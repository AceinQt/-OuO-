// --- START OF FILE bubble_css/generate.js ---
// ======================================================================
// basicState → CSS。外观系统里最大的一块，也是改动最频繁的一块。
//
// 产出的字符串会写进「高级」Tab 那个只读框，末尾带一条 /* META:{…} */ 注释
// （那是 basicState 的镜像，parse.js 靠它反解回面板）。
//
// ★ 每一项都要先和 defaultBasicState 比一次，只有真被改过的才发 ——
//   默认值必须和静态 CSS 逐字对得上，对不上就会「什么都没改也生成一堆 CSS」。
// ★ 默认值本身在 state.js。改这里的生成逻辑时顺手确认那边的默认值还对。
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


function hexToRgba(hex, alpha) {
    if (!hex) return 'transparent';
    if (hex.startsWith('rgb')) return hex;
    let r = 0, g = 0, b = 0;
    if (hex.length === 7) { r = parseInt(hex.substring(1,3), 16); g = parseInt(hex.substring(3,5), 16); b = parseInt(hex.substring(5,7), 16); }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}


function generateCssFromState() {
    // ★ META 那条注释**放在块尾**（见下面 END_MARKER 那行），不放块首 ——
    //   它是面板状态的序列化，有一两千字符长，而这个块现在是摊在「自动生成的样式」
    //   那个只读框里给用户当参考用的（照着里面的选择器抄，是查"某个东西叫什么 class"
    //   最快的办法）。META 摆第一行会把真正有用的规则整个顶出可视区。
    //   三个读 META 的地方（getMessageTimeFormatFromCss / getBarCollapseFromCss /
    //   syncBasicUiFromCss）都是 `match(/\/\* META:(.+?) \*\//)`，**与位置无关**，
    //   所以搬家是安全的；但 START_MARKER 必须仍是块的第一行，splitBubbleCss 靠它定界。
    let basicCss = `${START_MARKER}\n`;
    let hasChanges = false; // 核心标记：记录是否真的修改了基础样式
    
    // 判断全局设置是否修改
    if (basicState.hideAvatar !== defaultBasicState.hideAvatar) {
        if (basicState.hideAvatar) basicCss += `.message-avatar { display: none !important; }\n`;
        hasChanges = true;
    }
    // 头像圆角。默认 19 = 正圆，和 chat_room.css 里那条 border-radius:50% 是同一个意思，
    // 所以不改就一个字节都不生成。到顶时输出 50% 而不是 19px —— 万一以后头像尺寸变了，
    // 百分比还是正圆，19px 就变成一个莫名其妙的方角了。
    if (basicState.avatarRadius !== defaultBasicState.avatarRadius) {
        const r = basicState.avatarRadius >= 19 ? '50%' : `${basicState.avatarRadius}px`;
        basicCss += `.message-avatar { border-radius: ${r} !important; }\n`;
        hasChanges = true;
    }
    // 每条消息的时间放在哪儿。气泡工厂对每条消息画了三个槽位，默认全是 display:none
    // （chat_room.css），这里按用户选的位置放开一个。
    // ★「气泡上方」必须**同时**放开两条：时间本身，以及「整行只有时间」时被收掉的那整行。
    //   少放开第二条的话，私聊里选了这个位置等于什么都没发生（整行还是 display:none）。
    //   那一行为什么要整行收掉，见 chat_room.css 的 .meta-time-only 注释（gap:4px 的坑）。
    // ★ 另外两个位置**不能**放开 .meta-time-only：时间画在别的槽位里，
    //   meta 行仍然是空的，放开它就又把那 4px 空隙请回来了。
    // ★ 'avatar' 还要把 .message-avatar-col 从 display:contents 翻成真正的 flex 列，
    //   默认那个 contents 的用意见 chat_room.css 那段注释。
    if (basicState.timePos !== defaultBasicState.timePos) {
        if (basicState.timePos === 'above') {
            basicCss += `.message-time { display: inline !important; }\n`;
            basicCss += `.message-meta-info.meta-time-only { display: flex !important; }\n`;
        } else if (basicState.timePos === 'avatar') {
            basicCss += `.message-avatar-col { display: flex !important; }\n`;
            basicCss += `.message-time-avatar { display: block !important; }\n`;
        } else if (basicState.timePos === 'tail') {
            basicCss += `.message-time-tail { display: block !important; }\n`;
        }
        hasChanges = true;
    }
    // 时间格式只影响文字内容、生成不出 CSS，但仍要让 hasChanges 为真 ——
    // 否则整个自动生成区块（连同存着 timeFormat 的 META 注释）会被下面那段
    // 「没改动就彻底删掉」的逻辑连锅端走，用户改的格式存不下来。
    if (basicState.timeFormat !== defaultBasicState.timeFormat) {
        hasChanges = true;
    }
    if (basicState.customFont !== defaultBasicState.customFont) {
        if (basicState.customFont) {
            basicCss += `@font-face { font-family: 'CustomBubbleFont'; src: url('${basicState.customFont}'); }\n`;
            basicCss += `.message-bubble, .narration-bubble, .voice-bubble, .transfer-card, .quoted-message { font-family: 'CustomBubbleFont' !important; }\n`;
        }
        hasChanges = true;
    }

    // ============ 顶栏 ============
    // 选择器统一钉在 #chat-room-header-default 上，不用裸 .app-header ——
    // 聊天室里有**两个** .app-header，另一个是多选态的 #chat-room-header-select
    // （只有「取消 / 选择消息 / 显示隐藏」三件套）。把昵称位置顺手改到它身上，
    // 等于用户进多选时标题莫名其妙挪了个位置。
    const hdr = basicState.header || defaultBasicState.header;
    const hdrDef = defaultBasicState.header;
    if (hdr.namePos !== hdrDef.namePos) {
        // ★ 聊天室顶栏的默认**不是**居中。components.css 那套 absolute 居中被
        //   chat_room.css 的 `#chat-room-header-default .title-container`
        //   （static + flex-start + flex-grow:1）整个顶掉了 —— 所以默认档是「靠左」，
        //   那一档一个字节都不生成。照 components.css 去写「复位到流里」只会是空操作。
        // 实测（无头 Chrome 量 Range 的 getBoundingClientRect，470px 宽顶栏）：
        //   默认/靠左  文字 42~76   中心 59   ← 顶栏中心是 235
        //   居中       文字 218~252 中心 235  ← 和顶栏中心重合
        //   靠右       文字 372~406          ← 紧贴按钮组左边缘 406
        if (hdr.namePos === 'center') {
            // 居中要把 absolute 那套请回来：容器本身是 flex-grow:1 占满
            // 「返回键右边 ~ 按钮组左边」这一段，在里面 align-items:center 只能居中于
            // 这一段（偏左约 22px，两侧按钮宽度不等），看着像没对齐。
            basicCss += `#chat-room-header-default .title-container {`
                + ` position: absolute !important;`
                + ` left: 50% !important;`
                + ` transform: translateX(-50%) !important;`
                + ` align-items: center !important;`
                + ` text-align: center !important;`
                + ` flex-grow: 0 !important; }\n`;
        } else if (hdr.namePos === 'right') {
            // 容器已经是 flex-grow:1 了，只要把里面的内容推到容器右边缘即可，
            // 不用动 position/margin —— 动了反而要再把 flex 那套重新拼回来。
            basicCss += `#chat-room-header-default .title-container {`
                + ` align-items: flex-end !important;`
                + ` text-align: right !important; }\n`;
        }
        hasChanges = true;
    }
    if (hdr.hideStatus !== hdrDef.hideStatus) {
        // ★ !important 是必须的：chat_room.js 进私聊时写的是 inline 的
        //   subtitle.style.display='flex'，内联样式只有 !important 压得住。
        //   群聊那边本来就被置成 none，这条叠上去无害。
        if (hdr.hideStatus) basicCss += `#chat-room-subtitle { display: none !important; }\n`;
        hasChanges = true;
    }
    if (hdr.collapseCall !== hdrDef.collapseCall) {
        // 这一项**生成不出 CSS**。真正干活的是 #chat-room-screen 上的
        // bar-collapse-call（getBarCollapseFromCss → applyBarCollapseClasses，
        // 藏/放的规则在 chat_room.css）。这里只负责让 hasChanges 为真，
        // 把存着这个开关的 META 注释留住 —— 不然下面「没改动就整块删掉」的逻辑
        // 会连 META 一起端走，用户拨的开关存不下来。和 timeFormat 同一个处境。
        hasChanges = true;
    }

    // 栏本体的底：底色和不透明度合成一条 rgba，模糊单独一条。
    // 顶栏底栏逻辑一模一样，抽成一个闭包，省得两边各写一遍再漂。
    const barSurfaceCss = (conf, def, sel) => {
        let out = '';
        if ((conf.bg || '').toUpperCase() !== def.bg.toUpperCase() || conf.opacity !== def.opacity) {
            out += `${sel} { background-color: ${hexToRgba(conf.bg, conf.opacity)} !important; }\n`;
            hasChanges = true;
        }
        if (conf.blur !== def.blur) {
            // 0 发 none，不发 blur(0px)：后者一样会让浏览器去抠一张背景快照，
            // 还会给 position:fixed 的后代造出一个新的包含块 —— 白花钱又改语义。
            const v = conf.blur > 0 ? `blur(${conf.blur}px)` : 'none';
            out += `${sel} { backdrop-filter: ${v} !important; -webkit-backdrop-filter: ${v} !important; }\n`;
            hasChanges = true;
        }
        return out;
    };
    basicCss += barSurfaceCss(hdr, hdrDef, HEADER_BAR_SELECTOR);

    // 两条栏的分割线。顶栏画下沿、底栏画上沿，别的完全一样，所以也抽一个闭包。
    // 0 发 none（而不是 0px solid）：语义更直白，也省得和别处的 border 简写打架。
    const barDividerCss = (conf, def, sel, side) => {
        if (conf.divW === def.divW
            && (conf.divC || '').toUpperCase() === def.divC.toUpperCase()) return '';
        hasChanges = true;
        return (conf.divW > 0)
            ? `${sel} { border-${side}: ${conf.divW}px solid ${conf.divC} !important; }\n`
            : `${sel} { border-${side}: none !important; }\n`;
    };
    basicCss += barDividerCss(hdr, hdrDef, HEADER_BAR_SELECTOR, 'bottom');

    // 顶栏那几个图标的颜色。这一条只管 svg，不管托着它的块（块在下面那段）。
    if ((hdr.btnC || '').toUpperCase() !== hdrDef.btnC.toUpperCase()) {
        basicCss += `${HEADER_BTN_SELECTOR} { color: ${hdr.btnC} !important; }\n`;
        // ★ 第二条不能省：返回键的 svg 是 stroke="currentColor"（跟着 color 走），
        //   但通话/菜单那两颗的描线被 chat_room.css 的
        //   `#chat-room-header-default .action-btn-group .action-btn svg { stroke: var(--btn-color) }`
        //   硬写死了，只发 color 的话是"图标填充变了、描线还是老颜色"的半吊子。
        basicCss += `#chat-room-header-default .action-btn-group .action-btn svg { stroke: ${hdr.btnC} !important; }\n`;
        hasChanges = true;
    }

    // 顶栏三块元素（返回键 / 昵称栏 / 右侧按钮组）各自一套底色+描边+弧度+内边距。
    // 和底栏那三个对象同一个路子，区别是这边多一层「块化归零」（HEADER_BLOCK_NORMALIZE）。
    for (const key of Object.keys(HEADER_BLOCK_SELECTORS)) {
        const conf = hdr[key] || hdrDef[key];
        const def = hdrDef[key];
        const sel = HEADER_BLOCK_SELECTORS[key];

        let blockCss = '';
        if ((conf.bg || '').toUpperCase() !== def.bg.toUpperCase() || conf.opacity !== def.opacity) {
            // 出厂 opacity 是 0，所以这条在用户拉起不透明度之前发出来也是全透明的，
            // 和"没改"看着一样 —— 面板的 hint 里把这事讲明了（不透明度就是总开关）。
            blockCss += ` background-color: ${hexToRgba(conf.bg, conf.opacity)} !important;`;
        }
        if (conf.radius !== def.radius) {
            blockCss += ` border-radius: ${conf.radius}px !important;`;
        }
        if (conf.strokeW !== def.strokeW || (conf.strokeC || '').toUpperCase() !== def.strokeC.toUpperCase()) {
            blockCss += (conf.strokeW > 0)
                ? ` border: ${conf.strokeW}px solid ${conf.strokeC} !important;`
                : ` border: none !important;`;
        }
        if (conf.pad !== def.pad) {
            blockCss += ` padding: ${conf.pad}px !important;`;
        }
        // 昵称栏专属：块占「返回键右边 ~ 按钮组左边」那段空档的几成。
        // ★ flex-basis 必须压成 0：留着 auto 的话基准是文字自身宽度、grow 分的是
        //   "文字之外剩下的"，百分比就不成百分比了（短昵称和长昵称算出的块宽不一样）。
        // ★ 居中档不发这条：那一档走的是 absolute（见上面 namePos 那段），
        //   flex-grow 对 absolute 的元素没有意义，发出来是条死规则。面板上那一行
        //   也会在居中档收起来（syncConditionalRows）。
        if (key === 'title' && hdr.namePos !== 'center' && conf.widthPct !== def.widthPct) {
            blockCss += ` flex-basis: 0 !important; flex-grow: ${conf.widthPct / 100} !important;`;
        }
        if (!blockCss) continue;

        // 真的长出块了才归零那套"为裸图标准备"的几何，理由见 HEADER_BLOCK_NORMALIZE。
        const boxed = conf.opacity > def.opacity || conf.strokeW > 0 || conf.pad > 0;
        const norm = boxed ? (HEADER_BLOCK_NORMALIZE[key] || '') : '';
        basicCss += `${sel} {${norm}${blockCss} }\n`;

        // 按钮组成块之后，把里面那颗按钮摆成正方形。
        // ★ 它在 chat_room.css 里是 24×30 的**长方形**，所以「收纳通话」只剩一颗按钮时，
        //   组的盒子是 (24+2p)×(30+2p)，弧度拉满也只能是个胶囊，拼不出正圆 ——
        //   用户就是撞上了这个。取两边的大值 30 摆成 30×30：收纳后组是正方形（弧度到顶
        //   即正圆），两颗都在时是规整的胶囊。取大值而不是取小值，是为了让热区变大不变小。
        if (key === 'group' && boxed) {
            basicCss += `#chat-room-header-default .action-btn-group .action-btn`
                + ` { width: 30px !important; height: 30px !important; }\n`;
        }
        hasChanges = true;
    }

    // ============ 底栏 ============
    const ftr = basicState.footer || defaultBasicState.footer;
    const ftrDef = defaultBasicState.footer;
    basicCss += barSurfaceCss(ftr, ftrDef, FOOTER_BAR_SELECTOR);
    basicCss += barDividerCss(ftr, ftrDef, FOOTER_BAR_SELECTOR, 'top');
    if (ftr.collapseToolbar !== ftrDef.collapseToolbar) {
        // 同 collapseCall：生成不出 CSS，只把 META 留住，干活的是 bar-collapse-toolbar。
        hasChanges = true;
    }
    if (ftr.collapseReply !== ftrDef.collapseReply) {
        // 同上，干活的是 bar-collapse-reply（把 #get-reply-btn 搬进输入框内部右侧，
        // 只在输入框有焦点时露出来）。几何写死在 chat_room.css 的收纳段。
        hasChanges = true;
    }
    if (ftr.hideSend !== ftrDef.hideSend) {
        // 藏了照样能发：回车走的是 chat_room.js 里 #message-input 的 keydown 分支，
        // 和这颗按钮的 click/touchend 是三条各自独立的通道。
        if (ftr.hideSend) basicCss += `#send-message-btn { display: none !important; }\n`;
        hasChanges = true;
    }
    // 工具栏那排图标的颜色。只要重声明 chat_room.css 开头那个 `--bar-icon-color`，
    // 6 颗工具栏按钮 + 输入栏那颗 "+" 一次全覆盖，不用逐个点名（顶栏的 btnC 做不到
    // 这点，所以那边是一长串选择器）。
    // ★ **不要**顺手把 `--bar-icon-stroke`（线宽）也做成旋钮：6 颗里只有语音和钱包
    //   是线型，另外 4 颗面型的粗细画死在路径里 —— 调了就是 2 颗变粗、整排粗细不一致。
    //   曾经做过，用户实测后要求删掉。
    // ★ 选择器写 `#chat-room-screen`，scopeBubbleCss 会把它**整体替换**成
    //   `#chat-room-screen.chat-active-xx.chat-active-xx`（不是加前缀，见 bubble_css_scope.js
    //   的 scopeSelector），所以变量正好落在声明它的那个元素上、后代全能读到。
    if ((ftr.btnC || '').toUpperCase() !== ftrDef.btnC.toUpperCase()) {
        basicCss += `#chat-room-screen { --bar-icon-color: ${ftr.btnC} !important; }\n`;
        hasChanges = true;
    }
    for (const key of Object.keys(FOOTER_SELECTORS)) {
        const conf = ftr[key] || ftrDef[key];
        const def = ftrDef[key];
        const sel = FOOTER_SELECTORS[key];

        // 底色单独一条。★ 这里曾经挂 `:not(:disabled)`，为的是给 chat_room.css 那条
        // `.message-input-area .icon-btn:disabled { background-color:#cccccc }` 让路
        // ——「正在生成」时按钮变灰是唯一的进度反馈，当时不躲开就等于把它抹掉。
        // 现在 disabled 改成了**整颗变淡**（那边是 `filter: opacity(.45)`，压根不碰底色），
        // 所以这里必须**不挂**：继续躲着的话，生成那几秒按钮会掉回
        // var(--primary-color) 的默认蓝，用户自定义的颜色当场失效几秒再跳回来 ——
        // 而「禁用时固定是灰的、跟自定义样式不搭」正是用户要求改掉的。
        if ((conf.bg || '').toUpperCase() !== def.bg.toUpperCase()) {
            // .message-input-area .icon-btn 用的是 background 简写，这里只改 background-color；
            // 简写剩下的部分（没有渐变/图片）不受影响。
            basicCss += `${sel} { background-color: ${conf.bg} !important; }\n`;
            hasChanges = true;
        }

        // 文字/图标色。三个对象各有各的落点：
        //   send  → "发送"二字
        //   reply → 那颗 svg（chat_room.css 给它 `fill: currentColor`，所以改 color 就够）
        //   input → 用户打进去的字
        // 同样不挂 :not(:disabled) —— 变淡是整颗一起淡（filter），没人需要让路。
        if ((conf.color || '').toUpperCase() !== (def.color || '').toUpperCase()) {
            basicCss += `${sel} { color: ${conf.color} !important; }\n`;
            // 输入框额外补 placeholder：浏览器给的默认灰在深色输入框上直接看不见，
            // 而「深色底看不清」正是这组旋钮要解决的问题。opacity 压到 0.55 是为了
            // 跟用户真打进去的字拉开层次，不然提示文字和正文一个样。
            if (key === 'input') {
                basicCss += `${sel}::placeholder { color: ${conf.color} !important; opacity: 0.55 !important; }\n`;
            }
            hasChanges = true;
        }

        // 弧度和描边反过来，连 disabled 态一起改 —— 变淡只该整颗压低不透明度，
        // 不该把形状也变回去。
        let shapeCss = '';
        if (conf.radius !== def.radius) {
            shapeCss += ` border-radius: ${conf.radius}px !important;`;
        }
        if (conf.strokeW !== def.strokeW || (conf.strokeC || '').toUpperCase() !== def.strokeC.toUpperCase()) {
            shapeCss += (conf.strokeW > 0)
                ? ` border: ${conf.strokeW}px solid ${conf.strokeC} !important;`
                : ` border: none !important;`;
        }
        if (shapeCss) {
            basicCss += `${sel} {${shapeCss} }\n`;
            hasChanges = true;
        }
    }

    // 遍历所有气泡类型，仅当属性与默认值不同时才生成代码
    for (const [typeKey, conf] of Object.entries(basicState.styles)) {
        if (typeKey.startsWith('voice_')) continue;

        const isNarration = typeKey.startsWith('narration');
        // 中立那四类的键名本来就不带后缀，split('_')[0] 原样返回，所以这里不用特判
        const isNeutral = NEUTRAL_TYPES.has(typeKey);
        const baseType = isNarration ? 'narration' : typeKey.split('_')[0];
        const sel = classSelectorsMap[baseType];
        if(!sel) continue;

        // 旁白的「我方」是用户自己在"+"面板发的剧情旁白（.narration-mine），
        // 「对方」是 AI 在线下模式/通话里写的（:not(.narration-mine)）。
        // 下面主规则、圆角拼接、描边去内侧边三处都拿这一个 nwSelf 拼选择器 ——
        // 分头硬写过一次，结果是调我方圆角会把对方的拼接规则一起盖掉。
        const nwSelf = !isNarration ? ''
            : (typeKey === 'narration_sent'
                ? '.message-wrapper.narration-wrapper.narration-mine'
                : '.message-wrapper.narration-wrapper:not(.narration-mine)');

        // 我方 / 对方那半边的 class。★ 中立那四类切出来是 undefined ——
        // 所以凡是用到它的地方都必须先排除 isNeutral（和 isNarration），
        // 否则会生成 `.message-wrapper.undefined …` 这种永不命中的选择器，
        // 症状是面板上调得动、预览和聊天里都没反应。
        // 下面三处用它：主规则的 ruleSel、伪元素智能染色、描边补偿。
        const sideClass = typeKey.split('_')[1] === 'recv' ? 'received' : typeKey.split('_')[1];

        let ruleSel = '';
        if (isNeutral) {
            // 没有我方/对方之分，直接用 class 本身。
            // ★ 不能走下面那条分支：那里要拼 sideClass，中立键是 undefined（见上）。
            ruleSel = sel;
        } else if (isNarration) {
            ruleSel = `${nwSelf} ${sel}`;
        } else {
            ruleSel = sel.split(',').map(s => {
                const sTrim = s.trim();
                return `.message-wrapper.${sideClass} ${sTrim}, ${sTrim}.${sideClass}`;
            }).join(', ');
        }

        const defaultConf = defaultBasicState.styles[typeKey];
        let typeCss = '';
        let isTypeChanged = false;

        // 1. 颜色与透明度对比
        if (conf.bg.toUpperCase() !== defaultConf.bg.toUpperCase() || conf.opacity !== defaultConf.opacity) {
            const bg = hexToRgba(conf.bg, conf.opacity);
            typeCss += ` background-color: ${bg} !important;`;
            isTypeChanged = true;
            hasChanges = true;
            
            // 伪元素智能染色：用户自己手写的尖角 / 小三角（::before / ::after）
            // 跟着气泡底色一起染，不然调完底色尖角还是旧的。
            // ★ 这里读的是**用户那半边**（拆两个框之后用户框里只剩手写内容）——
            //   正好是想要的：以前连自动生成的区块一起扫，纯属浪费（生成块里
            //   从来不写伪元素），还得指望正则别误伤自己刚生成的东西。
            //   拆文件后 generateCssFromState 已经不在 setupBubblePresets 的闭包里，
            //   拿不到那个缓存的 cssInput 变量，直接走 _userCssEl()（css_io.js，
            //   指的就是同一个 #global-bubble-custom-css）。
            const _userCss = _userCssEl();
            if (baseType === 'normal' && _userCss && _userCss.value) {
                const customCss = _userCss.value;
                const pseudoRegex = new RegExp(`(?:message-bubble[^:{]*${sideClass}|${sideClass}[^:{]*message-bubble)::(after|before)[^:{]*\\{([^}]+)\\}`, 'ig');
                
                let pseudoMatch;
                while ((pseudoMatch = pseudoRegex.exec(customCss)) !== null) {
                    const pseudoType = pseudoMatch[1];
                    const pseudoRules = pseudoMatch[2];
                    const normalBubbleSel = `.message-wrapper.${sideClass} .message-bubble, .message-bubble.${sideClass}`;
                    const pseudoSelectors = normalBubbleSel.split(',').map(s => `#chat-room-screen ${s.trim()}::${pseudoType}`).join(', ');

                    const borderRegex = /border-(left|right|top|bottom)(?:-color)?\s*:\s*([^;!]+)/ig;
                    let borderMatch;
                    while ((borderMatch = borderRegex.exec(pseudoRules)) !== null) {
                        if (!borderMatch[2].includes('transparent')) basicCss += `${pseudoSelectors} { border-${borderMatch[1]}-color: ${bg} !important; }\n`;
                    }

                    const bgRegex = /(?:^|[^\w-])background(?:-color)?\s*:\s*([^;!]+)/ig;
                    let bgMatch;
                    while ((bgMatch = bgRegex.exec(pseudoRules)) !== null) {
                        if (!bgMatch[1].includes('transparent') && !bgMatch[1].includes('url')) basicCss += `${pseudoSelectors} { background-color: ${bg} !important; }\n`;
                    }
                }
            }
        }

        // 2. 毛玻璃对比
        if (conf.blur !== defaultConf.blur) {
            const blur = conf.blur > 0 ? `blur(${conf.blur}px)` : 'none';
            typeCss += ` backdrop-filter: ${blur} !important; -webkit-backdrop-filter: ${blur} !important;`;
            isTypeChanged = true;
            hasChanges = true;
        }

        // 3. 圆角对比
        if (conf.radius !== defaultConf.radius) {
            typeCss += ` border-radius: ${conf.radius}px !important;`;
            isTypeChanged = true;
            hasChanges = true;

            // 旁白是「连续多条拼成一张大卡片」的：chat_room.css 用 :has(+...) / +
            // 把相邻两条之间的圆角和边框压平。上面这句 border-radius 带 !important
            // 且生成得更晚，会把那几条压平规则全部盖掉 —— 表现就是用户一调圆角，
            // 大卡片碎成一堆各自带圆角的小气泡。
            // 所以这里必须把拼接规则按用户的新半径重新生成一遍：
            // 首条只圆上两角、末条只圆下两角、中间四角全平。
            if (isNarration) {
                // ★ 只和**同类**拼接：AI 旁白是 :not(.narration-mine)，用户自己发的
                //   剧情旁白是 .narration-mine。分组方式必须和 chat_room.css 那几条
                //   一模一样，否则"默认样式下谁跟谁连"和"自定义之后谁跟谁连"会分叉。
                //   两类各有自己的圆角，所以这里只生成 nwSelf 这一类 —— 早先是一次把
                //   两类都按同一个 conf.radius 生成，拆开之后那样会让后遍历到的那类
                //   把前一类刚生成的拼接规则按错误半径重写一遍。
                const r = `${conf.radius}px`;
                const nw = nwSelf;
                // 后面还有同类旁白 → 我不是最后一条 → 底部两角压平
                basicCss += `${nw}:has(+ ${nw}) ${sel} {`
                    + ` border-bottom-left-radius: 0 !important;`
                    + ` border-bottom-right-radius: 0 !important;`
                    + ` border-top-left-radius: ${r} !important;`
                    + ` border-top-right-radius: ${r} !important; }\n`;
                // 前面还有同类旁白 → 我不是第一条 → 顶部两角压平
                basicCss += `${nw} + ${nw} ${sel} {`
                    + ` border-top-left-radius: 0 !important;`
                    + ` border-top-right-radius: 0 !important; }\n`;
                // 既有前也有后 → 中间条 → 四角全平
                // （上面两条已经能推出这个结果，但显式写一遍防止将来谁改动其中一条时破功）
                basicCss += `${nw} + ${nw}:has(+ ${nw}) ${sel} {`
                    + ` border-radius: 0 !important; }\n`;
            }
        }

        // 4. 字号对比
        if (conf.fontSize !== defaultConf.fontSize) {
            typeCss += ` font-size: ${conf.fontSize}px !important;`;
            isTypeChanged = true;
            hasChanges = true;
        }

        // 5. 字体颜色对比
        if (conf.fontColor.toUpperCase() !== defaultConf.fontColor.toUpperCase()) {
            typeCss += ` color: ${conf.fontColor} !important;`;
            isTypeChanged = true;
            hasChanges = true;
        }

        // 6. 描边设置对比
        if (conf.strokeW !== defaultConf.strokeW || conf.strokeC.toUpperCase() !== defaultConf.strokeC.toUpperCase() || JSON.stringify(conf.strokeSides) !== JSON.stringify(defaultConf.strokeSides)) {
            isTypeChanged = true;
            hasChanges = true;
            const sides = conf.strokeSides ||[];
            if (conf.strokeW > 0) {
                if (sides.length === 4) {
                    typeCss += ` border: ${conf.strokeW}px solid ${conf.strokeC} !important;`;
                } else if (sides.length > 0) {['top', 'right', 'bottom', 'left'].forEach(side => {
                        if (sides.includes(side)) {
                            typeCss += ` border-${side}: ${conf.strokeW}px solid ${conf.strokeC} !important;`;
                        } else {
                            typeCss += ` border-${side}: none !important;`;
                        }
                    });
                } else {
                    typeCss += ` border: none !important;`;
                }
            } else {
                typeCss += ` border: none !important;`;
            }

            // 描边补偿：reset.css 给 * 置了 border-box，所以描边是**从正文可用宽里扣的**
            // —— 实测 375px 宽的屏上 1px 描边就让每行少一个字（14 → 13），右边空出一截
            // （用户原话「每行就少了一个字，导致右边很空」）。把水平方向实际占掉的
            // 像素数写进 --bub-stroke-x，chat_room.css 里 .message-content-col 的 70%
            // 和 .message-bubble 的 260px 两处 max-width 都加它，于是不管哪条在夹人，
            // 正文宽都和「没描边」时逐像素相同。
            // ★ 只有普通气泡那一族吃这碗饭：旁白是全宽卡片（压根不在 .message-content-col
            //   里，自己 max-width:none），引用画在气泡**内部**，转账/图片各有更小的上限
            //   —— 给它们补也补不到正文宽上去。
            // ★ 变量设在**内容列**（气泡的祖先，靠继承传给气泡），并用 :has() 限定
            //   「这条消息的气泡正是这一类」。一条消息只有一颗气泡，所以不会串到
            //   别的类型/另一侧去；没描边的消息列宽一个像素都不动。
            //   :has() 里那些逗号是安全的 —— scopeBubbleCss 的 splitSelectorList
            //   只按**顶层**逗号切选择器组（bubble_css_scope.js 里有 depth 计数）。
            //   ⚠️ .forum-share-card 也得算进来：它自己没有描边设置，是**刻意跟普通气泡
            //      等宽**的（chat_room.css 那段注释写了，share_card.test.cjs 也在守
            //      「两边 max-width 逐字节一致」）。漏了它，用户给气泡加描边之后
            //      卡片就比上下的气泡窄 2×描边宽、右边缘对不齐。
            // ★ 按勾选方向逐边算，不是一律 2×：只描左边就只补一边，补多了气泡会凭空变宽。
            if (baseType === 'normal') {
                const edge = (side) => (sides.length === 4 || sides.includes(side)) ? conf.strokeW : 0;
                const padX = (conf.strokeW > 0 && sides.length > 0) ? edge('left') + edge('right') : 0;
                basicCss += `.message-wrapper.${sideClass} .message-content-col`
                    + `:has(.message-bubble, .voice-bubble, .forum-share-card)`
                    + ` { --bub-stroke-x: ${padX}px; }\n`;
            }

            // ★ 这里曾经硬写一条「我方旁白一律 border: none」—— 那是两类共用一套设置
            //   时用来区分谁写的。现在我方是独立的一类（narration_sent，默认 strokeW:0），
            //   描边归用户自己调，硬写会让他刚调好的我方描边当场消失。
            //   "默认不画描边"这件事由默认值 + chat_room.css 那条静态规则负责。

            // 旁白的上下描边要「只描整组的外沿」，理由和圆角那条一样：
            // 选了上+下的话，每条旁白都会各自画一条上边和一条下边，
            // 相邻两条的接缝处就叠出两条横线，横穿本该是一整张的大卡片。
            // 所以把内侧那条边去掉：不是最后一条就没有下边，不是第一条就没有上边。
            // 左右边不用管 —— 它们沿着卡片侧面连成一条，本来就是想要的效果。
            // ★ 只处理 nwSelf 这一类：两类的描边各调各的，跨类去边会误伤。
            if (isNarration && conf.strokeW > 0) {
                const nw = nwSelf;
                if (sides.length === 4 || sides.includes('bottom')) {
                    // 后面还有旁白 → 我不是最后一条 → 去掉下边
                    basicCss += `${nw}:has(+ ${nw}) ${sel} { border-bottom: none !important; }\n`;
                }
                if (sides.length === 4 || sides.includes('top')) {
                    // 前面还有旁白 → 我不是第一条 → 去掉上边
                    basicCss += `${nw} + ${nw} ${sel} { border-top: none !important; }\n`;
                }
            }
        }

        if (isTypeChanged && typeCss) {
            basicCss += `${ruleSel} {${typeCss} }\n`;
        }

        // 裸文字那两类（消息时间 / 群昵称）一旦真长出了块，补一点内边距，
        // 否则底色紧贴着字，边角弧度也拉不出形状。判据和 HEADER_BLOCK_NORMALIZE 一样：
        // 只在"看得见的块"出现时才发，光改字色不动几何（不然用户只是想把灰字调亮一点，
        // 时间戳的位置却整体挪了，会以为自己碰坏了什么）。
        // ★ 这里**绝对不能**顺手发 display —— timePos 的反解正则（见 syncBasicUiFromCss）
        //   是靠「`.message-time` 后面的花括号里有没有 display」来读回时间位置的，
        //   发了就会把「不显示」误读成「气泡上方」，一存一读位置自己就跳了。
        if (BARE_TEXT_PAD[typeKey]) {
            const boxed = conf.opacity > 0 || conf.strokeW > 0;
            if (boxed) {
                basicCss += `${ruleSel} { padding: ${BARE_TEXT_PAD[typeKey]} !important; }\n`;
                hasChanges = true;
            }
        }

        // 7. 特殊子元素颜色同步 (引用与图标)
        if (baseType === 'quote') {
            if (conf.fontColor.toUpperCase() !== defaultConf.fontColor.toUpperCase()) {
                const innerSel = ruleSel.split(',').map(s => `${s.trim()} .quoted-sender, ${s.trim()} .quoted-text, ${s.trim()} .quoted-content`).join(', ');
                basicCss += `${innerSel} { color: ${conf.fontColor} !important; }\n`;
            }
            if (conf.fontSize !== defaultConf.fontSize) {
                const senderSel = ruleSel.split(',').map(s => `${s.trim()} .quoted-sender`).join(', ');
                const textSel = ruleSel.split(',').map(s => `${s.trim()} .quoted-text, ${s.trim()} .quoted-content`).join(', ');
                basicCss += `${senderSel} { font-size: ${conf.fontSize + 1}px !important; }\n`;
                basicCss += `${textSel} { font-size: ${conf.fontSize}px !important; }\n`;
            }
        }

        // 气泡里那些图标跟着字体颜色走（语音的播放三角、转账卡的图标、折叠通话的
        // 话筒/摄像头、图片气泡的放大和识图按钮…）。
        // ★ 以前这里锁死 `baseType === 'normal'`，所以调了转账气泡的字体颜色，
        //   卡片上的图标还是旧色，半边新半边旧。现在所有类型都发。
        // ★ `fill` 必须挂 `:not([fill="none"])`：这个项目里的线型图标是
        //   `fill="none" stroke="currentColor"` 的写法，而 CSS 的优先级高过
        //   presentation attribute —— 无条件发 fill 会把空心图标**灌成一个实心色块**
        //   （原先只对普通气泡生效，所以一直没被发现）。
        //   线型图标靠下面那条 color 走 currentColor 就够了。
        // ★ 反过来**绝不能**无条件发 stroke：路径没写 stroke 时默认是 none，
        //   硬发会给实心图标（语音那个播放三角）描上一圈外框。
        // ★ 中立那四类跳过：它们是纯文字（时间 / 分割线 / 系统提示 / 群昵称），
        //   里面不可能有图标，发了就是给生成块添三行永不命中的死规则。
        if (!isNeutral && conf.fontColor.toUpperCase() !== defaultConf.fontColor.toUpperCase()) {
            const parts = ruleSel.split(',').map(s => s.trim());
            const svgSel = parts.map(s => `${s} svg`).join(', ');
            basicCss += `${svgSel} { color: ${conf.fontColor} !important; }\n`;
            const fillSel = parts.map(s => `${s} svg:not([fill="none"])`).join(', ');
            basicCss += `${fillSel} { fill: ${conf.fontColor} !important; }\n`;
        }
    }

    basicCss += `/* META:${JSON.stringify(basicState)} */\n${END_MARKER}`;

    // 生成块直接写进那个只读框，不再去用户的 textarea 里做正则手术 ——
    // 两个框一分，「哪段是生成的」就不用从文本里猜了，原先那套
    // 「有标记就原地替换、没标记就追加」的分支整段消失。
    // hasChanges 为假时清空它（出厂设置就不该留痕迹，这样
    // joinBubbleCss 拼出来的也一个字节都没有）。
    const genEl = _genCssEl();
    if (genEl) {
        genEl.textContent = hasChanges ? basicCss : '';
        const hint = document.getElementById('bubble-generated-css-hint');
        if (hint) {
            hint.textContent = hasChanges
                ? `${basicCss.split('\n').length} 行`
                : '暂无（没改过基础设置）';
        }
        // 原先这里调的是闭包里的 updatePreview（= () => refreshBubbleCssPreview()）。
        // 拆文件后直接调 refreshBubbleCssPreview（css_io.js），省掉那层别名。
        refreshBubbleCssPreview();
    }
}
