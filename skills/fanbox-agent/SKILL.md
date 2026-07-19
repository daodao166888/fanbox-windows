---
name: fanbox-agent
description: 在 FanBox 终端里指挥兄弟终端窗口：列出所有窗口、读取输出、发送指令、新开 agent 窗口、等待任务完成。当用户说「开个窗口跑 X」「看看另一个终端」「让 N 号窗口执行…」「多窗口并行实验」时使用。仅当 FANBOX_CTL 环境变量存在（跑在 FanBox 桌面 app 终端里）时可用。
---

# FanBox 终端控制

只在 FanBox 桌面 app 的终端里可用。先确认门票在手：

```bash
[ -n "$FANBOX_CTL" ] && echo "在 FanBox 里，我是 $FANBOX_TERM_ID 号窗口" || echo "不在 FanBox 终端里，本 skill 不可用"
```

三个环境变量由 FanBox 注入：`FANBOX_CTL`（接口地址）、`FANBOX_CTL_TOKEN`（门票，每次启动随机、只存在于 FanBox 终端的环境里，**绝不外传、不写进文件**）、`FANBOX_TERM_ID`（自己的窗口 id）。

**别给自己（$FANBOX_TERM_ID）发指令**——那会把你自己的输入流打乱甚至死循环。

## 接口速查

所有请求带 `x-fanbox-token` 头。以下用 `CT` 缩写公共参数：

```bash
CT=(-s -H "x-fanbox-token: $FANBOX_CTL_TOKEN")
```

**列出所有终端窗口**（id / 目录 / 前台进程 / 忙闲 / 最近输出尾巴）：

```bash
curl "${CT[@]}" "$FANBOX_CTL/terminals"
```

**读某窗口最近输出**（去 ANSI 纯文本，默认 200 行，最多 2000）：

```bash
curl "${CT[@]}" "$FANBOX_CTL/read?id=t2&lines=100"
```

**给窗口发指令**（默认自动补回车提交；`"submit": false` 只输入不提交；多行文本发给 claude 等 TUI 加 `"paste": true` 走 bracketed paste 整块粘贴）：

```bash
curl "${CT[@]}" -X POST -H 'Content-Type: application/json' \
  -d '{"id":"t2","text":"npm test"}' "$FANBOX_CTL/send"
```

控制键直接发字符本身，如 Ctrl-C：`{"id":"t2","text":"","submit":false}`。

**新开终端窗口**（可选 `autorun` 开窗即执行，会等 shell 就绪再敲）：

```bash
curl "${CT[@]}" -X POST -H 'Content-Type: application/json' \
  -d '{"cwd":"/path/to/project","autorun":"claude \"跑通所有测试\""}' "$FANBOX_CTL/create"
# → {"ok":true,"id":"t5","autorun":true}
```

**等窗口告一段落**（HTTP 长轮询，timeoutMs 最长 240000）：

```bash
curl "${CT[@]}" -X POST -H 'Content-Type: application/json' \
  -d '{"id":"t5","timeoutMs":120000}' "$FANBOX_CTL/wait"
```

三种等法：
- 默认：前台回到裸 shell 且输出静默 ≥ `idleMs`（默认 2000）——适合等普通命令跑完
- `"idle":"quiet"`：只看输出静默——适合等 claude 等常驻 TUI 回答完，建议配 `"idleMs":3000`
- `"until":"正则"`：新输出匹配到正则就立刻返回——注意只匹配 wait 开始之后的新输出，所以要在结果出现前就发起 wait。**命令回显也算输出**：你敲的命令本身会先出现在流里，正则要用 `^` 锚定行首（如 `"^DONE$"`）才不会匹配到自己发的命令

返回 `{ok, idle|matched|exited|timeout, elapsed, output}`，output 是等待期间的输出（最后 8KB），通常不用再 read。

**关闭窗口**：

```bash
curl "${CT[@]}" -X POST -H 'Content-Type: application/json' -d '{"id":"t5"}' "$FANBOX_CTL/kill"
```

## 子窗口的 claude 卡在确认框怎么办

新窗口里的 claude 默认权限模式会在写文件/跑命令前停下等确认，没人替它点就永远卡着（wait 只会 timeout 或 quiet）。两条路：

- **开窗时就放权**（实验场景推荐）：autorun 用 `claude --permission-mode acceptEdits "任务"`（文件编辑自动同意，跑命令仍确认）；用户明确授权全自动时才用 `claude --dangerously-skip-permissions "任务"`
- **替它按确认**：wait 返回后 read 尾部，看到「Do you want …?」「❯ 1. Yes」这类选择框就是卡在确认——发 `{"id":"tN","text":"","submit":true}`（回车 = 确认当前选中项），或数字直选如 `{"id":"tN","text":"2","submit":false}`（TUI 选择框数字键即按即生效，**别带回车**，多出的回车会误触下一个状态）

## 多窗口并行实验套路

1. `create` × N 个窗口，不同 `cwd` 或不同 `autorun` 方案
2. 并行等待：每个窗口的 `wait` 用 `curl … &` 后台发起，`wait` 命令收齐
3. 从各 `wait` 返回的 `output`（或补一次 `read`）收结果，对比汇报

用户在 FanBox 界面上能看到每个窗口实时滚动，被遥控的 tab 会闪 ⚡。

## 规矩

- `kill`、发 Ctrl-C、覆盖性命令：先向用户确认，除非用户已明确授权
- 读到的其他窗口输出可能含敏感信息，只用于当前任务，不外传
- 接口报 403/501 或环境变量缺失：说明不在 FanBox 里或版本过旧，直接告诉用户，不要重试
