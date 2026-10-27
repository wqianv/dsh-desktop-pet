//! DSH 桌宠 —— Tauri 2 版
//!
//! 真桌面窗：透明、无边框、置顶、点击穿透；Rust 侧负责窗口/托盘/状态桥。
//! 状态源（MVP）：只读 tail `$DSH_HOME/sessions/**/session.v4.jsonl.zstd`。
//! 宠物包：`pet-manifest-v2` 的 sprite2d 子集，目录在 `pets/`、`$DSH_HOME/pets/`、
//!          `~/.dsh-desktop-pet/pets/`。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[cfg(target_os = "macos")]
use objc2::{AnyThread, MainThreadMarker};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSApplication, NSImage};
#[cfg(target_os = "macos")]
use objc2_foundation::NSData;

const DEFAULT_FRAMES: [u32; 9] = [6, 8, 8, 4, 5, 8, 6, 6, 6];

/// 会话状态面板当前占用的逻辑高度（0 = 隐藏/折叠到没有）。
static OVERLAY_HEIGHT: OnceLock<Mutex<f64>> = OnceLock::new();

fn overlay_height() -> f64 {
    OVERLAY_HEIGHT
        .get_or_init(|| Mutex::new(0.0))
        .lock()
        .map(|value| *value)
        .unwrap_or(0.0)
}

/* ------------------------------------------------------------------ */
/* 配置                                                               */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    pack_id: String,
    size: u32,
    x: Option<i32>,
    y: Option<i32>,
    visible: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            pack_id: "dafeiyu".into(),
            size: 210,
            x: None,
            y: None,
            visible: true,
        }
    }
}

fn project_root() -> PathBuf {
    // 分发包：插件用 DSH_PET_ROOT 指向解压目录；手动双击时从 .app 位置推断父目录。
    if let Ok(root) = std::env::var("DSH_PET_ROOT") {
        if !root.is_empty() {
            return PathBuf::from(root);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        let mut cur = exe.as_path();
        while let Some(parent) = cur.parent() {
            if parent.extension().and_then(|s| s.to_str()) == Some("app") {
                return parent
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| parent.to_path_buf());
            }
            cur = parent;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn home_dir() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_default()
}

fn dsh_home() -> PathBuf {
    std::env::var("DSH_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home_dir().join(".dsh"))
}

fn config_path() -> PathBuf {
    if let Ok(path) = std::env::var("DSH_PET_CONFIG") {
        return PathBuf::from(path);
    }
    project_root().join(".userdata").join("config.json")
}

fn log_msg(message: &str) {
    let path = std::env::var("DSH_PET_LOG")
        .map(PathBuf::from)
        .unwrap_or_else(|_| project_root().join("pet.log"));
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        use std::io::Write as _;
        let _ = writeln!(file, "[{}] {}", now_ms(), message);
    }
}

fn read_config() -> Config {
    fs::read_to_string(config_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_config(config: &Config) {
    let path = config_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(text) = serde_json::to_string_pretty(config) {
        let _ = fs::write(path, text);
    }
}

/* ------------------------------------------------------------------ */
/* 共享设置（autoStart / 自定义图标）                                   */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct IconSettings {
    app: Option<String>,
    tray: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PetSettings {
    auto_start: bool,
    show_dock_icon: bool,
    show_tray_icon: bool,
    show_balance: bool,
    show_priority_sessions: bool,
    show_cost: bool,
    pack_id: Option<String>,
    icons: IconSettings,
}

impl Default for PetSettings {
    fn default() -> Self {
        Self {
            // 随 DSH 启动默认开启；图标默认不显示（右键桌宠可以打开）。
            auto_start: true,
            show_dock_icon: false,
            show_tray_icon: false,
            show_balance: true,
            show_priority_sessions: true,
            show_cost: true,
            pack_id: None,
            icons: IconSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DisplaySettings {
    show_balance: bool,
    show_priority_sessions: bool,
    show_cost: bool,
}

impl From<&PetSettings> for DisplaySettings {
    fn from(settings: &PetSettings) -> Self {
        Self {
            show_balance: settings.show_balance,
            show_priority_sessions: settings.show_priority_sessions,
            show_cost: settings.show_cost,
        }
    }
}

fn emit_display_settings(app: &AppHandle) {
    let _ = app.emit("pet:settings", DisplaySettings::from(&read_settings()));
}

fn settings_dir() -> PathBuf {
    home_dir().join(".dsh-desktop-pet")
}

fn settings_path() -> PathBuf {
    settings_dir().join("settings.json")
}

fn file_modified(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|meta| meta.modified()).ok()
}

fn settings_signature() -> (Option<SystemTime>, Option<SystemTime>, Option<SystemTime>) {
    (
        file_modified(&settings_path()),
        file_modified(&settings_dir().join("icons").join("app.png")),
        file_modified(&settings_dir().join("icons").join("tray.png")),
    )
}

fn read_settings() -> PetSettings {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_settings(settings: &PetSettings) {
    let _ = fs::create_dir_all(settings_dir());
    if let Ok(text) = serde_json::to_string_pretty(settings) {
        let temp = settings_path().with_extension("tmp");
        if fs::write(&temp, text).is_ok() {
            let _ = fs::rename(temp, settings_path());
        }
    }
}

/// 自定义图标的查找顺序：settings 里显式路径 → ~/.dsh-desktop-pet/icons/<kind>.png
/// → 当前宠物包目录的 <kind>.png。找不到就沿用内置图标（我们自己画的那套）。
fn apply_visibility(app: &AppHandle, settings: &PetSettings) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_dock_visibility(settings.show_dock_icon);
    }
    if let Some(tray) = app.tray_by_id("pet-tray") {
        let _ = tray.set_visible(settings.show_tray_icon);
    }
    log_msg(&format!(
        "settings: showDock={} showTray={}",
        settings.show_dock_icon, settings.show_tray_icon
    ));
}

fn configured_icon_path(kind: &str) -> Option<PathBuf> {
    let settings = read_settings();
    let configured = if kind == "app" {
        settings.icons.app
    } else {
        settings.icons.tray
    };
    if let Some(value) = configured {
        let candidate = PathBuf::from(value);
        let resolved = if candidate.is_absolute() {
            candidate
        } else {
            settings_dir().join(candidate)
        };
        if resolved.is_file() {
            return Some(resolved);
        }
    }
    let fallback = settings_dir().join("icons").join(format!("{kind}.png"));
    fallback.is_file().then_some(fallback)
}

fn find_pack_dir(pack_id: &str) -> Option<PathBuf> {
    for root in pack_roots() {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let Ok(text) = fs::read_to_string(dir.join("pet.json")) else {
                continue;
            };
            let Ok(manifest) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            let id = manifest
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    dir.file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("pet")
                        .to_string()
                });
            if id == pack_id {
                return Some(dir);
            }
        }
    }
    None
}

fn package_icon_path(kind: &str) -> Option<PathBuf> {
    let pack_id = read_config().pack_id;
    let dir = find_pack_dir(&pack_id)?;
    let path = dir.join(format!("{kind}.png"));
    path.is_file().then_some(path)
}

fn load_icon_bytes(kind: &str) -> Option<Vec<u8>> {
    if let Some(path) = configured_icon_path(kind) {
        if let Ok(bytes) = fs::read(path) {
            return Some(bytes);
        }
    }
    if let Some(path) = package_icon_path(kind) {
        if let Ok(bytes) = fs::read(path) {
            return Some(bytes);
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn set_dock_icon(bytes: &[u8]) -> bool {
    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    let data = unsafe {
        NSData::dataWithBytes_length(
            bytes.as_ptr() as *const std::ffi::c_void,
            bytes.len(),
        )
    };
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
        return false;
    };
    unsafe {
        NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image));
    }
    true
}

#[cfg(not(target_os = "macos"))]
fn set_dock_icon(_bytes: &[u8]) -> bool {
    false
}

/* ------------------------------------------------------------------ */
/* 宠物包                                                             */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
struct PackView {
    id: String,
    manifest: Value,
}

fn pack_roots() -> Vec<PathBuf> {
    vec![
        project_root().join("pets"),
        dsh_home().join("pets"),
        home_dir().join(".dsh-desktop-pet").join("pets"),
    ]
}

fn data_url_for(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let mime = if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else {
        "image/webp"
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{mime};base64,{b64}"))
}

fn load_one_pack(dir: &Path) -> Option<PackView> {
    let manifest_path = dir.join("pet.json");
    let text = fs::read_to_string(&manifest_path).ok()?;
    let mut manifest: Value = serde_json::from_str(&text).ok()?;

    let id = manifest
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            dir.file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("pet")
                .to_string()
        });

    let renderer = manifest
        .get("renderer")
        .and_then(Value::as_str)
        .unwrap_or("sprite2d");
    if renderer != "sprite2d" {
        return None;
    }

    let spritesheet = manifest
        .get("sprite2d")
        .and_then(|s| s.get("spritesheetPath"))
        .and_then(Value::as_str)
        .unwrap_or("spritesheet.webp")
        .to_string();
    let spritesheet_abs = dir.join(&spritesheet);
    if !spritesheet_abs.starts_with(dir) || !spritesheet_abs.exists() {
        return None;
    }
    let data_url = data_url_for(&spritesheet_abs)?;

    manifest["id"] = json!(id);
    manifest["renderer"] = json!("sprite2d");
    if manifest.get("displayName").is_none() {
        manifest["displayName"] = json!(id);
    }
    if manifest.get("license").is_none() {
        manifest["license"] = json!("UNKNOWN");
    }
    let (columns, atlas_rows) = (
        manifest
            .get("sprite2d")
            .and_then(|s| s.get("columns"))
            .and_then(Value::as_u64)
            .unwrap_or(8),
        manifest
            .get("sprite2d")
            .and_then(|s| s.get("atlasRows"))
            .and_then(Value::as_u64)
            .unwrap_or_else(|| {
                if manifest
                    .get("spriteVersionNumber")
                    .and_then(Value::as_u64)
                    .unwrap_or(1)
                    >= 2
                {
                    11
                } else {
                    9
                }
            }),
    );
    manifest["columns"] = json!(columns);
    manifest["atlasRows"] = json!(atlas_rows);
    if manifest.get("frames").is_none() {
        manifest["frames"] = json!(DEFAULT_FRAMES);
    }
    if manifest.get("tracks").is_none() {
        manifest["tracks"] = json!({});
    }
    if manifest.get("sequences").is_none() {
        manifest["sequences"] = json!({});
    }
    if manifest.get("cell").is_none() {
        manifest["cell"] = json!({ "width": 192, "height": 208 });
    }

    // 可选的行为配置：动画表、状态映射、交互、费用气泡模板。
    // 不写就由 renderer 用内置默认行为，保持旧 pet pack 兼容。
    let behavior_path = dir.join("behavior.json");
    if behavior_path.exists() && behavior_path.starts_with(dir) {
        if let Ok(text) = fs::read_to_string(&behavior_path) {
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                manifest["behavior"] = value;
            }
        }
    }

    manifest["spritesheetDataUrl"] = json!(data_url);

    Some(PackView { id, manifest })
}

fn load_packs() -> Vec<PackView> {
    let mut by_id: HashMap<String, PackView> = HashMap::new();
    for root in pack_roots() {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Some(pack) = load_one_pack(&path) {
                by_id.insert(pack.id.clone(), pack);
            }
        }
    }
    let mut packs: Vec<PackView> = by_id.into_values().collect();
    packs.sort_by(|a, b| {
        let an = a.manifest.get("displayName").and_then(Value::as_str).unwrap_or("");
        let bn = b.manifest.get("displayName").and_then(Value::as_str).unwrap_or("");
        an.cmp(bn)
    });
    packs
}

fn load_pack_by_id(pack_id: &str) -> Option<PackView> {
    let mut found: Option<PackView> = None;
    for root in pack_roots() {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let Ok(text) = fs::read_to_string(dir.join("pet.json")) else {
                continue;
            };
            let Ok(manifest) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            let id = manifest
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    dir.file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("pet")
                        .to_string()
                });
            if id == pack_id {
                if let Some(pack) = load_one_pack(&dir) {
                    found = Some(pack);
                }
            }
        }
    }
    found
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PackMeta {
    id: String,
    display_name: String,
    description: String,
    author: String,
    license: String,
    version: String,
}

fn list_pack_meta() -> Vec<PackMeta> {
    let mut by_id: HashMap<String, PackMeta> = HashMap::new();
    for root in pack_roots() {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let Ok(text) = fs::read_to_string(dir.join("pet.json")) else {
                continue;
            };
            let Ok(manifest) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            let id = manifest
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| {
                    dir.file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("pet")
                        .to_string()
                });
            let get = |key: &str| {
                manifest
                    .get(key)
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string()
            };
            by_id.insert(
                id.clone(),
                PackMeta {
                    id,
                    display_name: {
                        let name = get("displayName");
                        if name.is_empty() {
                            get("id")
                        } else {
                            name
                        }
                    },
                    description: get("description"),
                    author: get("author"),
                    license: get("license"),
                    version: get("version"),
                },
            );
        }
    }
    let mut packs: Vec<PackMeta> = by_id.into_values().collect();
    packs.sort_by(|a, b| a.display_name.cmp(&b.display_name));
    packs
}

fn activate_pack(app: &AppHandle, pack_id: &str) -> bool {
    let Some(pack) = load_pack_by_id(pack_id) else {
        log_msg(&format!("pack: not found {pack_id}"));
        return false;
    };
    let mut config = read_config();
    config.pack_id = pack.id.clone();
    write_config(&config);
    let mut settings = read_settings();
    settings.pack_id = Some(pack.id.clone());
    write_settings(&settings);
    let _ = app.emit("pet:pack", &pack);
    log_msg(&format!("pack: activated {}", pack.id));
    true
}

/// 菜单事件里直接加载 2.5MB 图集会卡菜单，延迟到事件返回后再切换。
fn activate_pack_deferred(app: &AppHandle, pack_id: &str) {
    let app = app.clone();
    let pack_id = pack_id.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        activate_pack(&app, &pack_id);
        schedule_tray_refresh(&app);
    });
}

/* ------------------------------------------------------------------ */
/* DSH 会话状态（只读 JSONL）                                          */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionView {
    session_id: String,
    title: String,
    phase: String,
    tool_family: Option<String>,
    active: bool,
    last_event_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reminder: Option<String>,
    #[serde(default)]
    attention_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PetState {
    phase: String,
    tool_family: Option<String>,
    active_count: usize,
    sessions: Vec<SessionView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cost: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    account: Option<Value>,
    updated_at: u64,
}

impl Default for PetState {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            tool_family: None,
            active_count: 0,
            sessions: Vec::new(),
            cost: None,
            account: None,
            updated_at: 0,
        }
    }
}

/// DSH 桌面端主进程是否还在（--managed 模式的兜底：DSH 被强杀时桌宠自己退出）。
fn dsh_running() -> bool {
    // 注意：DSH 主进程有时不出现在 pgrep -f 的结果里（macOS 的 argv 可见性差异），
    // 但它的 Helper 进程一定在；Helper 随 DSH 主进程退出而退出，足够做存活探测。
    let pattern = std::env::var("DSH_PET_DSH_PROC")
        .unwrap_or_else(|_| "DeepSeek Harness Helper".to_string());
    Command::new("/usr/bin/pgrep")
        .arg("-f")
        .arg(&pattern)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn tool_family(name: &str) -> &'static str {
    let n = name.to_lowercase();
    if n.starts_with("bash") || n.starts_with("shell") || n.starts_with("terminal") || n.starts_with("job_") {
        "shell"
    } else if n.starts_with("write") || n.starts_with("edit") || n.starts_with("apply_patch") {
        "edit"
    } else if n.starts_with("web_search") || n.starts_with("web_fetch") || n.starts_with("browser") {
        "web"
    } else if n.starts_with("read") || n.starts_with("glob") || n.starts_with("grep") {
        "read"
    } else if n.starts_with("spawn_teammate") || n.starts_with("team_task") || n.starts_with("todo_write") {
        "agent"
    } else {
        "mcp"
    }
}

fn priority(phase: &str) -> u8 {
    match phase {
        "failed" => 6,
        "waiting" => 5,
        "tool" => 4,
        "thinking" => 3,
        "review" => 2,
        "done" => 1,
        _ => 0,
    }
}

fn decode_session(path: &Path) -> Option<Vec<u8>> {
    let bytes = fs::read(path).ok()?;
    // 会话文件是 append-only 的多 frame zstd；decode_all 会连续解所有 frame。
    zstd::stream::decode_all(&bytes[..]).ok()
}

fn relative_age_ms(mtime_ms: u64, now: u64) -> u64 {
    now.saturating_sub(mtime_ms)
}

fn reduce_session(session_id: &str, events: &[Value], now: u64) -> SessionView {
    let mut active = false;
    let mut phase = "idle".to_string();
    let mut tool: Option<String> = None;
    let mut title = String::new();
    let mut last_event_at = 0u64;

    for ev in events {
        let ty = ev.get("type").and_then(Value::as_str).unwrap_or("");
        let data = ev.get("data").cloned().unwrap_or(Value::Null);
        let ts = ev.get("time").and_then(Value::as_u64).unwrap_or(last_event_at);

        match ty {
            "session/title" => {
                if let Some(t) = data.get("title").and_then(Value::as_str) {
                    title = t.to_string();
                }
            }
            "turn/start" => {
                active = true;
                phase = "thinking".into();
                tool = None;
                last_event_at = ts;
            }
            "step/start" => {
                if active {
                    phase = "thinking".into();
                }
                last_event_at = ts;
            }
            "tool/call" => {
                if active {
                    let name = data
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_string();
                    phase = if name == "ask_user_question" {
                        "waiting".into()
                    } else {
                        "tool".into()
                    };
                    tool = Some(name);
                }
                last_event_at = ts;
            }
            "tool/result" | "step/end" => {
                if active {
                    phase = "thinking".into();
                    tool = None;
                }
                last_event_at = ts;
            }
            "turn/end" => {
                let kind = data
                    .pointer("/reason/kind")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                active = false;
                tool = None;
                // DSH 的 Blocked 是“失败/系统错误”，不是“等你确认”；
                // 只有 approval/asked 与 ask_user_question 才是真正的等待。
                phase = match kind {
                    "completed" => "done",
                    "blocked" => "failed",
                    _ => "failed",
                }
                .into();
                last_event_at = ts;
            }
            "approval/asked" => {
                phase = "waiting".into();
                last_event_at = ts;
            }
            "approval/decided" => {
                // 用户已经处理过审批；回到工作态，不要一直卡在 waiting。
                phase = if active { "thinking" } else { "idle" }.into();
                last_event_at = ts;
            }
            _ => {}
        }
    }

    if !active && phase == "done" && now.saturating_sub(last_event_at) > 8_000 {
        phase = "idle".into();
    }
    if !active && phase == "failed" && now.saturating_sub(last_event_at) > 15_000 {
        phase = "idle".into();
    }
    if active && last_event_at > 0 && now.saturating_sub(last_event_at) > 120_000 {
        if phase == "waiting" && now.saturating_sub(last_event_at) <= 30 * 60_000 {
            // 审批/提问可以等很久；不要 2 分钟就吞掉“需要你”的状态。
        } else {
            active = false;
            phase = "idle".into();
            tool = None;
        }
    }
    if !active && phase == "thinking" && now.saturating_sub(last_event_at) > 15_000 {
        phase = "idle".into();
    }

    SessionView {
        session_id: session_id.to_string(),
        title,
        phase,
        tool_family: tool.as_deref().map(tool_family).map(str::to_string),
        active,
        last_event_at,
        reminder: None,
        attention_at: 0,
    }
}

fn list_session_files(max: usize) -> Vec<(PathBuf, String, u64)> {
    let root = dsh_home().join("sessions");
    let mut found = Vec::new();
    let Ok(workspaces) = fs::read_dir(&root) else {
        return found;
    };
    for ws in workspaces.flatten() {
        let ws_path = ws.path();
        if !ws_path.is_dir() {
            continue;
        }
        let Ok(sessions) = fs::read_dir(&ws_path) else {
            continue;
        };
        for session in sessions.flatten() {
            let session_path = session.path();
            if !session_path.is_dir() {
                continue;
            }
            let file = session_path.join("session.v4.jsonl.zstd");
            let Ok(meta) = fs::metadata(&file) else {
                continue;
            };
            let Ok(modified) = meta.modified() else {
                continue;
            };
            let mtime_ms = modified
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let session_id = session
                .file_name()
                .to_string_lossy()
                .to_string();
            found.push((file, session_id, mtime_ms));
        }
    }
    found.sort_by(|a, b| b.2.cmp(&a.2));
    found.truncate(max);
    found
}

#[derive(Clone)]
struct CachedSession {
    mtime_ms: u64,
    size: u64,
    state: SessionView,
}

fn session_cache() -> &'static Mutex<HashMap<PathBuf, CachedSession>> {
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, CachedSession>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn bridge_state_path() -> PathBuf {
    home_dir().join(".dsh-desktop-pet").join("state.json")
}

/// DSH host 插件写的桥状态（比重新解压 session JSONL 便宜得多）。
/// 文件超过 30s 没更新就认为 bridge 不在了，回退到 JSONL。
fn read_bridge_state() -> Option<PetState> {
    let path = bridge_state_path();
    let meta = fs::metadata(&path).ok()?;
    let modified = meta.modified().ok()?;
    let age = SystemTime::now().duration_since(modified).ok()?;
    if age > Duration::from_secs(30) {
        return None;
    }
    let text = fs::read_to_string(&path).ok()?;
    let state: PetState = serde_json::from_str(&text).ok()?;
    if state.phase.is_empty() {
        return None;
    }
    Some(state)
}

/// 终态回落（done/failed/thinking 超时 → idle）在每次读取时都重新计算，
/// 这样文件没变时也能按时间自然回到 idle。
fn settle(mut view: SessionView, now: u64) -> SessionView {
    if !view.active && view.phase == "done" && now.saturating_sub(view.last_event_at) > 8_000 {
        view.phase = "idle".into();
    }
    if !view.active && view.phase == "failed" && now.saturating_sub(view.last_event_at) > 15_000 {
        view.phase = "idle".into();
    }
    if view.active && view.last_event_at > 0 && now.saturating_sub(view.last_event_at) > 120_000 {
        view.active = false;
        view.phase = "idle".into();
        view.tool_family = None;
    }
    if !view.active && view.phase == "thinking" && now.saturating_sub(view.last_event_at) > 15_000 {
        view.phase = "idle".into();
    }
    view
}

fn collect_state() -> PetState {
    if let Some(state) = read_bridge_state() {
        return state;
    }
    let now = now_ms();
    let mut sessions: Vec<SessionView> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();

    for (file, session_id, mtime_ms) in list_session_files(8) {
        if relative_age_ms(mtime_ms, now) > 30 * 60 * 1000 {
            continue;
        }
        seen.insert(file.clone());

        // 关键优化：会话文件可能几 MB，不能每秒重复解压。
        // 只有 mtime/size 变化才重新解码，其余时间复用缓存里的 SessionView。
        let meta = fs::metadata(&file).ok();
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let cached = session_cache()
            .lock()
            .ok()
            .and_then(|cache| cache.get(&file).cloned())
            .filter(|entry| entry.mtime_ms == mtime_ms && entry.size == size);

        let view = if let Some(entry) = cached {
            entry.state
        } else {
            let Some(decoded) = decode_session(&file) else {
                continue;
            };
            let mut events: Vec<Value> = Vec::new();
            for line in decoded.split(|b| *b == b'\n') {
                if line.is_empty() {
                    continue;
                }
                if let Ok(value) = serde_json::from_slice::<Value>(line) {
                    events.push(value);
                }
            }
            if events.is_empty() {
                continue;
            }
            let state = reduce_session(&session_id, &events, now);
            if let Ok(mut cache) = session_cache().lock() {
                cache.insert(
                    file.clone(),
                    CachedSession {
                        mtime_ms,
                        size,
                        state: state.clone(),
                    },
                );
            }
            state
        };
        sessions.push(settle(view, now));
    }

    // 清掉已不存在的会话缓存
    if let Ok(mut cache) = session_cache().lock() {
        cache.retain(|path, _| seen.contains(path));
    }

    sessions.sort_by(|a, b| {
        let p = priority(&b.phase).cmp(&priority(&a.phase));
        if p != std::cmp::Ordering::Equal {
            p
        } else {
            b.last_event_at.cmp(&a.last_event_at)
        }
    });

    let active_count = sessions
        .iter()
        .filter(|s| s.active || s.phase == "waiting" || s.phase == "failed")
        .count();
    let display = sessions.first();

    PetState {
        phase: display.map(|s| s.phase.clone()).unwrap_or_else(|| "idle".into()),
        tool_family: display.and_then(|s| s.tool_family.clone()),
        active_count,
        sessions,
        cost: None,
        account: None,
        updated_at: now,
    }
}

fn selected_pack_signature() -> (Option<SystemTime>, Option<SystemTime>, Option<SystemTime>, Option<SystemTime>) {
    let Some(dir) = find_pack_dir(&read_config().pack_id) else {
        return (None, None, None, None);
    };
    (
        file_modified(&dir.join("pet.json")),
        file_modified(&dir.join("behavior.json")),
        file_modified(&dir.join("spritesheet.webp")),
        file_modified(&dir.join("spritesheet.png")),
    )
}

fn spawn_state_loop(app: AppHandle) {
    std::thread::spawn(move || {
        let mut ticks = 0u64;
        let mut last_settings_sig = settings_signature();
        let mut last_pack_sig = selected_pack_signature();
        loop {
            // DSH 设置页 / 手动编辑 settings.json 或 icons/*.png 后，1s 内应用。
            let sig = settings_signature();
            if sig != last_settings_sig {
                last_settings_sig = sig;
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    let settings = read_settings();
                    if let Some(pack_id) = settings.pack_id.clone() {
                        if pack_id != read_config().pack_id {
                            activate_pack(&handle, &pack_id);
                        }
                    }
                    rebuild_tray(&handle);
                    apply_icons(&handle);
                    emit_display_settings(&handle);
                    log_msg("settings: reloaded from external file change");
                });
            }
            // 当前 pack 的文件被编辑（热更新）时重新加载并推给前端。
            let pack_sig = selected_pack_signature();
            if pack_sig != last_pack_sig {
                last_pack_sig = pack_sig;
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    let pack_id = read_config().pack_id;
                    if let Some(pack) = load_pack_by_id(&pack_id) {
                        let _ = handle.emit("pet:pack", &pack);
                        log_msg(&format!("pack: hot reloaded {pack_id}"));
                    }
                });
            }
            let state = collect_state();
            if ticks < 5 || ticks % 60 == 0 {
                log_msg(&format!(
                    "state tick: phase={} sessions={}",
                    state.phase,
                    state.sessions.len()
                ));
            }
            ticks += 1;
            let _ = app.emit("pet:state", &state);
            std::thread::sleep(Duration::from_millis(1000));
        }
    });
}

/* ------------------------------------------------------------------ */
/* Tauri commands                                                     */
/* ------------------------------------------------------------------ */

#[tauri::command]
fn poll_state() -> PetState {
    collect_state()
}

#[tauri::command]
fn frontend_log(message: String) {
    log_msg(&format!("frontend: {message}"));
}

#[tauri::command]
fn frontend_ready(width: f64, height: f64, dpr: f64) {
    log_msg(&format!(
        "frontend ready: viewport={}x{} dpr={}",
        width, height, dpr
    ));
}

#[derive(Serialize)]
struct Bootstrap {
    config: Config,
    packs: Vec<PackView>,
    state: PetState,
    settings: DisplaySettings,
    is_dev: bool,
}

#[tauri::command]
fn bootstrap() -> Bootstrap {
    log_msg("bootstrap requested by frontend");
    Bootstrap {
        config: read_config(),
        packs: load_packs(),
        state: collect_state(),
        settings: DisplaySettings::from(&read_settings()),
        is_dev: cfg!(debug_assertions),
    }
}

#[tauri::command]
fn get_settings() -> DisplaySettings {
    DisplaySettings::from(&read_settings())
}

#[tauri::command]
fn reload_packs() -> Vec<PackView> {
    load_packs()
}

#[tauri::command]
fn list_packs() -> Vec<PackMeta> {
    list_pack_meta()
}

#[tauri::command]
fn set_pack(app: AppHandle, pack_id: String) -> Result<PackView, String> {
    let pack = load_pack_by_id(&pack_id).ok_or_else(|| format!("pack not found: {pack_id}"))?;
    activate_pack(&app, &pack.id);
    Ok(pack)
}

fn balance_text(account: Option<&Value>) -> String {
    let Some(account) = account else {
        return "余额 未加载".into();
    };
    let status = account.get("status").and_then(Value::as_str).unwrap_or("");
    if status != "ready" {
        return if status == "signed-out" { "余额 未登录".into() } else { "余额 不可用".into() };
    }
    let mut cny = 0.0f64;
    let mut usd = 0.0f64;
    for key in ["wallets", "bonusWallets"] {
        let Some(list) = account.get(key).and_then(Value::as_array) else {
            continue;
        };
        for wallet in list {
            let currency = wallet.get("currency").and_then(Value::as_str).unwrap_or("");
            let value = wallet
                .get("balance")
                .and_then(Value::as_str)
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(0.0);
            match currency {
                "CNY" => cny += value,
                "USD" => usd += value,
                _ => {}
            }
        }
    }
    if cny > 0.0 || usd == 0.0 {
        format!("余额 ¥{cny:.2}")
    } else {
        format!("余额 ${usd:.2}")
    }
}

fn priority_submenu(app: &AppHandle, prefix: &str) -> tauri::Result<Submenu<tauri::Wry>> {
    let state = collect_state();
    let mut priority: Vec<&SessionView> = state
        .sessions
        .iter()
        .filter(|session| session.phase == "waiting" || session.phase == "failed")
        .collect();
    priority.sort_by_key(|session| if session.phase == "waiting" { 0 } else { 1 });
    priority.truncate(5);

    let mut items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    if priority.is_empty() {
        items.push(MenuItem::with_id(
            app,
            format!("{prefix}-prio-empty"),
            "无高优会话",
            false,
            None::<&str>,
        )?);
    } else {
        for (index, session) in priority.iter().enumerate() {
            let title = if session.title.trim().is_empty() {
                let suffix = &session.session_id[session.session_id.len().saturating_sub(6)..];
                format!("会话 {suffix}")
            } else {
                session.title.chars().take(42).collect()
            };
            let phase = if session.phase == "waiting" { "等待确认" } else { "出错" };
            items.push(MenuItem::with_id(
                app,
                format!("{prefix}-prio-{index}"),
                format!("{phase} · {title}"),
                false,
                None::<&str>,
            )?);
        }
    }
    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items.iter().map(|item| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect();
    Submenu::with_items(app, format!("高优会话 ({})", priority.len()), true, &refs)
}

fn choose_png() -> Option<PathBuf> {
    let script = r#"POSIX path of (choose file with prompt "选择 PNG 图标")"#;
    let output = Command::new("osascript").arg("-e").arg(script).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    let bytes = fs::read(&path).ok()?;
    if !bytes.starts_with(b"\x89PNG") {
        log_msg(&format!("icon: picked file is not PNG: {}", path.display()));
        return None;
    }
    Some(path)
}

fn install_icon(kind: &str, source: &Path) -> bool {
    let bytes = match fs::read(source) {
        Ok(bytes) => bytes,
        Err(_) => return false,
    };
    if !bytes.starts_with(b"\x89PNG") {
        return false;
    }
    let dir = settings_dir().join("icons");
    if fs::create_dir_all(&dir).is_err() {
        return false;
    }
    let target = dir.join(format!("{kind}.png"));
    if fs::write(&target, &bytes).is_err() {
        return false;
    }
    let mut settings = read_settings();
    let relative = format!("icons/{kind}.png");
    if kind == "app" {
        settings.icons.app = Some(relative);
    } else {
        settings.icons.tray = Some(relative);
    }
    write_settings(&settings);
    log_msg(&format!("icon: installed {} -> {}", kind, target.display()));
    true
}

fn apply_default_icons(app: &AppHandle) {
    let app = app.clone();
    let _ = app.clone().run_on_main_thread(move || {
        let _ = set_dock_icon(include_bytes!("../icons/128x128@2x.png"));
        if let Some(tray) = app.tray_by_id("pet-tray") {
            if let Ok(image) = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png")) {
                let _ = tray.set_icon(Some(image));
            }
        }
    });
}

fn handle_icon_action(app: &AppHandle, action: &str) {
    let app = app.clone();
    let action = action.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(250));
        match action.as_str() {
            "dock" | "tray" => {
                let kind = if action == "dock" { "app" } else { "tray" };
                let Some(path) = choose_png() else {
                    log_msg("icon: picker cancelled or non-PNG");
                    return;
                };
                if !install_icon(kind, &path) {
                    log_msg("icon: install failed");
                    return;
                }
                let app_main = app.clone();
                let _ = app.run_on_main_thread(move || {
                    apply_icons(&app_main);
                    schedule_tray_refresh(&app_main);
                });
            }
            "open" => {
                let dir = settings_dir().join("icons");
                let _ = fs::create_dir_all(&dir);
                let _ = Command::new("open").arg(dir).status();
            }
            "reload" => {
                let app_main = app.clone();
                let _ = app.run_on_main_thread(move || apply_icons(&app_main));
            }
            "reset" => {
                let mut settings = read_settings();
                settings.icons.app = None;
                settings.icons.tray = None;
                write_settings(&settings);
                for name in ["app.png", "tray.png"] {
                    let _ = fs::remove_file(settings_dir().join("icons").join(name));
                }
                apply_default_icons(&app);
                let app_main = app.clone();
                let _ = app.run_on_main_thread(move || {
                    apply_icons(&app_main);
                    schedule_tray_refresh(&app_main);
                });
            }
            _ => {}
        }
    });
}

fn icon_submenu(app: &AppHandle, prefix: &str) -> tauri::Result<Submenu<tauri::Wry>> {
    let dock = MenuItem::with_id(app, format!("{prefix}-icon-dock"), "选择 Dock 图标…", true, None::<&str>)?;
    let tray = MenuItem::with_id(app, format!("{prefix}-icon-tray"), "选择菜单栏图标…", true, None::<&str>)?;
    let open = MenuItem::with_id(app, format!("{prefix}-icon-open"), "打开图标目录…", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, format!("{prefix}-icon-reload"), "重载自定义图标", true, None::<&str>)?;
    let reset = MenuItem::with_id(app, format!("{prefix}-icon-reset"), "恢复默认图标", true, None::<&str>)?;
    Submenu::with_items(app, "自定义图标", true, &[&dock, &tray, &open, &reload, &reset])
}

fn pack_submenu(app: &AppHandle, prefix: &str) -> tauri::Result<Submenu<tauri::Wry>> {
    let packs = list_pack_meta();
    let current = read_config().pack_id;
    let mut items: Vec<CheckMenuItem<tauri::Wry>> = Vec::new();
    if packs.is_empty() {
        items.push(CheckMenuItem::with_id(
            app,
            format!("{prefix}-pack-empty"),
            "没有可用宠物包",
            false,
            false,
            None::<&str>,
        )?);
    } else {
        for pack in packs.iter().take(20) {
            items.push(CheckMenuItem::with_id(
                app,
                format!("{prefix}-pack:{}", pack.id),
                format!("{}{}", pack.display_name, if pack.id == current { "  ✓" } else { "" }),
                true,
                pack.id == current,
                None::<&str>,
            )?);
        }
    }
    let refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = items
        .iter()
        .map(|item| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    Submenu::with_items(app, "更换形象", true, &refs)
}

fn settings_submenu(app: &AppHandle, prefix: &str) -> tauri::Result<Submenu<tauri::Wry>> {
    let settings = read_settings();
    let balance = CheckMenuItem::with_id(app, format!("{prefix}-balance"), "显示余额", true, settings.show_balance, None::<&str>)?;
    let priority = CheckMenuItem::with_id(app, format!("{prefix}-priority"), "显示高优会话", true, settings.show_priority_sessions, None::<&str>)?;
    let cost = CheckMenuItem::with_id(app, format!("{prefix}-cost"), "显示费用气泡", true, settings.show_cost, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(app, format!("{prefix}-autostart"), "随 DSH 启动", true, settings.auto_start, None::<&str>)?;
    let dock = CheckMenuItem::with_id(app, format!("{prefix}-dock"), "显示 Dock 图标", true, settings.show_dock_icon, None::<&str>)?;
    let tray = CheckMenuItem::with_id(app, format!("{prefix}-tray"), "显示菜单栏图标", true, settings.show_tray_icon, None::<&str>)?;
    let icons = icon_submenu(app, prefix)?;
    Submenu::with_items(
        app,
        "设置",
        true,
        &[&balance, &priority, &cost, &autostart, &dock, &tray, &icons],
    )
}

/// 在菜单事件回调里同步 remove/build tray 会死锁（Tauri tray register 会等菜单事件锁）。
/// 所有菜单触发的设置变更先落盘 + 通知前端，等菜单事件返回后再重建托盘/应用可见性。
fn schedule_tray_refresh(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(250));
        let app_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            rebuild_tray(&app_main);
        });
    });
}

fn toggle_setting(app: &AppHandle, key: &str) {
    let mut settings = read_settings();
    match key {
        "balance" => settings.show_balance = !settings.show_balance,
        "priority" => settings.show_priority_sessions = !settings.show_priority_sessions,
        "cost" => settings.show_cost = !settings.show_cost,
        "autostart" => settings.auto_start = !settings.auto_start,
        "dock" => settings.show_dock_icon = !settings.show_dock_icon,
        "tray" => settings.show_tray_icon = !settings.show_tray_icon,
        _ => return,
    }
    write_settings(&settings);
    emit_display_settings(app);
    schedule_tray_refresh(app);
    log_msg(&format!("settings toggled: {key} -> {settings:?}"));
}

#[tauri::command]
fn show_context_menu(window: WebviewWindow) -> Result<(), String> {
    log_msg("show_context_menu invoked");
    let settings = read_settings();
    let state = collect_state();
    let settings_menu = settings_submenu(window.app_handle(), "ctx-set").map_err(|e| e.to_string())?;
    let priority_menu = priority_submenu(window.app_handle(), "ctx").map_err(|e| e.to_string())?;
    let pack_menu = pack_submenu(window.app_handle(), "ctx").map_err(|e| e.to_string())?;
    let balance_item = MenuItem::with_id(
        &window,
        "ctx-balance",
        balance_text(state.account.as_ref()),
        false,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let show_icons = MenuItem::with_id(
        &window,
        "ctx-icons",
        "显示图标（Dock + 菜单栏）",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let open_dsh_item = MenuItem::with_id(&window, "ctx-open-dsh", "打开 DSH 窗口", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(&window, "ctx-quit", "退出", true, None::<&str>)
        .map_err(|e| e.to_string())?;

    let mut items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = Vec::new();
    if settings.show_balance {
        items.push(&balance_item);
    }
    if settings.show_priority_sessions {
        items.push(&priority_menu);
    }
    items.push(&pack_menu);
    items.push(&settings_menu);
    items.push(&show_icons);
    items.push(&open_dsh_item);
    items.push(&quit);
    let menu = Menu::with_items(&window, &items).map_err(|e| e.to_string())?;
    log_msg("context menu shown");
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_ignore(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_overlay_height(app: AppHandle, height: f64) -> Result<(), String> {
    let height = height.clamp(0.0, 420.0);
    let state = OVERLAY_HEIGHT.get_or_init(|| Mutex::new(0.0));
    let previous = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        let old = *guard;
        *guard = height;
        old
    };
    if (previous - height).abs() < 0.5 {
        return Ok(());
    }
    let Some(window) = app.get_webview_window("pet") else {
        return Ok(());
    };
    let config = read_config();
    let base_width = config.size as f64 * 192.0 / 208.0 + 96.0;
    let base_height = config.size as f64 + 120.0;
    let old_pos = window.outer_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    // set_size 后 outer_size 可能还是旧值；用逻辑高度差换算物理位移，保证窗口上沿向上长、底边不动。
    let delta = height - previous;
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize::new(base_width, base_height + height)))
        .map_err(|e| e.to_string())?;
    let new_y = old_pos.y - (delta * scale).round() as i32;
    let _ = window.set_position(tauri::PhysicalPosition::new(old_pos.x, new_y));
    log_msg(&format!(
        "overlay: height={height:.1} delta={delta:.1} -> y={new_y} logical={}x{}",
        base_width,
        base_height + height
    ));
    Ok(())
}

#[tauri::command]
fn ack_session(session_id: String) -> Result<(), String> {
    let dir = settings_dir();
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("acks.json");
    let mut value = fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| json!({}));
    if !value.is_object() {
        value = json!({});
    }
    if let Some(map) = value.as_object_mut() {
        map.insert(session_id.clone(), json!(now_ms()));
    }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, serde_json::to_string(&value).unwrap_or_else(|_| "{}".into()))
        .map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| e.to_string())?;
    log_msg(&format!("session ack: {session_id}"));
    Ok(())
}

#[tauri::command]
fn start_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_pet(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn open_dsh_app() {
    // 不要用 config 里可能过期的 web URL；直接激活 DSH 桌面应用。
    let by_bundle = Command::new("open")
        .args(["-b", "com.deepseek.dsh"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if by_bundle {
        return;
    }
    let by_name = Command::new("open")
        .args(["-a", "DeepSeek Harness"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);
    if !by_name {
        let _ = Command::new("open")
            .arg("/Applications/DeepSeek Harness.app")
            .status();
    }
}

#[tauri::command]
fn open_dsh() {
    open_dsh_app();
}

/* ------------------------------------------------------------------ */
/* 窗口与托盘                                                         */
/* ------------------------------------------------------------------ */

fn position_window(window: &WebviewWindow) {
    // 优先放到“鼠标当前所在的那块屏”；多屏时避免把宠物放到用户没看的那块。
    let cursor = window.cursor_position().ok();
    let monitors = window.available_monitors().unwrap_or_default();
    let mut bounds: Option<(i32, i32, u32, u32, f64)> = None;

    if let Some(cursor) = cursor {
        for monitor in &monitors {
            let origin = monitor.position();
            let size = monitor.size();
            let inside = cursor.x >= origin.x as f64
                && cursor.x < (origin.x + size.width as i32) as f64
                && cursor.y >= origin.y as f64
                && cursor.y < (origin.y + size.height as i32) as f64;
            if inside {
                bounds = Some((
                    origin.x,
                    origin.y,
                    size.width,
                    size.height,
                    monitor.scale_factor(),
                ));
                break;
            }
        }
    }

    if bounds.is_none() {
        if let Ok(Some(monitor)) = window.current_monitor() {
            let origin = monitor.position();
            let size = monitor.size();
            bounds = Some((
                origin.x,
                origin.y,
                size.width,
                size.height,
                monitor.scale_factor(),
            ));
        }
    }

    if let Some((ox, oy, sw, sh, scale)) = bounds {
        let win = window
            .outer_size()
            .unwrap_or(tauri::PhysicalSize::new(271, 310));
        let x = ox + sw as i32 - win.width as i32 - (24.0 * scale) as i32;
        let y = oy + sh as i32 - win.height as i32 - (80.0 * scale) as i32;
        log_msg(&format!(
            "position: display={}x{} scale={} -> ({},{})",
            sw, sh, scale, x, y
        ));
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

/// Tauri 的 set_ignore_cursor_events 没有 Electron 的 {forward:true}：
/// 一旦整窗穿透，webview 收不到 mousemove，前端无法自己检测“指针进入宠物”。
/// 这里在 Rust 侧以 100ms 轮询全局光标 + 窗口位置，命中宠物矩形才切回可交互。
fn spawn_hover_loop(window: WebviewWindow, pet_size: u32) {
    std::thread::spawn(move || {
        let mut last_inside: Option<bool> = None;
        loop {
            let inside = (|| -> Option<bool> {
                let pos = window.outer_position().ok()?;
                let cur = window.cursor_position().ok()?;
                let size = window.outer_size().ok()?;
                let scale = window.scale_factor().ok()?;

                let pet_w = pet_size as f64 * scale;
                let pet_h = pet_w * 208.0 / 192.0;
                let pad = 10.0 * scale;
                let left = (size.width as f64 - pet_w) / 2.0 - pad;
                let right = left + pet_w + pad * 2.0;
                let bottom = size.height as f64 - 6.0 * scale;
                let top = bottom - pet_h - pad;

                let x = cur.x - pos.x as f64;
                let y = cur.y - pos.y as f64;
                let pet_hit = x >= left && x <= right && y >= top && y <= bottom;

                // 上方状态面板也必须是可点击区域，否则点折叠/清除会穿透。
                let panel_h = overlay_height() * scale;
                let panel_hit = panel_h > 4.0
                    && y >= 0.0
                    && y <= panel_h + 18.0 * scale
                    && x >= 8.0 * scale
                    && x <= size.width as f64 - 8.0 * scale;
                Some(pet_hit || panel_hit)
            })();

            if let Some(inside) = inside {
                if last_inside != Some(inside) {
                    let _ = window.set_ignore_cursor_events(!inside);
                    if last_inside.is_some() {
                        log_msg(&format!("hover: interactive={}", inside));
                    }
                    last_inside = Some(inside);
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
}

fn apply_icons(app: &AppHandle) {
    let custom_app = load_icon_bytes("app");
    let app_bytes = custom_app
        .clone()
        .unwrap_or_else(|| include_bytes!("../icons/128x128@2x.png").to_vec());
    let _ = app.run_on_main_thread(move || {
        let ok = set_dock_icon(&app_bytes);
        log_msg(&format!(
            "icon: app {} applied={ok}",
            if custom_app.is_some() { "custom" } else { "default" }
        ));
    });

    let custom_tray = load_icon_bytes("tray");
    let tray_bytes = custom_tray
        .clone()
        .unwrap_or_else(|| include_bytes!("../icons/32x32.png").to_vec());
    if let Some(tray) = app.tray_by_id("pet-tray") {
        match tauri::image::Image::from_bytes(&tray_bytes) {
            Ok(image) => {
                let _ = tray.set_icon(Some(image));
                log_msg(&format!(
                    "icon: tray {} applied",
                    if custom_tray.is_some() { "custom" } else { "default" }
                ));
            }
            Err(err) => log_msg(&format!("icon: tray apply failed: {err}")),
        }
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let settings = read_settings();
    let state = collect_state();
    let settings_menu = settings_submenu(app, "set")?;
    let priority_menu = priority_submenu(app, "tray")?;
    let pack_menu = pack_submenu(app, "tray")?;
    let balance_item = MenuItem::with_id(
        app,
        "tray-balance",
        balance_text(state.account.as_ref()),
        false,
        None::<&str>,
    )?;
    let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
    let reload_icons = MenuItem::with_id(app, "reload-icons", "重载自定义图标", true, None::<&str>)?;
    let open_icons = MenuItem::with_id(app, "open-icons", "打开图标目录…", true, None::<&str>)?;
    let recenter = MenuItem::with_id(app, "recenter", "移到当前屏幕", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let mut items: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = Vec::new();
    if settings.show_balance {
        items.push(&balance_item);
    }
    if settings.show_priority_sessions {
        items.push(&priority_menu);
    }
    items.push(&pack_menu);
    items.push(&settings_menu);
    items.push(&toggle);
    items.push(&reload_icons);
    items.push(&open_icons);
    items.push(&recenter);
    items.push(&quit);
    let menu = Menu::with_items(app, &items)?;

    let custom_tray = load_icon_bytes("tray");
    let icon = match custom_tray.as_ref() {
        Some(bytes) => tauri::image::Image::from_bytes(bytes)?,
        None => tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?,
    };

    TrayIconBuilder::with_id("pet-tray")
        .icon(icon)
        .menu(&menu)
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            if let Some(pack_id) = id.strip_prefix("tray-pack:") {
                activate_pack_deferred(app, pack_id);
                return;
            }
            if let Some(action) = id.strip_prefix("set-icon-") {
                handle_icon_action(app, action);
                return;
            }
            if let Some(key) = id.strip_prefix("set-") {
                toggle_setting(app, key);
                return;
            }
            match id {
                "quit" => app.exit(0),
                "reload-icons" => apply_icons(app),
                "open-icons" => {
                    let dir = settings_dir().join("icons");
                    let _ = fs::create_dir_all(&dir);
                    let _ = Command::new("open").arg(&dir).status();
                }
                "toggle" => {
                    if let Some(window) = app.get_webview_window("pet") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_always_on_top(true);
                        }
                    }
                }
                "recenter" => {
                    if let Some(window) = app.get_webview_window("pet") {
                        let _ = window.show();
                        position_window(&window);
                    }
                }
                _ => {}
            }
        })
        .build(app)?;
    Ok(())
}

fn rebuild_tray(app: &AppHandle) {
    let _ = app.remove_tray_by_id("pet-tray");
    let _ = build_tray(app);
    let settings = read_settings();
    apply_visibility(app, &settings);
}

/* ------------------------------------------------------------------ */
/* 启动                                                               */
/* ------------------------------------------------------------------ */

fn main() {
    if std::env::args().any(|arg| arg == "--diagnose") {
        let state = collect_state();
        println!("{}", serde_json::to_string_pretty(&state).unwrap());
        let packs = load_packs();
        println!("packs: {:?}", packs.iter().map(|p| p.id.clone()).collect::<Vec<_>>());
        return;
    }

    tauri::Builder::default()
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(pack_id) = id.strip_prefix("ctx-pack:") {
                activate_pack_deferred(app, pack_id);
                return;
            }
            if let Some(action) = id.strip_prefix("ctx-set-icon-") {
                handle_icon_action(app, action);
                return;
            }
            if let Some(key) = id.strip_prefix("ctx-set-") {
                toggle_setting(app, key);
                return;
            }
            match id {
                "ctx-icons" => {
                    let mut settings = read_settings();
                    let visible = settings.show_dock_icon || settings.show_tray_icon;
                    settings.show_dock_icon = !visible;
                    settings.show_tray_icon = !visible;
                    write_settings(&settings);
                    emit_display_settings(app);
                    schedule_tray_refresh(app);
                }
                "ctx-open-dsh" => open_dsh_app(),
                "ctx-quit" => app.exit(0),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            reload_packs,
            list_packs,
            set_pack,
            poll_state,
            frontend_ready,
            frontend_log,
            get_settings,
            set_overlay_height,
            ack_session,
            set_ignore,
            show_context_menu,
            start_drag,
            hide_pet,
            quit_app,
            open_dsh
        ])
        .setup(|app| {
            log_msg(&format!(
                "setup: args={:?} managed_env={:?}",
                std::env::args().collect::<Vec<_>>(),
                std::env::var("DSH_PET_MANAGED").ok()
            ));
            let window = app
                .get_webview_window("pet")
                .ok_or("missing pet window in tauri.conf.json")?;

            let mut config = read_config();
            let mut startup_settings = read_settings();
            if let Some(pack_id) = startup_settings.pack_id.clone() {
                if find_pack_dir(&pack_id).is_some() {
                    config.pack_id = pack_id;
                } else {
                    // 选中的 pack 被删掉/改名了：回落到 config 里的上一个有效 pack。
                    log_msg(&format!("pack: selected {pack_id} missing, fallback to {}", config.pack_id));
                    startup_settings.pack_id = Some(config.pack_id.clone());
                    write_settings(&startup_settings);
                }
            } else {
                startup_settings.pack_id = Some(config.pack_id.clone());
                write_settings(&startup_settings);
            }
            // config.size 是 CSS 逻辑像素：必须用 LogicalSize，不能把物理像素当逻辑像素。
            // Retina 屏上 PhysicalSize(280,320) 的 CSS viewport 只有 140×160，会把 200px 的宠物裁掉头/两侧。
            let width = (config.size as f64 * 192.0 / 208.0) + 96.0;
            let height = config.size as f64 + 120.0;
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)));
            position_window(&window);

            window.set_ignore_cursor_events(true)?;
            window.set_always_on_top(true)?;
            if config.visible {
                window.show()?;
            }
            spawn_hover_loop(window.clone(), config.size);
            build_tray(app.handle())?;
            apply_icons(app.handle());
            let initial_settings = read_settings();
            apply_visibility(app.handle(), &initial_settings);

            spawn_state_loop(app.handle().clone());
            write_config(&config);

            // 由 DSH 启动器插件拉起时带 --managed：DSH 退出/被强杀后自己退出，
            // 避免留下一个没有 DSH 可看的桌宠进程。
            if std::env::args().any(|arg| arg == "--managed")
                || std::env::var("DSH_PET_MANAGED").ok().as_deref() == Some("1")
            {
                log_msg("managed mode: watching DSH process");
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    // 刚被 DSH 拉起时给它一点启动宽限，避免 Helper 还没起全就误判。
                    std::thread::sleep(Duration::from_secs(5));
                    loop {
                        if !dsh_running() {
                            log_msg("managed mode: DSH is gone, exiting");
                            handle.exit(0);
                            break;
                        }
                        std::thread::sleep(Duration::from_secs(3));
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running dsh-desktop-pet");
}
