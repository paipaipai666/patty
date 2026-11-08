# 在 Patty 中跳转 OMP 历史轮次

本功能在当前终端中显示选中的历史轮次。终端右侧的悬浮细线表示各轮提问。移开鼠标会收起预览并保留历史浏览位置，点击预览中的 **Live** 或在终端按 **Esc** 才返回实时输出。

## 准备并启动

当前支持本机普通 `omp` 18.17.0。Patty 构建时由 `scripts/build-omp-hook.mjs` 生成 `resources/omp-patty-hook.bundle.js`，应用启动后复制到 `%USERPROFILE%\.omp\agent\extensions\patty-notifier.ts`。普通 omp 的扩展发现会加载它，继续使用原来的 `omp` 命令、版本、配置和插件。

1. 在项目根目录构建并启动本次代码构建的 Patty。

   ```powershell
   rtk npm run dev
   ```

2. 在 Patty 新建本地终端，确认设置中的 **Oh My Pi** 适配器已启用。

3. 在该终端直接运行原来的 `omp` 命令。

   ```powershell
   omp
   ```

   恢复指定 session 时继续使用原来的参数。

   ```powershell
   omp --resume "D:\path\to\session.jsonl"
   ```

不要再运行项目内 18.13.3 companion，也不需要设置 `OMP_SOURCE_MODULES`。Patty 只复制自己的扩展文件，不替换全局 OMP 包、配置或插件。

## 跳转

1. 聚焦运行 OMP 的终端 pane。
2. 将鼠标移到右侧任意细线上，查看该轮提示词预览。当前细线伸长并变色，邻近细线按距离逐渐缩短。
3. 点击细线，直接跳到对应轮次。列表高度固定，滚动鼠标滚轮可以浏览其他轮次。
4. 需要搜索时，点击细线下方的搜索图标，或按 **Ctrl+Shift+J**。输入提示词中的文字，再点击匹配的细线或按 **Enter**。

目标内容在同一个终端出现。浏览不会改变 session leaf 和模型上下文。切换 pane 后，目录控制目标随聚焦 pane 改变。

悬停只预览，不触发跳转，也不抢走终端输入焦点。鼠标移开后，悬浮列表收回约 24px 的交互宽度，细线本身更短。没有可用轮次时，悬浮列表默认隐藏。

默认快捷键可在 **Settings → Shortcuts** 中修改。

| 操作 | 默认快捷键 |
| --- | --- |
| 打开或关闭轮次目录 | Ctrl+Shift+J |
| 上一轮 | Ctrl+Shift+PageUp |
| 下一轮 | Ctrl+Shift+PageDown |
| 返回实时终端 | Ctrl+Shift+End |

历史浏览期间，终端内的 **Up、Down、PageUp、PageDown** 滚动内容。**Esc** 返回实时终端。直接输入已提交文本或粘贴文本，也会先返回实时编辑器，再交付输入。

## 识别状态

- **Jumping to turn…**：请求正在排队或执行。
- **Waiting for terminal display…**：OMP 已执行，Patty 尚未确认对应终端帧。
- **Turn N of M**：终端已确认显示的历史位置。
- **Terminal display not confirmed**：执行结果已到达，但显示确认超时。可以再次定位或返回实时终端。
- **Turn navigation unavailable**：当前 pane 没有报告兼容能力。确认使用了本次构建的 Patty，并且普通 omp 在 Patty 启动后重新打开过以加载更新后的扩展。
- 目录同步失败时，打开目录并点击 **Retry**。

超长代码当前显示基础代码颜色。标准 OMP 扩展的单文件版本不启动渐进高亮 worker，因此不会出现补色延迟；病态长行的渲染仍受宿主 Markdown 渲染速度限制。

## 运行验证

在项目根目录执行：

```powershell
rtk npm run typecheck
rtk npx vitest run
rtk node scripts/build-omp-hook.mjs --check
rtk npm run test:e2e:omp
```

桌面回归使用单独应用身份和临时 APPDATA。先构建，再将 `PATTY_EXE` 设为构建输出中的 `patty-integration-test.exe`：

```powershell
rtk npx tauri build --no-bundle --features e2e --config src-tauri/tauri.integration.conf.json --debug
$env:PATTY_EXE = 'D:\rust-cache\target\debug\patty-integration-test.exe'
rtk npm run test:e2e:omp
```

上例的可执行文件路径是本机 Cargo 输出目录。其他机器请使用构建日志给出的绝对路径。

桌面结果及截图写入 `output/omp-navigation/desktop`。实际通过范围和剩余边界见 [实施状态](D:/code/terminal/terminal-sidebar/docs/plan/omp-navigation-progress.md)。

## 回退

在设置中关闭 **Oh My Pi** 适配器会移除 Patty 扩展副本；随后直接使用原来的 `omp` 命令即可。此功能不迁移或清空用户 session，不删除原有快捷键配置。
