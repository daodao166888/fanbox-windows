// 诊断：6.0 隐藏期灌行后的滚动失同步——量出差多少、试哪种操作能救
const { _electron } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const HOME = '/tmp/fb-verify-xterm6-home-probe';
setTimeout(() => { console.error('watchdog 超时'); process.exit(2); }, 120000);

(async () => {
  for (const d of ['Desktop', 'Documents', 'Downloads']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
  const app = await _electron.launch({ executablePath: require(path.join(ROOT, 'node_modules/electron')), args: [ROOT], cwd: ROOT, env: { ...process.env, HOME, FANBOX_PORT: '4642' } });
  const win = await app.firstWindow();
  await win.waitForTimeout(2200);
  await win.evaluate(() => { localStorage.setItem('fb_guided', '1'); localStorage.setItem('fb_term_open', '1'); localStorage.setItem('fb_term_dock', 'bottom'); });
  await win.evaluate(() => location.reload()).catch(() => {});
  await win.waitForTimeout(2500);
  await win.evaluate(() => { window.playChime = () => {}; term.notify = () => {}; });

  const pos = await win.evaluate(async () => {
    await term.newTab();
    await new Promise((r) => setTimeout(r, 800));
    const target = term.sessions[term.sessions.length - 1];
    window.__t = target;
    term.activate(term.sessions[0].id); // 藏起来
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < 60; i++) await new Promise((r) => target.xterm.write(Array.from({ length: 100 }, (_, j) => 'line ' + (i * 100 + j)).join('\r\n') + '\r\n', r));
    await new Promise((r) => setTimeout(r, 1000));
    term.activate(target.id);
    await new Promise((r) => setTimeout(r, 800));
    const vp = target.host.querySelector('.xterm-viewport');
    const rc = vp.getBoundingClientRect();
    return { cx: rc.left + rc.width / 2, cy: rc.top + rc.height / 2 };
  });

  const dims = () => win.evaluate(() => {
    const t = window.__t; const vp = t.host.querySelector('.xterm-viewport');
    const b = t.xterm.buffer.active;
    const cell = t.xterm._core._renderService?.dimensions?.css?.cell?.height || 0;
    return { viewportY: b.viewportY, baseY: b.baseY, lines: b.length, scrollTop: Math.round(vp.scrollTop), scrollHeight: vp.scrollHeight, clientHeight: vp.clientHeight, cell, expectedSH: Math.round(cell * b.length) };
  });
  console.log('激活后:', JSON.stringify(await dims()));

  await win.evaluate(() => window.__t.xterm.scrollLines(-200));
  await win.mouse.move(pos.cx, pos.cy);
  for (let i = 0; i < 30; i++) { await win.mouse.wheel(0, 400); await win.waitForTimeout(20); }
  await win.waitForTimeout(500);
  console.log('滚轮后:', JSON.stringify(await dims()));

  // 候选修法 A：scrollToBottom API
  await win.evaluate(() => window.__t.xterm.scrollToBottom());
  await win.waitForTimeout(300);
  console.log('scrollToBottom 后:', JSON.stringify(await dims()));

  // 再上翻，试候选修法 B：refresh 全屏
  await win.evaluate(() => window.__t.xterm.scrollLines(-200));
  await win.evaluate(() => window.__t.xterm.refresh(0, window.__t.xterm.rows - 1));
  await win.waitForTimeout(300);
  for (let i = 0; i < 30; i++) { await win.mouse.wheel(0, 400); await win.waitForTimeout(20); }
  await win.waitForTimeout(500);
  console.log('refresh+滚轮后:', JSON.stringify(await dims()));

  // 候选修法 C：加大剂量——上翻 200 行后连滚 120 个事件，验证是「慢」还是「卡」
  await win.evaluate(() => window.__t.xterm.scrollToBottom());
  await win.evaluate(() => window.__t.xterm.scrollLines(-200));
  for (let i = 0; i < 120; i++) { await win.mouse.wheel(0, 400); await win.waitForTimeout(15); }
  await win.waitForTimeout(600);
  console.log('120个滚轮后:', JSON.stringify(await dims()));

  await win.evaluate(() => term.sessions.slice().forEach((s) => { try { window.fanboxPty.kill(s.id); } catch { /* */ } }));
  await win.waitForTimeout(400);
  await app.close().catch(() => {});
  setTimeout(() => process.exit(0), 800);
})().catch((e) => { console.error('异常', e); process.exit(1); });
