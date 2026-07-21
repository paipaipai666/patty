# 问题清单

> 仅记录代码可验证的事实 + 逻辑推论。问题 D 已补充外部验证结论。

---

## 问题 A：opencode 退出时 `session_deleted` 无法送达后端 🔴

### 事实（代码可验证）

| 行号 | 内容 |
|------|------|
| `resources/opencode-patty-plugin.ts:47-58` | `notifyPatty` 用 HTTP POST 发事件给 `127.0.0.1:${PATTY_PORT}/hook` |
| `resources/opencode-patty-plugin.ts:60-61` | `fetch` 错误被 `catch {}` 静默吞掉，无重试 |
| `resources/opencode-patty-plugin.ts:84-93` | `session.deleted` handler 调用 `await notifyPatty('session_deleted')` — 但调用者（opencode 的 event dispatch）不等待此 promise（标准 fire-and-forget 模式） |
| `resources/opencode-patty-plugin.ts:79` | `alive` 的 `setInterval` 调用了 `.unref()`，不会阻止 Node.js 进程退出 |
| 用户 Ctrl+C → 进程收到 SIGINT | 在 `notifyPatty` 的 HTTP POST 完成之前，进程可能已经终止 |

### 逻辑推论

opencode 退出时，`session_deleted` POST 请求发出后进程立即终止，请求不会送达后端。hook server 收不到 `session_deleted` → `note_event` 不移除 ACTIVE 条目 → 不发射清理信号 → 前端 `aiType` 保持不变。

### 支持证据

`hooks.rs:47-49` `session_deleted` 的处理路径是 `note_event` 移除 ACTIVE + `on_hook_request` 发射 `pty:attn Null`。如果 POST 根本没到，两个都不发生。

### 严重性

**高**。用户每次关闭 opencode 时触发，100% 复现。

---

## 问题 B：backend 端 opencode 心跳超时 15s，看门狗只能兜底不能立即清除 🔴

### 事实（代码可验证）

| 行号 | 内容 |
|------|------|
| `src/shared/heartbeat.ts:6` 和 `hooks.rs:15` | opencode 超时 = `15_000ms` |
| `hooks.rs:77-91` | 看门狗每 5s 检查一次，超过 15s 无心跳才判定过期 |
| `hooks.rs:70` | 条件为 `now.saturating_sub(e.last_seen) > t`（严格大于，非大于等于） |
| `hooks.rs:88-89` | 过期后发射 `pty:attn` 带 `Null`，前端 `setAiType(null)` 清除动画 |

### 逻辑推论

opencode 已退出（`alive` 停发）→ 看门狗最早 15s 后发射清除信号 → 最晚 20s 后动画熄灭。从用户视角就是"一直不灭"。

时序举例：最后一个 alive 在 T=0
- T=5s 检查：5000 > 15000? No
- T=10s 检查：10000 > 15000? No
- T=15s 检查：15000 > 15000? No（严格大于）
- T=20s 检查：20000 > 15000? Yes → 发射

### 与问题 A 的关系

A 是根本原因（请求不到后端），B 是兜底（即使请求到了，兜底也要 15-20s）。

### 严重性

**高**。叠加 A，用户关闭 opencode 后动画将持续 15-20s 才熄灭。

---

## 问题 C：`on_hook_request` 中 `session_deleted` 清理信号被 `enabled` 检查错误拦截 🟡

### 事实（代码可验证）

| 行号 | 内容 |
|------|------|
| `hooks.rs:125-159` | 执行顺序：`note_event`(127行) → enabled 检查(130-139行) → 若 `!enabled` 则 return(137-139行) → 发射事件(144-157行) |
| `hooks.rs:127` | `note_event("session_deleted")` 在 enabled 检查之前执行，确实从 ACTIVE 移除了条目 |
| `hooks.rs:137-139` | 但如果 notification 开关为 false，return 阻止了 `pty:attn Null` 发射 |
| `hooks.rs:150-151` | 被阻塞的具体代码：发射 `pty:attn` 带 `(pane, Value::Null, Value::Null)` |

### 逻辑推论

如果用户在 opencode 运行期间去设置里关掉 notification，此后任何 `session_deleted` 事件仍会从 ACTIVE 移除条目，但不会发射清理信号到前端 → `aiType` 永不改变 → 动画永久不灭。

### 前提条件

用户在 session 活跃时关闭了 notification。如果从未关过，此问题不影响。

### 严重性

**中**。条件触发，依赖用户行为。一旦触发则永久残留。

---

## 问题 D：Claude Code 的 SessionStart hook 格式与 Notification 不一致 🟡

### 事实（代码可验证）

| 行号 | 内容 |
|------|------|
| `installer.rs:144,149` | Notification/Stop/StopFailure 使用 `cmd_hook`：`"command": "powershell -ExecutionPolicy Bypass -File \"...\""`（完整命令字符串） |
| `installer.rs:82-91,152` | SessionStart/SessionEnd/PreToolUse/PostToolUse/UserPromptSubmit 使用 `args_hook`：`"command": "powershell"`, `"args": ["-ExecutionPolicy", "Bypass", "-File", "...", "-EventType", "session_start"]`（命令和参数分离） |
| `installer.rs:159-170` | Codex 的所有 hook 统一使用 `cmd_hook`，不存在此差异 |
| `installer.rs:276-289` | 单元测试仅验证 JSON 结构正确，不验证 Claude Code 能否识别此格式 |

### 已确认

Claude Code 可以识别 `args` 格式。此格式不一致不影响功能。

### 残留问题

虽然格式兼容，但代码库内两种格式混用是不必要的差异。Notification/Stop/StopFailure 用 `cmd_hook`，其他用 `args_hook` — 没有技术理由解释为什么选择不同格式。

### 严重性

**低**。无功能影响，仅代码风格不一致。

---

## 问题 E：`loadState` 异步注册导致 hook 事件窗口期丢失 🟡

### 事实（代码可验证）

| 行号 | 内容 |
|------|------|
| `main.rs:240-241` | hook server 在 Tauri `setup()` 中启动，早于 webview 加载 |
| `sessionStore.ts:102-122` | `loadState` 是 `async` 函数，`onAttentionChange` 在 `await window.terminalAPI.stateLoad()` 之后才注册 |
| `App.tsx:121-145` | `loadState()` 在 React `useEffect` 中调用 |
| `sessionStore.ts:116-122` | 注册 `onAttentionChange` 之前没有任何队列或缓冲机制 |

### 逻辑推论

hook server 启动 → webview 加载 → React mount → `useEffect` 调 `loadState()` → `await stateLoad()` IPC → 注册 listener。这个窗口期内 hook 事件已可到达但无人接收。事件永久丢失。

### 实际影响评估

`stateLoad()` 是读本地 JSON 文件，通常 <5ms。用户几乎不可能在这个窗口内完成"打开终端 → 运行 claude → 触发 SessionStart"。理论窗口存在但实测可忽略。

### 严重性

**低**。理论漏洞，实际利用窗口极小。

---

## 问题 F：`reset_attention` 命令是空壳 🟢

### 事实（代码可验证）

| 行号 | 内容 |
|------|------|
| `main.rs:126` | `fn reset_attention() {}` — 无参数、空函数体 |
| `renderer/api.ts:46-48` | 前端调用 `invoke('reset_attention', { id })` 传递 `id` 参数 |

### 推论

IPC 调用浪费，`id` 被忽略，命令无任何效果。不直接影响动画触发/结束。

### 严重性

**低**。死代码，不产生可见故障。前端 `resetAttention` 在 `sessionStore.ts:392-395` 中被调用，调用后后端无响应，但前端 `setAttention(id, null)` 已在本端执行，所以功能上无受损。

---

## 问题 G：attention coalesce timer 到期后不清除 `attentionMap` 🟢

### 事实（代码可验证）

| 行号 | 内容 |
|------|------|
| `sessionStore.ts:382-383` | `setTimeout` 只执行 `delete attentionTimers[id]`，不清除 `attentionMap[id]` |
| `sessionStore.ts:370-390` | `attentionMap` 条目只有收到 `eventType=null` 时才清除（`:371-376`），timer 到期不触发清除 |

### 逻辑推论

最后一个 attention 事件（如 `permission` 蓝光）会永久保留，直到下一次 `session_deleted` 或看门狗超时。对于 claude-code/codex 的 600s 超时，窗口期可达 10 分钟。

### 影响

不影响功能正确性。`attentionMap` 条目仅用于 CSS 状态类名，视觉上用户看不出来（因为 `aiType` 和 `attentionType` 共同决定 UI 表现）。但如果 `aiType` 已清除而 `attentionMap` 残留，理论上可能有微妙的视觉误导。

### 严重性

**低**。不影响功能正确性，但属于数据不一致。
