# xterm 6.0 升级暂存（2026-07 下载，同日已接入）

中文乱码（WebGL 字形图集损坏）三方案里的方案二：升级渲染栈到上游修复版。
**已按下方检查单接入 public/vendor/xterm/**（unicode11/clipboard 与现役相同未动），此目录留作升级来源存档。

## 版本

| 文件 | 版本 | 现役版本 |
|------|------|---------|
| xterm.js / xterm.css | @xterm/xterm **6.0.0** | 5.5.0 |
| addon-webgl.js | @xterm/addon-webgl **0.19.0** | 0.18.0 |
| addon-fit.js | @xterm/addon-fit **0.11.0** | 0.10.0 |
| addon-unicode11.js | @xterm/addon-unicode11 0.9.0 | 0.9.0（同版本，顺手刷新） |
| addon-clipboard.js | @xterm/addon-clipboard 0.2.0 | 0.2.0（同版本，顺手刷新） |

## 接入时的检查单

1. **IME 补丁不用再打**：现役 vendor 手工打过 `20===e.keyCode||229===e.keyCode` 补丁（package.json 的 `check:vendor-patch`），6.0.0 上游已原生包含该逻辑，直接覆盖后 `npm run check:vendor-patch` 应通过（已验证 dist/xterm.js 含该片段）。
2. 把 `dist/*` 覆盖到 `public/vendor/xterm/`（现役目录里还有 addon-clipboard.js.map，按需处理）。
3. **删掉两处 5.5.0 Viewport workaround**（app.js 里搜「升级 xterm 6.0 后删掉」）：
   - 滚动失同步自愈的 wheel 监听（`xterm._core.viewport?.syncScrollArea?.(true)` 那段）
   - activate() 里重新可见后的 syncScrollArea 补偿
   6.0 重写了 Viewport（上游 #5339 已修），这两处依赖的 `_core.viewport.syncScrollArea` 私有 API 在 6.0 可能已不存在——都是可选链调用不会炸，但该删。
4. 6.0 是大版本，过一遍上游 release notes / 迁移说明，重点核对：
   - `allowProposedApi`、`unicode.activeVersion`、`minimumContrastRatio`、`macOptionClickForcesSelection` 等现用 options 是否有变
   - 回放播放器（app.js `buildTerm`）和主终端两处创建路径都要测
5. 回归测试：中文输入法候选词、claude/codex TUI 重绘、滚动到底、⌘+/- 字号缩放、换肤、录像回放、GIF 导出。
