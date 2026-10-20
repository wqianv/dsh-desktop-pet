# Third-party notices

本项目默认宠物包都来自社区开源素材；**代码/适配清单与宠物素材分开授权**。每个 `pets/<id>/` 目录里的 `LICENSE` / `NOTICE.md` 是具体条款，公开发布或商用前请以那些文件为准。

## 吃白饭的蓝色大肥鱼（`pets/dafeiyu/`）

- 来源：https://github.com/PC2005-cloud/dsh-pet
- 代码：MIT License, Copyright (c) 2026 PC2005-cloud。
- 素材（动画/提示词/源视频）：上游 README 写明「允许开源使用，禁止商用」；本项目按非商业 fan art 处理。
- 用 `tools/make-dafeiyu-pet.py` 从 16 段透明 VP9 WebM 抽帧拼成 1536×3536 图集；没有重绘。

## 大肥鱼·鲸鲸娘（`pets/jingjing/`）

- 来源：https://github.com/zhouwu97/ds-pet
- 许可：MIT License, Copyright (c) 2026 zhouwu97（见 `pets/jingjing/LICENSE`）。
- 图集：`codex/jingjing-spritesheet.png`（1536×2288，8×11，57 动作帧 + 16 方向帧）。
- 角色为「若叶睦」形态粉丝二创；角色/IP 权利归原权利方，上游 MIT 只覆盖其有权许可的部分。

## 鲸鱼娘·像素（`pets/whale-pixel/`）

- 来源：https://github.com/chenthreegold/deepseek-whale-pet
- 许可：MIT License, Copyright (c) 2026 DeepSeek Whale Pet Contributors。
- 图集：`codex-package/deepseek-whale-girl/spritesheet.webp`（1536×1872，8×9）。

## ds 鲸鱼女仆 / 月薪喵（`pets/dpsk-girl/`、`pets/yuexinmiao/`）

- 来源：https://github.com/LINNoot/dsh-co-pet
- 许可：MIT License, Copyright (c) 2026 dsh-pet contributors（各目录有 LICENSE）。
- 图集：`pet/pets/deepseek/spritesheet.webp`（8×11）、`pet/pets/yuexinmiao/spritesheet.webp`（8×9）。

## 深深（`pets/shenshen/`）

- 来源：https://github.com/schrieeeffer/shenshen-codex-pet
- 视觉素材：**CC BY-NC-SA 4.0**（见 `pets/shenshen/ASSET_LICENSE.md`）；上游代码 MIT，本仓库只再分发视觉素材与适配清单。
- 原始鲸鱼娘形象「上善无形」；本版本由 Shenshen Pet contributors 制作；**非商业**，再分发须署名 + 相同方式共享。
- 与 DeepSeek / OpenAI / 角色原权利方无隶属或背书关系。

## 对下游使用者的要求

1. **逐包看许可**：`dafeiyu` 与 `shenshen` 的素材是 **非商业**；其余 MIT 包仍可能涉及角色/IP 权利，商用前请自行确认。
2. **保留声明**：再分发时保留对应 `pets/<id>/LICENSE`、`NOTICE.md` 与本文件。
3. **代码与素材分开**：本仓库代码（`src-tauri/`、`renderer/`、`tools/` 等）是 MIT；素材限制不因代码 MIT 而解除。
4. 任何 pack 若含第三方角色/IP，本仓库不额外授予角色权利。

## 上游 MIT 许可文本（通用）

```
MIT License

Copyright (c) 2026 respective authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
