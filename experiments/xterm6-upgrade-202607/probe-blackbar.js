// 诊断：终端底部黑带——找出是哪个元素、什么背景色，验证 CSS 修法
const { _electron } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const HOME = '/tmp/fb-verify-xterm6-home-bar';
setTimeout(() => { console.error('watchdog 超时'); process.exit(2); }, 90000);

(async () => {
  for (const d of ['Desktop', 'Documents', 'Downloads']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
  const app = await _electron.launch({ executablePath: require(path.join(ROOT, 'node_modules/electron')), args: [ROOT], cwd: ROOT, env: { ...process.env, HOME, FANBOX_PORT: '4643' } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1400, 900); w.center(); });
  await win.waitForTimeout(2200);
  await win.evaluate(() => { localStorage.setItem('fb_guided', '1'); localStorage.setItem('fb_term_open', '1'); localStorage.setItem('fb_term_dock', 'bottom'); });
  await win.evaluate(() => location.reload()).catch(() => {});
  await win.waitForTimeout(2500);

  const info = await win.evaluate(() => {
    const host = document.querySelector('#xterm-host');
    const hr = host.getBoundingClientRect();
    const screen = host.querySelector('.xterm-screen');
    const sr = screen.getBoundingClientRect();
    // 终端行区底部到 host 底部之间的「缝」——黑带嫌疑区
    const gapY = Math.round(sr.bottom + (hr.bottom - sr.bottom) / 2);
    const el = document.elementFromPoint(Math.round(hr.left + hr.width / 2), gapY);
    const probe = [];
    let cur = el;
    while (cur && cur !== document.body && probe.length < 6) {
      const cs = getComputedStyle(cur);
      probe.push({ tag: cur.tagName, cls: String(cur.className).slice(0, 60), bg: cs.backgroundColor });
      cur = cur.parentElement;
    }
    const vp = host.querySelector('.xterm-viewport');
    return { hostBottom: Math.round(hr.bottom), screenBottom: Math.round(sr.bottom), gapPx: Math.round(hr.bottom - sr.bottom), atGap: probe, vpBg: vp ? getComputedStyle(vp).backgroundColor : null };
  });
  console.log('诊断:', JSON.stringify(info, null, 1));

  // 候选修法：viewport 背景透明
  const after = await win.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '.xterm .xterm-viewport { background-color: transparent !important; }';
    document.head.appendChild(st);
    const vp = document.querySelector('#xterm-host .xterm-viewport');
    return getComputedStyle(vp).backgroundColor;
  });
  console.log('override 后 viewport bg:', after);
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  await win.screenshot({ path: path.join(__dirname, 'shots', 'blackbar-after-css.png') });

  await win.evaluate(() => term.sessions.slice().forEach((s) => { try { window.fanboxPty.kill(s.id); } catch { /* */ } }));
  await win.waitForTimeout(400);
  await app.close().catch(() => {});
  setTimeout(() => process.exit(0), 800);
})().catch((e) => { console.error('异常', e); process.exit(1); });
