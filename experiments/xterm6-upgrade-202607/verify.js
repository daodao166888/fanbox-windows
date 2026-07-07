// xterm 6.0 升级 + 中文乱码三方案的自动化验收：Playwright 驱动 Electron（假 HOME，不碰真实数据）。
// 覆盖：①6.0 冷启动/列宽/PTY 对齐 ②WebGL addon 挂载 ③CJK 宽度（unicode11） ④IME CapsLock（6.0 原生补丁）
// ⑤atlasCare 忙时清理 ⑥atlasCare 收工兜底 ⑦setWebgl 关（含新标签遵守） ⑧setWebgl 开
// ⑨设置面板开关不污染 agent 配置 ⑩删 workaround 后 6.0 原生滚动到底。含中文截图供人工目检。
const { _electron } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HOME = '/tmp/fb-verify-xterm6-home';
let fails = 0;
const check = (ok, name, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (detail ? ' — ' + detail : '')); if (!ok) fails++; };
setTimeout(() => { console.error('FAIL: watchdog 超时'); process.exit(2); }, 180000);

(async () => {
  for (const d of ['Desktop', 'Documents', 'Downloads']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
  const app = await _electron.launch({ executablePath: require(path.join(ROOT, 'node_modules/electron')), args: [ROOT], cwd: ROOT, env: { ...process.env, HOME, FANBOX_PORT: '4641' } });
  const win = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1560, 950); w.center(); });
  await win.waitForTimeout(2200);
  await win.evaluate(() => { localStorage.setItem('fb_guided', '1'); localStorage.setItem('fb_term_open', '1'); localStorage.setItem('fb_term_dock', 'bottom'); });
  await win.evaluate(() => location.reload()).catch(() => {});
  await win.waitForTimeout(2500);

  // 通知静音：验收期间的 busy/idle 循环别真响铃
  await win.evaluate(() => { window.playChime = () => {}; term.notify = () => {}; });

  // ---------- ① 6.0 冷启动：Terminal 全局、列宽、PTY 对齐 ----------
  const r1 = await win.evaluate(() => ({ ctor: typeof window.Terminal, cols: term.sessions.find((x) => x.id === term.active).xterm.cols }));
  check(r1.ctor === 'function' && r1.cols > 120, '6.0 冷启动 xterm 就绪', JSON.stringify(r1));
  await win.evaluate(() => term.input(term.active, 'stty size\r'));
  await win.waitForTimeout(900);
  const stty = await win.evaluate(() => { const s = term.sessions.find((x) => x.id === term.active); const b = s.xterm.buffer.active; for (let i = b.length - 1; i >= 0; i--) { const l = b.getLine(i); if (!l) continue; const t = l.translateToString(true).trim(); if (/^\d+ \d+$/.test(t)) return t; } return null; });
  check(Number((stty || '0 0').split(' ')[1]) === r1.cols, 'PTY 列宽与 xterm 对齐', 'stty=' + stty);

  // ---------- ② WebGL addon 挂载 + clearTextureAtlas 可用 ----------
  const wg = await win.evaluate(() => { const s = term.sessions.find((x) => x.id === term.active); return { has: !!s.webgl, clear: typeof (s.webgl && s.webgl.clearTextureAtlas) }; });
  check(wg.has && wg.clear === 'function', 'WebGL addon 挂载且 clearTextureAtlas 可用', JSON.stringify(wg));

  // ---------- ③ CJK 宽度：unicode11 生效，汉字占 2 列 ----------
  const cjk = await win.evaluate(async () => {
    const s = term.sessions.find((x) => x.id === term.active);
    await new Promise((r) => s.xterm.write('\r\n中文渲染宽度测试\r\n', r));
    const b = s.xterm.buffer.active;
    for (let i = b.length - 1; i >= 0; i--) {
      const l = b.getLine(i); if (!l) continue;
      const t = l.translateToString(true).trim();
      if (t === '中文渲染宽度测试') return { found: true, w: l.getCell(0).getWidth(), uni: s.xterm.unicode.activeVersion };
    }
    return { found: false };
  });
  check(cjk.found && cjk.w === 2 && cjk.uni === '11', 'CJK 宽度=2 且 unicode11 生效', JSON.stringify(cjk));

  // ---------- ④ IME CapsLock 不双写（6.0 已原生含 PR #5282，vendor 补丁退役后的回归） ----------
  const ime = await win.evaluate(async () => {
    const s = term.sessions.find((x) => x.id === term.active);
    const cap = [];
    const sub = s.xterm.onData((d) => cap.push(d));
    const ta = s.host.querySelector('.xterm-helper-textarea');
    ta.focus(); ta.value = '';
    ta.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    ta.value = 'yao da';
    ta.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'yao da', bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
    const kd = new KeyboardEvent('keydown', { key: 'CapsLock', code: 'CapsLock', bubbles: true, cancelable: true });
    Object.defineProperty(kd, 'keyCode', { get: () => 20 });
    ta.dispatchEvent(kd);
    ta.value = 'yaoda';
    ta.dispatchEvent(new CompositionEvent('compositionend', { data: 'yaoda', bubbles: true }));
    ta.dispatchEvent(new InputEvent('input', { data: 'yaoda', inputType: 'insertText', bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r, 30));
    sub.dispose();
    term.input(term.active, '\x15');
    return cap.join('');
  });
  check(ime === 'yaoda', 'IME CapsLock 不双写（6.0 原生）', JSON.stringify(ime));

  // ---------- ⑤ atlasCare 忙时清理：忙满 5 分钟应清一次图集 ----------
  const care1 = await win.evaluate(async () => {
    const s = term.sessions.find((x) => x.id === term.active);
    let n = 0;
    const orig = s.webgl.clearTextureAtlas.bind(s.webgl);
    s.webgl.clearTextureAtlas = () => { n++; orig(); };
    term._atlasAt = Date.now() - 301000; // 假装 5 分钟没清过（2.6.1 起全局计时，标签一起清）
    const iv = setInterval(() => { s.xterm.write('.'); term.markBusy(s); }, 300); // 维持 busy
    await new Promise((r) => setTimeout(r, 1500)); // 状态机 600ms 一拍，等两拍
    clearInterval(iv);
    const midBusy = { n, status: s.status };
    s.webgl.clearTextureAtlas = orig;
    return midBusy;
  });
  check(care1.n >= 1 && care1.status === 'busy', 'atlasCare 忙时清理触发', JSON.stringify(care1));

  // ---------- ⑥ atlasCare 收工兜底：busy→idle 且距上次 >60s 应再清一次 ----------
  const care2 = await win.evaluate(async () => {
    const s = term.sessions.find((x) => x.id === term.active);
    let n = 0;
    const orig = s.webgl.clearTextureAtlas.bind(s.webgl);
    s.webgl.clearTextureAtlas = () => { n++; orig(); };
    term._atlasAt = Date.now() - 61000; // 距上次清理 61 秒（2.6.1 起全局计时）
    await new Promise((r) => setTimeout(r, 4000)); // 停止输出，等 2.5s 静默判定 + 状态机拍子
    const out = { n, status: s.status };
    s.webgl.clearTextureAtlas = orig;
    return out;
  });
  check(care2.n >= 1 && care2.status === 'idle', 'atlasCare 收工兜底触发', JSON.stringify(care2));

  // ---------- ⑦ setWebgl(false)：已开标签立即回退 DOM，新标签也遵守 ----------
  const off = await win.evaluate(async () => {
    term.setWebgl(false);
    await new Promise((r) => setTimeout(r, 300));
    const allOff = term.sessions.every((s) => !s.webgl);
    const s0 = term.sessions.find((x) => x.id === term.active);
    const domRows = s0.host.querySelectorAll('.xterm-rows > div').length; // DOM renderer 的行结构
    await term.newTab();
    await new Promise((r) => setTimeout(r, 800));
    const sNew = term.sessions.find((x) => x.id === term.active);
    return { allOff, domRows, ls: localStorage.getItem('fanbox.noWebgl'), newTabOff: !sNew.webgl };
  });
  check(off.allOff && off.domRows > 0 && off.ls === '1' && off.newTabOff, 'setWebgl(false) 即时生效+新标签遵守', JSON.stringify(off));

  // ---------- ⑧ setWebgl(true)：全部标签挂回 WebGL ----------
  const on = await win.evaluate(async () => {
    term.setWebgl(true);
    await new Promise((r) => setTimeout(r, 300));
    return { allOn: term.sessions.every((s) => !!s.webgl), ls: localStorage.getItem('fanbox.noWebgl') };
  });
  check(on.allOn && on.ls === null, 'setWebgl(true) 全标签恢复', JSON.stringify(on));

  // ---------- ⑨ 设置面板：渲染开关存在、切换生效、不污染 agent 勾选 ----------
  const panel = await win.evaluate(async () => {
    const before = JSON.stringify(agentState.enabled);
    agentsPop.open();
    await new Promise((r) => setTimeout(r, 200));
    const cb = agentsPop.el.querySelector('[data-webgl] input');
    if (!cb) return { hasCb: false };
    const initChecked = cb.checked;
    cb.checked = false; cb.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 200));
    const afterOff = { ls: localStorage.getItem('fanbox.noWebgl'), webgl: term.sessions.every((s) => !s.webgl) };
    cb.checked = true; cb.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 200));
    const afterOn = { ls: localStorage.getItem('fanbox.noWebgl'), webgl: term.sessions.every((s) => !!s.webgl) };
    agentsPop.close();
    return { hasCb: true, initChecked, afterOff, afterOn, agentSame: JSON.stringify(agentState.enabled) === before };
  });
  check(panel.hasCb && panel.initChecked && panel.afterOff.ls === '1' && panel.afterOff.webgl && panel.afterOn.ls === null && panel.afterOn.webgl && panel.agentSame, '设置面板渲染开关', JSON.stringify(panel));

  // ---------- ⑩ 滚动到底：删掉 5.5.0 workaround 后靠 6.0 原生（隐藏期灌 6000 行） ----------
  const scrollPos = await win.evaluate(async () => {
    const ids = term.sessions.map((s) => s.id);
    const target = term.sessions[term.sessions.length - 1];
    term.activate(ids[0]);
    await new Promise((r) => setTimeout(r, 300));
    const x = target.xterm;
    for (let i = 0; i < 60; i++) await new Promise((r) => x.write(Array.from({ length: 100 }, (_, j) => 'line ' + (i * 100 + j)).join('\r\n') + '\r\n', r));
    await new Promise((r) => setTimeout(r, 1000));
    term.activate(target.id);
    await new Promise((r) => setTimeout(r, 600));
    x.scrollLines(-200);
    await new Promise((r) => setTimeout(r, 100));
    const rc = target.host.querySelector('.xterm-viewport').getBoundingClientRect();
    return { cx: rc.left + rc.width / 2, cy: rc.top + rc.height / 2 };
  });
  // 6.0 Viewport 走原生滚动，合成 WheelEvent 是 untrusted 不触发默认滚动——用 Playwright 真实滚轮。
  // 6.0 平滑滚动单个事件约 2.8 行（probe-scroll.js 实测），上翻 200 行要 ~75 个事件，给 120 个余量
  await win.mouse.move(scrollPos.cx, scrollPos.cy);
  for (let i = 0; i < 120; i++) { await win.mouse.wheel(0, 400); await win.waitForTimeout(15); }
  await win.waitForTimeout(600);
  const scroll = await win.evaluate(() => {
    const b = term.sessions[term.sessions.length - 1].xterm.buffer.active;
    return { viewportY: b.viewportY, baseY: b.baseY };
  });
  check(scroll.viewportY === scroll.baseY, '6.0 原生滚动到底（workaround 已删）', JSON.stringify(scroll));

  // ---------- 中文截图：供人工目检字形（乱码 bug 属渲染层，buffer 断言测不到像素） ----------
  await win.evaluate(async () => {
    const s = term.sessions.find((x) => x.id === term.active);
    await new Promise((r) => s.xterm.write('\x1bc', r)); // 清屏
    const lines = ['终端中文渲染目检：', '验收标准全部有证据、独立复跑、无阻发现，交叉印证。', '第七关、第九关均给内部同回，弧线演出符合设计，正式记账。', '\x1b[32m绿色：任务完成状态行\x1b[0m \x1b[33m黄色:等待确认\x1b[0m \x1b[36m青色：路径/链接\x1b[0m', 'English mixed 中英混排 digits 0123456789 完成'];
    for (const l of lines) await new Promise((r) => s.xterm.write(l + '\r\n', r));
  });
  await win.waitForTimeout(600);
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  await win.screenshot({ path: path.join(__dirname, 'shots', 'xterm6-cjk.png') });

  console.log(fails === 0 ? '\n全部通过 ✅' : '\n有 ' + fails + ' 项失败 ❌');
  await win.evaluate(() => term.sessions.slice().forEach((s) => { try { window.fanboxPty.kill(s.id); } catch { /* */ } }));
  await win.waitForTimeout(400);
  await app.close().catch(() => {});
  setTimeout(() => process.exit(fails === 0 ? 0 : 1), 1200);
})().catch((e) => { console.error('FAIL: 脚本异常', e); process.exit(1); });
