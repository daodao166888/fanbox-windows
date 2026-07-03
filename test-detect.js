const { execFile } = require('child_process');
const safe = 'WorkBuddy';

// Exactly what the server generates
let script = '@echo off\r\n';
script += `where "${safe}.exe" 2>nul 1>nul && echo 1 && exit /b\r\n`;
script += `where "${safe}" 2>nul 1>nul && echo 1 && exit /b\r\n`;
script += `if exist "%ProgramFiles%\\${safe}\\${safe}.exe" (echo 1 & exit /b)\r\n`;
script += `if exist "%ProgramFiles(x86)%\\${safe}\\${safe}.exe" (echo 1 & exit /b)\r\n`;
script += `if exist "%LocalAppData%\\Programs\\${safe}\\${safe}.exe" (echo 1 & exit /b)\r\n`;
script += `if exist "%AppData%\\${safe}\\${safe}.exe" (echo 1 & exit /b)\r\n`;
script += `if exist "%LocalAppData%\\${safe}\\${safe}.exe" (echo 1 & exit /b)\r\n`;
script += 'echo 0';

console.log('SCRIPT:', JSON.stringify(script));
execFile('cmd', ['/c', script], { timeout: 8000 }, (err, stdout) => {
  console.log('err:', err);
  console.log('stdout:', JSON.stringify(String(stdout).trim()));
  console.log('FOUND:', !err && String(stdout).trim() === '1');
});
