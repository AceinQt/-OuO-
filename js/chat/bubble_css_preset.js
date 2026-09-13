// --- START OF FILE bubble_css_preset.js ---
const colorThemes = {
    'white_blue': {
        name: '默认',
        received: { bg: '#FFFFFF', text: '#1D1F21' },
        sent: { bg: '#0099FF', text: '#FFFFFF' }
    }
};
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
let currentPreviewMode = 0; // 0:气泡, 1:顶部栏, 2:底部栏

// clone 出来后要强制隐藏的浮层/浮块（它们都住在 #chat-room-screen 里面）
const PREVIEW_HIDE_IDS = [
    'chat-settings-sidebar',   // 设置侧边栏
    'sticker-modal',           // 表情包面板
    'chat-expansion-panel',    // "+"扩展面板
    'multi-select-bar',        // 多选删除栏
    'chat-room-header-select', // 多选状态的顶栏
    'typing-indicator'         // "正在输入"指示器
];

// 三个预览视图。focus 决定 iframe 里滚动/裁切到哪个区域，
// 不再各自持有一份 HTML。
const previewModes = [
    { title: '预览 1/3：消息气泡 (Bubbles)', focus: 'bubbles' },
    { title: '预览 2/3：顶部栏 (Header)',    focus: 'header'  },
    { title: '预览 3/3：底部栏 (Footer & Input)', focus: 'footer' }
];

// 预览用的假 chatId。scopeBubbleCss 会把它拼进 class，所以只能用合法 class 字符。
const PREVIEW_CHAT_ID = 'preview';


function _getBubblePresets() {
    let presets = db.bubbleCssPresets ||[];
    // 兼容迁移：如果有旧版本的 "默认(白/蓝)"，统一更名为 "默认"
    let oldDefault = presets.find(p => p.name === '默认(白/蓝)');
    if (oldDefault) {
        oldDefault.name = '默认';
        _saveBubblePresets(presets);
    }
    return presets;
}

function _saveBubblePresets(arr) {
    db.bubbleCssPresets = arr ||[];
   saveGlobalKeys(['bubbleCssPresets']);
}

// 预设的保存/删除/重命名会把新 CSS 直接注入用到该预设的每个聊天的
// customBubbleCss / useCustomBubbleCss / bubbleThemeName 三个字段。
// 渲染读的是 chat.customBubbleCss 而不是预设列表，所以这三个字段必须落盘；
// 过去只保存了 bubbleCssPresets，改动仅存在内存里靠切后台的全量 saveData 兜底，
// App 被系统杀掉就会整体回退到旧 CSS，用户看到的是"刚改的外观没了"。
// 落盘口径与 saveSingleChat 一致：剥掉 history 与独立存储的记忆字段。
async function _persistChatsAfterPresetChange() {
    try {
        if (typeof dexieDB === 'undefined') return;
        const strip = (src) => {
            const o = { ...src };
            delete o.history;
            delete o.memorySummaries;
            delete o.memoryJournals;
            delete o.longTermSummaries;
            if (window.isChunkMigrated) delete o.memoryChunks;
            return o;
        };
        if (dexieDB.characters && db.characters && db.characters.length) {
            await dexieDB.characters.bulkPut(db.characters.map(strip));
        }
        if (dexieDB.groups && db.groups && db.groups.length) {
            await dexieDB.groups.bulkPut(db.groups.map(strip));
        }
    } catch (e) {
        console.error('❌ 气泡预设同步到聊天的保存失败:', e);
    }
}
// =================================== 更新预览区域核心逻辑 ===================================

// 全景气泡预览生成器：将所有的气泡都放在一个窗口里
function getDynamicBubblePreview() {
    // 【教学指南：如何自己修改这里的预览气泡？】
    // 1. `getRow(isSent, html)` 是生成一行消息的函数，isSent 为 true 表示是我方发出的。
    // 2. 所有的预览内容都在下方的 `let html = ""` 中拼接。
    // 3. 如果你想改变它们在预览里的上下顺序，直接调换 `html += ...` 代码块的位置即可。
    // 4. 如果你想删掉某个预览（比如觉得太多了），直接删掉对应的 `html += ...` 行。

    const getRow = (isSent, innerHtml) => `
        <div class="message-wrapper ${isSent ? 'sent' : 'received'}">
            <div class="message-bubble-row" ${isSent ? 'style="flex-direction: row-reverse;"' : ''}>
                <img src="${isSent ? './png/avatar_default_me.jpg' : './png/avatar_default.jpg'}" class="message-avatar avatar">
                <div class="message-content-col" ${isSent ? 'style="align-items: flex-end;"' : ''}>
                    ${innerHtml}
                </div>
            </div>
        </div>
    `;

    let html = "";

    // 1. 普通气泡
    html += getRow(false, `<div class="message-bubble received">这是一条对方发来的普通消息。</div>`);
    html += getRow(true, `<div class="message-bubble sent">这是我方回复的普通消息。</div>`);

// 2. 旁白气泡 (中立，不需要调 getRow，独立结构)
    html += `
        <div class="message-wrapper system-notification narration-wrapper">
            <div class="narration-bubble markdown-content">这是一段旁白气泡内容。</div>
        </div>
        <div class="message-wrapper system-notification narration-wrapper">
            <div class="narration-bubble markdown-content">旁白气泡不区分我方和对方。固定显示在屏幕中间位置。多个旁白气泡将连接为一整个气泡。</div>
        </div>
        <div class="message-wrapper system-notification narration-wrapper">
            <div class="narration-bubble markdown-content">旁白气泡只在【线下模式】中出现，用于描述角色的行动。</div>
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
function buildPreviewShellHtml() {
    const real = document.getElementById('chat-room-screen');
    if (!real) return '';

    const clone = real.cloneNode(true);
    // scopeBubbleCss 生成的选择器是 #chat-room-screen.chat-active-preview.chat-active-preview，
    // 这里必须挂上同名 class，否则预览里什么都不生效。
    clone.classList.add('screen', 'active', `chat-active-${PREVIEW_CHAT_ID}`);
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

    // 示例气泡塞进真实的 #message-area
    const area = clone.querySelector('#message-area');
    if (area) area.innerHTML = getDynamicBubblePreview();

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

    const shellHtml = buildPreviewShellHtml();
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

// 供侧边栏获取选项并填充
function populateChatThemeSelects() {
    const privateSel = document.getElementById('setting-theme-color');
    const groupSel = document.getElementById('setting-group-theme-color');
    
    // 【修改点】过滤掉名称为“默认”的预设，防止和顶部的自带默认发生选项重复渲染
    const optionsHtml = `<option value="default">默认</option>` + 
        _getBubblePresets().filter(p => p.name !== '默认').map(p => `<option value="preset:${p.name}">${p.name}</option>`).join('');
        
    if (privateSel) privateSel.innerHTML = optionsHtml;
    if (groupSel) groupSel.innerHTML = optionsHtml;
}
window.populateChatThemeSelects = populateChatThemeSelects;

// 渲染全局列表下拉框
window.renderGlobalBubblePresets = function() {
    const select = document.getElementById('global-bubble-preset-select');
    if (!select) return;
    const presets = _getBubblePresets();
    select.innerHTML = '<option value="">— 新建预设 —</option>';
    presets.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        select.appendChild(opt);
    });
};

function setupBubblePresets() {
    // 记录当前正在编辑的预设原始名称 (空表示全新新建)
    let currentEditingPresetOriginalName = ""; 

    const nameInput = document.getElementById('global-bubble-preset-name');
    const cssInput = document.getElementById('global-bubble-custom-css');
    const previewBox = document.getElementById('global-bubble-css-preview');
    const saveBtn = document.getElementById('global-bubble-save-btn');
    const delBtn = document.getElementById('global-bubble-delete-btn');
    const addBtn = document.getElementById('global-bubble-add-btn');

    const defaultTheme = colorThemes['white_blue'];

    const updatePreview = () => {
        updateBubbleCssPreview(previewBox, cssInput.value, false, defaultTheme);
    };
    updatePreview();

    // ================== 分栏 Tab 切换逻辑 ==================
    const tabContainer = document.getElementById('tab-view-bubbles');
    if(tabContainer) {
        const tabBtns = tabContainer.querySelectorAll('.side-tab-btn');
        const tabPanes = tabContainer.querySelectorAll('.content-pane');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                if(btn.id === 'reset-basic-css-btn') return; 
                e.preventDefault(); e.stopPropagation(); 
                tabBtns.forEach(b => b.classList.remove('active'));
                tabPanes.forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                const targetId = btn.getAttribute('data-pane'); 
                const targetPane = document.getElementById(targetId);
                if(targetPane) targetPane.classList.add('active');
            });
        });
    }

    // ================== 进阶基础 UI 数据管理与 CSS 生成 ==================
    const defaultBasicState = {
        hideAvatar: false, customFont: '', 
        styles: {
            normal_sent:   { bg:'#0099FF', fontSize:16, fontColor:'#FFFFFF', opacity:1, blur:0, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
            normal_received:   { bg:'#FFFFFF', fontSize:16, fontColor:'#333333', opacity:1, blur:0, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
            narration:     { bg:'#FFFFFF', fontSize:15, fontColor:'#555555', opacity:0.8, blur:0, strokeW:3, strokeC:'#0099FF', radius:6, strokeSides:['left'] },
            voice_sent:    { bg:'#0099FF', fontSize:14, fontColor:'#FFFFFF', opacity:1, blur:5, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
            voice_received:    { bg:'#FFFFFF', fontSize:14, fontColor:'#333333', opacity:1, blur:5, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
            transfer_sent: { bg:'#FF9900', fontSize:14, fontColor:'#FFFFFF', opacity:1, blur:0, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
            transfer_received: { bg:'#FF9900', fontSize:14, fontColor:'#FFFFFF', opacity:1, blur:0, strokeW:0, strokeC:'#000000', radius:8, strokeSides:[] },
            
            quote_sent:    { bg:'#FFFFFF', fontSize:13, fontColor:'#FFFFFF', opacity:0.1, blur:0, strokeW:3, strokeC:'#FFFFFF', radius:8, strokeSides: ['left'] },
            quote_received:    { bg:'#000000', fontSize:13, fontColor:'#555555', opacity:0.04, blur:0, strokeW:3, strokeC:'#0099FF', radius:8, strokeSides:['left'] }
        }
    };

    let basicState = JSON.parse(JSON.stringify(defaultBasicState));
    let currentSelectType = 'normal_sent';
    
    // 把 .voice-bubble 并入 normal，让它们共享同一套样式！
    const classSelectorsMap = {
        'normal': '.message-bubble, .voice-bubble', 
        'narration': '.narration-bubble', 
        'transfer': '.transfer-card', 
        'quote': '.quoted-message'
    };

    const START_MARKER = "/* --- 自动生成：基础外观开始 (请勿在此区块内手写) --- */";
    const END_MARKER = "/* --- 自动生成：基础外观结束 --- */";

    function hexToRgba(hex, alpha) {
        if (!hex) return 'transparent';
        if (hex.startsWith('rgb')) return hex;
        let r = 0, g = 0, b = 0;
        if (hex.length === 7) { r = parseInt(hex.substring(1,3), 16); g = parseInt(hex.substring(3,5), 16); b = parseInt(hex.substring(5,7), 16); }
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function generateCssFromState() {
        let basicCss = `${START_MARKER}\n/* META:${JSON.stringify(basicState)} */\n`;
        let hasChanges = false; // 核心标记：记录是否真的修改了基础样式
        
        // 判断全局设置是否修改
        if (basicState.hideAvatar !== defaultBasicState.hideAvatar) { 
            if (basicState.hideAvatar) basicCss += `.message-avatar { display: none !important; }\n`; 
            hasChanges = true; 
        }
        if (basicState.customFont !== defaultBasicState.customFont) {
            if (basicState.customFont) {
                basicCss += `@font-face { font-family: 'CustomBubbleFont'; src: url('${basicState.customFont}'); }\n`;
                basicCss += `.message-bubble, .narration-bubble, .voice-bubble, .transfer-card, .quoted-message { font-family: 'CustomBubbleFont' !important; }\n`;
            }
            hasChanges = true;
        }

        // 遍历所有气泡类型，仅当属性与默认值不同时才生成代码
        for (const [typeKey, conf] of Object.entries(basicState.styles)) {
            if (typeKey.startsWith('voice_')) continue;

            const isNarration = typeKey === 'narration';
            const baseType = isNarration ? 'narration' : typeKey.split('_')[0];
            const sel = classSelectorsMap[baseType];
            if(!sel) continue;
            
            let ruleSel = '';
            if (isNarration) {
                ruleSel = `.message-wrapper.narration-wrapper ${sel}`;
            } else {
                const sideClass = typeKey.split('_')[1] === 'recv' ? 'received' : typeKey.split('_')[1];
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
                
                // 伪元素智能染色
                if (baseType === 'normal' && cssInput && cssInput.value) {
                    const customCss = cssInput.value;
                    const sideClass = typeKey.split('_')[1] === 'recv' ? 'received' : typeKey.split('_')[1];
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
                    const nw = '.message-wrapper.narration-wrapper';
                    const r = `${conf.radius}px`;
                    // 后面还有旁白 → 我不是最后一条 → 底部两角压平
                    basicCss += `${nw}:has(+ ${nw}) ${sel} {`
                        + ` border-bottom-left-radius: 0 !important;`
                        + ` border-bottom-right-radius: 0 !important;`
                        + ` border-top-left-radius: ${r} !important;`
                        + ` border-top-right-radius: ${r} !important; }\n`;
                    // 前面还有旁白 → 我不是第一条 → 顶部两角压平
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

                // 旁白的上下描边同样要「只描整组的外沿」，理由和圆角那条一样：
                // 选了上+下的话，每条旁白都会各自画一条上边和一条下边，
                // 相邻两条的接缝处就叠出两条横线，横穿本该是一整张的大卡片。
                // 所以把内侧那条边去掉：不是最后一条就没有下边，不是第一条就没有上边。
                // 左右边不用管 —— 它们沿着卡片侧面连成一条，本来就是想要的效果。
                if (isNarration && conf.strokeW > 0) {
                    const nw = '.message-wrapper.narration-wrapper';
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

            if (baseType === 'normal' && conf.fontColor.toUpperCase() !== defaultConf.fontColor.toUpperCase()) {
                const svgSel = ruleSel.split(',').map(s => `${s.trim()} svg`).join(', ');
                basicCss += `${svgSel} { color: ${conf.fontColor} !important; fill: ${conf.fontColor} !important; }\n`;
            }
        }

        basicCss += `${END_MARKER}`;
        
        if (cssInput) {
            let currentCss = cssInput.value;
            const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}\\n?`);

            if (!hasChanges) {
                // 【核心逻辑】：如果没有任何改动，彻底删掉整个基础生成区块！不留一丝痕迹！
                if (regex.test(currentCss)) {
                    cssInput.value = currentCss.replace(regex, '').trim() + (currentCss.replace(regex, '').trim() ? '\n' : '');
                }
            } else {
                if (regex.test(currentCss)) {
                    cssInput.value = currentCss.replace(regex, basicCss + '\n');
                } else {
                    if (currentCss.trim() !== '' && !currentCss.endsWith('\n')) currentCss += '\n\n';
                    else if (currentCss.trim() !== '') currentCss += '\n';
                    cssInput.value = currentCss + basicCss + '\n';
                }
            }
            updatePreview();
        }
    }

    function updateUIFromState() {
        document.getElementById('setting-hide-avatar').checked = basicState.hideAvatar;
        document.getElementById('setting-custom-font').value = basicState.customFont;
        const typeConf = basicState.styles[currentSelectType];
        
        // 色值同步
        document.getElementById('setting-bg').value = typeConf.bg;
        document.getElementById('setting-bg-text').value = typeConf.bg.toUpperCase();
        document.getElementById('setting-fontcolor').value = typeConf.fontColor;
        document.getElementById('setting-fontcolor-text').value = typeConf.fontColor.toUpperCase();
        document.getElementById('setting-stroke-c').value = typeConf.strokeC;
        document.getElementById('setting-stroke-c-text').value = typeConf.strokeC.toUpperCase();

        // 局部滑块数值与文本显示同步
        const props =['fontsize', 'opacity', 'blur', 'stroke-w', 'radius'];
        const stateKeys =['fontSize', 'opacity', 'blur', 'strokeW', 'radius'];
        
        props.forEach((prop, index) => {
            const inputEl = document.getElementById(`setting-${prop}`);
            const textEl = document.getElementById(`val-${prop}`);
            if (inputEl && textEl) {
                inputEl.value = typeConf[stateKeys[index]];
                textEl.textContent = typeConf[stateKeys[index]];
            }
        });
        const sides = typeConf.strokeSides ||[];
        document.querySelectorAll('.stroke-side-cb').forEach(cb => {
            cb.checked = sides.includes(cb.value);
        });
    }

function syncBasicUiFromCss(css) {
        if (!css) { basicState = JSON.parse(JSON.stringify(defaultBasicState)); } 
        else {
            const metaMatch = css.match(/\/\* META:(.+?) \*\//);
            let parsedFromMeta = false;
            if (metaMatch && metaMatch[1]) {
                try {
                    const parsed = JSON.parse(metaMatch[1]);
                    if (parsed.styles && parsed.styles.narration_sent) {
                        parsed.styles.narration = parsed.styles.narration_sent;
                        delete parsed.styles.narration_sent; delete parsed.styles.narration_received;
                    }

                    // 【核心修复】使用深度合并，坚决防止 defaultBasicState 里的默认属性被意外覆盖为 undefined
                    basicState = JSON.parse(JSON.stringify(defaultBasicState));
                    if (parsed.hideAvatar !== undefined) basicState.hideAvatar = parsed.hideAvatar;
                    if (parsed.customFont !== undefined) basicState.customFont = parsed.customFont;
                    if (parsed.marginY !== undefined) basicState.marginY = parsed.marginY;
                    if (parsed.marginX !== undefined) basicState.marginX = parsed.marginX;
                    
                    if (parsed.styles) {
                        for (const key in parsed.styles) {
                            if (basicState.styles[key]) {
                                basicState.styles[key] = { ...basicState.styles[key], ...parsed.styles[key] };
                            }
                        }
                    }
                    parsedFromMeta = true;
                } catch(e) { console.error('解析META配置失败', e); }
            }
            
            // ======== 终极进阶版：支持基类提取、分段合并读取与子元素防误伤 ========
            if (!parsedFromMeta) {
                basicState = JSON.parse(JSON.stringify(defaultBasicState));
                
                function extractColorToHexAndAlpha(colorStr) {
                    colorStr = colorStr.trim().toLowerCase();
                    if (colorStr.startsWith('rgba')) {
                        let m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                        if (m) {
                            let r = parseInt(m[1]).toString(16).padStart(2, '0');
                            let g = parseInt(m[2]).toString(16).padStart(2, '0');
                            let b = parseInt(m[3]).toString(16).padStart(2, '0');
                            let a = m[4] !== undefined ? parseFloat(m[4]) : 1;
                            return { hex: `#${r}${g}${b}`.toUpperCase(), alpha: a };
                        }
                    } else if (colorStr.startsWith('rgb')) {
                        let m = colorStr.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                        if (m) {
                            let r = parseInt(m[1]).toString(16).padStart(2, '0');
                            let g = parseInt(m[2]).toString(16).padStart(2, '0');
                            let b = parseInt(m[3]).toString(16).padStart(2, '0');
                            return { hex: `#${r}${g}${b}`.toUpperCase(), alpha: 1 };
                        }
                    } else if (colorStr.startsWith('#')) {
                        if (colorStr.length === 4) {
                            let r = colorStr[1], g = colorStr[2], b = colorStr[3];
                            return { hex: `#${r}${r}${g}${g}${b}${b}`.toUpperCase(), alpha: 1 };
                        } else if (colorStr.length === 9) {
                            let alpha = parseInt(colorStr.substring(7, 9), 16) / 255;
                            return { hex: colorStr.substring(0, 7).toUpperCase(), alpha: parseFloat(alpha.toFixed(2)) };
                        } else {
                            return { hex: colorStr.substring(0, 7).toUpperCase(), alpha: 1 };
                        }
                    }
                    return null;
                }

                function parseRulesToState(rules, targetStateObj) {
                    const bgMatch = rules.match(/background-color:\s*([^!;}]+)/i) || rules.match(/(?:^|[^-])background:\s*([^!;}]+)/i);
                    if (bgMatch && !bgMatch[1].includes('url')) {
                        const parsedColor = extractColorToHexAndAlpha(bgMatch[1]);
                        if (parsedColor) {
                            targetStateObj.bg = parsedColor.hex;
                            targetStateObj.opacity = parsedColor.alpha;
                        }
                    }
                    const colorMatch = rules.match(/(?:^|[^a-z-])color:\s*([^!;}]+)/i);
                    if (colorMatch) {
                        const parsedColor = extractColorToHexAndAlpha(colorMatch[1]);
                        if (parsedColor) targetStateObj.fontColor = parsedColor.hex;
                    }
                    const fontMatch = rules.match(/font-size:\s*([\d.]+)px/i);
                    if (fontMatch) targetStateObj.fontSize = parseFloat(fontMatch[1]);

                    const radiusMatch = rules.match(/border-radius:\s*([\d.]+)px/i);
                    if (radiusMatch) targetStateObj.radius = parseFloat(radiusMatch[1]);

                    const blurMatch = rules.match(/blur\(([\d.]+)px\)/i);
                    if (blurMatch) targetStateObj.blur = parseFloat(blurMatch[1]);

                    const borderMatch = rules.match(/(?:^|[^-])border:\s*([\d.]+)px\s+(?:solid\s+)?([^!;}]+)/i);
                    if (borderMatch) {
                        targetStateObj.strokeW = parseFloat(borderMatch[1]);
                        const parsedColor = extractColorToHexAndAlpha(borderMatch[2]);
                        if (parsedColor) targetStateObj.strokeC = parsedColor.hex;
                        targetStateObj.strokeSides =['top', 'right', 'bottom', 'left'];
                    } else {
                        let foundSide = false;
                        let sides =[];['top', 'right', 'bottom', 'left'].forEach(side => {
                            const regex = new RegExp(`border-${side}:\\s*([\\d.]+)px\\s+(?:solid\\s+)?([^!;}]+)`, 'i');
                            const match = rules.match(regex);
                            if (match) {
                                targetStateObj.strokeW = parseFloat(match[1]); 
                                const parsedColor = extractColorToHexAndAlpha(match[2]);
                                if (parsedColor) targetStateObj.strokeC = parsedColor.hex;
                                sides.push(side);
                                foundSide = true;
                            }
                        });
                        if (foundSide) {
                            targetStateObj.strokeSides = sides;
                        }
                    }
                }

                let baseBubbleRules = "";
                const baseRegex = /\.message-bubble(?![^{]*\.(?:sent|received))\s*(?:,[^{]*)?\{([^}]+)\}/ig;
                let baseMatch;
                while ((baseMatch = baseRegex.exec(css)) !== null) { baseBubbleRules += baseMatch[1] + ";"; }

                if (baseBubbleRules) {
                    parseRulesToState(baseBubbleRules, basicState.styles['normal_sent']);
                    parseRulesToState(baseBubbleRules, basicState.styles['normal_received']);
                }

                const classMap = {
                    'normal_sent': /\.message-bubble\.sent\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'normal_received': /\.message-bubble\.received\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'narration': /\.narration-bubble[^{]*\{([^}]+)\}/ig,
                    'voice_sent': /\.sent\s+\.voice-bubble\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'voice_received': /\.received\s+\.voice-bubble\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'transfer_sent': /\.sent(?:-transfer|\s+\.transfer-card)\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'transfer_received': /\.received(?:-transfer|\s+\.transfer-card)\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'quote_sent': /\.sent\s+\.quoted-message\s*(?:,[^{]*)?\{([^}]+)\}/ig,
                    'quote_received': /\.received\s+\.quoted-message\s*(?:,[^{]*)?\{([^}]+)\}/ig
                };

                for (const[key, regex] of Object.entries(classMap)) {
                    let match; let combinedRules = "";
                    while ((match = regex.exec(css)) !== null) { combinedRules += match[1] + ";"; }
                    if (combinedRules) {
                        parseRulesToState(combinedRules, basicState.styles[key]);
                    }
                }

                if (/(?:\.message-avatar|\.avatar|avatar)[^{]*\{[^}]*(?:display:\s*none|opacity:\s*0|visibility:\s*hidden)/i.test(css) ||
                    /\.message-info[^{]*\{[^}]*display:\s*none/i.test(css)) {
                    basicState.hideAvatar = true; 
                }
                
                const fontFaceMatch = css.match(/@font-face\s*\{[^}]*src:\s*url\(['"]([^'"]+)['"]\)/i);
                if (fontFaceMatch) { basicState.customFont = fontFaceMatch[1]; }
            }
        }
        updateUIFromState();
    }

    // ================= 绑定所有的 UI 事件 =================
    const typeSelect = document.getElementById('setting-bubble-type');
    const sideSelect = document.getElementById('setting-bubble-side');

    function updateTypeLabel() {
        const t = typeSelect.value;
        const s = sideSelect.value;
        if (t === 'narration') {
            sideSelect.disabled = true;
            currentSelectType = 'narration';
            document.getElementById('current-type-label').textContent = '旁白气泡 (中立)';
        } else {
            sideSelect.disabled = false;
            currentSelectType = `${t}_${s}`;
            const tName = typeSelect.options[typeSelect.selectedIndex].text;
            const sName = sideSelect.options[sideSelect.selectedIndex].text;
            document.getElementById('current-type-label').textContent = `${tName} - ${sName}`;
        }
        updateUIFromState();
        currentPreviewMode = 0; 
        updatePreview();
    }
    typeSelect.addEventListener('change', updateTypeLabel);
    sideSelect.addEventListener('change', updateTypeLabel);['setting-hide-avatar', 'setting-custom-font'].forEach(id => {
        document.getElementById(id).addEventListener('change', (e) => {
            if(id === 'setting-hide-avatar') basicState.hideAvatar = e.target.checked;
            if(id === 'setting-custom-font') basicState.customFont = e.target.value;
            generateCssFromState();
        });
    });

    const inputsMap = {
        'setting-bg':['bg', 'color'], 'setting-bg-text': ['bg', 'text'],
        'setting-fontsize':['fontSize', 'number'],
        'setting-fontcolor':['fontColor', 'color'], 
        'setting-fontcolor-text':['fontColor', 'text'],
        'setting-opacity':['opacity', 'number'], 'setting-blur':['blur', 'number'],
        'setting-stroke-w':['strokeW', 'number'],
        'setting-stroke-c':['strokeC', 'color'],
        'setting-stroke-c-text': ['strokeC', 'text'],
        'setting-radius':['radius', 'number']
    };

    Object.keys(inputsMap).forEach(id => {
        const el = document.getElementById(id);
        if(!el) return;
        el.addEventListener('input', (e) => {
            const[key, type] = inputsMap[id];
            let val = e.target.value;
            
            if (type === 'number') {
                val = parseFloat(val) || 0;
                const valDisplayId = id.replace('setting-', 'val-');
                const displayEl = document.getElementById(valDisplayId);
                if(displayEl) displayEl.textContent = val;
            }
            
            basicState.styles[currentSelectType][key] = val;
            if (key === 'strokeW' && val > 0 && (!basicState.styles[currentSelectType].strokeSides || basicState.styles[currentSelectType].strokeSides.length === 0)) {
                basicState.styles[currentSelectType].strokeSides =['top', 'right', 'bottom', 'left'];
                document.querySelectorAll('.stroke-side-cb').forEach(cb => cb.checked = true);
            }
            if (id === 'setting-bg') document.getElementById('setting-bg-text').value = val.toUpperCase();
            if (id === 'setting-bg-text' && /^#[0-9A-F]{6}$/i.test(val)) document.getElementById('setting-bg').value = val;

            if (id === 'setting-fontcolor') document.getElementById('setting-fontcolor-text').value = val.toUpperCase();
            if (id === 'setting-fontcolor-text' && /^#[0-9A-F]{6}$/i.test(val)) document.getElementById('setting-fontcolor').value = val;

            if (id === 'setting-stroke-c') document.getElementById('setting-stroke-c-text').value = val.toUpperCase();
            if (id === 'setting-stroke-c-text' && /^#[0-9A-F]{6}$/i.test(val)) document.getElementById('setting-stroke-c').value = val;

            generateCssFromState();
        });
    });
    
    document.querySelectorAll('.stroke-side-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const sides =[];
            document.querySelectorAll('.stroke-side-cb').forEach(box => {
                if (box.checked) sides.push(box.value);
            });
            basicState.styles[currentSelectType].strokeSides = sides;
            generateCssFromState();
        });
    });

    const resetBasicBtn = document.getElementById('reset-basic-css-btn');
    if (resetBasicBtn) {
        resetBasicBtn.addEventListener('click',async () => {
             if (!await AppUI.confirm('是否确定重置基础设置，默认气泡样式将恢复原始样式。', "系统提示", "确认", "取消")) return; 
            basicState = JSON.parse(JSON.stringify(defaultBasicState));
            updateUIFromState();
            generateCssFromState(); 
            updatePreview();
            if(window.showToast) showToast('已清除基础配置');
        });
    }

    const prevBtn = document.getElementById('preview-prev-btn');
    const nextBtn = document.getElementById('preview-next-btn');
    if (prevBtn) prevBtn.addEventListener('click', () => {
        currentPreviewMode = (currentPreviewMode - 1 + previewModes.length) % previewModes.length; updatePreview();
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
        currentPreviewMode = (currentPreviewMode + 1) % previewModes.length; updatePreview();
    });

    if(cssInput) {
        cssInput.addEventListener('input', () => {
            syncBasicUiFromCss(cssInput.value); 
            updatePreview();
        });
    }

    // ================== 生成新预设逻辑 ==================
    if (addBtn) {
        const newAddBtn = addBtn.cloneNode(true); addBtn.parentNode.replaceChild(newAddBtn, addBtn);
        newAddBtn.addEventListener('click', () => {
            const presets = _getBubblePresets();
            let newIndex = 1; let newName = `新建外观(${newIndex})`;
            while (presets.some(p => p.name === newName)) { newIndex++; newName = `新建外观(${newIndex})`; }

            basicState = JSON.parse(JSON.stringify(defaultBasicState)); updateUIFromState();
            currentEditingPresetOriginalName = ""; 
            if(nameInput) nameInput.value = newName;
            
            if(cssInput) { cssInput.value = ""; generateCssFromState(); }
            if(delBtn) delBtn.style.display = 'none';
            if(window.showToast) showToast('已准备新建模板，请配置后保存');
        });
    }

    // ================== 保存预设逻辑 ==================
    if (saveBtn) {
        const newSaveBtn = saveBtn.cloneNode(true); saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        newSaveBtn.addEventListener('click', async () => {
            const newName = nameInput ? nameInput.value.trim() : "";
            const newCss = cssInput ? cssInput.value.trim() : "";
            if (!newName) return (window.showToast && showToast('请输入预设名称'));

            if (currentEditingPresetOriginalName !== '默认' && newName === '默认') {
                return (window.showToast && showToast('系统默认预设名称不可用，请使用其他名称！'));
            }

            let presets = _getBubblePresets();
            if (currentEditingPresetOriginalName && currentEditingPresetOriginalName !== newName && currentEditingPresetOriginalName !== '默认') {
                const idx = presets.findIndex(x => x.name === currentEditingPresetOriginalName);
                if (idx >= 0) { presets[idx].name = newName; presets[idx].css = newCss; }
            } else {
                const idx = presets.findIndex(x => x.name === newName);
                if (idx >= 0) { presets[idx].css = newCss; } else { presets.push({ name: newName, css: newCss }); }
            }

            _saveBubblePresets(presets);
            currentEditingPresetOriginalName = newName; 
            if(delBtn) delBtn.style.display = newName === '默认' ? 'none' : 'block';

            // 【核心修改点：应用保存到实际聊天室的逻辑】
            const updateChats = (list) => {
                let updated = false;
                list.forEach(c => {
                    // 如果正在保存的是“默认”，那么强制为使用默认预设的聊天室注入这段 CSS，使样式生效
                    if (newName === '默认') {
                        if (!c.bubbleThemeName || c.bubbleThemeName === 'default' || c.bubbleThemeName === '默认') {
                            c.customBubbleCss = newCss; 
                            c.useCustomBubbleCss = !!newCss; 
                            c.bubbleThemeName = 'default';
                            updated = true;
                            if (c.id === window.currentChatId && typeof updateCustomBubbleStyle === 'function') {
                                updateCustomBubbleStyle(c.id, newCss, c.useCustomBubbleCss);
                            }
                        }
                    } else if (c.bubbleThemeName === currentEditingPresetOriginalName || c.bubbleThemeName === newName) {
                        c.bubbleThemeName = newName; c.customBubbleCss = newCss; c.useCustomBubbleCss = !!newCss; updated = true;
                        if (c.id === window.currentChatId && typeof updateCustomBubbleStyle === 'function') updateCustomBubbleStyle(c.id, newCss, c.useCustomBubbleCss);
                    }
                });
                return updated;
            };
            let updatedP = updateChats(db.characters ||[]); let updatedG = updateChats(db.groups ||[]);
            if (updatedP || updatedG) { await saveGlobalKeys(['bubbleCssPresets']); await _persistChatsAfterPresetChange(); }

            showToast('外观保存成功！');
            if (typeof window.populateChatThemeSelects === 'function') window.populateChatThemeSelects();
        });
    }

    // ================== 删除当前预设逻辑 ==================
    if (delBtn) {
        const newDelBtn = delBtn.cloneNode(true); delBtn.parentNode.replaceChild(newDelBtn, delBtn);
        newDelBtn.addEventListener('click', async () => {
            const name = currentEditingPresetOriginalName || (nameInput ? nameInput.value : "");
            if (!name || name === '默认') return; 

            if (await AppUI.confirm(`确定删除预设 "${name}" 吗？\n所有使用此预设的聊天将恢复默认。`, '系统提示', '确定', '取消')) {
                let presets = _getBubblePresets();
                presets = presets.filter(x => x.name !== name); _saveBubblePresets(presets);

                const resetChats = (charList) => {
                    let updated = false;
                    charList.forEach(c => {
                        if (c.bubbleThemeName === name) {
                            c.bubbleThemeName = 'default'; 
                            // 【修复】恢复默认时也需要去读取一下我们的“默认”里面是不是已经配了CSS了
                            const defaultPreset = _getBubblePresets().find(x => x.name === '默认');
                            if (defaultPreset && defaultPreset.css) {
                                c.useCustomBubbleCss = true;
                                c.customBubbleCss = defaultPreset.css;
                            } else {
                                c.useCustomBubbleCss = false; 
                                c.customBubbleCss = '';
                            }
                            updated = true;
                            if (c.id === window.currentChatId && typeof updateCustomBubbleStyle === 'function') {
                                updateCustomBubbleStyle(c.id, c.customBubbleCss, c.useCustomBubbleCss);
                            }
                        }
                    });
                    return updated;
                };
                let updatedP = resetChats(db.characters ||[]); let updatedG = resetChats(db.groups ||[]);
                if (updatedP || updatedG) { await saveGlobalKeys(['bubbleCssPresets']); await _persistChatsAfterPresetChange(); }

                if(window.showToast) showToast('预设删除成功');
                if(addBtn) document.getElementById('global-bubble-add-btn').click();
                if (typeof window.populateChatThemeSelects === 'function') window.populateChatThemeSelects();
            }
        });
    }

    // ================== 管理弹窗 (默认预设机制) ==================
    function openManagePresetsModal() {
        const modal = document.getElementById('bubble-presets-modal'); const list = document.getElementById('bubble-presets-list');
        if (!modal || !list) return; list.innerHTML = '';
        
        const defaultPresetObj = { name: '默认', css: _getBubblePresets().find(p => p.name === '默认')?.css || '', isDefault: true };
        const userPresets = _getBubblePresets().filter(p => p.name !== '默认');
        const presets =[defaultPresetObj, ...userPresets];
        
        presets.forEach((p) => {
            const row = document.createElement('div'); row.className = 'list-item';
            const nameDiv = document.createElement('div'); nameDiv.className = 'list-item-title'; nameDiv.textContent = p.name;               
            const btnWrap = document.createElement('div'); btnWrap.className = 'list-item-btn';                

            const editBtn = document.createElement('button'); editBtn.className = 'btn'; editBtn.textContent = '编辑';
            editBtn.onclick = function() {
                currentEditingPresetOriginalName = p.name;
                if(nameInput) nameInput.value = p.name;
                if(cssInput) { cssInput.value = p.css; syncBasicUiFromCss(p.css); }
                if(delBtn) delBtn.style.display = p.isDefault ? 'none' : 'block';
                
                const typeEl = document.getElementById('setting-bubble-type');
                if(typeEl) typeEl.value = 'normal';
                const sideEl = document.getElementById('setting-bubble-side');
                if(sideEl) sideEl.value = 'sent';

                currentSelectType = 'normal_sent';
                const labelEl = document.getElementById('current-type-label');
                if(labelEl) labelEl.textContent = '普通气泡 - 我方';
                updateUIFromState();
                
                currentPreviewMode = 0;
                updatePreview();
                if(window.showToast) showToast(`已加载预设: ${p.name}`);
                modal.style.display = 'none'; modal.classList.remove('visible');
            };
            btnWrap.appendChild(editBtn);

            if (!p.isDefault) {
                const renameBtn = document.createElement('button'); renameBtn.className = 'btn'; renameBtn.textContent = '重命名';               
                renameBtn.onclick = async function () {
                    const newName = await AppUI.prompt('请输入新名称：', p.name, '重命名预设');
                    if (!newName || newName === p.name) return;
                    if (newName === '默认') return showToast('不能使用系统默认名称');
                    
                    const presetsAll = _getBubblePresets();
                    const realIdx = presetsAll.findIndex(x => x.name === p.name);
                    if (realIdx >= 0) { presetsAll[realIdx].name = newName; _saveBubblePresets(presetsAll); }

                    const updateChats = (charList) => {
                        let updated = false;
                        charList.forEach(c => { if (c.bubbleThemeName === p.name) { c.bubbleThemeName = newName; updated = true; } });
                        return updated;
                    };
                    let updatedP = updateChats(db.characters ||[]); let updatedG = updateChats(db.groups ||[]);
                    if (updatedP || updatedG) { await saveGlobalKeys(['bubbleCssPresets']); await _persistChatsAfterPresetChange(); }

                    openManagePresetsModal(); 
                    if (typeof window.populateChatThemeSelects === 'function') window.populateChatThemeSelects();
                    if (currentEditingPresetOriginalName === p.name) { currentEditingPresetOriginalName = newName; if(nameInput) nameInput.value = newName; }
                };

                const delListBtn = document.createElement('button'); delListBtn.className = 'btn btn-danger'; delListBtn.textContent = '删除';
                delListBtn.onclick = async function () {
                    if (!await AppUI.confirm('确定删除预设 "' + p.name + '" ?\n相关聊天将恢复默认。', "系统提示", "确认", "取消")) return;
                    
                    const presetsAll = _getBubblePresets();
                    const realIdx = presetsAll.findIndex(x => x.name === p.name);
                    if (realIdx >= 0) { presetsAll.splice(realIdx, 1); _saveBubblePresets(presetsAll); }

                    const resetChats = (charList) => {
                        let updated = false;
                        charList.forEach(c => {
                            if (c.bubbleThemeName === p.name) {
                                c.bubbleThemeName = 'default'; 
                                const defaultPreset = _getBubblePresets().find(x => x.name === '默认');
                                if (defaultPreset && defaultPreset.css) {
                                    c.useCustomBubbleCss = true;
                                    c.customBubbleCss = defaultPreset.css;
                                } else {
                                    c.useCustomBubbleCss = false; 
                                    c.customBubbleCss = ''; 
                                }
                                updated = true;
                                if (c.id === window.currentChatId && typeof updateCustomBubbleStyle === 'function') updateCustomBubbleStyle(c.id, c.customBubbleCss, c.useCustomBubbleCss);
                            }
                        });
                        return updated;
                    };
                    let updatedP = resetChats(db.characters ||[]); let updatedG = resetChats(db.groups ||[]);
                    if (updatedP || updatedG) { await saveGlobalKeys(['bubbleCssPresets']); await _persistChatsAfterPresetChange(); }

                    openManagePresetsModal(); 
                    if (typeof window.populateChatThemeSelects === 'function') window.populateChatThemeSelects();
                    if (currentEditingPresetOriginalName === p.name) document.getElementById('global-bubble-add-btn').click(); 
                };
                btnWrap.appendChild(renameBtn); btnWrap.appendChild(delListBtn);
            }
            row.appendChild(nameDiv); row.appendChild(btnWrap); list.appendChild(row);
        });
        modal.style.display = 'flex'; modal.classList.add('visible'); 
    }

    const manageBtn = document.getElementById('global-bubble-manage-btn');
    if(manageBtn) {
        const newManageBtn = manageBtn.cloneNode(true); manageBtn.parentNode.replaceChild(newManageBtn, manageBtn);
        newManageBtn.addEventListener('click', openManagePresetsModal);
    }

    const closeManageBtn = document.getElementById('close-presets-modal');
    if(closeManageBtn) closeManageBtn.addEventListener('click', () => {
        const modal = document.getElementById('bubble-presets-modal'); modal.style.display = 'none'; modal.classList.remove('visible');
    });

    const exportBtn = document.getElementById('global-bubble-export-btn');
    if (exportBtn) {
        const newExportBtn = exportBtn.cloneNode(true); exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);
        newExportBtn.addEventListener('click', () => {
            const presets = _getBubblePresets();
            if (!presets || presets.length === 0) return (window.showToast && showToast('没有可导出的预设'));
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(presets, null, 2));
            const downloadAnchorNode = document.createElement('a'); downloadAnchorNode.setAttribute("href", dataStr);
            const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, ""); downloadAnchorNode.setAttribute("download", `qchat_bubbles_${dateStr}.json`);
            document.body.appendChild(downloadAnchorNode); downloadAnchorNode.click(); downloadAnchorNode.remove();
        });
    }

    const importBtn = document.getElementById('global-bubble-import-btn');
    const importInput = document.getElementById('global-bubble-import-input');
    if (importBtn && importInput) {
        const newImportBtn = importBtn.cloneNode(true); importBtn.parentNode.replaceChild(newImportBtn, importBtn);
        newImportBtn.addEventListener('click', () => { importInput.click(); });
        
        const newImportInput = importInput.cloneNode(true); importInput.parentNode.replaceChild(newImportInput, importInput);
        newImportInput.addEventListener('change', (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const importedPresets = JSON.parse(event.target.result);
                    if (!Array.isArray(importedPresets)) throw new Error("JSON格式错误");
                    let currentPresets = _getBubblePresets(); let addedCount = 0;
                    importedPresets.forEach(p => {
                        if (p.name === '默认(白/蓝)') p.name = '默认'; // 自动兼容遗留数据
                        if (p.name && p.css) {
                            const idx = currentPresets.findIndex(x => x.name === p.name);
                            if (idx >= 0) { currentPresets[idx].css = p.css; } else { currentPresets.push(p); }
                            addedCount++;
                        }
                    });
                    _saveBubblePresets(currentPresets);
                    if (typeof window.populateChatThemeSelects === 'function') window.populateChatThemeSelects();
                    if(window.showToast) showToast(`成功导入并合并了 ${addedCount} 个预设`);
                } catch (err) {
                    if(window.showToast) showToast('导入失败：文件格式不符合要求');
                } finally { e.target.value = ''; }
            };
            reader.readAsText(file);
        });
    }

    // ================== 初始加载“默认”样式及回显机制 ==================
    const presets = _getBubblePresets();
    const defaultPreset = presets.find(p => p.name === '默认');
    
    currentEditingPresetOriginalName = '默认';
    if(nameInput) nameInput.value = '默认';
    if(delBtn) delBtn.style.display = 'none'; // 默认预设不可删除
    
    if (defaultPreset && defaultPreset.css) {
        if(cssInput) cssInput.value = defaultPreset.css;
        syncBasicUiFromCss(defaultPreset.css); 
    } else {
        if(cssInput) cssInput.value = '';
        syncBasicUiFromCss(''); 
        generateCssFromState(); 
    }
    
    const initTypeEl = document.getElementById('setting-bubble-type');
    if(initTypeEl) initTypeEl.value = 'normal';
    const initSideEl = document.getElementById('setting-bubble-side');
    if(initSideEl) initSideEl.value = 'sent';

    currentSelectType = 'normal_sent';
    const initLabelEl = document.getElementById('current-type-label');
    if(initLabelEl) initLabelEl.textContent = '普通气泡 - 我方';

    updateUIFromState();
    
    currentPreviewMode = 0;
    updatePreview();
}

// 确保页面加载完成后执行绑定
window.setupBubblePresets = setupBubblePresets;