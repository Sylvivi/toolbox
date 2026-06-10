# toolbox 项目记忆

## 项目概况
- **单文件 HTML PWA**：核心就是 `index.html`（约 1.6 万行，JS/CSS 全部内联，约 1MB）。不要拆分成多文件，用户要求保持单文件。
- **部署**：GitHub Pages，线上地址 https://sylvivi.github.io/toolbox/ ，仓库 `Sylvivi/toolbox`，分支 `main`。
- **自定义域名（已绑定，免梯子）**：工具站 `https://tool.masterofmydomain.top`（CF DNS CNAME → sylvivi.github.io，橙色已代理）；云同步 Worker `https://sync.masterofmydomain.top`（CF Workers 自定义域，原 `toolbox-api.wanwanviavia.workers.dev`）。SSL/TLS 模式必须「完全(Full)」否则重定向死循环。域名 `masterofmydomain.top`（阿里云注册，NS 已搬到 Cloudflare）。
- **PWA 安装注意**：装 PWA 到桌面要**挂梯子**（WebAPK 需要 Google 服务器签发，国内被墙）；不挂梯子会退化成「带 Google 标识的快捷方式」，状态栏颜色被冻死、跟不上主题。装完之后日常使用不需要梯子。
- **更新机制**：network-first 的 service worker，会自动更新；推送后过一两分钟刷新页面即可生效。
- **PWA 排障经验**：装 PWA 到桌面要**挂梯子**（WebAPK 需 Google 服务器签发，国内被墙）；不挂梯子会退化成「带 Google 标识的快捷方式」，状态栏颜色被冻死、跟不上主题。装完之后日常用不需要梯子。遇到「状态栏不变色 / 图标变样」先往这个方向查。
- **主要用途**：用户主要用「共读模式」读长篇小说（如天龙八部），其次有翻译模式、普通对话模式。

## 用户偏好（重要）
- 用户**非技术背景**，请用**中文**回复，方案要**傻瓜式**、解释通俗，少术语。
- **提交习惯：改完代码、用预览服务器验证通过后，直接 `git commit` + `git push`，不用再问「要推吗」。** 用户明确表示不想每次被问。
- 提交信息用中文，遵循仓库已有风格（`fix:` / `feat:` 前缀 + 简述「为什么」）。

## 开发工作流
1. 编辑 `index.html`。
2. 用预览服务器验证：`preview_start` 名称 `tbx`（端口 8732），服务器根目录就是 toolbox 文件夹，所以 URL 是 **`/index.html`**（不是 `/toolbox/index.html`）。
3. `location.reload()` 后用 `preview_eval` 检查逻辑、`preview_console_logs` 看有无报错。
4. 验证通过 → 直接提交并推送。
5. Git 命令带路径：`git -C "C:/Users/Administrator/Downloads/toolbox-repo" ...`。

## 关键功能笔记
- **三模式选择器**：`对话 / 翻译 / 共读`（无 emoji），分段按钮，互斥。`chatSetMode()` / `chatSyncModeButtons()`。
- **上下文压缩**（`chatCompressContext`）：对话模式默认 40 条触发、保留 20（设置里「触发」滑块可调）；**翻译/共读模式固定 10 条触发、保留最近 5 条**（写死保证一致）。设置面板的「触发」滑块在翻译/共读模式下禁用并显示「10 条（自动）」。
- **摘要**：分段保存在 `chatCompressSummaries`，可在「查看摘要」弹窗里编辑/删除（保存用 `chatSaveCurrentConv(true)`，注意没有 `chatSaveConv` 这个函数）。
- **翻译模式追问**：长按译文块触发（约 0.5s，移动超 10px 取消），双击/拖选留给浏览器选词复制。
- **等待中可中止**：翻译、翻译追问、共读提问加载时按钮带 `✕`，点击用 `AbortController` 掐断请求；中止不弹报错。
- **遮罩**：`chat_mask` localStorage（'1'/'0'）控制 `body.chat-mask-on`，初始化时按保存值强制对齐（加或删）。
- **夜间模式**：clawd「主题」子面板有 🌙 开关（`setNightMode`，存 `toolbox_night`）。每个浅色皮肤有对应 `.theme-xxx-night` 类，**7 个夜间皮肤共用同一套深蓝底**（`linear-gradient 135deg #0e1726→#16284a→#0e1726`），只有强调色各自不同；`深林绿(dark)` 无夜间版。`applyTheme` 里 `cls = (nightMode && t.night) ? t.night : t.cls`。
- **共读点击翻页按行对齐**（`readingPageDown`）：翻页时用 `Range.getClientRects()` 找「被屏幕底边切断的那一行」，把它滚到容器顶部——新页顶部永远是完整一行，不受字体/字号/行距影响。找不到行（开头结尾、纯图）或目标太近(<60px)时退回整屏滚。已知极小瑕疵：开「画框」时顶边可能露出上一行画框底描边 2~4px（装饰比文字高），文字本身不会被切。
- **窗口化渲染（进会话防卡顿）**：长篇共读/翻译会话原本进入时一次性同步重排整本书，章节多了卡几十秒。现改为**只渲染「上次阅读位置→末尾」这一窗口**，更早章节上滑到顶自动补渲染（顶部有「↑ 载入更早章节」哨兵，也可点）。关键函数：`chatRenderAllMessages(windowed)`（**只有进会话那次传 `true`**；编辑/重生成等仍全量）、`chatComputeRenderStart`（以存档锚点 `reading_pos_<convId>.idx` 为基准，前留 `READING_RENDER_BUFFER=4`）、`chatLoadEarlier`（上滑补渲染并用高度差修正 scrollTop，防跳）、`chatAppendMsgRange`/`chatMakeTimeSep` 抽出的复用逻辑。`chatRenderStartIdx` 记当前已渲染首条下标（0=全渲染）。**阅读位置定位靠「第几条消息+第几段」锚点（在 AI 共读消息的 `.reading-merged p[data-p]` 上），不靠像素，所以少渲染早章节不影响回到原位。**
