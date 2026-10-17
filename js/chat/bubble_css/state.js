// --- START OF FILE bubble_css/state.js ---
// ======================================================================
// 外观系统的共享状态与数据表。
//
// 装三样东西：
//   · colorThemes —— 气泡工厂也在用（chat_bubble_factory.js）
//   · defaultBasicState / basicState / 三个「修改对象」的当前选中项
//   · 生成端要用的那几张「状态 → 真实 DOM 选择器」对照表
//
// ★ basicState 是整个外观面板的**唯一**状态源。它曾经是 setupBubblePresets
//   闭包里的 let，而那个函数有两个调用点 —— 结果是两份状态绑在同一批控件上，
//   表现为「换了预设，底栏按钮点不中 / 改色没反应」（见 git 9d003f1）。
//   提到这里之后结构上就只可能有一份了；wire.js 里那个 _bubblePresetsInited
//   守卫是防重复绑监听的，两件事别混。
//
// ★ 这一组文件原先是一个 3074 行的 js/chat/bubble_css_preset.js。
//   拆分的前置条件是把共享状态从 setupBubblePresets 的闭包里提到**脚本级** ——
//   这个项目用的是普通 <script>（不是 ESM），脚本级的 let/const 跨文件可见但
//   不挂在 window 上（同 showToast / AppUI 那批）。所以 basicState 这些
//   在 state.js 里声明、在别的文件里直接用，不需要 import 也不需要命名空间对象。
//
// ★ 加载顺序写在 index.html 里，必须是：
//     state → css_io → store → preview → generate → panel → parse → wire → help_text
//   而且整组必须排在 bubble_css_scope.js **后面**（generate / preview 都调 scopeBubbleCss）、
//   chat_settings.js **前面**（那边调 _getBubblePresets / getBarCollapseFromCss）。
//   函数声明本身是提升的、互相调用不看顺序，排序是为了：
//     · state.js 里 `let basicState = …defaultBasicState…` 要在同文件内先声明；
//     · help_text.js 的 AppHelp.register 在**加载时**就执行，得等 utils.js 先到；
//     · 测试把这 9 个文件按这个顺序拼起来当一整份源码读（见 tests/_bubble_css_src.cjs），
//       有几条断言是跨文件切片的（比如 updateUIFromState → syncBasicUiFromCss）。
// ======================================================================

const colorThemes = {
    'white_blue': {
        name: '默认',
        received: { bg: '#FFFFFF', text: '#1D1F21' },
        sent: { bg: '#0099FF', text: '#FFFFFF' }
    }
};

// ================== 进阶基础 UI 数据管理与 CSS 生成 ==================
// timePos: 消息时间放哪儿 —— 'none' 不显示 / 'avatar' 头像下方 / 'above' 气泡上方 / 'tail' 气泡后。
//   三个槽位在气泡工厂里都画了出来（见 chat_bubble_factory.js 的组装段），这里只负责
//   放开其中一个，所以换位置是纯 CSS 的事，已经渲染出来的气泡会立刻跟着动。
//   ★ 老预设存的是布尔 `showTime`，迁移在 syncBasicUiFromCss 里：true → 'above'。
// timeFormat: 时间文字的模板，**不是 CSS**，由气泡工厂在渲染时按它拼字符串
//   （解析器 formatMessageTimestamp，说明文案见本文件底部的 AppHelp.register）。
// avatarRadius: 头像圆角，0 = 方角，19 = 正圆（头像 38px，19px 正好是 50%）。
// header / footer: 顶栏和底栏的设置，和气泡挤在**同一个** META 里 ——
//   它们本来就是一个预设的三个视图，分开存会出现「换预设只换了气泡」。
//   默认值一律照抄对应的静态 CSS，这样「没改过」就一个字节都不生成（见下面的 hasChanges）。
//   · header.namePos  'left' = chat_room.css 的 `#chat-room-header-default .title-container`
//     那套 static + flex-start + flex-grow:1，也就是**聊天室现在的样子**。
//     ★ 别照 components.css 写成 'center'：那条只管别的页面的顶栏，聊天室这边
//       早被 chat_room.css 顶掉了。写错的话「什么都没改」也会生成一堆 CSS，
//       而且会把默认的靠左悄悄变成居中。
//   · header.hideStatus 昵称下面那行小字（绿点 + 在线），即 #chat-room-subtitle
//   · header/footer 的 bg+opacity+blur 是「栏本体」的底：两条栏在 chat_room.css 里
//     恰好是同一组值 —— `#chat-room-header-default` 和 `.chat-input-wrapper` 都写着
//     `background-color: rgba(243,242,247,0.85)` + `backdrop-filter: blur(8px)`。
//     ★ 顶栏别照 components.css 的 `.app-header`（rgba(255,255,255,.5) + blur 5）抄，
//       那条被 chat_room.css 顶掉了，抄错就是「没改过也生成 CSS」。
//   · header.btnC 是顶栏那几个**图标**本身的颜色，默认 var(--btn-color) = #2F3034
//     （variables.css）。它和下面三块的 bg 是两码事：btnC 管 svg，bg 管托着 svg 的那块。
//   · header.back / header.title / header.group 是顶栏的**三块元素**：
//     返回键 `.back-btn` / 昵称+状态 `.title-container` / 右侧按钮组 `.action-btn-group`。
//     ★ 以前这三颗按钮共用**一组** strokeC/strokeW/radius，而且画在**每颗按钮**身上
//       （`.back-btn, .action-btn-group .action-btn`），所以通话和菜单会各得一个框。
//       用户要的是"底透明、要素成块"，于是改成按块走：按钮组整体一个框，不是两个。
//       老预设里那三个平铺字段的迁移在 syncBasicUiFromCss 里。
//     ★ 三块出厂都是**全透明**的，所以默认 opacity 取 0（bg 填什么都看不见，
//       填 #FFFFFF 只是给取色器一个初值）；radius/strokeW/pad 的默认也都是 0 ——
//       静态 CSS 里 `.back-btn` / `.title-container` / `.action-btn-group`
//       三者都没写 border-radius 也没写 border（radius:8 是写在**里面**那颗
//       `.action-btn` 上的，不是组上）。全 0 = 没改过就一个字节都不生成。
//     ★ title.widthPct：昵称栏在 chat_room.css 里是 `flex-grow:1`，占满「返回键右边 ~
//       按钮组左边」的整段空档（也就是 100%），一上底色就是横贯顶栏的一长条。
//       这个百分比就是"占那段空档的几成"，默认 100（照抄静态 CSS，不改一字节不生成）。
//       余下的 (100-P)% 由 `.app-header` 的 `justify-content:space-between` 均分到两侧，
//       所以块看着是在中间、左右各留一道空隙。
//       ★ 它和 namePos 是**两件事**：namePos 管"文字在块里靠哪边"，widthPct 管"块多宽"。
//         曾经这里是个布尔 `fit`（贴合文字 = flex-grow:0），用户反馈"一开就变居中、
//         不开又离左右太近"，没有中间档 —— 所以换成百分比。老预设里的 fit 不迁移
//         （贴合文字没有对应的百分比），直接丢掉。
//   · header.divW/divC 和 footer.divW/divC 是两条栏的**分割线**：顶栏画在下沿
//     （border-bottom），底栏画在上沿（border-top）。默认照抄静态 CSS —— 顶栏
//     `#chat-room-header-default` 明写着 `border-bottom: none`，所以 divW 默认 0；
//     底栏 `.chat-input-wrapper` 是 `1px solid rgba(255,255,255,0.3)`，所以 divW 默认 1。
//     ★ 底栏那条出厂线带着 0.3 的 alpha，而取色器给不出 alpha。所以 divC 默认记作
//       #FFFFFF，用户一旦动了这两个旋钮，生成的就是**实心**线 —— 不动则一个字节不生成，
//       维持出厂的半透明。这点在面板「背景与分割线」那个小标题的问号里对用户讲明了
//       （文案见本文件底部 AppHelp.register 的 footerBg）。
//   · header.collapseCall / footer.collapseToolbar 是两个「收纳」开关，
//     **生成不出 CSS**，只负责让 hasChanges 为真把 META 留住；真正干活的是
//     getBarCollapseFromCss → #chat-room-screen 上的 class（见本文件上方那个函数）。
//   · footer.send/reply/input 分别是 #send-message-btn / #get-reply-btn / #message-input，
//     默认值来自 chat_room.css：两颗按钮 var(--primary-color)=#0099FF + radius 5 + border:none，
//     输入框 #ffffff + radius 5 + border:none。
//   · footer.btnC 是**工具栏那排图标**的颜色。和顶栏那个要列一长串选择器的
//     header.btnC 实现完全不同：`chat_room.css` 开头（`#chat-room-screen` 那个块）
//     早就把它抽成了 CSS 变量 `--bar-icon-color`，面型图标靠它上 `fill`、
//     线型（`.ic-line`）靠它上 `stroke`，所以这里只要把变量重新声明一遍，
//     就一次覆盖工具栏 6 颗 + 输入栏那颗 "+"，不用点名 —— 这也是加这项特别便宜的原因。
//     默认值照抄那边的 #555。
//     ★ 旁边那个 `--bar-icon-stroke`（线宽）**故意没有做成旋钮**：工具栏 6 颗里
//       只有语音和钱包是线型，另外 4 颗是面型、粗细画死在路径里调不动。
//       做成旋钮的结果是「2 颗变粗、6 颗粗细不一致」，越调越难看（用户实测后要求删掉）。
//       想整体换粗细只能换素材。**别再把它加回来。**
//     ★ 别把 #get-reply-btn 算进来：那颗是实心蓝底按钮，图标走 `fill: currentColor`，
//       归下面 reply.color 管。
//   · footer.send/reply/input 的 color 是**文字/图标色**，默认照抄静态 CSS：
//     两颗按钮来自 `.message-input-area .icon-btn { color: white }`（发送键是"发送"二字，
//     AI 回复那颗是 svg 走 currentColor，所以同一个 color 两边都管得到）；
//     输入框没写过 color、继承 variables.css 的 --text-color: #444，故记作 #444444。
//     ★ 输入框这一项**连 ::placeholder 一起发**（同色 + opacity 0.55）——
//       用户把输入框调成深色时，浏览器默认那个灰 placeholder 会当场看不见，
//       而这正是加这组旋钮要解决的问题，只改 color 等于只修了一半。
const defaultBasicState = {
    hideAvatar: false, timePos: 'none', timeFormat: 'HH:mm', avatarRadius: 19, customFont: '',
    header: {
        namePos: 'left', hideStatus: false, collapseCall: false,
        bg: '#F3F2F7', opacity: 0.85, blur: 8,
        divW: 0, divC: '#000000',
        btnC: '#2F3034',
        back:  { bg:'#FFFFFF', opacity:0, pad:0, radius:0, strokeW:0, strokeC:'#000000' },
        title: { bg:'#FFFFFF', opacity:0, pad:0, radius:0, strokeW:0, strokeC:'#000000', widthPct:100 },
        group: { bg:'#FFFFFF', opacity:0, pad:0, radius:0, strokeW:0, strokeC:'#000000' }
    },
    footer: {
        hideSend: false, collapseToolbar: false, collapseReply: false,
        bg: '#F3F2F7', opacity: 0.85, blur: 8,
        divW: 1, divC: '#FFFFFF',
        btnC: '#555555',
        send:  { bg:'#0099FF', color:'#FFFFFF', strokeW:0, strokeC:'#000000', radius:5 },
        reply: { bg:'#0099FF', color:'#FFFFFF', strokeW:0, strokeC:'#000000', radius:5 },
        input: { bg:'#FFFFFF', color:'#444444', strokeW:0, strokeC:'#000000', radius:5 }
    },
    styles: {
        normal_sent:   { bg:'#0099FF', fontSize:16, fontColor:'#FFFFFF', opacity:1, blur:0, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
        normal_received:   { bg:'#FFFFFF', fontSize:16, fontColor:'#333333', opacity:1, blur:0, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
        // 旁白也分我方/对方，和普通气泡一个口径：
        //   narration_received = AI 写的旁白（线下模式/通话），选择器 :not(.narration-mine)
        //   narration_sent     = 用户自己在"+"面板发的「剧情旁白」，选择器 .narration-mine
        // 曾经这两者共用一个 `narration` 键、我方靠生成端硬写一条 border:none 区分，
        // 于是"我方想单独换个底色/描边"做不到。现在各自独立。
        // ★ 我方的默认值 = 对方的默认值但描边归零，这样拆分前后长得一模一样
        //   （chat_room.css 的 `.narration-mine .narration-bubble { border: none }` 就是它）。
        //   改这里要同步 tests/narration_radius_stitch.test.cjs 的默认值断言。
        narration_received: { bg:'#FFFFFF', fontSize:15, fontColor:'#555555', opacity:0.8, blur:0, strokeW:3, strokeC:'#0099FF', radius:6, strokeSides:['left'] },
        narration_sent:     { bg:'#FFFFFF', fontSize:15, fontColor:'#555555', opacity:0.8, blur:0, strokeW:0, strokeC:'#0099FF', radius:6, strokeSides:[] },
        voice_sent:    { bg:'#0099FF', fontSize:14, fontColor:'#FFFFFF', opacity:1, blur:5, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
        voice_received:    { bg:'#FFFFFF', fontSize:14, fontColor:'#333333', opacity:1, blur:5, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
        transfer_sent: { bg:'#FF9900', fontSize:14, fontColor:'#FFFFFF', opacity:1, blur:0, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
        transfer_received: { bg:'#FF9900', fontSize:14, fontColor:'#FFFFFF', opacity:1, blur:0, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
        
        quote_sent:    { bg:'#FFFFFF', fontSize:13, fontColor:'#FFFFFF', opacity:0.1, blur:0, strokeW:3, strokeC:'#FFFFFF', radius:8, strokeSides: ['left'] },
        quote_received:    { bg:'#000000', fontSize:13, fontColor:'#555555', opacity:0.04, blur:0, strokeW:3, strokeC:'#0099FF', radius:8, strokeSides:['left'] },

        // ===== 下面四类**不是气泡**，是聊天里那些零散的小字 =====
        // 它们在 chat_room.css 里各自写死一个灰，换成深色背景后就全看不见了
        // （用户原话：「换了深色背景就看不清」）。以前外观系统完全没管到这几类。
        // ★ 这四类**没有我方/对方之分**（见 NEUTRAL_TYPES），所以键名不带 _sent/_received
        //   后缀，选中它们时「我方/对方」那个下拉会禁掉。
        // ★ 默认值一律照抄静态 CSS，否则"什么都没改"也会生成 CSS。其中三类
        //   **从来没写过 background**，所以底色默认记作不透明度 0（取色器要个初值，
        //   填 #FFFFFF 只是占位）—— 要是给个看得见的默认值，一打开面板就凭空多出一块底。
        //   radius 同理：没写过 border-radius 的就是 0，别图好看填个 4。
        msgtime:   { bg:'#FFFFFF', fontSize:10, fontColor:'#AAAAAA', opacity:0,   blur:0, strokeW:0, strokeC:'#000000', radius:0,  strokeSides:[] },
        timediv:   { bg:'#FFFFFF', fontSize:12, fontColor:'#999999', opacity:0,   blur:0, strokeW:0, strokeC:'#000000', radius:6,  strokeSides:[] },
        systip:    { bg:'#C8C8C8', fontSize:12, fontColor:'#666666', opacity:0.5, blur:0, strokeW:0, strokeC:'#000000', radius:12, strokeSides:[] },
        groupname: { bg:'#FFFFFF', fontSize:13, fontColor:'#888888', opacity:0,   blur:0, strokeW:0, strokeC:'#000000', radius:0,  strokeSides:[] }
    }
};

let basicState = JSON.parse(JSON.stringify(defaultBasicState));
let currentSelectType = 'normal_sent';
// 底栏那块面板上「修改对象」下拉选的是谁。三个对象共用同一组控件（和气泡那块同一套路）。
let currentFooterTarget = 'send';
// 顶栏同理：返回键 / 昵称栏 / 右侧按钮组。
let currentHeaderTarget = 'back';


// 底栏三个对象 → 真实 DOM 选择器。改 index.html 的底栏时这里要跟着动。
const FOOTER_SELECTORS = {
    send:  '#send-message-btn',
    reply: '#get-reply-btn',
    input: '#message-input'
};

// 「栏本体」的底色 —— 改背景/透明度/模糊时要刷的选择器。
// ★ 两条栏各自都有一个**多选态的替身**，必须一起改：
//   顶栏进多选会换成 #chat-room-header-select（取消/选择消息/显示隐藏），
//   底栏进多选会被 #multi-select-bar 盖住（删除已选/转发）。
//   只改常态那条的话，用户把栏调成深色后一进多选就闪回浅灰，看着像 bug。
//   （昵称位置、按钮样式那些**不能**这么干：多选态顶栏里是两颗文字按钮，
//     把 40px 宽度和弧度套上去会把"显示隐藏"四个字挤出来 —— 见 chat_room.css 那条注释。）
const HEADER_BAR_SELECTOR = '#chat-room-header-default, #chat-room-header-select';
const FOOTER_BAR_SELECTOR = '.chat-input-wrapper, #multi-select-bar';

// 顶栏那几个图标：返回 / 通话 / 菜单。这条只管**图标本身**的颜色（btnC）。
// 图标里 fill 走 currentColor（跟着 color），stroke 却被 chat_room.css 硬写成
// var(--btn-color) —— 只改 color 的话描线不跟着变，半边新半边旧，所以两条都得发。
const HEADER_BTN_SELECTOR =
    '#chat-room-header-default .back-btn, #chat-room-header-default .action-btn-group .action-btn';

// 顶栏三块元素 → 真实 DOM 选择器。改 index.html 的顶栏时这里要跟着动。
// ★ 一律钉在 #chat-room-header-default 上，不碰多选态那个 #chat-room-header-select：
//   那边是两颗**文字**按钮（取消 / 显示隐藏），把块样式套上去会把字挤出来。
const HEADER_BLOCK_SELECTORS = {
    back:  '#chat-room-header-default .back-btn',
    title: '#chat-room-header-default .title-container',
    group: '#chat-room-header-default .action-btn-group'
};

// 三块元素在静态 CSS 里都带着「为裸图标准备」的几何：
//   .back-btn           40×40 固定 + margin-left:-8px（把图标顶到屏幕最左边）
//   .action-btn-group   width:54px 固定（正好等于 24+6+24，一点余量都没有）
// 这些值一旦被当成**色块**看就全是毛病：负外边距让左边那块比右边多探出 8px，
// 固定宽高遇上 padding 会反过来把里面的 svg 压小（reset.css 给 * 置了 border-box）。
// 所以一旦这块真的长出了底色/描边/内边距（见下面的 boxed），就把这些几何归零，
// 让块自己按内容撑开。★ 只在 boxed 时发：光改个弧度（透明底下根本看不见）
// 就把按钮挪 8px，用户会以为自己碰坏了什么。
const HEADER_BLOCK_NORMALIZE = {
    back:  ' width: auto !important; height: auto !important; margin-left: 0 !important;',
    group: ' width: auto !important;',
    title: ''
};

// 把 .voice-bubble 并入 normal，让它们共享同一套样式！
const classSelectorsMap = {
    'normal': '.message-bubble, .voice-bubble',
    'narration': '.narration-bubble',
    'transfer': '.transfer-card',
    'quote': '.quoted-message',

    // 下面四类不是气泡，是聊天里那些零散小字（默认全是写死的灰，深色背景下看不见）。
    // ★ msgtime 的三个 class 是**同一个时间**的三个槽位（气泡上方 / 头像下方 / 气泡后），
    //   每条消息三个都画出来、由 timePos 放开其中一个，所以三个必须一起染色 ——
    //   只染一个的话，用户换个时间位置颜色就白调了。
    // ★ systip 把「系统提示」和「撤回提示」并成一组：这两个 class 在 chat_room.css 里
    //   的 color / background / font-size / radius / padding 逐字节相同，出厂就是一个样子，
    //   分成两项只是让用户多调一遍。
    //   ⚠ chat_room.css 末尾（折叠通话那段）给这两个 class 和 .chat-time-divider
    //   在 `.expanded-call-session-container` 里另染了一遍灰蓝 #7A869A，用来和通话外的
    //   消息做区分。这里生成的规则带 !important 又被 scope 抬到 1 id + 2 class，
    //   会把那份区分盖掉 —— **这是故意的**：用户把整体调成深色时，通话里那几行
    //   要是还钉在浅色主题的灰蓝上，才是真的看不清。别为了"保住区分"去加排除。
    'msgtime': '.message-time, .message-time-avatar, .message-time-tail',
    'timediv': '.chat-time-divider',
    'systip': '.system-notification-bubble, .withdrawn-message',
    'groupname': '.group-nickname'
};

// 这几类没有「我方 / 对方」之分，选中时把那个下拉禁掉，键名也不带 _sent/_received 后缀。
// （时间分割线和系统提示本来就是居中的独立一行；时间戳和群昵称两侧共用一条静态规则，
//   拆成两套只是让用户多调一遍。）
const NEUTRAL_TYPES = new Set(['msgtime', 'timediv', 'systip', 'groupname']);

// msgtime 和 groupname 出厂是**裸文字** —— 既没有 background 也没有 padding，
// 一上底色就紧贴着字，难看。照 HEADER_BLOCK_NORMALIZE 的路子：只在"真长出块"
// （底色能看见、或者描了边）时才补一点内边距，光改个字色不会动几何。
// 另两类（timediv / systip）静态 CSS 里本来就有 padding，不用管。
const BARE_TEXT_PAD = { msgtime: '2px 6px', groupname: '1px 6px' };

// START_MARKER / END_MARKER 已提到模块级（和 splitBubbleCss / joinBubbleCss 放一起），
// 因为拆两个框之后「哪段是生成的」这件事在闭包外面也要用。
