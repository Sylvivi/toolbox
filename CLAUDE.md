# toolbox 项目记忆

## 项目概况
- **单文件 HTML PWA**：核心就是 `index.html`（约 1.6 万行，JS/CSS 全部内联，约 1MB）。不要拆分成多文件，用户要求保持单文件。
- **部署**：GitHub Pages，线上地址 https://sylvivi.github.io/toolbox/ ，仓库 `Sylvivi/toolbox`，分支 `main`。
- **更新机制**：network-first 的 service worker，会自动更新；推送后过一两分钟刷新页面即可生效。
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
5. Git 命令带路径：`git -C "C:/Users/86177/Downloads/toolbox" ...`。

## 关键功能笔记
- **三模式选择器**：`对话 / 翻译 / 共读`（无 emoji），分段按钮，互斥。`chatSetMode()` / `chatSyncModeButtons()`。
- **上下文压缩**（`chatCompressContext`）：对话模式默认 40 条触发、保留 20（设置里「触发」滑块可调）；**翻译/共读模式固定 10 条触发、保留最近 5 条**（写死保证一致）。设置面板的「触发」滑块在翻译/共读模式下禁用并显示「10 条（自动）」。
- **摘要**：分段保存在 `chatCompressSummaries`，可在「查看摘要」弹窗里编辑/删除（保存用 `chatSaveCurrentConv(true)`，注意没有 `chatSaveConv` 这个函数）。
- **翻译模式追问**：长按译文块触发（约 0.5s，移动超 10px 取消），双击/拖选留给浏览器选词复制。
- **等待中可中止**：翻译、翻译追问、共读提问加载时按钮带 `✕`，点击用 `AbortController` 掐断请求；中止不弹报错。
- **遮罩**：`chat_mask` localStorage（'1'/'0'）控制 `body.chat-mask-on`，初始化时按保存值强制对齐（加或删）。
