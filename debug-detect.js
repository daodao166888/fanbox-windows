const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function findAgentBin(name) {
  return new Promise((resolve) => {
    execFile('cmd', ['/c', 'where', name], { timeout: 8000 }, (err, stdout) => {
      const out = String(stdout || '').trim().split(/\r?\n/)[0];
      resolve(!err && out && /^[A-Z]:\/i.test(out) ? out : null);
    });
  });
}

async function checkApp(a) {
  const safe = a.replace(/"/g, '');
  const found = await findAgentBin(safe + '.exe');
  console.log('1. where', safe + '.exe', '=', found);
  if (found) return true;
  const found2 = await findAgentBin(safe);
  console.log('2. where', safe, '=', found2);
  if (found2) return true;
  const paths = [
    path.join(process.env.ProgramFiles || 'C:\Program Files', safe, safe + '.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\Program Files (x86)', safe, safe + '.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', safe, safe + '.exe'),
    path.join(process.env.APPDATA || '', safe, safe + '.exe'),
    path.join(process.env.LOCALAPPDATA || '', safe, safe + '.exe'),
  ];
  console.log('3. fs paths:');
  for (const p of paths) console.log('  ', p, '=', fs.existsSync(p));
  return paths.some((p) => { try { return fs.existsSync(p); } catch { return false; } });
}

checkApp('WorkBuddy').then(r => console.log('RESULT:', r));
