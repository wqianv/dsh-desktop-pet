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
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

const DEFAULT_FRAMES: [u32; 9] = [6, 8, 8, 4, 5, 8, 6, 6, 6];

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
    dsh_url: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            pack_id: "whale".into(),
            size: 210,
            x: None,
            y: None,
            visible: true,
            dsh_url: "http://127.0.0.1:51183".into(),
        }
    }
}

fn project_root() -> PathBuf {
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
    project_root().join(".userdata").join("config.json")
}

fn log_msg(message: &str) {
    let path = project_root().join("pet.log");
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

/* ------------------------------------------------------------------ */
/* DSH 会话状态（只读 JSONL）                                          */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionView {
    session_id: String,
    title: String,
    phase: String,
    tool_family: Option<String>,
    active: bool,
    last_event_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PetState {
    phase: String,
    tool_family: Option<String>,
    active_count: usize,
    sessions: Vec<SessionView>,
    updated_at: u64,
}

impl Default for PetState {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            tool_family: None,
            active_count: 0,
            sessions: Vec::new(),
            updated_at: 0,
        }
    }
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
        updated_at: now,
    }
}

fn spawn_state_loop(app: AppHandle) {
    std::thread::spawn(move || {
        let mut ticks = 0u64;
        loop {
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
    is_dev: bool,
}

#[tauri::command]
fn bootstrap() -> Bootstrap {
    log_msg("bootstrap requested by frontend");
    Bootstrap {
        config: read_config(),
        packs: load_packs(),
        state: collect_state(),
        is_dev: cfg!(debug_assertions),
    }
}

#[tauri::command]
fn reload_packs() -> Vec<PackView> {
    load_packs()
}

#[tauri::command]
fn set_ignore(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
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

#[tauri::command]
fn open_dsh() {
    let config = read_config();
    let _ = std::process::Command::new("open").arg(config.dsh_url).status();
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
                Some(x >= left && x <= right && y >= top && y <= bottom)
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

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
    let recenter = MenuItem::with_id(app, "recenter", "移到当前屏幕", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&toggle, &recenter, &quit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

    TrayIconBuilder::with_id("pet-tray")
        .icon(icon)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => app.exit(0),
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
        })
        .build(app)?;
    Ok(())
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
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            reload_packs,
            poll_state,
            frontend_ready,
            frontend_log,
            set_ignore,
            start_drag,
            hide_pet,
            quit_app,
            open_dsh
        ])
        .setup(|app| {
            log_msg("setup: creating pet window");
            let window = app
                .get_webview_window("pet")
                .ok_or("missing pet window in tauri.conf.json")?;

            let config = read_config();
            let width = (config.size as f64 * 192.0 / 208.0) as u32 + 96;
            let height = config.size + 120;
            let _ = window.set_size(tauri::PhysicalSize::new(width, height));
            position_window(&window);

            window.set_ignore_cursor_events(true)?;
            window.set_always_on_top(true)?;
            if config.visible {
                window.show()?;
            }
            spawn_hover_loop(window.clone(), config.size);
            build_tray(app.handle())?;
            spawn_state_loop(app.handle().clone());
            write_config(&config);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running dsh-desktop-pet");
}
