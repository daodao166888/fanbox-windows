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

// 创建临时 Python 脚本
const tmpScript = path.join(require('os').tmpdir(), 'fanbox-create-shortcut.py');
const pyContent = `
import win32com.client
import os

ws = win32com.client.Dispatch('WScript.Shell')
sc = ws.CreateShortcut(r'${shortcutPath.replace(/'/g, "''")}')
sc.TargetPath = r'${electronPath.replace(/'/g, "''")}'
sc.Arguments = '.'
sc.WorkingDirectory = r'${appDir.replace(/'/g, "''")}'
sc.IconLocation = r'${iconPath.replace(/'/g, "''")},0'
sc.Save()
print('Created')
`;

try {
  console.log('[fanbox] 正在创建桌面快捷方式...');
  fs.writeFileSync(tmpScript, pyContent, 'utf8');
  const result = execSync(`python "${tmpScript}"`, {
    encoding: 'utf8',
    timeout: 10000,
  });

  // 清理临时文件
  try { fs.unlinkSync(tmpScript); } catch {}

  if (result.includes('Created')) {
    console.log('[fanbox] ✅ 桌面快捷方式已创建：FanBox.lnk');
  } else {
    console.log('[fanbox] ⚠️ 快捷方式创建完成');
  }
} catch (err) {
  // 清理临时文件
  try { fs.unlinkSync(tmpScript); } catch {}
  console.log('[fanbox] ⚠️ 创建桌面快捷方式失败（不影响使用）');
}
