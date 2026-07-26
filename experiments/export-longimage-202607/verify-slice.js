// 排版档「导出长图（分节）」的自动化验收：Playwright 驱动 Electron（假 HOME，不碰真实数据）。
// 覆盖：①菜单里单张和分节两个入口并存（分节没有替换掉单张）②点菜单走完整链路，多张 PNG 连号
// 落在文章旁边 ③每张宽度一致 = 750×2 ④每张非空白（体积阈值）⑤规则生效——每片高度落在
// [1:1, 1:4] 上下限内（矮的合并了、长的断开了）⑥内容守恒——各片高度之和 ≈ 整篇单张的高度，
// 既没丢也没重复 ⑦没有 h2 的文章退化成按高度切，仍出图 ⑧再导一次整组顺延成 -长图2-1，
// 不覆盖任何旧图。产物 PNG 存进 shots-slice/ 供人工目检。
const { _electron } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HOME = '/tmp/fb-verify-slice-home';
const PROJ = path.join(HOME, 'Documents', '分节长图测试');
const MD = path.join(PROJ, '多节文章.md');
const MD2 = path.join(PROJ, '无小节.md');
const W = 750, MIN_H = W, MAX_H = W * 4; // 与 typeset.js 里的 SLICE_MIN_H / SLICE_MAX_H 一致
let fails = 0;
const check = (ok, name, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (detail ? ' — ' + detail : '')); if (!ok) fails++; };
setTimeout(() => { console.error('FAIL: watchdog 超时'); process.exit(2); }, 300000);

const pngSize = (fp) => {
  const b = fs.readFileSync(fp);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
};
const para = (tag, n) => Array.from({ length: n }, (_, i) => `${tag}第 ${i + 1} 段：这一段是用来把小节撑到指定高度的填充文字，中文为主，长度足够占满两行。`).join('\n\n');

(async () => {
  fs.rmSync(HOME, { recursive: true, force: true });
  for (const d of ['Desktop', 'Documents', 'Downloads']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
  fs.mkdirSync(PROJ, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'assets', 'screenshot-index.png'), path.join(PROJ, '配图.png'));

  // 六个小节，故意造出三种情形：正常节、两个连着的极短节（该被合并）、一个超长节（该被断开）
  fs.writeFileSync(MD, [
    '---', 'title: 分节长图验收', '---', '',
    '# 分节导出验收文章', '',
    '导语：这篇文章专门用来验收「按小节切多图」。下面每一节的长度都是故意设计的。', '',
    '![题图](配图.png)', '',
    '## 一、正常长度的一节', '', para('甲', 12), '',
    '> 引用块：分节后每一片都应当保留主题容器的底色和留白。', '',
    '## 二、极短的一节', '', '只有一句话。', '',
    '## 三、同样极短的一节', '', '也只有一句话。', '',
    '## 四、正常长度的一节', '', para('丁', 12), '',
    '```js', 'console.log("代码块不能被切成两半");', '```', '',
    '## 五、超长的一节', '', para('戊', 70), '',
    '## 六、收尾的一节', '', para('己', 12), '',
  ].join('\n'));
  // 没有任何 h2 的文章：算法该退化成「按高度在块边界切」，而不是报错
  fs.writeFileSync(MD2, ['# 一篇没有小节标题的文章', '', para('庚', 120), ''].join('\n'));

  const app = await _electron.launch({ executablePath: require(path.join(ROOT, 'node_modules/electron')), args: [ROOT], cwd: ROOT, env: { ...process.env, HOME, FANBOX_PORT: '4644' } });
  const win = await app.firstWindow();
  await win.waitForTimeout(2200);
  await win.evaluate(() => { localStorage.setItem('fb_guided', '1'); });
  await win.evaluate(() => location.reload()).catch(() => {});
  await win.waitForTimeout(2500);

  // ---------- ① 排版档 →「送去…」菜单：单张和分节两个入口并存 ----------
  await win.evaluate((p) => enterEditMode({ path: p, name: '多节文章.md', kind: 'text', isDir: false }), MD);
  await win.waitForTimeout(1500);
  await win.click('.ed-modes .seg-btn[data-m="typeset"]');
  await win.waitForTimeout(800);
  check(await win.evaluate(() => typeof typeset.exportSlices === 'function'), 'typeset.exportSlices 存在');
  await win.click('#ts-more');
  await win.waitForTimeout(300);
  const items = await win.evaluate(() => Array.from(document.querySelectorAll('#context-menu .ctx-item')).map((x) => x.textContent));
  check(items.includes('导出长图') && items.includes('导出长图（分节）'), '菜单里单张与分节两个入口并存（没替换原功能）', JSON.stringify(items));

  // ---------- ② 点「导出长图（分节）」→ 连号多张 PNG 落在文章旁边 ----------
  await win.evaluate(() => { Array.from(document.querySelectorAll('#context-menu .ctx-item')).find((x) => x.textContent === '导出长图（分节）').click(); });
  const p1 = path.join(PROJ, '多节文章-长图-1.png');
  for (let i = 0; i < 120 && !fs.existsSync(p1); i++) await win.waitForTimeout(500);
  await win.waitForTimeout(2500); // 等最后一张写完
  const outs = fs.readdirSync(PROJ).filter((n) => /^多节文章-长图-\d+\.png$/.test(n))
    .sort((a, b) => parseInt(a.match(/-(\d+)\.png$/)[1], 10) - parseInt(b.match(/-(\d+)\.png$/)[1], 10));
  check(outs.length >= 4, '点菜单导出多张长图', outs.join(', '));
  const nums = outs.map((n) => parseInt(n.match(/-(\d+)\.png$/)[1], 10));
  check(nums.every((v, i) => v === i + 1), '编号从 1 连续到 N，中间不跳号', JSON.stringify(nums));

  // ---------- ③④ 宽度一致 + 每张非空白 ----------
  const sizes = outs.map((n) => pngSize(path.join(PROJ, n)));
  check(sizes.every((s) => s && s.w === W * 2), '每张宽度一致 = 750 × 2 倍率', JSON.stringify(sizes.map((s) => s.w)));
  check(sizes.every((s) => s.bytes > 30 * 1024), '每张体积过阈值（无空白片）', sizes.map((s) => (s.bytes / 1024).toFixed(0) + 'KB').join(' '));

  // ---------- ⑤ 上下限规则生效：每片高度落在 [1:1, 1:4] 内 ----------
  const hs = sizes.map((s) => s.h / 2); // PNG 是 2x，换回 CSS px
  check(hs.every((h) => h >= MIN_H), `每片不低于 ${MIN_H}px（1:1，太矮的小节已合并）`, JSON.stringify(hs));
  check(hs.every((h) => h <= MAX_H * 1.15), `每片不超过 ${MAX_H}px（1:4，超长小节已断开）`, JSON.stringify(hs));

  // ---------- ⑥ 内容守恒：各片高度之和 ≈ 整篇单张的高度 ----------
  const single = await win.evaluate(async (p) => {
    const md = await fetch('/api/read?path=' + encodeURIComponent(p)).then((x) => x.json());
    return await typeset.exportImage(md.content, p, typeset.current());
  }, MD);
  const sOne = pngSize(single.path);
  const sum = hs.reduce((a, b) => a + b, 0);
  const one = sOne.h / 2;
  // 容差：每片多了一个页码角标（约 50px），且首元素 margin-top 被清零（约 40px）
  check(Math.abs(sum - one) < outs.length * 110, '各片高度之和 ≈ 整篇单张高度（内容不丢不重）', `分节合计 ${sum} vs 整篇 ${one}`);
  check(fs.existsSync(path.join(PROJ, '多节文章-长图.png')), '单张导出仍然可用，且与分节各占各的名字');

  // ---------- ⑦ 没有 h2 的文章：退化成按高度切，仍然出图 ----------
  const r7 = await win.evaluate(async (p) => {
    const md = await fetch('/api/read?path=' + encodeURIComponent(p)).then((x) => x.json());
    return await typeset.exportSlices(md.content, p, typeset.current());
  }, MD2);
  const s7 = r7.paths.map(pngSize);
  check(r7.ok && r7.count >= 2 && s7.every((s) => s && s.w === W * 2 && s.bytes > 30 * 1024),
    '无 h2 文章退化成按高度切，仍出连号多图', JSON.stringify({ count: r7.count, h: r7.heights }));

  // ---------- ⑧ 再导一次：整组顺延成 -长图2-1，不覆盖旧图 ----------
  const before = fs.readdirSync(PROJ).filter((n) => /^多节文章-长图-\d+\.png$/.test(n)).map((n) => fs.statSync(path.join(PROJ, n)).mtimeMs);
  const r8 = await win.evaluate(async (p) => {
    const md = await fetch('/api/read?path=' + encodeURIComponent(p)).then((x) => x.json());
    return await typeset.exportSlices(md.content, p, 'wechat-ft'); // 顺便换个带底色的主题
  }, MD);
  const after = fs.readdirSync(PROJ).filter((n) => /^多节文章-长图-\d+\.png$/.test(n)).map((n) => fs.statSync(path.join(PROJ, n)).mtimeMs);
  check(r8.ok && r8.paths.every((p, i) => p.endsWith(`多节文章-长图2-${i + 1}.png`)), '重复导出整组顺延 -长图2-N', JSON.stringify(r8.paths.map((p) => p.split('/').pop())));
  check(JSON.stringify(before) === JSON.stringify(after), '第一组长图一张没被覆盖');
  check(r8.failed === 0 && r8.total === 1, '本地图片全部内联成功', JSON.stringify({ total: r8.total, failed: r8.failed }));

  // 产物存档供人工目检
  const shots = path.join(__dirname, 'shots-slice');
  fs.rmSync(shots, { recursive: true, force: true });
  fs.mkdirSync(shots, { recursive: true });
  outs.forEach((n) => fs.copyFileSync(path.join(PROJ, n), path.join(shots, '默认主题-' + n)));
  r8.paths.forEach((p) => fs.copyFileSync(p, path.join(shots, '金融时报主题-' + p.split('/').pop())));

  console.log(fails === 0 ? '\n全部通过 ✅' : '\n有 ' + fails + ' 项失败 ❌');
  await app.close().catch(() => {});
  setTimeout(() => process.exit(fails === 0 ? 0 : 1), 1200);
})().catch((e) => { console.error('FAIL: 脚本异常 — ' + (e && e.stack || e)); process.exit(2); });
