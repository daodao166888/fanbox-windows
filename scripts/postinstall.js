#!/usr/bin/env node
/**
 * FanBox 安装后自动创建桌面快捷方式
 * 仅在 Windows 上运行
 */
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 仅在 Windows 上运行
if (process.platform !== 'win32') {
  console.log('[fanbox] 非 Windows 系统，跳过创建桌面快捷方式');
  process.exit(0);
}

// 检查是否在 electron 环境中（避免重复执行）
if (process.env.FANBOX_POSTINSTALL) {
  process.exit(0);
}

const desktop = path.join(require('os').homedir(), 'Desktop');
const shortcutPath = path.join(desktop, 'FanBox.lnk');
const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const appDir = path.join(__dirname, '..');

// 检查必要文件是否存在
if (!fs.existsSync(electronPath)) {
  console.log('[fanbox] Electron 未安装，跳过创建桌面快捷方式');
  process.exit(0);
}

if (!fs.existsSync(iconPath)) {
  console.log('[fanbox] 图标文件不存在，跳过创建桌面快捷方式');
  process.exit(0);
}

// 如果快捷方式已存在，跳过
if (fs.existsSync(shortcutPath)) {
  console.log('[fanbox] 桌面快捷方式已存在，跳过');
  process.exit(0);
}

// 使用 PowerShell 创建快捷方式
const psScript = `
$LANG = [System.Text.Encoding]::UTF8
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut('${shortcutPath.replace(/\\/g, '\\\\')}')
$sc.TargetPath = '${electronPath.replace(/\\/g, '\\\\')}'
$sc.Arguments = '.'
$sc.WorkingDirectory = '${appDir.replace(/\\/g, '\\\\')}'
$sc.IconLocation = '${iconPath.replace(/\\/g, '\\\\')},0'
$sc.Save()
Write-Host 'Created'
`;

try {
  console.log('[fanbox] 正在创建桌面快捷方式...');
  const result = execSync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
    timeout: 10000,
  });

  if (result.includes('Created')) {
    console.log('[fanbox] ✅ 桌面快捷方式已创建：FanBox.lnk');
  } else {
    console.log('[fanbox] ⚠️ 快捷方式创建完成');
  }
} catch (err) {
  console.log('[fanbox] ⚠️ 创建桌面快捷方式失败（不影响使用）');
  console.log('[fanbox]    你可以手动创建：运行 scripts/create-shortcut.js');
}
