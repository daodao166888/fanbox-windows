# 📦 FanBox Windows 桌面版

> 基于 [alchaincyf/fanbox](https://github.com/alchaincyf/fanbox) v2.6.1，增加了 Windows 桌面版支持。

## 🎯 这是什么

FanBox 是一个 **vibe coding 驾驶舱**：左边文件浏览，右边终端，中间实时看 AI 改了什么。

原版只支持 macOS，这个分支让 **Windows 用户也能用上完整桌面版**。

## ✨ Windows 版新增功能

- ✅ Windows 标题栏适配（最小化/最大化/关闭按钮）
- ✅ 截图直通车（监听 Windows 截图目录，Win+Shift+S 截完即弹）
- ✅ 剪贴板文件复制（PowerShell 实现）
- ✅ 快捷键自动适配（Ctrl 替代 ⌘）
- ✅ 原生图标支持（icon.ico）
- ✅ 样式优化（拖拽区域、呼吸感）
- ✅ xterm 5.5.0 降级（避免 Windows 上 xterm 6.0 的闪屏/黑块/光标异常）
- ✅ node-pty 预编译二进制（无需额外编译）
- ✅ 桌面应用多路径搜索（兼容 where + 常见安装路径）

## 📋 更新日志

### v2.6.1-win (2026-07-08)
- 同步上游 v2.6.1：修复多标签下 WebGL 图集互相污染导致大面积丢字
- 更新检测指向 Windows fork release

### v2.6.0-win (2026-07-05)
- 同步上游 v2.6.0：终端中文乱码根治 + 图集自动保养 + 兼容渲染开关
- xterm 降级至 5.5.0（Windows 兼容性）
- Agent 项目侧边栏过滤系统目录
- 回合安全带 (v2.5.0)：agent 开工前自动存档 + 一键回滚

### v2.5.0-win (2026-07-03)
- 同步上游 v2.5.0：回合安全带
- 一键启动 agent 扩到 11 个 + 设置面板
- 终端 CJK 残影修复

### v1.11.3-win (2026-06-15)
- 同步上游 v1.11.3：修复终端目录路径不可点击 + 面包屑图标偏高
- 重新应用 Windows 适配（标题栏、截图、剪贴板）

## 🚀 快速开始

### 方式1：直接运行（推荐）

```bash
# 克隆仓库
git clone https://github.com/daodao166888/fanbox-windows.git
cd fanbox-windows

# 安装依赖（自动创建桌面快捷方式）
npm install

# 启动桌面版
npx electron .
```

### 方式2：使用启动脚本

双击 `启动FanBox桌面版.bat`

### 方式3：Web 模式

```bash
node server.js
# 浏览器打开 http://localhost:4567
```

双击 `启动FanBox.bat`

### 方式4：打包成安装包

```bash
npm run dist
```

生成的安装包在 `dist/` 目录。

## 📖 功能一览

| 功能 | 说明 |
|------|------|
| 📁 文件浏览 | 左侧树状目录，支持模糊搜索 |
| 👀 实时预览 | Markdown/HTML/代码/图片/PDF |
| 💻 内嵌终端 | 真实终端 (node-pty)，支持 Claude Code / Codex / Aider 等 |
| 🔄 文件跟随 | AI 改哪个文件，实时高亮 + 波纹动画 |
| 🛡️ 回合安全带 | agent 开工前自动存档，一键回滚 |
| 🔧 11 个 Agent 一键启动 | Claude Code / Codex / Aider / CodeBuddy / Qoder 等 |
| 🎚️ 兼容渲染开关 | WebGL / DOM 渲染器切换，杜绝终端中文乱码 |
| 📸 截图直通车 | Win+Shift+S 截图后自动弹出，可直接喂给 AI |
| 🌐 微信遥控 | 通过微信远程操控本机 AI Agent |
| 🎨 三套皮肤 | Volt / Archive / Index，随心切换 |
| 📦 离线可用 | 所有前端资源本地化，断网也能用 |

## 🛠️ 技术栈

- Electron 33
- node-pty（内嵌终端，Windows 预编译二进制）
- xterm.js 5.5.0（终端渲染，Windows 降级版）
- Monaco Editor（代码编辑）
- Milkdown（Markdown 编辑）

## 📝 与原版的差异

| 项目 | 原版 (macOS) | Windows 版 |
|------|-------------|-----------|
| 标题栏 | hiddenInset + 毛玻璃 | hidden + titleBarOverlay |
| 截图监听 | ~/Desktop | ~/Pictures/Screenshots |
| 剪贴板 | osascript | PowerShell |
| 快捷键 | ⌘ | Ctrl |
| 图标 | .icns | .ico |
| xterm | 6.0 | 5.5.0（避免闪屏黑块） |
| node-pty | macOS 原生编译 | Windows x64 预编译二进制 |
| AGENT_PATH 搜索 | which | where + 常见安装路径 |
| 系统目录过滤 | macOS 标准路径 | Windows/system32/Pictures 等 |
| 更新检测 | alchaincyf/fanbox | daodao166888/fanbox-windows |

## 🙏 致谢

原项目：[alchaincyf/fanbox](https://github.com/alchaincyf/fanbox) by 花叔

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE)

---

**作者**: [daodao166888](https://github.com/daodao166888)  
**基于**: FanBox v2.6.1 by 花叔
