# toolbox 项目记忆

> 本文件是"改这个前端项目"用的备忘，随每次对话加载，请保持精简。
> 服务器/运维（订阅桥、书库服务、Caddy、cron 等）的敏感拓扑**不在这里**——见服务器本地私有文件 `SERVER-OPS.md`（已 gitignore、不入公开仓）。

## 项目概况
- **单文件 HTML PWA**：核心就是 `index.html`（约 2.4 万行 / 约 1.4MB，JS/CSS 全部内联）。**不要拆成多文件**，用户要求保持单文件。
- **⚠️ `#chatMessages` 容器必须保持空**（源码里应是 `<div class="chat-messages" id="chatMessages"></div>`）。它是运行时消息/阅读内容的渲染区，app 启动会清空重渲染——**绝不能让渲染后的正文/点评被冻进源码**。曾有一整段《傲慢与偏见》阅读快照误存进去，白白撑大文件 1.2MB（2026-07-07 已清）。多半是**从运行中的网页整页保存/导出**导致的，改动后留意别把 DOM 快照写回源码；发现文件异常变大先 grep 书中人名/`class="chat-msg"` 排查这里。
- **部署**：GitHub Pages，仓库 `Sylvivi/toolbox`、分支 `main`。线上 https://sylvivi.github.io/toolbox/ ，**自定义域**（免梯子）`https://tool.masterofmydomain.top`（Cloudflare CNAME → sylvivi.github.io）。
- **更新机制**：network-first 的 service worker，推送后过一两分钟刷新页面即生效。
- **主要用途**：用户主要用「共读模式」读长篇小说（如天龙八部），其次翻译模式、普通对话模式。
- **PWA 安装注意**：装 PWA 到桌面要**挂梯子**（WebAPK 需 Google 服务器签发、国内被墙）；不挂梯子会退化成「带 Google 标识的快捷方式」，状态栏颜色被冻死、跟不上主题。装完之后日常用不需要梯子。遇到「状态栏不变色 / 图标变样」先往这个方向查。

## 部署排障
- 根目录有 **`.nojekyll`**，让 Pages 跳过 legacy Jekyll 构建、原样发布（曾因反复 Jekyll 构建失败导致线上半天不更新，加它后修好，别删）。
- `sylvivi.github.io/toolbox` 会 **301 重定向到自定义域**，curl 验证线上要么加 `-L`、要么直接打 `tool.masterofmydomain.top`。
- Pages 的「部署」步骤偶尔 GitHub 侧抽风（build 成功、deploy 失败/卡 queued）。**别干等**：立刻推个空提交触发全新运行（常几十秒就过）；服务器上有 `/home/ubuntu/deploy_autoheal.sh` 可后台自动盯着重触发。查真实状态用 Actions API，`/pages/builds` 那个老接口会滞后，别只信它。

## 用户偏好（重要）
- 用户**非技术背景**，请用**中文**回复，方案要**傻瓜式**、解释通俗，少术语。
- **提交习惯：改完代码、验证通过后，直接 `git commit` + `git push`，不用再问「要推吗」。** 用户明确表示不想每次被问。
- 提交信息用中文，遵循仓库已有风格（`fix:` / `feat:` 前缀 + 简述「为什么」）。
- 遇到可能长时间的等待（部署/构建），别让用户守着——用后台脚本自愈、失败就立刻重试，先给结论和处置。

## 开发工作流
1. 编辑 `index.html`（仓库在服务器上 `/home/ubuntu/Toolbox`；这台机器同时就是线上宿主机）。
2. 验证：服务器已装 node + playwright(chromium)。交互类改动写个 headless 脚本跑 `file:///home/ubuntu/Toolbox/index.html` 实测（参考 scratchpad 里的 playwright 用例）；纯静态改动本地 `python3 -m http.server` 起来看即可。
3. 验证通过 → 直接 `git -C /home/ubuntu/Toolbox commit` + `push`。
4. 凭据存 `~/.git-credentials`（HTTPS + PAT），推送无需交互。

## 关键功能笔记
- **三模式选择器**：`对话 / 翻译 / 共读`（无 emoji），分段按钮，互斥。`chatSetMode()` / `chatSyncModeButtons()`。默认打开固定显示**密钥页**（`init` 里 `savedTab='keys'`，不再恢复上次标签）。
- **上下文压缩**（`chatCompressContext`）：对话模式默认 40 条触发、保留 20（设置里「触发」滑块可调）；**翻译/共读固定 10 条触发、保留最近 5 条**（写死保证一致）。滑块在翻译/共读下禁用、显示「10 条（自动）」。
- **摘要（断点续传设计）**：分段存 `chatCompressSummaries`，`chatCompressedCount` 逐段推进；某章总结失败（网络/回空）**就地停住不推进计数**，那章连同后面留作未压缩、下一轮共读自动补上（绝不越过、否则永久跳过）。可在「📋 摘要」弹窗编辑/删除/**♻️单段重新生成**（按 `chatCompressSegEnds` 记的原文范围重切；旧版无范围记录则提示手动补）。记忆表格缺回可「补齐/重建」（只用现有摘要重折、不重读正文）。保存用 `chatSaveCurrentConv(true)`（**没有 `chatSaveConv` 这个函数**；`true` 强制标脏，否则自动生成的摘要不会同步）。
- **共读正文可调**：正文字号（`--reading-fs`/`reading_font_scale`）、段间距（`--reading-pspace`/`reading_para_space`，2~28px 默认8）。段落带行内 `margin:0.5em 0`，改间距的 CSS 必须 `!important` 才盖得过行内样式。批注框 `blockquote[data-cp]` **只吃自身上边距、贴住它点评的那一段**，不随段间距推开。
- **翻译模式追问**：长按译文块触发（约 0.5s，移动超 10px 取消），双击/拖选留给浏览器选词复制。
- **等待中可中止**：翻译、翻译追问、共读提问加载时按钮带 `✕`，用 `AbortController` 掐断；中止不弹报错。
- **遮罩**：`chat_mask` localStorage（'1'/'0'）控制 `body.chat-mask-on`，初始化按保存值强制对齐。
- **夜间模式**：clawd「主题」子面板 🌙 开关（`setNightMode`，存 `toolbox_night`）。每个浅色皮肤有 `.theme-xxx-night` 类，**7 个夜间皮肤共用同一套深蓝底**，只强调色不同；`深林绿(dark)` 无夜间版。`applyTheme` 里 `cls = (nightMode && t.night) ? t.night : t.cls`。
- **共读点击翻页按行对齐**（`readingPageDown`）：用 `Range.getClientRects()` 找「本页最后一行完整露出的行」滚到容器顶部——新页顶行 = 上页读到的最后一整行（保留一行接头），永远不切半。找不到行或目标太近(<60px)退回整屏滚。极小瑕疵：开「画框」时顶边可能露上一行画框底描边 2~4px，文字不切。
- **用量/计费面板**（clawd「💰 用量」→ `apiLogShowPanel`）：API 调用汇集在 `chatStreamChat`（后台小任务）和 `chatDoRequest`（主力流式）两处，各装探针 `apiLogRecord(purpose,model,inTok,outTok,est)`。token 优先取中转站真实 `usage`（两处都加 `stream_options:{include_usage:true}`，解析 `apiUsageFromChunk`），缺则 `estTokens` 估算并标 `est`。每个调用点带 `purpose:` 标签。存储本机不同步：`toolbox_api_log`（明细封顶500）、`toolbox_api_agg`（累计聚合）、`toolbox_api_price`（单价/百万token）。
- **Prompt Caching（2026-06-30 加）**：Claude 走原生 `/v1/messages` 时启用。`aiOpenStream` 加头 `anthropic-beta: prompt-caching-2024-07-31`；`aiBuildAnthropicBody` 给稳定前缀（整段 system + 末条消息最后一个 block）打 2 个 `cache_control:{type:'ephemeral'}`。计费把 `cache_read/creation_input_tokens` 都加进 `inTok`，单独透出 `cache_read`；面板顶「⚡ 缓存命中 X tok · 约省 ￥Y」。**排查：连续多轮命中一直 0，多半是中转站没回传缓存 usage，不是没缓存。**
- **云同步架构（CF 主力）**：CF 走「逐卡片 + 清单(manifest)」（`cfBuildManifest`/`cfSmartSync`），**整包 blob（`buildSyncPayload`）只给 Gist 和本地快照用，CF 不碰**。想让某项数据在 CF 同步，必须挂进 **manifest**、不能只塞 blob。密钥/收藏夹逐卡片（`k_`/`s_` + `cardTimestamps`）；书签、字体、阅读进度、收藏模型等「整块按时间戳后写覆盖」（能正确传播删除）。
- **收藏模型同步（2026-06-20 修）**：`chat_fav_models`（含每模型备注/价格 `f.price`）经 `chatFavModelsSave()`（写本地+盖 `_ts`+防抖 `syncPushData`），挂进 `cfBuildManifest`、按 ts 覆盖。**单价存在收藏对象里，收藏一同步计价价格就跟着同步。**
- **书籍/字体同步（自建服务器）**：正文/字体太大不进 CF，走自建 cc-books 服务器同步，前端函数前缀 `bkSync*`。书是「本地为主、服务器当镜像、按需下载」，占位书 `_remote:true` **不落盘 IndexedDB**；字体是「换设备启动自动全量拉回」。**服务端细节见私有 `SERVER-OPS.md`。**
- **窗口化渲染（进会话防卡顿）**：长篇会话进入只渲染「上次阅读位置→末尾」窗口，早章上滑到顶自动补渲染。`chatRenderAllMessages(windowed)`（**只进会话那次传 true**）、`chatComputeRenderStart`（以 `reading_pos_<convId>.idx` 为锚、前留 `READING_RENDER_BUFFER=4`）、`chatLoadEarlier`（补渲染并用高度差修 scrollTop）。**阅读定位靠「第几条消息+第几段」锚点（`.reading-merged p[data-p]`），不靠像素，所以少渲早章不影响回原位。**
  - **秒出 + 后台补（2026-06-20 修）**：先同步画 `READING_RENDER_FIRST=18` 条让界面秒出，其余 `setTimeout` 每批 `READING_RENDER_FWD_BATCH=8` 条后台补、接末尾（不移动已定位）。`_chatRenderToken` 代次令牌作废在途补渲染。用 `setTimeout` 不用 `rAF`（页面隐藏时 rAF 暂停）。
  - **双向窗口化 + 裁剪（2026-07-08 修，治「提前发十几章滑到最顶卡+烫」）**：早先只封窗口「起点以上」，起点以下一直渲染到全书末尾——于是把十几章(≈20万字)提前发出去、再滑到最顶从头读时整本书都堆进 DOM，滑动卡、手机烫。现在**起点以下也只先渲染 `READING_RENDER_FORWARD=12` 条**，底部挂 `chatMakeLaterSentinel`「↓ 载入后面章节」，滑到接近底部自动 `chatLoadLater` 补、对称于顶部的 `chatLoadEarlier`。`chatRenderEndIdx`＝已渲染的「末条+1」(==`chatMessages.length` 即到真末尾)。窗口超 `READING_RENDER_MAX=24` 条就从**远离视口那端裁掉**（`chatTrimTopIfNeeded` 带 scrollTop 高度差补偿 / `chatTrimBottomIfNeeded` 在视口下方无需补偿），实测全程 DOM 恒定 ≤~20 条、不随发章数增长。
    - **发新章/流式/生图接末尾前必须 `chatEnsureRenderedToEnd()`**（补齐窗口到真末尾+删底部哨兵），否则新节点接到哨兵后头、和未渲染的中间几条**串位**。已接：`chatSend`、`chatDoRequest` 收尾、`chatInsertGenImage`；这些追加后都要把 `chatRenderEndIdx = chatMessages.length` 同步、并 `chatTrimTopIfNeeded`。截断/删除(`chatSheetTruncate`/`chatSheetDelete`)按新长度校正 `chatRenderStartIdx/EndIdx`。
    - **任意位置跳转前先 `chatEnsureRenderedIdx(idx)`**（窗口上方→`chatRenderUpTo`、下方→`chatRenderDownTo`），否则目标不在 DOM、`querySelector` 返回 null 定位失败。已接：`chatNavJump`、`readingJumpBookmark`、`readingJumpHighlight`。
    - 测试脚本 scratchpad `test_window.js`（注入 60 条仿真消息，验证初始窗口、上下滑裁剪、无空洞、发章、跳转）。
