# 📦 FanBox Windows 桌面版

> 基于 [alchaincyf/fanbox](https://github.com/alchaincyf/fanbox) v1.9.1，增加了 Windows 桌面版支持。

## 🎯 这是什么

FanBox 是一个 **vibe coding 驾驶舱**：左边文件浏览，右边终端，中间实时看 AI 改了什么。

原版只支持 macOS，这个分支让 **Windows 用户也能用上完整桌面版**。

## ✨ Windows 版新增功能

- ✅ Windows 标题栏适配（最小化/最大化/关闭按钮）
- ✅ 截图直通车（监听 Windows 截图目录）
- ✅ 剪贴板文件复制（PowerShell 实现）
- ✅ 快捷键自动适配（Ctrl 替代 ⌘）
- ✅ 原生图标支持（icon.ico）
- ✅ 样式优化（拖拽区域、呼吸感）

## 🚀 快速开始

### 方式1：直接运行（推荐）

```bash
# 克隆仓库
git clone https://github.com/daodao166888/fanbox-windows.git
cd fanbox-windows

# 安装依赖
npm install

# 启动桌面版
npx electron .
```

### 方式2：使用启动脚本

双击 `启动FanBox桌面版.bat`

### 方式3：打包成安装包

```bash
npm run dist
```

生成的安装包在 `dist/` 目录。

## 📖 功能一览

| 功能 | 说明 |
|------|------|
| 📁 文件浏览 | 左侧树状目录，支持模糊搜索 |
| 👀 实时预览 | Markdown/HTML/代码/图片/PDF |
| 💻 内嵌终端 | 真实终端，支持 Claude Code 等 AI Agent |
| 🔄 文件跟随 | AI 改哪个文件，实时高亮显示 |
| 📸 截图直通车 | 截图后自动弹出，可直接喂给 AI |
| 🎨 三套皮肤 | 终端/档案/索引，随心切换 |

## 🛠️ 技术栈

- Electron 33
- node-pty（内嵌终端）
- xterm.js（终端渲染）
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

## 🙏 致谢

原项目：[alchaincyf/fanbox](https://github.com/alchaincyf/fanbox) by 花叔

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE)

---

**作者**: [daodao166888](https://github.com/daodao166888)  
**基于**: FanBox v1.9.1 by 花叔
