// 排版档「导出长图」的自动化验收：Playwright 驱动 Electron（假 HOME，不碰真实数据）。
// 覆盖：①排版档「送去…」菜单含「导出长图」入口 ②点菜单走完整链路（排版→图片内联→
// SVG foreignObject→canvas→/api/image-save 落盘），PNG 出现在文章旁边 ③尺寸 750×2 倍率、
// 高度随内容、非空白（体积阈值）④再导一次不覆盖、自动顺延 -2 ⑤带底色主题（金融时报）
// 也能导且图片全部内联成功。产物 PNG 存进 shots/ 供人工目检。
const { _electron } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const HOME = '/tmp/fb-verify-longimg-home';
const PROJ = path.join(HOME, 'Documents', '长图测试');
const MD = path.join(PROJ, '文章.md');
let fails = 0;
const check = (ok, name, detail) => { console.log((ok ? 'PASS' : 'FAIL') + ': ' + name + (detail ? ' — ' + detail : '')); if (!ok) fails++; };
setTimeout(() => { console.error('FAIL: watchdog 超时'); process.exit(2); }, 180000);

// PNG 尺寸直接读 IHDR（签名 8 字节 + 长度/类型 8 字节后是宽高各 4 字节大端）
const pngSize = (fp) => {
  const b = fs.readFileSync(fp);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
};

(async () => {
  fs.rmSync(HOME, { recursive: true, force: true }); // 假 HOME，可放心重置
  for (const d of ['Desktop', 'Documents', 'Downloads']) fs.mkdirSync(path.join(HOME, d), { recursive: true });
  fs.mkdirSync(PROJ, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'assets', 'screenshot-index.png'), path.join(PROJ, '配图.png'));
  fs.writeFileSync(MD, [
    '---', 'title: 导出长图验收', '---', '',
    '# 导出长图验收文章', '',
    '这是一篇用来验收「导出长图」的测试文章，中文为主，混一点 English words 和 `行内代码`。', '',
    '## 带本地配图', '', '![测试配图](配图.png)', '',
    '> 引用块：长图里的样式应当和排版档预览一致。', '',
    '## 列表与代码', '', '- 第一项', '- 第二项', '',
    '```js', 'console.log("导出长图");', '```', '',
    Array.from({ length: 20 }, (_, i) => `第 ${i + 1} 段填充文字：足够的长度才能验证长图真的「长」。`).join('\n\n'),
  ].join('\n'));

  const app = await _electron.launch({ executablePath: require(path.join(ROOT, 'node_modules/electron')), args: [ROOT], cwd: ROOT, env: { ...process.env, HOME, FANBOX_PORT: '4643' } });
  const win = await app.firstWindow();
  await win.waitForTimeout(2200);
  await win.evaluate(() => { localStorage.setItem('fb_guided', '1'); });
  await win.evaluate(() => location.reload()).catch(() => {});
  await win.waitForTimeout(2500);

  // ---------- ① 打开 md 编辑器 → 排版档 → 「送去…」菜单含「导出长图」 ----------
  await win.evaluate((p) => enterEditMode({ path: p, name: '文章.md', kind: 'text', isDir: false }), MD);
  await win.waitForTimeout(1500);
  await win.click('.ed-modes .seg-btn[data-m="typeset"]');
  await win.waitForTimeout(800);
  const r1 = await win.evaluate(() => ({
    bar: !!document.querySelector('#ts-more'),
    api: typeof typeset.exportImage === 'function',
    painted: !!document.querySelector('.typeset-host div'),
  }));
  check(r1.bar && r1.api && r1.painted, '排版档就位且 typeset.exportImage 存在', JSON.stringify(r1));
  await win.click('#ts-more');
  await win.waitForTimeout(300);
  const r2 = await win.evaluate(() => Array.from(document.querySelectorAll('#context-menu .ctx-item')).map((x) => x.textContent));
  check(r2.includes('导出长图'), '「送去…」菜单含「导出长图」', JSON.stringify(r2));

  // ---------- ② 点「导出长图」→ PNG 落在文章旁边 ----------
  await win.evaluate(() => { Array.from(document.querySelectorAll('#context-menu .ctx-item')).find((x) => x.textContent === '导出长图').click(); });
  const out1 = path.join(PROJ, '文章-长图.png');
  for (let i = 0; i < 60 && !fs.existsSync(out1); i++) await win.waitForTimeout(500);
  check(fs.existsSync(out1), 'PNG 落盘在文章旁边', out1);

  // ---------- ③ 尺寸与非空白：750×2 倍率、高度随内容、体积过阈值 ----------
  const s1 = fs.existsSync(out1) ? pngSize(out1) : null;
  check(!!s1 && s1.w === 1500, '宽度 = 750 × 2 倍率', JSON.stringify(s1));
  check(!!s1 && s1.h > s1.w, '长文高度大于宽度（真·长图）', JSON.stringify(s1));
  check(!!s1 && s1.bytes > 30 * 1024, '体积过阈值（非空白渲染）', s1 && `${(s1.bytes / 1024).toFixed(0)}KB`);

  // ---------- ④⑤ 直接调 API 再导一次（换带底色的金融时报主题）：不覆盖、顺延 -2，图片全内联 ----------
  const r4 = await win.evaluate(async (p) => {
    const md = await fetch('/api/read?path=' + encodeURIComponent(p)).then((x) => x.json());
    return await typeset.exportImage(md.content, p, 'wechat-ft');
  }, MD);
  const out2 = path.join(PROJ, '文章-长图-2.png');
  check(r4.ok && r4.path === out2 && fs.existsSync(out2), '重复导出不覆盖、自动顺延 -2', JSON.stringify(r4));
  check(r4.failed === 0 && r4.total === 1, '本地图片全部内联成功', JSON.stringify({ total: r4.total, failed: r4.failed }));
  const s2 = fs.existsSync(out2) ? pngSize(out2) : null;
  check(!!s2 && s2.w === 1500 && s2.bytes > 30 * 1024, '带底色主题同样出图', JSON.stringify(s2));

  // 产物存档供人工目检（长图本身就是最好的截图）
  fs.mkdirSync(path.join(__dirname, 'shots'), { recursive: true });
  if (fs.existsSync(out1)) fs.copyFileSync(out1, path.join(__dirname, 'shots', '默认主题-长图.png'));
  if (fs.existsSync(out2)) fs.copyFileSync(out2, path.join(__dirname, 'shots', '金融时报主题-长图.png'));

  console.log(fails === 0 ? '\n全部通过 ✅' : '\n有 ' + fails + ' 项失败 ❌');
  await app.close().catch(() => {});
  setTimeout(() => process.exit(fails === 0 ? 0 : 1), 1200);
})().catch((e) => { console.error('FAIL: 脚本异常 — ' + (e && e.stack || e)); process.exit(2); });
