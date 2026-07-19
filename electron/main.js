'use strict';
/**
 * FanBox — Electron 主进程
 *
 * 复用零依赖后端 server.js（文件能力），叠加 node-pty 内嵌终端，
 * 让 TUI coding agent（Claude Code / Codex / Aider…）在界面里直接跑起来。
 */
const { app, BrowserWindow, ipcMain, shell, nativeImage, Menu, clipboard, dialog, net, session } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 复用现有后端：require 即 listen 127.0.0.1:PORT，不自动开浏览器
process.env.FANBOX_NO_OPEN = '1';
const PORT = Number(process.env.FANBOX_PORT) || 4567;
require('../server.js');

// node-pty 是原生模块，需 electron-rebuild 编译过；未就绪时终端能力降级但 app 仍可用
let pty = null;
try { pty = require('node-pty'); }
catch (e) { console.error('[fanbox] node-pty 未就绪（跑 npm run rebuild）：', e.message); }

const terminals = new Map();
let win = null;

// ---------- Agent 控制接口状态（/api/agent/*，见 docs/12）----------
// token 每次启动随机生成、不落盘：只注入翻箱自己开的 pty 环境变量（FANBOX_CTL_TOKEN），
// 能力边界 = FanBox 进程树——只有跑在翻箱终端里的 agent 拿得到门票，本机其他进程无从读取。
// FANBOX_AGENT_TOKEN 环境变量可覆盖，供本地开发/自动化测试注入已知 token。
const crypto = require('crypto');
const AGENT_TOKEN = process.env.FANBOX_AGENT_TOKEN || crypto.randomBytes(24).toString('hex');
const termBufs = new Map();    // id -> 去 ANSI 滚动缓冲（~200KB），/api/agent/read 的数据源
const termLastOut = new Map(); // id -> 最近输出时间戳，wait 的 idle 判定
const termWaiters = new Map(); // id -> Set<fn(text)>，wait 的增量输出订阅

// ---------- 窗口尺寸/位置记忆 ----------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (b && b.width > 400 && b.height > 300) return b;
  } catch { /* 首次启动无记录 */ }
  return { width: 1320, height: 860 };
}
function saveBounds() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try { fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds())); } catch { /* */ }
}

function createWindow() {
  const b = loadBounds();
  const isWin = process.platform === 'win32';
  const opts = {
    width: b.width, height: b.height, x: b.x, y: b.y,
    minWidth: 920, minHeight: 600,
    backgroundColor: '#0b0c0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  if (isWin) {
    // Windows：隐藏标题栏，用自定义最小化/最大化/关闭按钮
    opts.titleBarStyle = 'hidden';
    opts.titleBarOverlay = { color: '#0b0c0a', symbolColor: '#8a8a8a', height: 36 };
    opts.icon = path.join(__dirname, '..', 'build', 'icon.ico');
  } else {
    // macOS：隐藏标题栏 + 毛玻璃
    opts.titleBarStyle = 'hiddenInset';
    opts.vibrancy = 'sidebar';
    opts.visualEffectState = 'active';
  }
  win = new BrowserWindow(opts);
  // 拖动/缩放后防抖记忆，关窗再存一次兜底
  let bt = null;
  const remember = () => { clearTimeout(bt); bt = setTimeout(saveBounds, 400); };
  win.on('resize', remember);
  win.on('move', remember);
  // macOS：点左上角红叉只隐藏到 Dock（保活渲染进程，所有界面/终端状态原样保留），真正退出走 ⌘Q。
  win.on('close', (e) => {
    saveBounds();
    if (process.platform === 'darwin' && !isQuitting) { e.preventDefault(); win.hide(); }
  });

  // 等后端起来再加载（首次 listen 有几十毫秒延迟）
  const load = () => win.loadURL(`http://localhost:${PORT}`).catch(() => setTimeout(load, 150));
  setTimeout(load, 250);

  // 外部链接走系统浏览器，不在 app 里开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  // 开发模式下 macOS 默认显示 Electron 图标——换成翻箱自己的（打包后由 electron-builder 的 icon 接管）
  if (process.platform === 'darwin' && app.dock) {
    try { app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'))); } catch { /* */ }
  }
  app.setName('FanBox');
  // 后端跑在 localhost，访问它永不该走代理。个别环境（clash 强制系统代理、企业 PAC 把 loopback 也代理）
  // 会把本地请求拦成 502 → 整个界面白屏。给 loopback 显式加旁路；其余（如查更新走 GitHub）仍按系统代理，互不影响。
  session.defaultSession.setProxy({ mode: 'system', proxyBypassRules: 'localhost;127.0.0.1;[::1]' }).catch(() => { /* 设置失败就退回默认行为，不影响启动 */ });
  buildMenu();
  createWindow();
  startShotWatch();
  // 启动 6 秒后查一次新版本（不挡启动）；长开会话每 2 小时再查；
  // 窗口重新聚焦也顺手查（30 分钟节流）——否则发版当天老 app 要等满周期才知道有新版
  setTimeout(checkUpdate, 6000);
  setInterval(checkUpdate, 2 * 3600 * 1000);
  app.on('browser-window-focus', () => {
    if (Date.now() - lastAutoCheck > 30 * 60 * 1000) checkUpdate();
  });
});

// ---------- 截图直通车：监听系统截屏落盘，新截图推给渲染层浮出直通卡 ----------
function screenshotDir() {
  if (process.platform === 'darwin') {
    try {
      const out = require('child_process').execSync('defaults read com.apple.screencapture location 2>/dev/null', { encoding: 'utf8' }).trim();
      if (out) return out.startsWith('~') ? path.join(os.homedir(), out.slice(1)) : out;
    } catch { /* 未自定义 → 默认桌面 */ }
    return path.join(os.homedir(), 'Desktop');
  }
  if (process.platform === 'win32') {
    // Windows 截图默认保存到 图片\屏幕截图
    return path.join(os.homedir(), 'Pictures', 'Screenshots');
  }
  return path.join(os.homedir(), 'Desktop');
}
let shotWatcher = null;
const shotSent = new Map(); // path -> t，fs.watch 同一文件会连发多个事件，3s 内去重
function startShotWatch() {
  if (shotWatcher) return;
  const dir = screenshotDir();
  if (!fs.existsSync(dir)) return;
  try {
    shotWatcher = fs.watch(dir, { persistent: false }, (evt, filename) => {
      const name = filename ? filename.toString() : '';
      // 截屏写盘有「.截屏xxx.png」点前缀的中间态，跳过；只认系统截屏的命名习惯
      // macOS: 截屏/Screenshot/Screen Shot/CleanShot/SCR-
      // Windows: Screenshot (Win+Shift+S) / 屏幕截图
      if (!/^(截屏|截圖|截图|Screenshot|Screen Shot|CleanShot|SCR-|屏幕截图)/i.test(name) || !/\.(png|jpe?g|bmp)$/i.test(name)) return;
      const fp = path.join(dir, name);
      setTimeout(() => { // 等写盘完成再确认
        fs.stat(fp, (err, st) => {
          if (err || !st.isFile() || st.size < 1000) return;
          const last = shotSent.get(fp) || 0;
          if (Date.now() - last < 3000) return;
          shotSent.set(fp, Date.now());
          if (shotSent.size > 50) { const k = shotSent.keys().next().value; shotSent.delete(k); }
          if (win && !win.isDestroyed()) win.webContents.send('shot:new', { path: fp, name, size: st.size });
        });
      }, 600);
    });
  } catch { /* 无权限等，静默放弃 */ }
}

// ---------- 更新检测：查 GitHub Releases，有新版本通知渲染层引导下载 ----------
// Windows 版检测自己的 fork release；macOS 原版走 alchaincyf/fanbox
function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
const REL_PAGE = 'https://github.com/daodao166888/fanbox-windows/releases/latest';
async function fetchLatestRelease() {
  // 先走 API（信息全）；代理共享出口 IP 很容易吃 GitHub API 的未认证限流（60 次/小时/IP，403），
  // 失败就退回抓 releases/latest 网页重定向——重定向后的 URL 自带 tag，且不占 API 配额
  try {
    const res = await net.fetch('https://api.github.com/repos/daodao166888/fanbox-windows/releases/latest', {
      headers: { 'User-Agent': 'fanbox-app', Accept: 'application/vnd.github+json' },
    });
    if (res.ok) {
      const rel = await res.json();
      if (rel.tag_name) return { tag: rel.tag_name, url: rel.html_url || REL_PAGE };
    }
  } catch { /* 走兜底 */ }
  const res = await net.fetch(REL_PAGE, { headers: { 'User-Agent': 'fanbox-app' } });
  const m = String(res.url || '').match(/\/releases\/tag\/([^/?#]+)/);
  if (m) return { tag: decodeURIComponent(m[1]), url: res.url };
  return null;
}
let pendingUpdate = null; // 渲染层晚注册监听也能拉到（启动 6 秒的推送 vs init 加载大目录，谁先谁后说不准）
let updRetry = 0;
let lastAutoCheck = 0;
async function checkUpdate(opts) {
  const manual = !!(opts && opts.manual);
  if (!manual) lastAutoCheck = Date.now();
  let info = null;
  try { info = await fetchLatestRelease(); } catch { info = null; }
  if (!info) {
    if (manual) {
      dialog.showMessageBoxSync(win && !win.isDestroyed() ? win : undefined, {
        type: 'warning', buttons: [M('好', 'OK')], message: M('检查更新失败', 'Update check failed'),
        detail: M('没连上 GitHub（网络问题或接口限流），稍后再试。', 'Could not reach GitHub (network issue or rate limit). Try again later.'),
      });
    } else if (updRetry < 3) { updRetry++; setTimeout(checkUpdate, 10 * 60 * 1000); } // 失败别干等 12 小时
    return;
  }
  updRetry = 0;
  const newer = cmpVer(info.tag, app.getVersion()) > 0;
  if (newer) {
    pendingUpdate = { version: info.tag.replace(/^v/, ''), url: info.url };
    if (win && !win.isDestroyed()) win.webContents.send('update:available', pendingUpdate);
  }
  if (manual) {
    const owner = win && !win.isDestroyed() ? win : undefined;
    if (newer) {
      const c = dialog.showMessageBoxSync(owner, {
        type: 'info', buttons: [M('去下载', 'Download'), M('取消', 'Cancel')], defaultId: 0, cancelId: 1,
        message: M(`发现新版本 v${pendingUpdate.version}`, `New version v${pendingUpdate.version} available`),
        detail: M(`当前版本 v${app.getVersion()}。点「去下载」打开发布页，下载安装包覆盖安装即可。`, `You are on v${app.getVersion()}. "Download" opens the release page; download and reinstall to update.`),
      });
      if (c === 0) shell.openExternal(pendingUpdate.url);
    } else {
      dialog.showMessageBoxSync(owner, {
        type: 'info', buttons: [M('好', 'OK')], message: M('已是最新版本', 'You are up to date'),
        detail: M(`当前版本 v${app.getVersion()} 就是最新发布版。`, `v${app.getVersion()} is the latest release.`),
      });
    }
  }
}
ipcMain.handle('update:open', (e, { url }) => { if (/^https:\/\/github\.com\//.test(String(url))) shell.openExternal(url); });
ipcMain.handle('update:get', () => pendingUpdate);

// 点完成通知把 app 拉到前台（渲染层 window.focus() 唤不醒最小化/被遮挡的窗口）
ipcMain.handle('win:focus', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// 预览全屏时藏掉左上角红黄绿系统按钮——它和右侧自家关闭图标太像，容易让人误点
ipcMain.handle('win:traffic', (e, { show }) => {
  if (!win || win.isDestroyed() || typeof win.setWindowButtonVisibility !== 'function') return;
  win.setWindowButtonVisibility(!!show);
});

// 界面语言：用户手动选过的存在 ~/.fanbox/config.json（渲染层切换时写入），没选过跟随系统
function uiLang() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.fanbox', 'config.json'), 'utf8'));
    if (c.lang === 'zh' || c.lang === 'en') return c.lang;
  } catch { /* 没配置过 */ }
  return String(app.getLocale() || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
const M = (zh, en) => (uiLang() === 'zh' ? zh : en);

// 原生菜单——关键是 Edit role，终端里的 ⌘C/⌘V 才生效
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ label: 'FanBox', submenu: [
      { role: 'about', label: M('关于 FanBox', 'About FanBox') },
      { label: M('检查更新…', 'Check for Updates…'), click: () => checkUpdate({ manual: true }) },
      { type: 'separator' },
      { role: 'hide', label: M('隐藏 FanBox', 'Hide FanBox') }, { role: 'hideOthers', label: M('隐藏其他', 'Hide Others') }, { role: 'unhide', label: M('全部显示', 'Show All') },
      { type: 'separator' },
      { role: 'quit', label: M('退出 FanBox', 'Quit FanBox') },
    ] }] : []),
    { label: M('文件', 'File'), submenu: [
      ...(isMac ? [] : [{ label: M('检查更新…', 'Check for Updates…'), click: () => checkUpdate({ manual: true }) }, { type: 'separator' }]),
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { label: M('编辑', 'Edit'), submenu: [
      { role: 'undo', label: M('撤销', 'Undo') }, { role: 'redo', label: M('重做', 'Redo') }, { type: 'separator' },
      { role: 'cut', label: M('剪切', 'Cut') }, { role: 'copy', label: M('复制', 'Copy') }, { role: 'paste', label: M('粘贴', 'Paste') },
      { role: 'selectAll', label: M('全选', 'Select All') },
    ] },
    { label: M('视图', 'View'), submenu: [
      { role: 'reload', label: M('重新加载', 'Reload') }, { role: 'toggleDevTools', label: M('开发者工具', 'Developer Tools') },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen', label: M('全屏', 'Full Screen') },
    ] },
    { role: 'window', label: M('窗口', 'Window'), submenu: [{ role: 'minimize', label: M('最小化', 'Minimize') }, { role: 'zoom' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else if (win && !win.isDestroyed()) { win.show(); win.focus(); } // 从 Dock 点回来：显示隐藏的窗口，状态原样还在
});
// ⌘Q 兜底：还有终端在跑时（agent 任务），退出前确认，避免手滑全灭
let quitConfirmed = false;
let isQuitting = false; // 真正退出（⌘Q / 菜单退出）才置真；点红叉只隐藏不退出，见 win.on('close')
app.on('before-quit', (e) => {
  if (quitConfirmed || terminals.size === 0) { isQuitting = true; return; }
  e.preventDefault();
  const choice = dialog.showMessageBoxSync(win && !win.isDestroyed() ? win : undefined, {
    type: 'warning',
    buttons: [M('取消', 'Cancel'), M('退出', 'Quit')],
    defaultId: 0,
    cancelId: 0,
    message: M(`还有 ${terminals.size} 个终端会话在运行`, `${terminals.size} terminal session(s) still running`),
    detail: M('退出会终止正在运行的 agent 任务，确定退出？', 'Quitting will terminate running agent tasks. Quit anyway?'),
  });
  if (choice === 1) { quitConfirmed = true; isQuitting = true; app.quit(); }
});
app.on('window-all-closed', () => {
  terminals.forEach((p) => { try { p.kill(); } catch { /* */ } });
  terminals.clear();
  if (process.platform !== 'darwin') app.quit();
});

// ---------- 终端 IPC（node-pty）----------
ipcMain.handle('pty:spawn', (e, { id, cwd, cols, rows }) => {
  if (!pty) return { ok: false, error: 'node-pty 未编译，跑：npm run rebuild' };
  const shellPath = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh');
  const startCwd = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  // login shell（-l）：GUI 启动的进程只继承精简 PATH，不读 .zprofile/.zlogin，
  // 用户在那里配的 Homebrew/nvm/npm 全局路径（claude 等）就丢了 → 「普通终端能找到、fanbox 找不到」。
  // 走 login shell 把这些路径带进来。Windows 的 powershell 无此机制，保持空参数。
  const shellArgs = process.platform === 'win32' ? [] : ['-l'];
  // GUI 启动的 app 不继承 shell 的 locale，zsh 会把中文路径按字节转义成 \M-^@ 乱码 → 兜底 UTF-8
  const env = {
    ...process.env, TERM: 'xterm-256color', FANBOX: '1',
    // 终端里的 agent 天生知道自己是几号窗口、控制接口在哪、门票是啥——skill 零配置（见 docs/12）
    FANBOX_TERM_ID: id, FANBOX_CTL: `http://127.0.0.1:${PORT}/api/agent`, FANBOX_CTL_TOKEN: AGENT_TOKEN,
  };
  if (!/UTF-8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || '')) env.LANG = 'zh_CN.UTF-8';
  let p;
  try {
    p = pty.spawn(shellPath, shellArgs, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: startCwd,
      env,
    });
  } catch (err) { return { ok: false, error: err.message }; }
  terminals.set(id, p);
  p.onData((data) => { if (win && !win.isDestroyed()) win.webContents.send('pty:data', { id, data }); });
  p.onExit(({ exitCode }) => {
    terminals.delete(id);
  refreshLidGuard(); // 开关开着时，第一个终端起来即生效
  recStart(id, { cols, rows, cwd: startCwd, theme });
  p.onData((data) => {
    if (win && !win.isDestroyed()) win.webContents.send('pty:data', { id, data });
    recEvent(id, 'o', data);
    const stripped = data.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b[()][AB0]|\r/g, '');
    termTails.set(id, ((termTails.get(id) || '') + stripped).slice(-4000)); // 留最后 ~4KB，给微信 agent 看「最近输出」
    termBufs.set(id, ((termBufs.get(id) || '') + stripped).slice(-200000)); // 大缓冲给 /api/agent/read
    termLastOut.set(id, Date.now());
    const ws = termWaiters.get(id);
    if (ws) for (const fn of ws) { try { fn(stripped); } catch { /* 单个 waiter 异常不连累别人 */ } }
  });
  p.onExit(({ exitCode }) => {
    terminals.delete(id);
    termTails.delete(id);
    termBufs.delete(id);
    termLastOut.delete(id);
    refreshLidGuard(); // 最后一个终端退出即恢复休眠
    recStop(id);
    if (win && !win.isDestroyed()) win.webContents.send('pty:exit', { id, exitCode });
  });
  return { ok: true, cwd: startCwd };
});
// ---------- 剪贴板：复制图片本体 / 复制文件（访达可粘贴）----------
ipcMain.handle('clip:image', (e, { path: p }) => {
  try { const img = nativeImage.createFromPath(p); if (img.isEmpty()) return { ok: false, error: '不是可读图片' }; clipboard.writeImage(img); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('clip:file', (e, { path: p }) => new Promise((resolve) => {
  const { execFile } = require('child_process');
  if (process.platform === 'win32') {
    // Windows：用 PowerShell 把文件放进剪贴板（资源管理器可粘贴）
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetFileDropList((New-Object System.Collections.Specialized.StringCollection)); (([System.Windows.Forms.Clipboard]::GetFileDropList()).Add('${p.replace(/'/g, "''")}'))`;
    execFile('powershell', ['-NoProfile', '-Command', ps], (err) => resolve({ ok: !err, error: err && err.message }));
  } else {
    // macOS：argv 传路径，避免拼进 AppleScript 字面量被注入
    execFile('osascript', ['-e', 'on run argv', '-e', 'set the clipboard to (POSIX file (item 1 of argv))', '-e', 'end run', p], (err) => resolve({ ok: !err, error: err && err.message }));
  }
}));

// 拖拽落盘：file-promise 类拖入（截图浮窗等）没有真实路径，把字节写进临时目录换路径
ipcMain.handle('drop:save', (e, { name, buf }) => {
  try {
    const dir = path.join(app.getPath('temp'), 'fanbox-drops');
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(name || '拖入文件.png').replace(/[/\\:]/g, '_');
    let dest = path.join(dir, safe);
    if (fs.existsSync(dest)) dest = path.join(dir, `${Date.now()}-${safe}`);
    fs.writeFileSync(dest, Buffer.from(buf));
    return { ok: true, path: dest };
  } catch (err) { return { ok: false, error: err.message }; }
});
// 同名不覆盖：foo.png 已存在就退而求其次 foo 2.png（仿访达）
function uniqueDest(dest) {
  if (!fs.existsSync(dest)) return dest;
  const d = path.dirname(dest), ext = path.extname(dest), base = path.basename(dest, ext);
  for (let i = 2; i < 1000; i++) { const c = path.join(d, `${base} ${i}${ext}`); if (!fs.existsSync(c)) return c; }
  return path.join(d, `${Date.now()}-${base}${ext}`);
}
// 拖进文件区：把没路径的拖入内容（截图浮窗等）写进目标目录
ipcMain.handle('drop:save-into', (e, { dir, name, buf }) => {
  try {
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, error: '目标目录无效' };
    const safe = String(name || '拖入文件').replace(/[/\\:]/g, '_');
    const dest = uniqueDest(path.join(dir, safe));
    fs.writeFileSync(dest, Buffer.from(buf));
    return { ok: true, path: dest };
  } catch (err) { return { ok: false, error: err.message }; }
});
// 拖进文件区：把已有路径的文件（Finder 文件）复制进目标目录
ipcMain.handle('drop:copy-into', (e, { srcPath, dir }) => {
  try {
    if (!srcPath || !fs.existsSync(srcPath)) return { ok: false, error: '源文件不存在' };
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, error: '目标目录无效' };
    const dest = uniqueDest(path.join(dir, path.basename(srcPath)));
    if (path.resolve(srcPath) === path.resolve(dest)) return { ok: true, path: dest }; // 原地拖入，无需复制
    fs.copyFileSync(srcPath, dest);
    return { ok: true, path: dest };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.on('pty:input', (e, { id, data }) => { const p = terminals.get(id); if (p) p.write(data); });
ipcMain.on('pty:resize', (e, { id, cols, rows }) => { const p = terminals.get(id); if (p) { try { p.resize(cols, rows); } catch { /* */ } } });
ipcMain.on('pty:kill', (e, { id }) => { const p = terminals.get(id); if (p) { try { p.kill(); } catch { /* */ } terminals.delete(id); } });
ipcMain.on('pty:input', (e, { id, data }) => { const p = terminals.get(id); if (p) { p.write(data); recEvent(id, 'i', data); } });
ipcMain.on('pty:resize', (e, { id, cols, rows }) => { const p = terminals.get(id); if (p) { try { p.resize(cols, rows); } catch { /* */ } recEvent(id, 'r', `${cols}x${rows}`); } });
ipcMain.on('pty:kill', (e, { id }) => { const p = terminals.get(id); if (p) { try { p.kill(); } catch { /* */ } terminals.delete(id); refreshLidGuard(); recStop(id); } });

// ---------- Agent 控制接口：把跨终端感知/控制能力开成本机 HTTP（server.js 的 /api/agent/* 调这里）----------
// 让跑在翻箱终端里的 agent 指挥兄弟窗口：列表/读屏/输入/开窗/等待/关闭。安全模型与接口规范见 docs/12。
const BARE_SHELL_RE = /^-?(zsh|bash|sh|fish|login)$/i;
let agentReqSeq = 0;
const agentCreateWaiters = new Map(); // reqId -> resolve（渲染进程建 tab 的回执）

function agentTouch(id, action) { // 被 agent 控制的 tab 在界面上闪 ⚡：审计 + 围观
  if (win && !win.isDestroyed()) win.webContents.send('agent:touch', { id, action });
}
async function agentList() {
  const arr = [];
  for (const [id, p] of terminals) {
    const proc = (p && p.process) || '';
    const cwd = await termCwdByPid(p && p.pid);
    arr.push({
      id, cwd, name: cwd ? path.basename(cwd) : '', proc,
      busy: !!proc && !BARE_SHELL_RE.test(proc),
      tail: (termTails.get(id) || '').slice(-500),
    });
  }
  return { ok: true, terminals: arr };
}
function agentRead(id, lines) {
  if (!terminals.has(id)) return { ok: false, error: 'no such terminal' };
  const n = Math.max(1, Math.min(2000, lines || 200));
  return { ok: true, id, text: (termBufs.get(id) || '').split('\n').slice(-n).join('\n') };
}
function agentSend(id, text, opts = {}) {
  const p = terminals.get(id);
  if (!p) return { ok: false, error: 'no such terminal' };
  let t = String(text == null ? '' : text);
  if (opts.paste) t = '\x1b[200~' + t + '\x1b[201~'; // bracketed paste：多行文本整块进 TUI，不被逐行提交
  else t = t.replace(/\r\n|\n/g, '\r'); // 换行 → 回车才会真正提交
  if (opts.submit !== false && !/\r$/.test(t)) t += '\r';
  try { p.write(t); recEvent(id, 'i', t); agentTouch(id, 'send'); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
function agentCreate(opts = {}) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve({ ok: false, error: 'no window' });
    const reqId = 'ac' + (++agentReqSeq);
    agentCreateWaiters.set(reqId, resolve);
    win.webContents.send('agent:term-create', { reqId, cwd: typeof opts.cwd === 'string' ? opts.cwd : '' });
    setTimeout(() => { if (agentCreateWaiters.delete(reqId)) resolve({ ok: false, error: 'renderer timeout' }); }, 10000);
  }).then(async (r) => {
    if (!r.ok) return r;
    agentTouch(r.id, 'create');
    if (!opts.autorun) return r;
    // 等 shell 就绪（有过输出且静默 ≥400ms）再敲命令，login shell 初始化慢也不怕
    const t0 = Date.now();
    await new Promise((done) => {
      const iv = setInterval(() => {
        const last = termLastOut.get(r.id);
        if ((last && Date.now() - last >= 400) || Date.now() - t0 > 8000) { clearInterval(iv); done(); }
      }, 100);
    });
    const s = agentSend(r.id, String(opts.autorun));
    return { ...r, autorun: s.ok };
  });
}
ipcMain.on('agent:term-created', (e, { reqId, ok, id, error } = {}) => {
  const resolve = agentCreateWaiters.get(reqId);
  if (!resolve) return;
  agentCreateWaiters.delete(reqId);
  resolve(ok && id ? { ok: true, id } : { ok: false, error: error || 'create failed' });
});
function agentWait(id, opts = {}) {
  return new Promise((resolve) => {
    if (!terminals.has(id)) return resolve({ ok: false, error: 'no such terminal' });
    let re = null;
    if (opts.until) {
      try { re = new RegExp(String(opts.until), 'm'); }
      catch { return resolve({ ok: false, error: 'bad regex' }); }
    }
    const idleMs = Math.max(500, Math.min(30000, Number(opts.idleMs) || 2000));
    const timeoutMs = Math.max(1000, Math.min(240000, Number(opts.timeoutMs) || 60000)); // 240s < node requestTimeout(300s)
    const quietMode = opts.idle === 'quiet'; // quiet：只看输出静默（TUI 回答完）；默认还要求前台回到裸 shell
    const started = Date.now();
    let acc = ''; // 只累计 wait 开始后的新输出，正则也只匹配这段
    let set = termWaiters.get(id);
    if (!set) termWaiters.set(id, set = new Set());
    const finish = (extra) => {
      clearInterval(iv); set.delete(onData);
      resolve({ elapsed: Date.now() - started, output: acc.slice(-8000), ...extra });
    };
    const onData = (s) => { acc = (acc + s).slice(-64000); if (re && re.test(acc)) finish({ ok: true, matched: true }); };
    set.add(onData);
    const iv = setInterval(() => {
      const p = terminals.get(id);
      if (!p) return finish({ ok: true, exited: true });
      if (Date.now() - started >= timeoutMs) return finish({ ok: false, timeout: true });
      if (re) return; // until 模式只认正则
      if (Date.now() - (termLastOut.get(id) || started) < idleMs) return;
      const proc = p.process || '';
      if (quietMode || !proc || BARE_SHELL_RE.test(proc)) finish({ ok: true, idle: true });
    }, 200);
  });
}
function agentKill(id) {
  const p = terminals.get(id);
  if (!p) return { ok: false, error: 'no such terminal' };
  try { p.kill(); agentTouch(id, 'kill'); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}
global.__fanboxAgent = { token: AGENT_TOKEN, list: agentList, read: agentRead, send: agentSend, create: agentCreate, wait: agentWait, kill: agentKill };

// ---------- 录制文件管理 IPC ----------
// 列表：读每个 .cast 的头行拿元信息 + 文件大小/时长（末事件时间），按新→旧。失败的文件跳过不报错。
ipcMain.handle('rec:list', () => {
  try {
    const dir = REC_DIR();
    if (!fs.existsSync(dir)) return { ok: true, items: [] };
    const live = new Set([...recorders.values()].map((r) => r.path));
    const items = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.cast')) continue;
      const full = path.join(dir, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        // 「打开但没干活」的空终端会留下几百字节的壳（提示符+括号粘贴开关），是噪音：
        // 非正在录且体量过小的直接不进列表，省得满屏空录像
        if (st.size < 700 && !live.has(full)) continue;
        const head = readFirstLine(full);
        const meta = head ? JSON.parse(head) : {};
        items.push({
          name, path: full, size: st.size, mtime: st.mtimeMs,
          width: meta.width || 80, height: meta.height || 24,
          cwd: (meta.fanbox && meta.fanbox.cwd) || '',
          startedAt: (meta.fanbox && meta.fanbox.startedAt) || (meta.timestamp ? meta.timestamp * 1000 : st.birthtimeMs),
          duration: readLastEventTime(full, st.size), // 原始时长（末事件时间），列表里给用户选片参考
          recording: live.has(full), // 还在录的会话
        });
      } catch { /* 损坏的文件跳过 */ }
    }
    items.sort((a, b) => b.startedAt - a.startedAt);
    return { ok: true, items };
  } catch (err) { return { ok: false, error: err.message, items: [] }; }
});
ipcMain.handle('rec:read', (e, { path: p }) => {
  try {
    if (!isInRecDir(p)) return { ok: false, error: '非录制目录' };
    return { ok: true, text: fs.readFileSync(p, 'utf8') };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('rec:delete', (e, { path: p }) => {
  try {
    if (!isInRecDir(p)) return { ok: false, error: '非录制目录' };
    fs.rmSync(p, { force: true });
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.handle('rec:reveal', (e, { path: p }) => {
  try { shell.showItemInFolder(isInRecDir(p) ? p : REC_DIR()); return { ok: true }; }
  catch (err) { return { ok: false, error: err.message }; }
});
// 把导出好的视频/GIF 字节落进录制目录旁，返回真实路径供「在访达显示」
ipcMain.handle('rec:save-export', (e, { name, buf }) => {
  try {
    const dir = path.join(REC_DIR(), 'exports');
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(name || 'export.webm').replace(/[/\\:]/g, '_');
    const dest = uniqueDest(path.join(dir, safe));
    fs.writeFileSync(dest, Buffer.from(buf));
    return { ok: true, path: dest };
  } catch (err) { return { ok: false, error: err.message }; }
});
// 导出：渲染层录出的永远是 WebM；要 MP4/GIF 就用本机 ffmpeg 转一道（检测不到 ffmpeg 优雅退回 WebM）。
function findFfmpeg() {
  if (process.platform === 'win32') {
    try { const r = require('child_process').execFileSync('where', ['ffmpeg'], { encoding: 'utf8', timeout: 3000 }).trim().split('\n')[0]; if (r) return r; } catch { /* */ }
    return null;
  }
  for (const c of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']) { try { if (fs.existsSync(c)) return c; } catch { /* */ } }
  return null;
}
ipcMain.handle('rec:export', async (e, { name, buf, format }) => {
  const { execFile } = require('child_process');
  const crypto = require('crypto');
  try {
    const dir = path.join(REC_DIR(), 'exports');
    fs.mkdirSync(dir, { recursive: true });
    const base = String(name || 'export').replace(/[/\\:]/g, '_').replace(/\.[a-z0-9]+$/i, '').slice(0, 120);
    const tmp = path.join(dir, '.tmp-' + process.pid + '-' + crypto.randomBytes(3).toString('hex') + '.webm');
    fs.writeFileSync(tmp, Buffer.from(buf));
    const saveWebm = (reason) => { const d = uniqueDest(path.join(dir, base + '.webm')); fs.renameSync(tmp, d); return { ok: true, path: d, format: 'webm', fellBack: reason || null }; };
    if (format === 'webm') return saveWebm();
    const ff = findFfmpeg();
    if (!ff) return saveWebm('未检测到 ffmpeg，已存 WebM');
    const run = (args) => new Promise((res, rej) => execFile(ff, args, { timeout: 180000 }, (err, so, se) => (err ? rej(new Error((se || err.message || '').slice(0, 300))) : res())));
    try {
      if (format === 'mp4') {
        const dest = uniqueDest(path.join(dir, base + '.mp4'));
        // 偶数宽高（yuv420p 要求）+ faststart（边下边播）
        await run(['-y', '-i', tmp, '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dest]);
        fs.rmSync(tmp, { force: true });
        return { ok: true, path: dest, format: 'mp4' };
      }
      if (format === 'gif') {
        const dest = uniqueDest(path.join(dir, base + '.gif'));
        const pal = tmp + '.png';
        // 两遍调色板，GIF 才不糊不抖；宽度封到 900，15fps，体积友好
        await run(['-y', '-i', tmp, '-vf', 'fps=15,scale=900:-1:flags=lanczos,palettegen=stats_mode=diff', pal]);
        await run(['-y', '-i', tmp, '-i', pal, '-lavfi', 'fps=15,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3', dest]);
        fs.rmSync(tmp, { force: true }); fs.rmSync(pal, { force: true });
        return { ok: true, path: dest, format: 'gif' };
      }
    } catch (convErr) { try { return saveWebm('转码失败（' + convErr.message + '），已存 WebM'); } catch { /* */ } }
    return saveWebm();
  } catch (err) { return { ok: false, error: err.message }; }
});
function isInRecDir(p) {
  try { const r = path.resolve(REC_DIR()); return p && path.resolve(p).startsWith(r + path.sep); }
  catch { return false; }
}
// 只读文件头一行（.cast 头），不把整个大文件读进内存
function readFirstLine(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const s = buf.slice(0, n).toString('utf8');
    const nl = s.indexOf('\n');
    return nl >= 0 ? s.slice(0, nl) : s;
  } finally { fs.closeSync(fd); }
}
// 读文件尾，取最后一条事件的时间戳 = 原始时长（不把大文件整读进内存）
function readLastEventTime(file, size) {
  try {
    const len = Math.min(4096, size);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, Math.max(0, size - len));
      const lines = buf.toString('utf8').split('\n').map((l) => l.trim()).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try { const v = JSON.parse(lines[i]); if (Array.isArray(v) && typeof v[0] === 'number') return v[0]; } catch { /* 末行可能被截断，往前找 */ }
      }
    } finally { fs.closeSync(fd); }
  } catch { /* */ }
  return 0;
}

// lsof 在非 UTF-8 locale 下会把中文路径按字节转义成 \xe8 字面量（GUI 启动的 app 不继承 shell 的 locale，
// 正中这个坑：标签标题乱码、双击定位失效）。调 lsof 时显式给 UTF-8 locale，这里再留一层 \xNN 解码兜底
function decodeLsofPath(s) {
  if (!/\\x[0-9a-fA-F]{2}/.test(s)) return s;
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === 'x' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 2, i + 4))) {
      bytes.push(parseInt(s.slice(i + 2, i + 4), 16));
      i += 3;
    } else {
      for (const b of Buffer.from(s[i], 'utf8')) bytes.push(b);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}
// 取某终端 shell 的真实当前目录（用 lsof 查 pty 子进程的 cwd），实现「定位到终端目录」
ipcMain.handle('pty:cwd', (e, { id }) => new Promise((resolve) => {
  const p = terminals.get(id);
  if (!p || !p.pid) return resolve({ ok: false });
  const { exec } = require('child_process');
  exec(`lsof -a -p ${p.pid} -d cwd -Fn`, { env: { ...process.env, LC_ALL: 'en_US.UTF-8' } }, (err, stdout) => {
    if (err) return resolve({ ok: false });
    const line = stdout.split('\n').find((l) => l.startsWith('n'));
    resolve(line ? { ok: true, cwd: decodeLsofPath(line.slice(1)) } : { ok: false });
  });
}));

// 取终端前台进程名（node-pty 维护）：判断当前是裸 shell 还是正跑着 claude/codex 等程序
ipcMain.handle('pty:proc', (e, { id }) => {
  const p = terminals.get(id);
  return p ? { ok: true, proc: p.process || '' } : { ok: false };
});

// ---------- 文件监听（agent 改文件 → 自动刷新 + 跨项目变更收件箱）----------
// 多目录监听：浏览目录 + 每个终端会话所在的项目目录。一下午开多个项目跑 agent 时，
// 不在前台的项目也能感知变更。前端发来期望监听集，这里做增量 diff（关掉多余、补上新增）。
const watchers = new Map(); // dir -> FSWatcher
function startWatch(dir) {
  if (watchers.has(dir) || !dir || !fs.existsSync(dir)) return;
  try {
    // macOS(FSEvents)/Windows 原生递归；Linux 递归不可靠，降级为非递归监听当前目录
    const recursive = process.platform !== 'linux';
    const w = fs.watch(dir, { persistent: false, recursive }, (evt, filename) => {
      if (!win || win.isDestroyed()) return;
      const name = filename ? filename.toString() : null;
      // FSEvents 连「文件只是被读了一下」（atime/元数据更新）都报：agent cat/Read 个文件、
      // Spotlight 扫一遍都会触发。mtime/ctime 都不新鲜 = 内容根本没动过，丢弃；
      // stat 失败 = 刚被删，是真变更，照常转发
      if (name) {
        try {
          const st = fs.statSync(path.join(dir, name));
          const now = Date.now();
          if (now - st.mtimeMs > 3000 && now - st.ctimeMs > 3000) return;
        } catch { /* 已删除/无权限：当真变更转发 */ }
      }
      win.webContents.send('fs:changed', { dir, filename: name });
    });
    watchers.set(dir, w);
  } catch { /* 无权限等，跳过该目录 */ }
}
ipcMain.handle('fs:watch-set', (e, { dirs }) => {
  const want = new Set((dirs || []).filter(Boolean));
  for (const [dir, w] of watchers) { if (!want.has(dir)) { try { w.close(); } catch { /* */ } watchers.delete(dir); } }
  for (const dir of want) startWatch(dir);
  return { ok: true, count: watchers.size };
});
// 兼容旧单目录接口：等价于「只监听这一个目录」
ipcMain.handle('fs:watch', (e, { dir }) => {
  for (const [d, w] of watchers) { if (d !== dir) { try { w.close(); } catch { /* */ } watchers.delete(d); } }
  startWatch(dir);
  return { ok: true };
});

// ---------- 切换皮肤图标（仅 Windows）----------
const SKIN_ICONS = {
  terminal: path.join(__dirname, '..', 'build', 'icon-terminal.ico'),
  warm: path.join(__dirname, '..', 'build', 'icon-archive.ico'),
  editorial: path.join(__dirname, '..', 'build', 'icon-editorial.ico'),
};
ipcMain.handle('skin:set-icon', (e, { skin }) => {
  console.log('[fanbox] skin:set-icon called with', skin);
  if (process.platform !== 'win32' || !win || win.isDestroyed()) {
    console.log('[fanbox] skin:set-icon skipped: not win32 or no window');
    return { ok: false };
  }
  const iconPath = SKIN_ICONS[skin];
  console.log('[fanbox] iconPath:', iconPath);
  if (!iconPath || !fs.existsSync(iconPath)) {
    console.log('[fanbox] skin:set-icon skipped: icon not found');
    return { ok: false, error: '图标不存在' };
  }
  try {
    const img = nativeImage.createFromPath(iconPath);
    console.log('[fanbox] icon size:', img.getSize());
    win.setIcon(img);
    console.log('[fanbox] setIcon success');
    return { ok: true };
  } catch (err) {
    console.log('[fanbox] setIcon error:', err.message);
    return { ok: false, error: err.message };
  }
});
