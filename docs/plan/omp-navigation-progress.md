# OMP 轮次导航实施状态

更新日期：2026-11-08。

2026-11-08 外观修订：移除常驻顶栏，改为终端左侧悬浮细线列表。悬停项伸长并显示提示词预览，邻近项按距离变化，滚轮只滚动轮次列表；收起时交互宽度约 24px。历史浏览使用正常终端 buffer，保留右侧终端滚动条。原有搜索、跳转、返回实时与显示确认协议沿用。

当前已实现同一终端中的轮次目录、搜索、快捷键、原生跳转和返回实时。用户已授权实施，并选择渐进高亮。标准 OMP 18.17.0 单文件扩展首版使用基础代码颜色；旧 companion 保留渐进高亮 worker。实现方案及执行顺序边界见 [完整方案](D:/code/terminal/terminal-sidebar/docs/plan/2026-11-05-omp-session-turn-navigation.md)，启动步骤见 [使用指南](D:/code/terminal/terminal-sidebar/docs/plan/omp-navigation-usage.md)。

## 已实现

- 项目内隔离 Bun 1.4.4，下载归档使用固定 SHA256 校验。该运行时和 18.13.3 副本现在只用于旧模块回归，不再是产品启动路径。
- 隔离 OMP 18.13.3 源码副本、上游源码 hash 清单和可重跑补丁，仅作为历史验证资产保留。
- 早期 companion 的 OMP 原生 `ctx.ui.transcript`，包含稳定 entryId、目录、Unicode scalar 源锚点、branchEpoch、displayEpoch 和帧事件。标准 OMP 路径由扩展宿主适配器提供同一 `NavigationApi`。
- 当前聚焦 pane 的轮次目录，支持多词搜索、虚拟列表、鼠标选择和键盘选择。
- 可配置的目录、上一轮、下一轮及返回实时快捷键，复用现有 IME、模态和终端控制键保护。
- Markdown 原始组件范围渲染及行源位置映射，覆盖已测试的代码、列表、宽字符、缩放和向上滚动。
- 早期 companion 的渐进高亮 worker，最多一个执行任务和一个最新候选，缓存最多 64 条、2 MiB。标准 OMP 单文件扩展使用基础代码颜色，不启动 worker。
- 独立长轮询调度器，不占住原有四个 hook 处理线程。
- 认证 lease 绑定当前 PTY root、OMP actor 的内核进程创建身份、instance 和 session。令牌保留在后端及 adapter 中。
- 有界目录原子分页、连续增量、稳定前端快照、请求去重、latest-wins 和单执行槽位。
- 执行前 `authorize` 校验、已取消请求 `abandoned` 清理，以及丢应答后的同请求重试。
- OMP 执行结果与同流 OSC 帧确认分开处理。终端解析和绘制后才确认 shown，隐藏 pane 不提前确认。
- 本地输入恢复原编辑器，已提交中文、粘贴和中断只交付一次，浏览不改变 session leaf。
- `/new` 保留有效导航 API 生命周期，自动轮换 session 绑定。
- 错误重试入口、旧前端 scope 失效、进程退出和服务停止后的 lease 与 poll 清理。

## 实际验收

- 前端全量回归 911 项通过，包含 17 项悬浮导航组件测试和标准宿主适配器契约测试。原始基线为 873 项。
- Rust 全量回归 271 项通过、1 项忽略。原始基线为 239 项通过、1 项忽略。
- OMP 模块测试 45 项通过，覆盖 SessionManager、TUI、renderer、native worker、源映射、标准宿主适配器和 10,000 轮缓存路径。
- `verify.mjs` 核对 11 个全局上游源码指纹、14 个补丁文件及 7 个运行模块。全局 OMP 未改动。
- 真实 CLI smoke 通过，包含 seek、返回实时、已提交中文一次性交付、单调帧版本及 `/new`。浏览前后 leaf 未改变。
- 真实 xterm parser 验证首轮离开 1,000 行滚动缓存后仍能定位，返回时保留实时尾部和浏览期间新增内容。
- 真实桌面回归使用 WebView2、ConPTY、完整 OMP CLI 和 650 组历史问答。首轮已从滚动缓存淘汰，搜索并点击后在同一终端显示。
- 同一桌面回归验证返回实时、浏览期间新增消息、上一轮快捷键、已提交中文仅输入一次、草稿跨浏览保留，以及 `/new` 后重新绑定。
- 桌面实测曾记录从点击到测试观察 shown 的上界约 233 ms，最新值见报告的 `jumpToShownUpperBoundMs`。测试轮询含 200 ms 检查间隔，该值不代表精确绘制耗时。
- production 前端构建通过，产物不包含桌面验证接口。类型检查和注释检查通过。
- 2026-11-08 悬浮列表实测：收起宽 24px，展开宽 64px，当前及邻近细线长 48、34、22、15、10px。悬停不跳转、不抢终端焦点；滚轮及列表两端都不向终端传递滚动。
- 独立视觉回归覆盖浅色 1440、540、360px 和深色 360px 窗口，预览四周保持在窗口内，实际角点命中通过。主题切换后列表能恢复，窄窗预览不受终端容器裁切。

## 2026-11-08 标准 OMP 18.17.0 验收

- `standard-probe.ts` 在真实 `omp/18.17.0` CLI 上完成首轮跳转和返回实时，`preexistingTranscript:false`，`catalogSize:2`，`answerVisible:true`，`leafBefore` 与 `leafAfter` 都是 `second-user`。报告在 `output/omp-standard/report.json`。
- 标准 OMP 扩展通过 `ctx.ui.setWidget` 取得真实 TUI，通过 `ctx.sessionManager.getBranchView()` 读取当前分支；`TranscriptNavigationController`、`CanonicalBranchIndex` 和 `ChatTranscriptBuilder` 复用。
- 单文件构建产物为 `resources/omp-patty-hook.bundle.js`，构建检查 `node scripts/build-omp-hook.mjs --check` 通过，包内无相对导入、无 `new Worker(`。
- 桌面验收 `npm run test:e2e:omp` 通过，使用普通 `omp.exe` 18.17.0 和临时 `USERPROFILE` 下的正常扩展发现路径。覆盖首轮离开滚动缓存后的跳转、返回实时、浏览期间追加、已提交中文一次交付、`/new` 重绑和 650 轮目录。报告在 `output/omp-navigation/desktop/report.json`。
- 前后端回归：`npx vitest run` 911 项通过；`npm run typecheck` 通过；OMP 模块测试 45 项通过。

## 适用范围与剩余边界

- 仅支持固定指纹的 OMP 18.13.3 companion 的限制已解除。当前产品路径是本机普通 `omp` 18.17.0 加载 `%USERPROFILE%\.omp\agent\extensions\patty-notifier.ts`，该文件由 `resources/omp-patty-hook.bundle.js` 安装而来。
- 早期 companion 的超长物理行原生语法解析仍可能耗时 10–40 秒，发生在 worker 中。标准 OMP 单文件扩展没有该 worker，病态长行改由宿主 Markdown 渲染速度限制。
- 复杂残缺 Markdown 与自定义工具 `details` 未做穷尽的保真和范围布局覆盖。复用原 renderer 不代表任意第三方 renderer 都已证明有界。
- 已测试合成输入保护和已提交中文文本。尚未逐一实测本机所有物理中文输入法候选窗流程。
- 浏览期间新增消息的桌面用例通过无模型请求的扩展注入完成，不代表已经覆盖全部云模型的真实流式协议。
- 尚未完成所有工具审批样式、多 OMP 实例并行、所有主题、所有宽度以及进程强杀时序的桌面组合矩阵。
- `authorize` 是开始执行的顺序点。授权成功响应在途时才撤销 scope，已获授权的动作仍可能完成。新请求等待旧执行槽位归位，旧结果不会覆盖新前端 scope。详见方案第 25 节。

## 可重跑证据

```powershell
rtk npm run typecheck
rtk npx vitest run
rtk node scripts/build-omp-hook.mjs --check
rtk node integrations/omp/standard-probe.mjs
rtk npm run test:e2e:omp
```

标准 OMP 探针报告为 `output/omp-standard/report.json`。桌面报告为 `output/omp-navigation/desktop/report.json`，另有 `directory.png`、`first-turn.png` 和 `live.png`。桌面测试的构建与 `PATTY_EXE` 配置见使用指南。

旧的 18.13.3 模块回归仍可单独运行 `rtk npm run test:omp`，它不是产品启动步骤。parser 报告 `output/omp-navigation/gate0-report.json` 是历史验证资产。

悬浮列表视觉报告为 `output/omp-navigation/desktop/rail-visual-report.json`。`rail-dark-hover.png` 和 `rail-dark-collapsed.png` 展示展开与收起，`rail-light-540-preview.png` 和 `rail-dark-360-preview.png` 展示窄窗。可通过 `rtk npm run test:e2e:omp -- --rail-visual` 单独运行视觉与交互回归。

所有运行副本、隔离 runtime、测试 profile 和会话样本均放在项目 `output/omp-navigation` 或独立的临时测试目录。未迁移用户 session，也未替换本机全局 OMP 安装。
