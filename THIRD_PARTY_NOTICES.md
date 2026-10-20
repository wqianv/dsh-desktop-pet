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
