# Agent 控制接口：让终端里的 agent 指挥兄弟窗口

2026-07 起。让跑在翻箱终端里的 coding agent（Claude Code / Codex…）通过本机 HTTP 接口控制其他终端窗口：新开 agent 窗口、读输出、发指令、等任务跑完。典型画面：主窗口的 claude 开三个窗口分别试方案 A/B/C，谁先跑绿用谁的，花叔在旁边围观。

## 安全模型：token 只在进程树里，不落盘

「本地」有三档，选了最紧的第三档：

1. ~~绑 127.0.0.1~~ —— server.js 本来就只绑回环（还有 Host/Origin 校验挡 DNS rebinding），但挡不住本机其他进程。
2. ~~token 文件~~ —— `~/.fanbox/token` 谁读到谁能控，等于把「驱动所有终端」开给全机器（含任意 npm 包的 postinstall）。
3. **token 每次启动随机生成、绝不落盘，只注入翻箱自开 pty 的环境变量。** 能力边界 = FanBox 进程树：只有跑在翻箱终端里的 agent 拿得到门票；翻箱一退出 token 作废；token 没有文件形态，想手滑泄漏都难。

代价（有意为之）：外部 MCP 客户端（Claude Desktop 等）和用户自己的 iTerm 接不进来。真有需求时再加「设置里手动生成持久 token」的显式开关，让用户自己承担开门的决定。

浏览器版（`node server.js` 无 Electron）没有终端能力，接口直接 501。

每个 pty 注入三个环境变量（skill 零配置的关键——agent 天生知道自己是谁、门在哪、票在手）：

| 变量 | 含义 |
|------|------|
| `FANBOX_TERM_ID` | 自己的窗口 id（防自控回环） |
| `FANBOX_CTL` | 接口地址 `http://127.0.0.1:PORT/api/agent` |
| `FANBOX_CTL_TOKEN` | 门票，随启动随机（`FANBOX_AGENT_TOKEN` 环境变量可覆盖，供开发/测试） |

透明度：被遥控的 tab 在界面上闪 8 秒 ⚡（send/create/kill 都触发）——既是审计，也让「agent 舰队互相指挥」这个画面看得见。

## 接口规范（v1，全部带 `x-fanbox-token` 头或 `?token=`）

| 端点 | 方法 | 参数 | 返回 |
|------|------|------|------|
| `/api/agent/terminals` | GET | — | `{ok, terminals:[{id, cwd, name, proc, busy, tail}]}` |
| `/api/agent/read` | GET | `id`, `lines`(≤2000, 默认200) | `{ok, id, text}` 去 ANSI 纯文本 |
| `/api/agent/send` | POST | `{id, text, submit?, paste?}` | `{ok}` |
| `/api/agent/create` | POST | `{cwd?, autorun?}` | `{ok, id, autorun?}` |
| `/api/agent/wait` | POST | `{id, until?, idle?, idleMs?, timeoutMs?}` | `{ok, idle\|matched\|exited\|timeout, elapsed, output}` |
| `/api/agent/kill` | POST | `{id}` | `{ok}` |

语义细节：

- **send**：`\n` 一律转 `\r`（否则 TUI 不提交）；默认末尾补 `\r` 提交，`submit:false` 只输入；`paste:true` 用 bracketed paste（`ESC[200~ … ESC[201~`）包住，多行文本整块进 claude 等 TUI 不被逐行提交。控制键直接发字符（Ctrl-C = `""`）。
- **create**：main → renderer IPC 开真实 tab（界面上看得见、随时接管，这是产品魂，所以不做 headless pty）。`autorun` 会等 shell 就绪（有过输出且静默 ≥400ms，上限 8s）再敲，login shell 初始化慢也不怕。
- **wait**：长轮询，`timeoutMs` 上限 240s（低于 node http 默认 requestTimeout 300s）。三种完成判定——默认「前台回到裸 shell 且静默 ≥idleMs」（等命令跑完）；`idle:'quiet'` 只看静默（等常驻 TUI 回答完）；`until` 正则匹配**wait 开始后的新输出**（所以要在结果出现前发起 wait，别先 send 干完了才 wait）。
- **read**：数据源是 main 进程维护的去 ANSI 滚动缓冲（每终端 ~200KB），TUI 重绘会有噪音但可读。

## 实现位置

- `electron/main.js`：能力层。`AGENT_TOKEN` / `termBufs` / `termLastOut` / `termWaiters` 状态，`agentList/Read/Send/Create/Wait/Kill` 六个函数，经 `global.__fanboxAgent` 递给 server.js（两者同进程，`main.js` require `server.js`）。
- `server.js`：`/api/agent/*` 路由 + token 校验（紧贴静态资源 fallthrough 之前）。
- `electron/preload.js`：`fanboxAgentCtl`（onCreate/created/onTouch）。
- `public/app.js`：应邀开 tab（复用 `term.newTab`）+ tab ⚡ 标记；样式在 `style.css` `.tab-zap`。
- `skills/fanbox-agent/SKILL.md`：给 agent 的使用说明（curl 速查 + 多窗口实验套路 + 规矩）。

微信 ClawBot 的 `termControl`（list/send）与此并存未合并——它走的是花名册编号 + `<term n=…>` 协议，改动面大收益小，留给下次顺手。

## 后续（按需再做）

1. **skill 随产品分发**：设置面板一键把 `skills/fanbox-agent` 装进 `~/.claude/skills/`（现在手动拷）。
2. **MCP 薄壳**：stdio MCP server 代理到 HTTP，给非终端场景的客户端用（需配套持久 token 开关）。
3. **滚动长截图**：xterm serialize 完整 scrollback → 离屏 BrowserWindow 全高渲染 → capturePage 一张长图。给人看/发微信用；agent 干活走 read 就够。
4. **微信 termControl 合并**到 `global.__fanboxAgent`，消掉重复的 list/send。
