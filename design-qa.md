# Graphite workbench 实现验收

日期：2026-10-22。目标是落实用户选定的 Graphite 工作台布局及已确认的细节规范。

## 比较依据

- 视觉目标：`D:/code/terminal/terminal-sidebar/designs/graphite-workbench-reference.png`。
- 细节规范：`D:/code/terminal/terminal-sidebar/designs/graphite-workbench-details-research.md`。
- 实现：`D:/rust-cache/target/release/patty.exe`，Tauri 原生窗口中的 React / xterm.js。
- 主截图：`D:/code/terminal/terminal-sidebar/output/graphite/workbench.png`。
- 主视口：1486 × 1059 CSS px；目标和归一化截图均为 1486 × 1059 像素。
- 实机 WebView2 密度：1.5。保留终端实际 DPR，截图使用 `clip.scale = 1 / devicePixelRatio` 归一化，避免把高密度 canvas 当成普通密度采样。
- 状态：深色主题、两个真实 PowerShell PTY、分组、选中窗格、合成的 Claude 通知事件。通知属于测试夹具，未启动 Claude 或远程 SSH。终端显示真实 Git 只读命令输出。
- 内容差异：设计图中的 Git Bash、服务器、Node 版本、Git 分支、时钟不作为现有运行时能力硬编码进产品。现有 Patty 图标和 AI 标识保留。
- 证据保存在本地忽略目录 `designs/` 和 `output/`。

## 比较历史与修正

| 轮次 | 证据 | 发现 | 修正与复验 |
| --- | --- | --- | --- |
| 1 | `output/graphite/comparison-initial.png`，目标和实现同图比较 | P2：侧栏仍为 220px，主要区域比例偏离规范 | 前后端默认值统一为 264px；18 项存储测试确认新默认值和已保存宽度保留 |
| 2 | `output/graphite/comparison-groups.png`、`comparison-detail.png` | P2：普通会话与 AI 会话图标列不齐；AI 图标过小 | 使用统一 24px 图标列，20px 图形；保留已有品牌图形，通用图标使用 Fluent 图标库 |
| 2 | 原有选中底色与焦点颜色；设置窗口截图 | P2：蓝色焦点及设置选中项文字对比不足 | 焦点色与主按钮色分离，设置选中项使用主文字色；原生渲染实测深色 3.47:1、浅色 5.56:1 |
| 3 | `output/graphite/narrow-sidebar.png`，160px 侧栏和长中文名称 | P2：按钮换行；长名称占满状态栏；侧栏拖动命中区被外层裁剪一半 | 主按钮单行截断、状态栏名称限宽省略、拖动区完整置于侧栏内；最终构建的截图与原生鼠标拖动断言通过 |
| 3 | Tauri 2.11.5 本地 `window/scripts/drag.js` 与能力配置 | P1：标题栏只有 CSS 拖动标记，未接入 Tauri 原生拖动处理 | 使用 Tauri 深层拖动区域，保留交互控件排除行为并授权窗口拖动；最终构建原生双击最大化和还原通过 |

首次高密度截图采样设置不一致，造成终端文字看似过小；修正采样后重新比较。这属于证据归一化问题，未改动终端字体渲染来补偿截图。

## 五项视觉检查

| 表面 | 检查结论 |
| --- | --- |
| 字体和排版 | 按已确认规范使用 Segoe UI Variable / Segoe UI / Microsoft YaHei UI，正文 14/20、辅助信息 12px；终端保留 Cascadia Code 和用户字号。设计图视觉字号更大，实际实现以细节规范为准。标题和路径采用省略与完整提示。 |
| 间距和布局 | 40px 标题栏、264px 初始侧栏、36px 主操作、40px 普通行、52px AI 行、42px 窗格工具栏；保持左侧导航、双终端、底部状态结构。已有侧栏宽度和分屏布局不会强制迁移。 |
| 颜色和状态 | 实色石墨背景、蓝色主操作与焦点、稳定选中底色；状态采用图形与文字。深浅主题常用文字、占位文字、按钮、状态标签对比度回归测试通过。 |
| 图像和图标 | 原始 Patty 图标保留，PNG 截图无占位插画；通用控件来自 Fluent 图标库；AI 图形沿用现有资产。设计图中品牌图形与项目原有资产不同，属于明确保留的产品身份差异。 |
| 文案和内容 | 主操作 New terminal、通知 Needs input / Completed / Error、空态操作和菜单含义明确；不展示无法确认的 Running、连接状态或系统指标。英文界面沿用项目现有语言。 |

## 最终比较

全图同图比较：`output/graphite/comparison-final.png`；聚焦比较：`output/graphite/comparison-detail-final.png`。两侧使用相同的像素比例，重点检查导航、文字、图标列、主操作和窗格标题。额外检查了 `narrow-sidebar.png`、`settings.png`、`light-workbench.png` 和 `create-menu.png`。

第 3 轮修正后的原生验收已通过：160px 侧栏中的主按钮单行省略、长中文名称不会挤出 28px 关闭按钮、状态栏会话名限宽省略，鼠标拖动可从 160px 恢复为 264px。标题栏双击最大化后能通过原生还原按钮恢复。主布局没有新增的 P0/P1/P2 视觉差异。

剩余差异属于已确认的产品约束：使用细节规范中的 14/20 正文尺度和 264px 初始侧栏，保留原始品牌资产及用户真实终端内容。当前截图只有两个会话与两个分组，数据密度低于概念图；未填充虚构服务器或工具版本。

## 行为与工程验证

- 前端全量：68 个文件，656 项测试通过，结果保存于 `output/graphite/unit-tests.json`。
- 后端默认值采用先失败再修正的流程；存储模块 18 项测试通过。
- 类型检查、无注释检查与差异空白检查通过。
- 已有真实 PTY 冒烟测试通过：创建、输入 exit、进程退出、移除会话。
- Graphite 原生验收脚本：`rtk npm run test:e2e:graphite`，使用隔离 APPDATA，不写入用户会话配置。
- 覆盖创建、分屏、真实命令输入、树导航、分组展开折叠、菜单焦点与 Escape、分隔条键盘调整、深浅主题持久化、设置窗口。
- 会话与分组重命名在回车完成或 Escape 取消后返回键盘焦点；组件回归测试及最终构建完成重命名后的原生焦点断言均通过。
- 宽度覆盖 1280×720、1440×900、1920×1080；另有 160px 侧栏、长中文名称和鼠标拖动边界验证。
- 控制台异常与 error 日志由脚本采集并断言为空。

## 最终验收与验证边界

- 最终 release 构建成功；Graphite 原生脚本与真实 PTY 冒烟脚本在该构建上顺序通过。运行时异常和 error 日志均为空，测试应用退出并清理隔离配置。
- 完成最终截图与概念图的全图、聚焦区域同图比较，无未解决的 P0/P1/P2 发现。
- 中文输入法组合事件已做组件测试；真实候选框位置和硬件输入未人工验收。
- 当前实机密度为 150%；100%、125%、200% 及跨显示器 DPI 切换未实测。
- 原生拖动接线和双击行为纳入自动化；物理鼠标跨屏拖动未人工验收。
- SSH 目标继承有回归测试，未连接用户远程服务器。

final result: passed
