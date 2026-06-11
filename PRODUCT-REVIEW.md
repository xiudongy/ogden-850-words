# Ogden 850 词学习 PWA · 产品改进方案报告

> 评审对象：`/Users/devin/Codes/Devin/ogden-850-words`（8-10 岁儿童英语 850 词学习 PWA）
> 评审方式：数据、视觉、代码、教学设计、真机实测五维交叉审查，全部发现经二次验证与去重合并
> 日期：2026-06-10

---

## 一、总评

这是一个底子相当不错的产品：850 词与 Ogden 官方词表逐类完全一致（五类 100/400/200/100/50 经脚本比对零误差），四种学习模式（翻卡/选择题/拼写/配对）齐备，视觉走儿童向糖果色路线，发音（speakWord）实现质量也好。但当前版本距离"可以放心交给孩子"还有明确差距：**翻卡模式因一处 CSS 层叠事故在真机上完全不可用**，约 30% 的测验答题进度因传参笔误写进了不存在的"中文键"，10 组重复中文译文让孩子"明明答对却被打叉"——这三类问题都直接命中儿童产品最脆弱的东西：信任感。

最大的三个机会点：

1. **修好"判对判错"的公正性**——P0 的四个问题（翻卡 CSS、进度写错键、会话死锁、重复译文）全部是"孩子做对了却得不到正反馈"的事故，修复成本极低（多数是删两行/改一个参数/改十个字符串），收益是产品基本可用性。
2. **让产品在目标环境真正跑起来**——面向中国大陆儿童却依赖 Google Fonts 与 unpkg CDN、无 Service Worker、无可用 PWA 图标，"装到孩子平板桌面"这个核心场景目前是名不副实的；本地化资源 + 一个 sw.js 即可解决。
3. **把"词库"升级为"课程"**——850 词一次性平铺、无先学后测、无间隔重复、星星只进不出。数据层（每词 correct/wrong/lastSeen）已经齐备，只差关卡化、错词重现和激励闭环这层薄薄的产品设计，这是和洪恩/Duolingo Kids 拉开差距的真正所在。

---

## 二、P0：必修 Bug 与数据错误

### P0-1 翻卡 3D 翻转布局损坏，背面卡片压住按钮，翻卡模式完全不可用

- **现象**（真机实测复现）：点卡片翻面后，绿色背面卡渲染在页面下半部（y≈456-836），正好盖住"认识/不认识"按钮区；点"认识"实际点在卡片上、触发的是容器翻转监听，卡片翻回正面，计数永远停在 1/10、单词不换。`elementFromPoint(按钮中心)` 命中的是 `.flashcard-back`。用 JS 直接触发按钮 click 计数正常推进，证明 JS 逻辑无恙，纯 CSS 层叠事故。
- **根因**：`style.css:383-395` 给 `.flashcard-front/.flashcard-back` 设了 `position:absolute`，但随后 `.flashcard-front`（**style.css:399**）和 `.flashcard-back`（**style.css:418**）又各自声明 `position:relative`（为 ::before 光斑加的）。同等特异性后者生效，两个卡面退回文档流上下堆叠（各 380px），back 溢出 380px 高的容器压住下方控件。对照组 `.memory-card-face`（style.css:738-742）无重复声明，故配对游戏翻转正常。又因按钮恰好只在翻面后才解除 `pointer-events:none`（app.js:549-563），**按钮唯一可点的时刻正是被卡片完全遮挡的时刻**。
- **修法**：删除 `style.css:399` 和 `style.css:418` 两行 `position: relative;`。absolute 元素本身就是定位元素，仍能作为 ::before 的包含块，光效与 overflow:hidden 均不受影响。修复后真实点击回归：翻面 → 点"认识" → 计数应变 2/10 且换词。

### P0-2 中译英选择题把中文释义当单词键写入进度，约 30% 测验答题作废

- **现象**（实测复现）：做完一轮 10 题后，localStorage 的 `progress.words` 出现中文键（"蛋糕"、"虽然"、"固定的"），统计页"最近学习"出现只有中文、译文为空的脏词条。
- **根因**：`renderQuizOptions(options, correctAnswer, wordEn)` 内部用第三参调 `recordAnswer`（app.js:711/718）。英译中分支（app.js:676）正确传 `word.en`，**中译英分支 app.js:681 误传了 `word.zh`**。`isEnToZh = Math.random() > 0.3`（app.js:665），即约 30% 的题答对答错都记到了不存在的"中文单词"上：真实单词的 correct/wrong 不累计、无法经此推进到 learning/mastered，垃圾键永久污染存储（`findWordZh(中文)` 返回 ''，故 recentWords 出现 zh 为空的条目）。
- **修法**：`app.js:681` 改为 `renderQuizOptions(options, word.en, word.en)`。另加一段一次性数据清洗：加载进度时删除 `progress.words` 中不在 850 词表内的键（`findWordZh(key)===''` 即可判定），并清理 recentWords 中 zh 为空的脏条目。

### P0-3 翻卡完成一轮后经底部导航重进，页面停在锁死的旧会话

- **现象**（实测复现）：完成 10 张 → 结算弹窗点"完成"回首页 → 点底部导航"卡片"：页面显示 10/10、卡片停留在上一轮最后一个词的**背面**（中文面），点卡片不翻、点"认识/不认识"无任何反应。孩子面对一个死掉的页面，只能靠改分类/数量下拉框或回首页点模式卡才能救活（app.js:614-615、app.js:1126 这两条路径会无条件重新 init）。
- **根因**（三重）：① showFlashcard 的完成分支（app.js:517-537）弹结算后直接 `return`，不重置 fcWords/fcIndex/fcLocked、不移除卡片 `flipped` 类；② 最后一张点按钮时 `fcLocked=true`（app.js:569/591），唯一解锁点 app.js:546 在完成分支的 return 之后，永远走不到——翻面、答题三个入口全被这把死锁挡住；③ 底部导航的重进守卫是 `fcWords.length === 0`（app.js:1115），完成后 fcWords 仍满员，initFlashcard 永不重跑。
- **修法**：导航守卫改为 `fcWords.length === 0 || fcIndex >= fcWords.length` 即重新 initFlashcard；同时完成分支里执行 `fcLocked = false`、`classList.remove('flipped')` 并复位 controls 样式。建议在完成弹窗加"再来一组"按钮，与 quiz 的 retry 体验对齐。

### P0-4 十组中文译文完全相同：测验出现双正确答案、拼写答案不唯一、配对出现同文卡

- **现象**：脚本逐词比对，850 词中恰好 10 组译文字符串完全相同：是=be/yes、通过=by/through、和=with/and、行为=act/behaviour、国家=country/nation、感觉=feeling/sense、声音=sound/voice、船=boat/ship、线=line/thread、高的=high/tall。
  位置：`words.js:24,40,47,51,72,113,125,147,187,240,340,424,452,501,554,640,688,712,785,831`。
  三处功能直接受害：
  1. **中译英选择题**（app.js:679）：干扰项用 `getRandomWords(3, [word.en])` 只按英文排除（words.js:925），题面"船"（答案 boat）时 ship 可同屏出现，孩子选 ship 意思全对却被判错并记 wrong（判分 app.js:705 严格比较 en）。触发概率约 0.35%/题且仅 30% 题目走该方向，低频但长期必现。
  2. **拼写模式**（app.js:798 题面只显示 word.zh；app.js:821-823 仅与 word.en 精确匹配）：提示"高的"时孩子拼 tall 但题目词是 high，两次后 `recordAnswer(word.en, false)` 判定失败。**该路径是确定性触发**——这 20 个词（占词库 2.4%）一进拼写题，题面即天然二义。
  3. **翻牌配对**（app.js:946 全量随机取词不按 zh 去重）：boat 与 ship 同时入局时桌面出现两张一模一样的"船"牌但 pairId 不同（判定 app.js:997），孩子按语义配对被判失败并给两个词各记一次 wrong。
- **根因**：译文撞车 + 代码三处只按 en 去重。旁证：英译中方向的 `getUniqueZhOptions`（app.js:642-655，注释 "FIX #3"）已显式过滤 `w.zh !== correctZh`——作者意识到了问题但只修了一个方向。
- **后果澄清**（采纳验证修正）：被误判 wrong 的词没有"错词本/复习队列"可去（代码中无此功能），实际损害是 wrong 计数 +1 可把 mastered 词降级为 learning（app.js:87-89），并让该词无法被记为掌握，污染学习进度统计。
- **修法**（不增删单词，只改译文 + 代码双保险）：
  - 译文消歧：yes=是的、by=在...旁边/被、with=和...一起、behaviour=举止/表现、nation=民族/国家、sense=感官、voice=嗓音、boat=小船 / ship=轮船、thread=丝线/细线、tall=个子高的。
  - 代码兜底：中译英干扰项补 `w.zh !== word.zh` 过滤；checkSpelling 接受所有 zh 相同的英文词为正确答案；initMemory 取词按 zh 去重（`const seen=new Set(); shuffle(getAllWords()).filter(w=>!seen.has(w.zh)&&seen.add(w.zh)).slice(0,pairsCount)`）。

---

## 三、P1：体验硬伤

### P1-1 面向大陆儿童却依赖 Google Fonts / unpkg CDN，且无 Service Worker，PWA 名不副实

- **现象与根因**：`index.html:7-10` 从 fonts.googleapis.com/fonts.gstatic.com（大陆不可达）加载 Nunito、从 unpkg.com（大陆慢且不稳）加载 lucide。全应用 40+ 处图标 100% 依赖 `lucide.createIcons()`，app.js:9-13 对加载失败仅静默跳过——CDN 失败时所有图标消失（底部导航降级为纯文字、喇叭按钮变成空圆形）。unpkg 的 `<script>` 还是 head 内同步阻塞脚本，被墙场景会长时间挂起首屏。仓库无 sw.js、无 serviceWorker 注册，manifest 形同虚设，离线刷新呈现浏览器错误页。
- **修法**：① Nunito（latin 子集约 30KB/字重）与 lucide.min.js 本地化随应用分发，更优是把用到的 ~20 个图标内联为 SVG sprite；② 新增 sw.js 用 cache-first 缓存 index.html/app.js/words.js/style.css/字体/图标，index.html 注册。两步均无需构建工具。

### P1-2 PWA 图标是 data-URI emoji SVG，装到桌面没有像样的图标

- **现象与根因**：`manifest.json:9-15` 唯一图标是 `data:image/svg+xml` 的 📚 emoji（sizes:any）；全仓库无 apple-touch-icon、无任何 PNG 图标资源。iOS 主屏图标管线不支持 SVG，添加到主屏后退化为网页截图缩略图；Android 上 data: URI 图标拉取行为不可靠、渲染质量无保障（修正：新版 Chrome 安装条件并不硬性要求 PNG 与 SW，但图标质量问题成立）。
- **修法**：按 logo-icon（紫渐变 + book-open）设计应用图标，导出 192/512 PNG（含 maskable 变体）写入 manifest，index.html 加 `<link rel="apple-touch-icon" href="icon-180.png">`。

### P1-3 缺 `viewport-fit=cover`，刘海屏安全区适配代码全部失效

- **现象与根因**：`style.css:884`、`style.css:1007-1010` 用 `env(safe-area-inset-bottom)` 为底部导航做安全区 padding，但 `index.html:5` 的 viewport 没有 `viewport-fit=cover`——此时所有 `env(safe-area-inset-*)` 恒为 0，两处适配是死代码。实际表现（修正版）：iOS standalone 下内容被 letterbox，底部导航下方出现一条无样式空白条、导航缺少预期留白。
- **修法**：viewport 改为 `width=device-width, initial-scale=1.0, viewport-fit=cover`，真机 standalone 验证。

### P1-4 彩带庆祝在高分屏上残缺：dpr≥2 真机一半以上彩带生成在屏幕外

- **现象与根因**：resizeConfetti（app.js:299-306）把 canvas 物理尺寸设为 `innerWidth*dpr` 并 `ctx.scale(dpr,dpr)`，此后坐标系是 CSS 像素；但 **app.js:315** 生成粒子用 `Math.random() * confettiCanvas.width`（设备像素）——可见比例恰为 1/dpr，dpr=3 的主流手机上 2/3 彩带落在屏幕右侧之外、可见彩带挤在左侧；**app.js:334** 存活判断 `p.y < confettiCanvas.height + 20` 同样用设备像素，粒子掉出屏幕后 rAF 还要空转约 40-70% 额外时长。庆祝动效是本产品最重要的情绪奖励，2x/3x 屏上效果稀疏。
- **修法**：生成、存活判定、clearRect 统一用 CSS 像素（`window.innerWidth/innerHeight`）。

### P1-5 quiz/spelling 的 setTimeout 不随页面切换取消，首页凭空响起朗读

- **现象与根因**：答题后 `setTimeout(..., 1000)`（app.js:721-724）及拼写两处（app.js:836-839, 857-861）从不被 clearTimeout；navigateTo（app.js:200-222）不清理。孩子答完立刻点返回，1 秒后 showQuizQuestion 在隐藏页面照常执行并以 ~70% 概率 `speakWord`（app.js:672）——首页突然朗读英文；若是最后一题，还会在首页响起结算音效、发星星、放彩带。
- **修法**：定时器句柄存模块级变量，navigateTo 离开对应页时 clearTimeout + `speechSynthesis.cancel()`；showQuizQuestion/showSpellingQuestion 入口加 `if (currentPage !== 'quiz') return` 防御。

### P1-6 连续天数（streak）只要打开 App 就 +1，与学习行为完全脱钩

- **现象与根因**：updateStreak（app.js:103-118）只比较日期；调用点是脚本初始化（app.js:1141）、refreshHome（app.js:379）和 60 秒轮询（app.js:1146-1148）。打开页面 1 秒即"打卡"，挂机跨午夜也自动续天，火焰失去"我今天学了"的承诺含义，家长看到的数据失真。另有渲染顺序小瑕疵：refreshHome 先取快照再 updateStreak，跨天首屏显示旧值。
- **修法**：触发点移到真实学习事件（recordAnswer / fc-yes/fc-no，加当日已记录标记防重复）；删除 60s 轮询；refreshHome 先 updateStreak 再 getProgress；lastDate 用 ISO 日期字符串（toDateString 依赖 locale，跨设备语言不同会误重置）。

### P1-7 "不认识"把 mastered 一键打回 'new'，进度倒退且与测验状态机口径不一

- **现象与根因**：fc-no 无条件 `progress.words[en].status = 'new'`（app.js:577），而 recordAnswer 的降级规则是 mastered 且 wrong>correct 才降到 learning（app.js:87-89）。同一个"答错"事件两套口径；correct=4 的 mastered 词点一次"不认识"直接归零，首页"已学 X/850"和分类百分比立刻倒退——对 8-10 岁孩子是明显挫败。背后是状态机逻辑三处内联重复（fc-yes/fc-no/recordAnswer），而本该承担此职责的 updateWordStatus（app.js:57-70）是零调用死代码。
- **修法**：fc-no 复用 recordAnswer 规则（mastered→learning，其余保持），保证进度条对孩子只进不退；把三处内联收敛回单一状态机函数。

### P1-8 数据：部分重叠译文造成选项歧义（cause/reason、force/power）

- **现象与根因**：getUniqueZhOptions 只过滤完全相等字符串（app.js:644）。考 force（words.js:250 力量）时干扰项可出现 power 的"力量/权力"（words.js:375），两个选项都含"力量"；cause（words.js:166 原因）与 reason（words.js:396 原因/理由）同理。全表按 '/' 切分义项扫描，跨词共享义项恰好只有这两组。
- **修法**：改 power=权力、reason=理由（无损消歧）。"X 与 X的"类（错误 vs 错误的等 10 组）靠词尾"的"可区分，不必改。

### P1-9 数据：delicate 译为"精致的"取错义项

- **现象与根因**：`words.js:866` delicate=精致的，位于 opposites（"反义形容词，描述对立的性质"，words.js:852）。它入选 50 反义词正是取"娇弱、易损"义（与 qualities 表中 strong/healthy 相对）；"精致的"是全表中唯一找不到反义配对的义项，与分类组织原则矛盾，孩子会当褒义词记。
- **修法**：改为 zh: "娇弱的/易损的"。

### P1-10 视觉可达性硬伤群：对比度、字号、中文字体、触控目标

四项合并（均为设计审查意见，建议一次性专项处理）：

1. **对比度**：翻卡背面白字配亮绿渐变（style.css:414-420）约 1.6:1；`--text-lighter #B2BEC3`（style.css:14）约 1.9:1，却用于拼写提示字母（style.css:640-646，答题的功能性线索）、统计空状态；非激活导航 opacity:0.45 叠加后同样 ~1.9:1（style.css:897-898）；streak 徽章白字配 #FF8E53 约 2.3:1。修法：背面文字改深绿或加深渐变至白字 ≥4.5:1；--text-lighter 改 #6B7280；导航去 opacity 方案改实色 + 激活态加粗。
2. **字号**：核心文字大量 ≤12px——词表中文释义 0.7rem（style.css:363）、mem-zh 0.7rem（:766）、进度小字 0.65rem（:286）、nav-label/stat-label 0.7-0.72rem。修法：建 12px 硬下限的字号阶梯，学习内容（word-zh/mem-zh）提到 0.8rem，词表英文提到 1rem。
3. **中文字体**：style.css:27 字体栈全是西文字体，界面 90% 中文落到浏览器缺省，低端 Android 出宋体。修法：补 'PingFang SC','HarmonyOS Sans SC','MiSans','Noto Sans SC','Microsoft YaHei' fallback。
4. **触控目标**：发音按钮 36×36（style.css:948）、back-btn ≈32px（:301-314）、重置按钮 ≈30px（:860-870，破坏性操作裸露在统计页头仅靠 confirm 兜底）、下拉 ≈30px（:496-506）。儿童产品建议 ≥48px。修法：wp-speak 提到 48×48，其余 min-height:44px；重置移到页面底部并改两段式确认。

### P1-11 拼写题空输入也消耗尝试次数，连按两次"确认"未动笔即判错

- **现象与根因**：checkSpelling（app.js:816-864）对空输入无守卫，实测空输入点两次"确认"直接显示正确答案并 `recordAnswer(false)`。孩子手滑双击或连按回车，没动笔就被记一次错误。
- **修法**：函数开头加 `if (!input) { 提示"先输入单词哦"; return; }`，空输入不消耗尝试。

### P1-12 教学流程硬伤：无先学后测，未学过的词直接进拼写/选择题

- **现象**：四个模式入口完全平级；选择题/拼写的分类下拉含"未学过"（index.html:204/259），8 岁孩子直接对从未见过的词做拼写=必然连错挫败；拼写默认"全部 850"还会抽到 of/the/as 这类功能词（按"的"拼 of 既无意义又必错）。
- **修法**：拼写/选择题取词池限制为 status !== 'new'（getWordsForMode 加 'learned' 模式），"未学过"只留给翻卡；拼写排除 operations 虚词或默认改"图示词"分类；首页加"今天就学这个"默认路径按钮（5 新词翻卡 → 5 题测验 → 庆祝）。

---

## 四、P2：设计与细节打磨

### 代码行为类（已验证）

| # | 问题 | 位置 | 修法 |
|---|------|------|------|
| 1 | 配对游戏把盲翻 miss 给两张牌各记一次 wrong（牌位记忆失误≠词汇错误），可把 mastered 词 1-2 局内降级；配对成功又与测验同权记 correct，叠加排除法得分使掌握度虚高 | app.js:1016-1017, 1004 | 配对不写 wrong；成功只更新 lastSeen 或降权，mastered 判定留给拼写/选择题 |
| 2 | 拼写 Enter 提交未排除 IME 组合态：中文输入法下按 Enter 上屏拼音的那一下同时触发判题，半截拼音被判错并播错误音 | app.js:869-871 | `if (e.key==='Enter' && !e.isComposing && e.keyCode!==229) checkSpelling()` |
| 3 | iOS 切后台后 AudioContext 挂起从不 resume，音效持续静音（standalone PWA 场景最稳定复现；朗读用 speechSynthesis 不受影响，属体验退化非致命） | app.js:233-236 | playSound 开头 `if (ctx.state!=='running') ctx.resume()`，并监听 visibilitychange；可顺带补 navigator.vibrate(50) 触觉反馈 |
| 4 | 翻卡防连点锁形同虚设：`fcLocked=true` 在同一调用栈末尾被 showFlashcard 同步置回 false，有效期为 0；触屏靠 pointer-events 兜底，但键盘 Enter/空格激活不受限，可连按制造虚假 correct 记录 | app.js:546, 566-612 | 解锁改 transitionend（或 setTimeout 400ms），按钮加 disabled 属性 |
| 5 | 配对长单词（advertisement/representative 等）在 4 列小卡上每侧溢出约 8px，占满卡片间隙、紧贴邻卡边缘，窄屏（320px）会叠压邻卡 | style.css:738-766, app.js:957 | .memory-card-face 加 overflow:hidden；.mem-en 加 word-break 或对 length>8 降字号 |
| 6 | 答完一张卡切下一张时，0.6s 回翻动画期间背面已换成下一词的中文，剧透答案（P0-1 修复后会更显眼） | app.js:540-547 | 先 remove('flipped')，transitionend 后再更新卡面文字与发音 |
| 7 | 改分类/数量下拉立即销毁当前会话，无确认；做到第 9/10 题误触即清零 | app.js:614-615, 755-756, 922-923, 1048 | 会话进行中先确认；更好：设置移到会话开始前的配置画面 |
| 8 | 全局未设 touch-action:manipulation，iOS 上配对/翻卡快速连点触发双击缩放 | style.css 全文, index.html:5 | body 或交互元素加 `touch-action:manipulation` + `-webkit-tap-highlight-color:transparent` + user-select:none |
| 9 | 答错反馈仅停留 1 秒即跳题，孩子来不及看清正确答案，正确答案也不朗读；拼写揭示答案 2 秒后直接跳题不要求重输；全应用无错题复看入口 | app.js:721-724, 853-861, 744-745 | 答错改"点击继续"+朗读正确答案；拼写揭示后要求照拼一遍；结算页列错词并给"只练错词再来一轮" |
| 10 | 低分结算播放与答错同款的 wrong 惩罚音、pct<50 给 0 星，双重惩罚且无连错保护 | app.js:750, 917, 738 | 结算永不播 wrong（新增中性鼓励音）；完成保底 1 星；连错 3 题插入信心题 |
| 11 | 提示按钮零成本：spellingHintUsed 赋值后从未被读取（死逻辑），三级提示露出 n-1 个字母仍按全对计分推进 mastered | app.js:763, 878, 888 | 用提示降权/不推进 mastered；第三级提示改只显元音或乱序字母 |
| 12 | 拼写第一级提示写死 3 个下划线，与"(5个字母)"自相矛盾 | app.js:883 | `${en[0]}${'_'.repeat(en.length-1)}` |
| 13 | 翻卡结算文案"获得 5 颗星星"配图却截断为 3 颗满星，数字与图形矛盾 | app.js:529-530 | 图形固定表示本轮评价、文案改"+N ⭐ 已存入"，或图形按实际数渲染 |
| 14 | 配对结算"完美配对！"标题与大拇指图标两套判定标准打架 | app.js:1027-1037 | 图标与标题共用同一 perfect 布尔 |
| 15 | 重置进度用原生 confirm()，与全应用自定义弹窗风格割裂、部分 WebView 行为不可控 | app.js:1102-1108 | 复用 .word-popup-overlay 做自定义确认弹窗 |
| 16 | 触屏 hover 粘滞：mode-card/category-card tap 后保持悬浮态 | style.css:199-203, 243-246 | :hover 包进 `@media (hover:hover)` |
| 17 | 统计页空状态只有一行 1.9:1 对比度的灰字，无插画无行动入口 | app.js:1086-1097 | 标准空状态组件：大图标 + 14px 正文 + "去翻卡片"按钮 |
| 18 | 代码健康：updateWordStatus 死代码、navHistory 只 push 不清理（6 个 back-btn 的 data-back="home" 被忽略，返回落点取决于会话历史）、saveProgress 的 Quota 分支无实效且存储失败被静默吞掉 | app.js:57-70, 207-209, 25-35 | 状态机收敛；back-btn 尊重 data-back；启动探测 localStorage 可写性，不可写时常驻提示 |

### 数据译文类（已验证）

| # | 词条 | 问题 | 修法 |
|---|------|------|------|
| 1 | solid=固体的（words.js:898） | 在 opposites 类，其形容词反义对应是 hollow=空心的（words.js:786）；"固体"的对立面 liquid 是名词不在配对体系内 | 改"实心的/坚固的" |
| 2 | open=开放的（words.js:801） | 与 Ogden 指定反义词 shut=关着的（words.js:893）不构成中文反义对 | 改"开着的" |
| 3 | old/thin/short/right（words.js:885/901/892/817） | 漏掉配对义项："旧/瘦/矮/右"四个义项全库缺席，而 new/fat/tall/left 均已入选 | 补为 老的/旧的、薄的/瘦的、短的/矮的、正确的/右边的（与 dear=亲爱的/贵的 双义写法一致） |
| 4 | mass=质量/大量（words.js:318） | 中文"质量"日常首义≈quality，与同表 quality=品质（words.js:388）语义冲突且可成为对方测验干扰项 | 改"一团/大量" |
| 5 | lead=领导（words.js:299） | Ogden 名词表中 lead 是金属"铅"（同表已凑齐 brass/copper/gold/iron/silver/steel/tin），"铅"义全库缺失 | 改"铅/带领" |
| 6 | 措辞成人化（words.js:65,126,136,205,217,392,491,546,673） | desire=欲望、trick=诡计、approval=批准、bath=浴、pump=泵、such=如此的、rate=速率；addition/division 错过对接小学"加法/除法" | 逐词替换为儿童友好措辞，注意替换后保持 850 条译文互不相同 |

### 视觉系统类（设计意见）

1. **色彩 token 化**：6 组硬编码渐变游离于 design token 外（翻卡正面 #667eea→#764ba2 是与 --primary 接近不相等的"野紫色"，style.css:397/752；背面 :415、streak :109、index.html:70/88）。分类色只出现在首页图标，没有贯穿到分类详情页/翻卡正面——颜色编码恰恰是儿童最依赖的导航线索。建议渐变收敛为 4 个 token，并为 5 个分类定义 --cat-*-grad 贯穿二级页面。
2. **圆角/间距网格**：圆角 6 种值、间距大量非 4/8 倍数混用（style.css 全文），收敛为 8/12/16/full 四档 + 4pt 网格。
3. **翻卡主单词偏小**：2.2rem 在 380px 高的卡上大面积留白（style.css:429-436），建议 3rem 起步 + 长词 JS 降档，背面中文同步放大。
4. **图标尺寸三套标准并存**：CSS 类全带 !important（style.css:52-56）、HTML 8 处内联尺寸、icon() 函数又输出内联，统一为类名阶梯。

---

## 五、P3：功能升级路线图（固定 850 词，不增删单词）

按建议实施顺序：

### 第一阶段：学习效果（1-2 周）

1. **给 200 个"图示词"加 emoji 字段**——分类名叫"图示词"却没有任何图，是当前最大的名实不符。只加属性不动词表：`{ en:"apple", zh:"苹果", emoji:"🍎" }`。落地：翻卡正面大号 emoji、配对改"英文↔emoji"玩法、选择题加"看图选词"题型。约一天工作量，是学习效果提升最大的单项投入。
2. **轻量间隔重复（SRS）**——当前答错的词掉回 850 词随机池（下次出现概率 ~1.2%），"错了就永远消失"，是学习产品最核心的缺陷。数据字段（wrong/correct/lastSeen）已齐备，三步落地：① 各模式分类下拉加"错词复习"（取 wrong>correct 的词）；② 随机取词改加权抽样 `weight = 1 + wrong*3 + min(距lastSeen天数,7)`；③ 翻卡点"不认识"的词追加到本轮队尾再过一遍，形成"本轮内闭环"。
3. **掌握度判定分级**——翻卡自评"认识"最多推到 learning，mastered 必须由选择题/拼写客观答对触发；降级改"最近 2 次连错"（存长度 3 的 recentResults 短数组）。
4. **听写玩法**——speakWord 质量已好，拼写模式加"听音拼词"子玩法（题干只有喇叭，答错一次才显示中文提示）；中译英选完即朗读、配对成功朗读，三处各一行。

### 第二阶段：动机结构（2-4 周）

5. **关卡化**——850 词按现有分类顺序切成每 10 词一关（共 85 关），首页用蛇形关卡地图替代分类列表；每关固定流程：翻卡学 10 词 → 选择题测这 10 词 → ≥70% 点亮 1-3 星解锁下一关。进度文案从"x/850"改"第 x 关/85 关"，把压迫感变成路径感。
6. **星星经济闭环**——当前星星只进不出（addStars 无任何消费出口），且翻卡乱点也送 n/2 颗星（app.js:520）而认真做对 10 题只得 3 星（app.js:738）。修正产星规则（全模式 0-3 星对齐）+ 星星商店（解锁卡片主题/音效/吉祥物配件）+ 30 星兑换"补签卡"保护 streak。
7. **每日目标**——当天答题 ≥10 个才点亮火焰，火焰旁加 0/10 进度环（配合 P1-6 的 streak 修复）。
8. **里程碑庆祝**——单分类 100% 全屏庆祝 + 永久皇冠角标；850 全通进入一次性"毕业典礼"页（canvas 生成可保存的毕业证书卡片）。当前"未学过"为空时静默回退全量词（app.js:492-493）应改为庆祝弹窗。

### 第三阶段：家长侧与质感（4 周+）

9. **家长统计**——progress 加 `dailyLog: { '2026-06-10': {answered, correct, newWords} }`，统计页渲染最近 7 天纯 CSS 柱状图 + "需要加强的词"区块（点击直接发起复习轮）；重置按钮移入算术题门控的"家长专区"。
10. **吉祥物与文案童趣化**——零成本替换："学习进度"→"我的闯关地图"、"已掌握"→"我学会啦"、"多练习一下吧！"→"没关系，下次一定记得住！"；选一个 emoji 吉祥物固定出现在首页与结算页，按成绩换表情。
11. **导航与动效**——接管浏览器历史（pushState/popstate，否则 Android 返回键直接退出应用丢进度）；前进/返回方向性转场；翻卡换词加 200ms 滑入滑出。
12. **数据防回归**——译文修订完成后固化 `tests/validate-words.js`：断言 850 总数、五类配额（100/400/200/100/50）、en 唯一、zh 非空；P0-4 修完后 zh 唯一性方可一并断言。词表本体经审计与 Ogden 官方逐类完全一致，无需任何改动。

---

## 六、如果只做 10 件事（按投入产出比排序）

| # | 事项 | 投入 | 产出 |
|---|------|------|------|
| 1 | 删 style.css:399、418 两行 `position:relative` | 2 行 | 翻卡模式从完全不可用到可用 |
| 2 | app.js:681 第三参改 `word.en` + 一次性清洗中文脏键 | ~10 行 | 找回 30% 的测验学习进度 |
| 3 | 修 10 组重复译文 + 三处代码按 zh 去重/兼容（app.js:679、checkSpelling、initMemory） | 10 个字符串 + ~15 行 | 消灭"答对被判错"，守住孩子的信任 |
| 4 | 翻卡完成分支重置状态 + 导航守卫加 `fcIndex >= fcWords.length`，弹窗加"再来一组" | ~10 行 | 消灭死锁页面 |
| 5 | lucide + Nunito 本地化，新增 sw.js 缓存静态资源，补 192/512 PNG 图标与 apple-touch-icon，viewport 加 viewport-fit=cover | 半天 | 大陆环境真正可用、可装、可离线 |
| 6 | 给 200 图示词加 emoji 字段并接入翻卡/配对/选择题 | 1 天 | 学习效果提升最大的单项 |
| 7 | streak 改学习事件触发 + 翻卡产星按"认识"数对齐 0-3 星 + fc-no 不再降到 'new' | ~30 行 | 激励系统恢复诚实，进度只进不退 |
| 8 | 错词闭环：本轮错词追加队尾重现 + 结算页"只练错词再来一轮" + 取词加权抽样 | 1-2 天 | 从"背单词工具"变成"会教的产品" |
| 9 | 答错体验包：点击继续替代 1 秒跳题、朗读正确答案、结算不播惩罚音、空输入守卫、IME Enter 守卫、setTimeout 清理 | 1 天 | 答错不再是惩罚，杂音 bug 一次清完 |
| 10 | 译文批量精修（delicate/solid/open/old/thin/short/right/mass/lead/power/reason + 成人化措辞）+ 固化 tests/validate-words.js | 1 天 | 数据质量长治久安 |

---

*报告依据五维审查共 50 项有效发现整理，跨维度重复项已合并，全部 P0/关键 P1 均经源码逐行复核或真机实测确认；验证环节的修正意见（行号勘误、症状澄清、过时论据替换）已采纳进正文。*
