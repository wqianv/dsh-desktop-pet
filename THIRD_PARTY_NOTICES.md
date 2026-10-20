# Third-party notices

## 吃白饭的蓝色大肥鱼（pet pack `pets/dafeiyu/`）

- Source: https://github.com/PC2005-cloud/dsh-pet (`dsh-pet/assets/webm/`)
- Code: MIT License, Copyright (c) 2026 PC2005-cloud.
- Assets (animations / prompts / source videos): the upstream README states
  **“允许开源使用，禁止商用”** (open-source use allowed, commercial use prohibited).
  This repository therefore treats the pet art as **non-commercial fan art**.
- Conversion: `tools/make-dafeiyu-pet.py` extracts frames from 8 upstream transparent
  VP9 WebM clips (stored in `tools/art-src/dafeiyu/`), crops them to one shared window,
  and packs a 1536×1872 `sprite2d` atlas. No character art is redrawn.
- The character is unofficial, not affiliated with or endorsed by DeepSeek or the
  original rights holders. Do not use commercially.

## 对下游使用者的要求（重要）

如果你（或其他人）复用本仓库的宠物包/素材：

1. **禁止商用**：不得用于收费产品、付费分发、广告变现、商业交付等；商用需向
   [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 作者取得单独授权。
2. **保留声明**：再分发/修改时保留 `pets/dafeiyu/NOTICE.md`、`pets/dafeiyu/LICENSE`
   与本文件；代码部分保留 MIT 版权与许可声明。
3. **代码与素材分开**：本仓库代码（`src-tauri/`、`renderer/`、`tools/` 等）是 MIT；
   宠物素材的限制不会因为代码是 MIT 而解除。
4. 素材是上游 AI 生成动画/非官方 fan art，上游未额外授予角色/IP 权利；
   公开分发或商用前请自行评估风险。

## Upstream MIT license (PC2005-cloud/dsh-pet)

```
MIT License

Copyright (c) 2026 PC2005-cloud

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
