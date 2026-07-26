# 排版档「导出长图」验收（2026-07）

docs/13 路线图 P2 第 4 项。技术路径按产品文档的判断走纯前端零依赖：
排好版的 DOM（样式本就全内联）序列化进 SVG foreignObject → 画上 canvas → PNG，
图片沿用「复制到公众号」的内联链路先转 base64，落盘复用图片编辑器的 `/api/image-save`。

踩到的坑：**blob: URL 装载的 foreignObject SVG 画上 canvas 会把 canvas 判成
tainted**（Chromium 行为），`toDataURL` 抛 SecurityError；换 `data:image/svg+xml` 就干净。

跑验收：`node experiments/export-longimage-202607/verify.js`（Playwright 驱动 Electron，假 HOME）。
9 项断言：菜单入口在位、点击链路 PNG 落盘、750×2 倍率宽度、高度随内容、非空白体积阈值、
重复导出顺延 -2 不覆盖、本地图片全内联、带底色主题（金融时报）铺满底色出图。
`shots/` 里存了两套主题的产物长图供目检。

## 分节多图（同期第二步）

`node experiments/export-longimage-202607/verify-slice.js`（同样 Playwright + Electron + 假 HOME，端口 4644）。

切点取 h2，最小不可分单位是顶层块元素——这是唯一的硬约束，保证切点永远落在两个块之间。
高度上下限 `[750, 3000]`（1:1 ~ 1:4）：矮的并进相邻节，长的在块边界**均分**断开
（贪心会在末尾剩一条两行字的窄条，均分不会）。

14 项断言：两个入口并存、连号不跳号、宽度一致、每张非空白、每片高度在上下限内、
各片高度之和 ≈ 整篇单张高度（内容不丢不重）、无 h2 文章退化成按高度切、
重复导出整组顺延 `-长图2-N` 且旧图零覆盖。

`shots-slice/` 存产物供目检：默认主题完整 4 片（合并、断开、页码三条规则都能看到），
金融时报主题取首、次、末三片（看带底色主题铺满全宽和页码角标）。为了不把仓库撑大，
存档是 750px 宽的 1x 缩图，真产物是 1500px；中间两片纯填充段落的没存。
