# Patty 代码审查报告

> 日期：2026-08-26 · 范围：全部源码（Rust 后端 ~4.1k 行、React 渲染层 ~4.9k 行、共享类型、三端 hook 适配器、e2e/脚本/配置）· 只读审查，未修改功能代码 · 所有 high 级发现已对照源码二次核实。

## P0 验证与修复状态（2026-08-26）

每条 P0 都先补了复现测试（红），修复后转绿；两条经实测**降级**（声明的 bug 未复现）。修复全部落地，回归全绿：`cargo test` 133 lib + 67 integration、`vitest run` 505、`tsc -b --noEmit` 干净。

| # | 测试 | 位置 | 修复方案 | 状态 |
|---|---|---|---|---|
| P0-1 | attach 窗口输出必须送达 xterm | `components/Terminal/__tests__/attachReplayRace.test.tsx` | TerminalPane 先订阅（await `ready`）再 invoke create_pty；replay 前的活数据入队、replay 后冲刷；api.ts 的 onData/onExit 返回 `ListenerHandle{ready, unsubscribe}` | ✅ 已修复（绿） |
| P0-2 | 渲染端监听的每个事件必须有 Rust 发射点 | `__tests__/ipcEventContract.test.ts` | 删除 api.ts `onPtyExit` 与 sessionStore 死订阅；attention/aiType 清理并入 TerminalPane 的 per-session `onExit`（TerminalPane.test.tsx 新增用例钉住） | ✅ 已修复（绿） |
| P0-3 | 损坏的 codex hooks.json 不得被静默清空 | `installer.rs::install_codex_preserves_corrupt_settings` | `install_at` 删除 `reset_on_corrupt` 参数（两个调用点统一 fail-safe）；`install_at`/`strip_patty_hooks` 改走 `store::save_atomic_to` 原子写 | ✅ 已修复（绿） |
| P0-4a | channel 阶段失败后连接必须及时拆除 | `sshconn.rs::channel_stage_failure_tears_down_connection` | 无需修复——实测 russh 0.62 在 Handle drop 时即拆除连接（服务端 0.24s 内观察到 handler drop）。另注：`request_pty`/`request_shell` 以 `want_reply=false` 调用，服务端失败根本不会回传，唯一可达的 channel 阶段失败点是 `channel_open_session`。测试保留为回归护栏 | ⤵️ 降级 P2（不对称清理，无泄漏） |
| P0-4b | 远端 exec 悬挂时 metrics 必须报 stale | `sshconn.rs::metrics_report_stale_when_remote_exec_hangs` | `collect_once` 读循环外套 10s `tokio::time::timeout`（`COLLECT_TIMEOUT`），超时走既有 `Err → emit {stale:true} → break` 路径 | ✅ 已修复（绿） |
| P0-5 | 8MiB 洪泛下无单次写入阻塞 >2s | `pty.rs::tests::write_to_non_reading_child_does_not_block_the_caller` | 无需修复——实测 512×16KiB 全部送达、最慢单次写 54ms（conhost 持续 drain，代价是 ~0.5 MiB/s 吞吐而非阻塞）。测试保留为回归护栏 | ⤵️ 降级 P2（吞吐注记） |

## P1 验证与修复状态（2026-08-26）

可行为验证的 P1 逐项补了复现测试，七条确认为真 bug 并已全部修复；两条以守护测试锁定一致性。回归全绿：`vitest run` 514、`cargo test --no-fail-fast` 203、`tsc -b --noEmit` 干净。

| # | 修复 | 状态 |
|---|---|---|
| P1-6 重复 kill | `App.handleCloseSession` 删掉显式 kill——kill 归 `sessionStore.removeSession` 独占；App.test 的 Ctrl+W 用例改钉新归属 | ✅ |
| P1-7 主题色漂移 | `variables.css :root --bg-app` `#000000`→`#0a0a0c` 对齐 dark.json；四源一致性测试常驻 | ✅ |
| P1-8b 校验过浅 | `validate_state` 新增 workspaces/paneTree 递归形状校验（leaf/split 字段、direction 词汇、ratio 类型） | ✅ |
| P1-9 假迁移 | `normalizeWorkspaces` 新增可选 `legacy` 参数：无 workspaces 且存在 legacy paneTree 时合成一个 workspace 走正常校验路径；App 加载处传入 | ✅ |
| P1-10 无卸载 | installer 新增 `remove_claude_code_hook`/`remove_codex_hook`/`remove_opencode_plugin`/`remove_omp_hook` 与统一入口 `sync_notification_tools`（开→ensure，关→remove）；`settings_set("notifications")` 与启动线程都改走该入口 | ✅ |
| P1-14a 引号截断 | `ssh.rs` 注释剥离改为引号感知的 `strip_comment`（OpenSSH 语义：引号内 # 为字面量） | ✅ |
| P1-15a 回滚不一致 | `updateSetting` 失败回滚时重放 `applyTheme`/`cacheBootTheme`/`applyFontSettings` 的旧值 | ✅ |
| P1-8a | settings 默认值双端对表守护测试（解析 store.rs `json!` 字面量 ↔ DEFAULT_SETTINGS） | 🟢 守护常驻 |
| P1-11 | CSP sha256 与 boot 脚本对表守护测试 | 🟢 守护常驻 |

**不适合测试验证的 P1**（附原因）：P1-8c settings_set 跨调用竞态（需在 Tauri 命令层并发注入，进程内复现价值低）；P1-12 SettingsModal 体量/可访问性（结构性问题，行为测试无法表达）；P1-13 WebGL 模块级全局污染（行为真实但属保守降级设计，改不改是产品决策）；P1-14b TOFU 无锁追加（并发窗口极小，确定性复现不现实）；P1-14c passphrase attempt 计数（UX 打磨）；P1-15b attentionTimers 死机制（死代码无可观察行为可钉，直接删即可）；dirtyScheduler 崩溃窗口（进程崩溃语义进程内不可测）。

---

## 总体判断

代码质量明显高于一般 Tauri 移植项目：线程模型干净（每会话 reader/waiter 两线程、注册表只做寻址）、SpawnGuard 解决 warm/create 同 id 竞态是真问题真修复、ConPTY DSR 握手拦截体现了对平台行为的深入理解、`resources/hook-protocol.json` 作为四方共享的事件词汇单一事实源被 Rust 与三套适配器测试共同消费，是教科书级的漂移防御。

问题集中在三类：

1. **跨端手工同步的事实源** —— 主题背景色 4 处、settings 默认值 2 处、IPC 事件名字符串散落两侧；
2. **真实但狭窄的并发/清理缺口** —— attach/replay 竞态、SSH 资源泄漏、同步 command 阻塞 UI；
3. **死机制 / 假迁移** —— 全局 `pty:exit` 死监听、attentionTimers 空转定时器、legacy paneTree 字段三端互撑假象。危害在于让后来者以为对应行为存在。

---

## P0 — 确凿 bug / 数据丢失

### P0-1 预热会话 attach↔replay 竞态：输出静默丢失

- `src-tauri/src/pty.rs:437` `create()` 重连预热会话时 `attached.store(true)`，reader_loop（pty.rs:281）随即改走 `emit("pty:data:{id}")`；
- `src/renderer/components/Terminal/TerminalPane.tsx:488-491` 在 create_pty promise 返回、写完 replay **之后**才调用 `onData` 订阅；Tauri 事件对无监听者直接丢弃（该文件 474-476 行注释自证）。
- **后果**：attach 翻转与订阅建立之间（约一个 IPC RTT）产生的输出既不进 replay buffer 也到不了 xterm，预热会话恰在挂载瞬间吐出的内容缺字。
- **修复方向**：渲染端先订阅并缓存事件、再 invoke create_pty、写完 replay 后冲刷缓存；或后端在首个 attach 确认前双写 emit+buffer。

### P0-2 全局 `pty:exit` 是死监听，退出清理路径从未执行

- `src/renderer/api.ts:57` 监听全局事件 `pty:exit`；Rust 侧只 emit `pty:exit:{id}`（pty.rs:316、sshconn.rs:533），全仓无裸 `pty:exit` 发射点。
- **后果**：`sessionStore.ts:130-133`「PTY 退出时清 attention/aiType」从未运行；本地 shell 无 hooks，进程退出后的 AI 状态清理完全落空。静默不报错，故无人发现。
- **修复方向**：后端退出处补发全局 `pty:exit`；或删除死订阅、把清理并入 TerminalPane 的 `onExit`。

### P0-3 installer 非原子写用户配置 + codex/claude 损坏处理非对称

- `src-tauri/src/installer.rs:225,256` `install_at`/`strip_patty_hooks` 直接 `fs::write` 覆盖用户的 `~/.claude/settings.json`、`~/.codex/hooks.json` —— 写盘中断即截断用户手工配置。
- `ensure_codex_hook`（installer.rs:263）传 `reset_on_corrupt: true`：损坏的 codex hooks.json 被整体重置为 `{}` 再写，用户既有钩子**永久丢弃**；claude 侧同场景（`false`）选择保留不动。
- **修复方向**：统一走 `store::save_atomic_to`（tmp+rename）；codex 改 `false` 或重置前先备份。

### P0-4 SSH 资源管理（一项确认，一项降级）

- ✅ **已确认（红）**：`sshconn.rs:563-573` metrics 的 `collect_once` 无界 `channel.wait()` —— 远端命令卡死或 SSH 服务器不发 EOF 时，metrics 任务永久悬挂、channel 永不释放，`stale` 信号永不发出（前端探测死连接依赖的信号被抑制）。复现测试：`sshconn.rs::tests::metrics_report_stale_when_remote_exec_hangs`。
- ⤵️ **降级（实测未复现泄漏）**：channel 阶段失败路径不调 `handle.disconnect()`（sshconn.rs:482-495）。实测 russh 0.62 在 Handle drop 时即拆除连接（见 `channel_stage_failure_tears_down_connection`，绿）；且 `request_pty`/`request_shell` 以 `want_reply=false` 调用，服务端失败根本不会回传，唯一可达的 channel 阶段失败点是 `channel_open_session`。残留问题仅为清理路径不对称（不发 `Disconnect::ByApplication`）→ P2。修复方向：三个失败分支补 `disconnect` 以对齐 auth 路径。

### ~~P0-5~~ `write_pty` 阻塞写（降级为 P2：实测无冻结）

- 原假设：同步 command 在主线程执行 + `pty::write` 阻塞 `write_all`，子进程不读 stdin 时 ConPTY 管道填满 → UI 冻结。
- **实测（2026-08-26, Win11 + ConPTY, cmd 子进程, 8 MiB 无回车洪泛）**：512×16 KiB 全部送达，最慢单次写入 **54ms**；conhost 持续 drain，代价是吞吐（~0.5 MiB/s）而非阻塞。冻结未复现。→ 降级为 P2（同步 command + 持锁阻塞写仍是结构隐患，但无证据表明可冻结 UI）。回归护栏：`pty.rs::tests::write_to_non_reading_child_does_not_block_the_caller`（绿）。

---

## P1 — 耦合与结构性问题

### P1-6 session/workspace 双 store 靠调用点手工配对

`addSession+createWorkspace` 出现在 App.tsx 4 个创建点，`kill+removeSession+removeSessionEverywhere` 在 2 个删除点，一致性全靠调用点自觉。App.tsx:38-41 注释自证这套约定已出过一次真 bug（collection 路径漏调 createWorkspace）。`handleCloseSession`（App.tsx:231）与 `removeSession` 内部 kill（sessionStore.ts:195-198）及 TerminalPane 卸载清理合计最多 kill 同一会话 3 次。503 行的 `sessionWorkspaceIntegration.test.ts` 实际在给手工舞步上保险。→ 抽 `sessionLifecycle` orchestrator 收口。

### P1-7 主题背景色 4 处真源，且已实际漂移

`lib.rs:220-227` BUILTIN 硬编码 6 主题 hex、`themes/*.json` 6 个 `--bg-app`、`variables.css` 5 个 data-theme 块 + `:root` 兜底、`index.html:18,28` 两处 `#0a0a0c`。漂移已发生：`variables.css:7` `:root --bg-app: #000000` ≠ `themes/dark.json:4 #0a0a0c`（被内联 setProperty 掩盖所以不可见）。漏改 Rust 侧表现为启动窗口闪异色。→ Rust 用 `include_str!` 直接消费 themes/*.json，消掉 BUILTIN 表。

### P1-8 settings 形状双端手工维护 + `settings_set` 跨调用竞态

`store.rs:30-56` 与 `src/shared/defaultSettings.ts` 逐字段手抄（当前一致），`settings_set` 白名单派生自 Rust 默认值 —— TS 新增设置项忘改 Rust → 每次 `settingsSet` 静默失败+回滚。load→modify→save 跨调用无锁（lib.rs:34-43），目前靠同步 command 主线程串行侥幸不可达。`validate_state`（store.rs:181-196）只查 4 个键，损坏的 paneTree 能通过校验覆盖好状态。→ `update_settings` 收进 store 锁内完成 load-modify-save；补 paneTree 递归形状校验。

### P1-9 legacy `paneTree`/`focusedPaneId` 假迁移

App.tsx:167 注释称旧字段由 `normalizeWorkspaces` 无缝升级，但其签名（workspaceNormalize.ts:13-17）从不读这两个字段；Rust `default_state()`（store.rs:67-68）至今仍写入它们。旧格式用户的分屏布局被**静默丢弃**（会话保留），死字段在 TS 类型（stateTypes.ts:37-38）、Rust 默认值、注释三处互撑假象。→ 删除两端遗留字段与注释，或补真迁移。

### P1-10 安装器只有「装」没有「卸」

关闭通知开关后，已写入 `~/.claude/settings.json` 的 8 个 hook、`~/.codex/hooks.json`、两个 plugin 文件**永久残留**；此后每次 Claude 工具调用仍 spawn 一次 `powershell.exe`（冷启动 0.3-1s），hooks.rs:200-220 的 enabled 检查只压 UI 不挡进程开销。`installer.rs:238` 已有 `strip_patty_hooks` 原语但未接线到 settings 变更路径。另：`apply_claude_hooks`（installer.rs:193-196）注册的 PreToolUse/PostToolUse 高频 hook 在 `map_event_to_attention_type` 全部返回 None，唯一作用是续 600s 租约 —— 每次工具调用被拖慢数百毫秒换租约续期，值得重新权衡。

### P1-11 meta CSP 靠手工 sha256 + 注入顺序运气

`tauri.conf.json:14` `csp: null`，实际防线是 `index.html:6-9` 手写 meta CSP（sha256 与 boot 内联脚本逐字节对表，已实测可拦未授权内联脚本）。但：(a) boot 脚本改一个字符 hash 即失效，无测试/工具守护；(b) meta 只约束其后的文档内容 —— dev 模式可用纯因 @vitejs/plugin-react 恰好把 react-refresh preamble 注在 meta 之前。另 `script-src` 的 `'wasm-unsafe-eval'` 全仓无消费者。→ CSP 上移到 tauri.conf.json 响应头，或加 hash 对表测试。

### P1-12 SettingsModal god component + 可访问性缺口

859 行单文件容纳 6 分类 8 内部组件；ThemePicker/FontPicker/ShellPicker 三处逐字复制同一套 open/click-outside 状态机（约 227-233、315-322、395-402 行）。下拉选项全是不可聚焦的 `<div onClick>`（约 263-283、350-380、395-415 行），键盘/读屏用户无法选择。`SessionList.tsx:142` 混用 `tablist > treeitem > tab` 非法嵌套语义。`applyJsonEdit`（SettingsModal.tsx:465-470）只查 name/ui/terminal 存在性，类型错误的 JSON 静默写入产生非法 CSS 变量。

### P1-13 TerminalPane 的全局态与重渲染

`webglSupported`/`webglPermanentlyLost` 模块级全局（TerminalPane.tsx:37-42）—— 单个 pane 的 context loss 使**所有** pane 永久降级 canvas。ImageAddon 靠 `HTMLCanvasElement.prototype.getContext` 全局 monkey-patch（357-365 行），升级 xterm 的隐性破坏点。`useSettingsStore((s) => s.settings)`（138 行）订阅整个 settings 对象，任何无关设置变更触发所有已挂载 pane 重渲染。

### P1-14 SSH 子系统其余问题

- `ssh.rs:49-53` 注释声称「# 在引号内不剥离」但实现无引号跟踪 —— 含 `#` 的 IdentityFile 路径被静默截断（doc 与实现矛盾）。
- TOFU known_hosts 追加无锁非原子（sshconn.rs:108-152），两 pane 并发连同一新主机可能交错写坏/重复提示。
- 公钥 passphrase 重试硬编码 `attempt: 1`（sshconn.rs:176-200），用户分不清首次提示与密码错误。
- `~/.ssh/config` 解析静默丢弃 Include/Match，别名回填可能产出看似合理实则错误的 profile。

### P1-15 前端状态层其余问题

- `settingsStore.ts:53-76` 回滚不一致：持久化失败只回滚 store，`applyTheme` 改的 DOM、`cacheBootTheme` 写的 localStorage 不回滚。
- `setAttention` 的 1s `attentionTimers` 是死机制（sessionStore.ts:397-400）：定时器回调只 delete 不做事，写入立即发生，测试还固化了它。
- `ContributionGrid.tsx:133` effect 只依赖 `[aiType]`，换肤后火焰颜色不刷新。
- dirtyScheduler 1s 防抖 + beforeunload 异步 `invoke('state_save')`（webview 销毁可能先于 IPC 到达），崩溃丢最后 1s 布局；失败仅 console.error。
- `hooks_clear_pane` 之外的跨模块依赖：`pty::kill` 与 `wait_loop` 反向调用 `crate::hooks::remove_pane`（pty.rs:562-569、309），进程层依赖通知层策略。

---

## P2 — 低严重度（择要）

| 位置 | 问题 |
|---|---|
| sessionStore.ts:122,422,424；TerminalPane.tsx:436 | `[flame]` 调试 console.log 残留生产路径，每次 attention 事件刷控制台 |
| pty.rs:411-419 | `buffer_push` 每次全量求和 + `remove(0)` O(n) 搬移，小块输出场景总量 O(n²) → `VecDeque` + running total |
| pty.rs:297 | `wait_loop` 的 `Err(_) => break 0`：try_wait 出错被报成退出码 0，auto-retry 不触发 |
| pty.rs:83-92 | gitbash 只硬编码 `C:\Program Files\Git`，不像 pwsh 走 `where.exe` —— 非默认安装位置用户选 gitbash 静默得到 PowerShell |
| pty.rs:325-329 | `cwd: ''` 空串绕过 USERPROFILE 回退，靠 portable-pty 内部 `is_dir()` 过滤兜底 —— 依赖 crate 实现细节 |
| lib.rs:173-217 | `theme_import` 只查键存在不查类型，`"name": 42` 也能导入 |
| installer.rs:8-14 | `home_dir()` 回退 `"."`，钩子会写进进程 CWD 而非用户目录 |
| hooks.rs:320-328 | HTTP body 无界读取（loopback+secret 缓解）→ Content-Length 上限 + 413 |
| lib.rs:264-267 | hook server 启动失败仅 eprintln，`PATTY_PORT=0` 仍注入每个 shell —— 通知永久静默失效无用户可见信号 |
| scripts/sync-version.mjs:8-13 | npm version 钩子漏同步 Cargo.lock（本次审查时工作区 `M src-tauri/Cargo.lock` 2.0.8→2.0.9 即活证据） |
| e2e/harness.mjs:75-80 | 注释声称 kills process tree，实现只杀顶层进程；smoke 失败路径留 conhost/pwsh 孤儿 → `taskkill /T /F`；`9300 + pid % 500` 端口可撞车 |
| package.json:44 | `@vitest/expect` 全仓零引用，死依赖 |
| MarqueeText.tsx | 60 行 ResizeObserver 双拷贝滚动 + 跨文件魔法常量耦合，实际场景多为不可能溢出的短标签 |
| 全仓 | 注释中英混杂（如同句 "same as the TS版"），风格不统一 |
| `out/` | 残留 Electron 时代产物（out/main、out/preload、probe.exe、utf8probe.rs），gitignored 但工作区存在 |

### 文档漂移（README 与代码严重脱节）

- README 把 6 行的 `main.rs` 描述为 "App entry, command registration, startup wiring"（真正入口在 lib.rs）；
- SSH 功能（全仓最大文件 sshconn.rs 1081 行 + 5 个 IPC + SshMonitor/SshSettings 两套 UI）、MetricsDashboard、第四个 AI 工具 omp 在 README **全文零提及**；
- "stable Rust toolchain (1.77+)" 与 Cargo.toml `rust-version = "1.85"` 矛盾。

---

## 测试质量

**做得好的**：pty.rs 内联测试覆盖真契约（跨 chunk 多字节 decode、DSR 拆分、buffer 超帽丢最旧、spawn guard 互斥），含一个真实 ConPTY round-trip；`hook-protocol.json` 被 Rust 一致性测试 + 三个适配器契约测试共同消费，任一侧词汇漂移即红；pattyHook 契约测试用真实 powershell.exe 端到端驱动；store 测试断言行为契约而非实现细节；sshconn 有真实 in-process russh 集成测试钉住 CREATING/KILL_EPOCH 竞态。

**缺口**：

1. attach/replay 竞态（P0-1）与 create 重连分支**完全无测试**；
2. `src-tauri/tests/hooks_integration.rs` 多条用例只注释「No errors / No panics」从不断言 ACTIVE 映射内容 —— 空断言造成「已覆盖」错觉；
3. 契约测试只驱动 stdin 载荷路径，installer 实际安装的 `-EventType` 显式参数路径不与 hook-protocol.json 对表 —— installer 里事件名笔误不会红任何测试；
4. Rust integration 测试靠全局 SERIAL 锁串行（根因 TEST_DATA_DIR/SETTINGS_CACHE 全局单例），漏调 fresh_dir 会读到上个用例的设置；
5. `dirtyScheduler.test.ts:98-114` 注释仍写 "BUG: this currently fails"，源码已修复 —— 过期叙述误导读者；beforeunload flush 路径从未被真测。

---

## 修复优先级建议（按验证结果排序）

1. **P0-3** installer 原子写 + codex `reset_on_corrupt` 改 false —— 已确认且在直接操作用户配置文件，风险最高
2. **P0-1** attach 竞态 —— 已确认，预热会话挂载窗口丢输出；渲染端先订阅再 invoke 即可
3. **P0-4b** metrics `collect_once` 加超时 —— 已确认，远端悬挂永久静默
4. **P0-2** 死 `pty:exit` 监听 —— 已确认，补发全局事件或删除死订阅
5. 死机制清理批次：`attentionTimers`、`[flame]` 日志、legacy paneTree 字段三端、`@vitest/expect`
6. 结构性收口：sessionLifecycle orchestrator、主题色单源化（`include_str!`）、settings 更新收进锁内
7. ~~P0-4a / P0-5~~ 已降级为 P2（实测未复现），回归护栏测试保留

## 值得保留的架构决策

shared 层不依赖 React/zustand；纯函数从 I/O 剥离（`evaluate_hook_body`/`compute_hook_events`/`paneTreeOps`/`dsr_filter`）；capabilities 权限面最小化；hook server loopback + 每进程随机 secret；e2e 用真实发布二进制 + APPDATA 隔离 + baseline tripwire。后续演进应沿用同一思路。
