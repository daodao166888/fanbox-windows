const { execFile } = require('child_process');
const safe = 'WorkBuddy';

const script = [
  '@echo off',
  `where "${safe}.exe" 2>nul 1>nul && echo 1 && exit /b`,
  `where "${safe}" 2>nul 1>nul && echo 1 && exit /b`,
  `if exist "%ProgramFiles%\${safe}\${safe}.exe" (echo 1 & exit /b)`,
  `if exist "%ProgramFiles(x86)%\${safe}\${safe}.exe" (echo 1 & exit /b)`,
  `if exist "%LocalAppData%\Programs\${safe}\${safe}.exe" (echo 1 & exit /b)`,
  `if exist "%AppData%\${safe}\${safe}.exe" (echo 1 & exit /b)`,
  `if exist "%LocalAppData%\${safe}\${safe}.exe" (echo 1 & exit /b)`,
  'echo 0',
].join('\r\n');

console.log('Running detection...');
execFile('cmd', ['/c', script], { timeout: 8000, windowsHide: true }, (err, stdout) => {
  console.log('Raw stdout:', JSON.stringify(stdout));
  console.log('Trimmed:', JSON.stringify(String(stdout).trim()));
  
  // Also test each line individually
  execFile('cmd', ['/c', `echo %LocalAppData%`], { timeout: 5000 }, (e, s) => {
    console.log('LocalAppData:', JSON.stringify(String(s).trim()));
  });
  execFile('cmd', ['/c', `if exist "C:\Users\Administrator\AppData\Local\Programs\WorkBuddy\WorkBuddy.exe" (echo FOUND) else (echo NOT)`], { timeout: 5000 }, (e, s) => {
    console.log('Hardcoded check:', JSON.stringify(String(s).trim()));
  });
  execFile('cmd', ['/c', `if exist "%LocalAppData%\Programs\WorkBuddy\WorkBuddy.exe" (echo FOUND) else (echo NOT)`], { timeout: 5000 }, (e, s) => {
    console.log('Env var check:', JSON.stringify(String(s).trim()));
  });
});
