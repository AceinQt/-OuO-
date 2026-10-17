// --- START OF FILE bubble_css/preview.js ---
// ======================================================================
// 外观页上半部分那个 200px 高的预览 iframe。
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

// =================================== 预览模板与沙盒渲染 ===================================
//
// 预览不再维护第二份 HTML —— 直接 clone index.html 里真实的 #chat-room-screen，
// 并且跑 chat_settings.js 用的同一个 scopeBubbleCss。
//
// 为什么这么改：以前预览是三份手写模板 + CSS 原样注入，实际应用是一套手写正则改写器。
// 两份结构会漂移（模板里给 .chat-input-wrapper 挂了内联 position、输入框是 disabled 的、
// 缺 #multi-select-bar 之类的兄弟节点），两条 CSS 通道语义又不同，于是「预览生效、
// 保存后不生效」是必然而不是偶发，底栏尤其明显。现在结构和改写都只有一份，
// 改 index.html 预览自动跟着变。
//
// 代价：clone 出来的东西里有一堆预览时不该出现的浮层（侧边栏、表情面板、多选栏），
// 得按 PREVIEW_HIDE_IDS 关掉；每个视图再决定滚到哪里、把哪些区域收窄。


// clone 出来后要强制隐藏的浮层/浮块（它们都住在 #chat-room-screen 里面）
const PREVIEW_HIDE_IDS = [
    'chat-settings-sidebar',   // 设置侧边栏
    'sticker-modal',           // 表情包面板
    'chat-expansion-panel',    // "+"扩展面板
    'multi-select-bar',        // 多选删除栏
    'chat-room-header-select', // 多选状态的顶栏
    'typing-indicator'         // "正在输入"指示器
];


// 预览用的假 chatId。scopeBubbleCss 会把它拼进 class，所以只能用合法 class 字符。
const PREVIEW_CHAT_ID = 'preview';


// 全景气泡预览生成器：将所有的气泡都放在一个窗口里
function getDynamicBubblePreview(timeFormat) {
    // 【教学指南：如何自己修改这里的预览气泡？】
    // 1. `getRow(isSent, html)` 是生成一行消息的函数，isSent 为 true 表示是我方发出的。
    // 2. 所有的预览内容都在下方的 `let html = ""` 中拼接。
    // 3. 如果你想改变它们在预览里的上下顺序，直接调换 `html += ...` 代码块的位置即可。
    // 4. 如果你想删掉某个预览（比如觉得太多了），直接删掉对应的 `html += ...` 行。

    // 样例时间固定挑一个能把所有占位符都试出来的时刻：2026-09-27(周日) 下午 13:05:09。
    // 分/秒故意带前导零，这样用户写 m 还是 mm 一眼看得出区别。
    const sampleTime = (typeof formatMessageTimestamp === 'function')
        ? formatMessageTimestamp(new Date(2026, 8, 27, 13, 5, 9).getTime(), timeFormat)
        : '13:05';

    // 时间分割线上的文字走的是另一套（formatSmartTime，「昨天 / 星期几 / 月日」那种），
    // **不跟** timeFormat 走 —— 所以这里写死一个样例，别拿 sampleTime 顶替，
    // 否则用户会以为改时间格式能改到分割线。
    const sampleDivider = '昨天 22:30';

    // getRow 里的三个时间槽位必须和 chat_bubble_factory.js 真实那份结构一致
    // （头像列里一个、meta 行里一个、气泡后一个），否则「消息时间」的位置在预览里
    // 拨了没反应 —— 生成的规则正是冲着这三个 class 去的，缺哪个哪个位置就是空的。
    // metaExtra：往 meta 行里额外塞东西（群聊的身份徽章 + 群昵称）。给了它就**不能**再挂
    // `meta-time-only` —— 那个 class 的语义是"这行除了时间空无一物，整行收掉"
    // （chat_room.css 里它就是 display:none），挂上去群昵称会跟着一起消失。
    // 真实的气泡工厂也是这么分的：群聊走 roleBadge+groupNickname，私聊才加 meta-time-only。
    const getRow = (isSent, innerHtml, metaExtra) => `
        <div class="message-wrapper ${isSent ? 'sent' : 'received'}">
            <div class="message-bubble-row" ${isSent ? 'style="flex-direction: row-reverse;"' : ''}>
                <div class="message-avatar-col">
                    <img src="${isSent ? './png/avatar_default_me.jpg' : './png/avatar_default.jpg'}" class="message-avatar avatar">
                    <span class="message-time-avatar">${sampleTime}</span>
                </div>
                <div class="message-content-col" ${isSent ? 'style="align-items: flex-end;"' : ''}>
                    <div class="message-meta-info${metaExtra ? '' : ' meta-time-only'}">${metaExtra || ''}<span class="message-time">${sampleTime}</span></div>
                    ${innerHtml}
                </div>
                <span class="message-time-tail">${sampleTime}</span>
            </div>
        </div>
    `;

    let html = "";

    // 0. 不属于任何气泡的那几类小字。摆在最前面是因为真实聊天里它们也多在一段的开头，
    //    而且这三样全是居中的独立一行，夹在气泡中间会把全家福切得很碎。
    //    结构照抄 chat_bubble_factory.js：
    //      时间分割线  → .message-wrapper.time-divider-wrapper > .chat-time-divider
    //      系统提示    → .message-wrapper.system-notification > .system-notification-bubble
    //      撤回提示    → 同上，但 class 是 .withdrawn-message（和系统提示同一组设置，
    //                    出厂长得一模一样，所以两个都画出来让用户看清改的是哪些）
    html += `
        <div class="message-wrapper time-divider-wrapper">
            <div class="chat-time-divider">${sampleDivider}</div>
        </div>
        <div class="message-wrapper system-notification">
            <div class="system-notification-bubble">这是系统提示（入群、改群名这类）</div>
        </div>
        <div class="message-wrapper system-notification">
            <div class="withdrawn-message">撤回提示也归「系统提示」这一组</div>
        </div>
    `;

    // 1. 普通气泡
    html += getRow(false, `<div class="message-bubble received">这是一条对方发来的普通消息。</div>`);
    html += getRow(true, `<div class="message-bubble sent">这是我方回复的普通消息。</div>`);

    // 1b. 群聊里的那一行：身份徽章 + 群昵称。私聊没有这一行（见 getRow 的 metaExtra 注释），
    //     所以单独画一条，否则选了「群昵称」在预览里根本找不到东西在变。
    html += getRow(false,
        `<div class="message-bubble received">群聊里气泡上方会多一行昵称。</div>`,
        `<span class="role-badge member">群成员</span><span class="group-nickname">群里的某人</span>`);

// 2. 旁白气泡 (固定居中，不需要调 getRow，独立结构)
//    分「对方」(AI 写的，:not(.narration-mine)) 和「我方」(用户在"+"面板发的剧情旁白，
//    .narration-mine) 两类，各有一套独立设置，所以预览里必须两种都看得见 ——
//    只画一种的话，调完另一种会以为"没生效"。
//    连体拼接只在同类之间发生，所以预览里两组之间也应当是断开的。
    html += `
        <div class="message-wrapper system-notification narration-wrapper">
            <div class="narration-bubble markdown-content">这是【对方】的旁白，由 AI 写在【线下模式】和【通话】里，用来描述角色的行动。</div>
        </div>
        <div class="message-wrapper system-notification narration-wrapper">
            <div class="narration-bubble markdown-content">旁白固定显示在屏幕中间位置。相邻的同类旁白会连接为一整个气泡。</div>
        </div>
        <div class="message-wrapper system-notification narration-wrapper narration-mine">
            <div class="narration-bubble markdown-content">这是【我方】的旁白，是我自己在"+"面板里发的【剧情旁白】，样式单独一套。</div>
        </div>
        <div class="message-wrapper system-notification narration-wrapper narration-mine">
            <div class="narration-bubble markdown-content">我方旁白默认不带描边，用来和对方的旁白一眼分开；想加也可以在左边选「我方」后自己调。</div>
        </div>
    `;

    // 4. 引用气泡
    html += getRow(false, `
        <div class="message-bubble received">
            <div class="quoted-message"><span class="quoted-sender">我：</span><p class="quoted-text">之前说的话</p></div>
            这是对方回复的引用消息。
        </div>
    `);
    html += getRow(true, `
        <div class="message-bubble sent">
            <div class="quoted-message"><span class="quoted-sender">对方：</span><p class="quoted-text">对方之前说的话</p></div>
            这是我方回复的引用消息。
        </div>
    `);

    // 5. 转账气泡
    html += getRow(false, `
        <div class="transfer-card received-transfer">
            <div class="overlay"></div>
            <div class="transfer-content">
                <p class="transfer-title">转账给你</p><p class="transfer-amount">¥50.00</p><p class="transfer-status">待查收</p>
            </div>
        </div>
    `);
    html += getRow(true, `
        <div class="transfer-card sent-transfer">
            <div class="overlay"></div>
            <div class="transfer-content">
                <p class="transfer-title">给你转账</p><p class="transfer-amount">¥100.00</p><p class="transfer-status">待查收</p>
            </div>
        </div>
    `);

    // 3. 语音气泡（结构要跟 chat_bubble_factory.js 里真实那份保持一致，
    //    否则用户在这儿调完 CSS，回到聊天页发现长得不一样）
    html += getRow(false, `
        <div class="message-bubble voice-bubble received" data-voice-state="ready">
            <button type="button" class="voice-play-btn" data-voice-state="ready" tabindex="-1">
                <svg class="vp-icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <span class="voice-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
            <span class="duration">12"</span>
        </div>
    `);
    html += getRow(true, `
        <div class="message-bubble voice-bubble sent" data-voice-state="ready">
            <button type="button" class="voice-play-btn" data-voice-state="ready" tabindex="-1">
                <svg class="vp-icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <span class="voice-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
            <span class="duration">8"</span>
        </div>
    `);
    // 只返回消息内容，外壳由 buildPreviewShellHtml 从真实 DOM clone 出来
    return html;
}

// 从 index.html 真实的 #chat-room-screen clone 一份，改成适合预览的样子。
// 关键点是：不重写结构，只做「隐藏浮层 + 填示例内容」这两件事。
// 这样以后改 index.html 的顶栏/底栏，预览自动跟着变，不会再漂移。
// timeFormat 是一路透传给示例气泡的时间模板，来源是正在编辑的那段 CSS 的 META。
// collapseFlags 同理，是那段 CSS 里的两个收纳开关。
function buildPreviewShellHtml(timeFormat, collapseFlags) {
    const real = document.getElementById('chat-room-screen');
    if (!real) return '';

    const clone = real.cloneNode(true);
    // scopeBubbleCss 生成的选择器是 #chat-room-screen.chat-active-preview.chat-active-preview，
    // 这里必须挂上同名 class，否则预览里什么都不生效。
    clone.classList.add('screen', 'active', `chat-active-${PREVIEW_CHAT_ID}`);
    // ★ clone 来源是**正开着的那个聊天**的屏幕，身上带着它自己的收纳 class。
    //   必须按正在编辑的这段 CSS 重新写一遍，否则预览显示的是"当前聊天收没收纳"，
    //   而不是"这段 CSS 存下去会长什么样" —— 顶栏的通话键、底栏的整条工具栏都会骗人。
    if (typeof applyBarCollapseClasses === 'function') {
        applyBarCollapseClasses(clone, collapseFlags);
    }

    // preview-root 是取景框用的钩子（见 updateBubbleCssPreview 里那段布局 CSS）
    clone.classList.add('preview-root');
    // 动画会让 iframe 每次重画都闪一下
    clone.classList.add('no-anim');

    // clone 出来的 id 会和主文档重名。iframe 是独立 document 所以不会真冲突，
    // 但内部 id 选择器（#sticker-bar 这类）要能命中，所以 id 一律保留。

    PREVIEW_HIDE_IDS.forEach(id => {
        const el = clone.querySelector(`#${id}`);
        if (el) el.style.setProperty('display', 'none', 'important');
    });

    // 设置侧边栏占了 clone 出来的一大半体积（几百个表单控件），预览里永远看不到，
    // 直接摘掉而不是 display:none —— 每次改一个字符都要重建一遍 iframe，省下来的是实打实的。
    const sidebar = clone.querySelector('#chat-settings-sidebar');
    if (sidebar) sidebar.remove();

    // 预览里不该出现真实数据：标题/状态换成示例文案
    const title = clone.querySelector('#chat-room-title');
    if (title) title.textContent = '聊天对象';
    const statusText = clone.querySelector('#chat-room-status-text');
    if (statusText) statusText.textContent = '在线';
    const subtitle = clone.querySelector('#chat-room-subtitle');
    if (subtitle) subtitle.style.display = 'flex';

    // 输入框：真实 DOM 里不是 disabled 的，预览也别 disable
    // （旧模板写了 disabled，用户针对 :disabled 调的样式在预览里对不上）
    const input = clone.querySelector('#message-input');
    if (input) {
        input.removeAttribute('disabled');
        input.setAttribute('value', '');
        input.setAttribute('placeholder', '输入消息...');
    }

    // 底栏两颗按钮同理：clone 取的是**当前活着的** DOM，正好在等 AI 回复时
    // #get-reply-btn 是 disabled 的（chat_ai_service.js 生成期间置的），
    // 而底栏的「颜色」生成的是 :not(:disabled) 规则 —— 不清掉这个属性，
    // 用户会看到预览里按钮是灰的、调色没反应，而且现象随有没有在生成而漂。
    clone.querySelectorAll('#send-message-btn, #get-reply-btn').forEach(btn => {
        btn.removeAttribute('disabled');
    });

    // 示例气泡塞进真实的 #message-area
    const area = clone.querySelector('#message-area');
    if (area) area.innerHTML = getDynamicBubblePreview(timeFormat);

    return clone.outerHTML;
}


// 每个预览视图额外补的一点布局 CSS。
// iframe 只有 200px 高，装不下整个聊天室，所以按视图把注意力放到对应区域：
// 看顶栏就把消息区压扁，看底栏就把底栏顶到可见处。
// 注意这些规则都不带用户 scope —— 它们是「取景框」，不该被用户 CSS 影响，
// 也不该影响用户判断自己写的样式生效没有。
// 取景框只有 200px 高，装不下「顶栏 + 一屏气泡 + 底栏」。
// 所以每个视图只留自己那一块：调气泡时不需要看见顶栏底栏（气泡全家福要占满整窗，
// 这也是旧模板的行为），调顶栏/底栏时反过来把消息区让出去。
const PREVIEW_FOCUS_CSS = {
    bubbles: `
        /* 气泡视图：把 chrome 收掉，200px 全给气泡全家福 */
        #chat-room-screen.preview-root .app-header,
        #chat-room-screen.preview-root .chat-input-wrapper { display: none !important; }
        #chat-room-screen.preview-root .message-area {
            padding-bottom: 10px !important;
            overflow-y: auto !important;
        }
    `,
    header: `
        /* 顶栏视图：只留顶栏，下面留一点消息区做背景参照 */
        #chat-room-screen.preview-root .chat-input-wrapper { display: none !important; }
        #chat-room-screen.preview-root .app-header { position: relative; z-index: 3; }
        #chat-room-screen.preview-root .message-area {
            padding-bottom: 10px !important;
            opacity: 0.35;
        }
    `,
    footer: `
        /* 底栏视图：只留底栏。它本身是 absolute bottom:0，
           顶栏收掉后把消息区淡成背景，视线落在底栏上 */
        #chat-room-screen.preview-root .app-header { display: none !important; }
        #chat-room-screen.preview-root .message-area { opacity: 0.35; }
        #chat-room-screen.preview-root .chat-input-wrapper { z-index: 60; }
        /* 「收纳 AI 回复」那一档：真机上那颗按钮只在输入框有焦点时才浮出来，
           而预览是张静态图（iframe 里连 click 都被 preventDefault 吃掉了）——
           不特殊照顾的话，用户一拨开关只看见按钮消失，看不见它搬去了哪。
           取景框里一律按"已聚焦"画。 */
        #chat-room-screen.preview-root.bar-collapse-reply #get-reply-btn {
            opacity: 1 !important;
        }
    `
};

function updateBubbleCssPreview(previewContainer, css, useDefault, theme) {
    if (!previewContainer) return;

    const innerContainer = document.getElementById('preview-inner-container');
    const titleEl = document.getElementById('preview-mode-title');
    if (!innerContainer) return;

    const mode = previewModes[currentPreviewMode] || previewModes[0];
    if (titleEl) titleEl.textContent = mode.title;

    let iframe = document.getElementById('preview-iframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'preview-iframe';
        iframe.style.width = '100%'; iframe.style.height = '100%';
        iframe.style.border = 'none'; iframe.style.borderRadius = '8px';
        iframe.style.backgroundColor = 'transparent';
        iframe.onload = () => { iframe.contentWindow.document.addEventListener('click', e => e.preventDefault()); };
        innerContainer.innerHTML = ''; innerContainer.appendChild(iframe);
    }

    const doc = iframe.contentWindow.document;
    doc.open();

    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
        // 别把上一轮生成的 custom-bubble-style-for-* 也搬进来，
        // 否则用户当前编辑的 CSS 会和某个聊天已保存的那份叠在一起
        .filter(el => !(el.id || '').startsWith('custom-bubble-style-for-'))
        .filter(el => !(el.id || '').startsWith('offline-narration-style-'))
        .map(el => el.outerHTML).join('\n');

    // 不加 !important，这样你手写的高级 CSS 可以轻松覆盖它，也能防止气泡无 CSS 时变透明
    const fallbackCss = `
        /* 强制提供底层主题色兜底 */
        .message-wrapper.sent .message-bubble, .message-wrapper.sent .voice-bubble { background-color: ${theme.sent.bg}; color: ${theme.sent.text}; }
        .message-wrapper.received .message-bubble, .message-wrapper.received .voice-bubble { background-color: ${theme.received.bg}; color: ${theme.received.text}; }
    `;

    // 【关键】用户 CSS 走的是和实际应用完全一样的改写函数，只是 chatId 换成 'preview'。
    // 这条不能改成原样注入 —— 那正是「预览生效、实际不生效」的来源。
    const rawUserCss = (!useDefault && css) ? css : '';
    const userCss = (rawUserCss && typeof scopeBubbleCss === 'function')
        ? scopeBubbleCss(rawUserCss, PREVIEW_CHAT_ID)
        : '';

    // 时间格式取自**同一段** rawUserCss 的 META，而不是编辑器里的 basicState ——
    // 预览的口径始终是"这段 CSS 存下去会长什么样"，和位置/颜色那些保持一致。
    // 两个收纳开关走同一条路（它们也生成不出 CSS，只能从 META 捞）。
    const shellHtml = buildPreviewShellHtml(
        getMessageTimeFormatFromCss(rawUserCss),
        getBarCollapseFromCss(rawUserCss)
    );
    const focusCss = PREVIEW_FOCUS_CSS[mode.focus] || '';

    doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            ${styles}
            <style>
                html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: transparent; }

                /* 预览取景框：真实聊天室是 flex 撑满手机壳，这里要塞进 200px 的小窗 */
                #chat-room-screen.preview-root {
                    position: relative !important;
                    height: 100% !important; width: 100% !important;
                    display: flex !important; flex-direction: column !important;
                    background-color: #eef2f5 !important;
                    overflow: hidden !important;
                    transform: none !important;
                    animation: none !important;
                    /* 手机壳圆角变量在这里没有意义，清掉免得底栏出现奇怪的圆角 */
                    --phone-corner-radius: 0px;
                    /* 预览里没有刘海/home 条，安全区归零，否则底栏凭空多一截留白 */
                    --safe-bottom: 0px;
                }

                #chat-room-screen.preview-root::before {
                    content: "OuO";
                    position: absolute;
                    top: 50%; left: 50%;
                    transform: translate(-50%, -50%) rotate(-35deg);
                    font-size: 120px;
                    font-weight: 600;
                    color: rgba(0, 0, 0, 0.1);
                    font-family: Arial, sans-serif;
                    letter-spacing: 10px;
                    pointer-events: none;
                    white-space: nowrap;
                    z-index: 0;
                }

                /* 消息区在真实页面里靠 padding-bottom 避开底栏，预览窗太矮要收一收 */
                #chat-room-screen.preview-root .message-area {
                    padding: 10px !important;
                    padding-bottom: 90px !important;
                }

                #chat-room-screen.preview-root .message-area::-webkit-scrollbar { width: 4px; }
                #chat-room-screen.preview-root .message-area::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }

                ${focusCss}
                ${fallbackCss}
            </style>
            <style id="user-custom-css">${userCss}</style>
        </head>
        <body>
            ${shellHtml}
        </body>
        </html>
    `);
    doc.close();
}
