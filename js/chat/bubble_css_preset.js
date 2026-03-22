// --- START OF FILE bubble_css_preset.js ---
const colorThemes = {
    'white_blue': {
        name: '默认',
        received: { bg: '#FFFFFF', text: '#1D1F21' },
        sent: { bg: '#0099FF', text: '#FFFFFF' }
    }
};
// =================================== 预览模板与沙盒渲染 ===================================
let currentPreviewMode = 0; // 0:气泡, 1:顶部栏, 2:底部栏

// 你的原生 HTML 结构模板
const previewModes =[
    {
        title: '预览 1/3：消息气泡 (Bubbles)',
        template: `
            <div id="chat-room-screen" class="screen active">
                <main class="content">
                    <div class="message-area" style="padding: 10px;">
                        <!-- 第一条接收消息 -->
                        <div class="message-wrapper received" data-sender-id="test1">
                            <div class="message-bubble-row">
                                <img src="https://i.postimg.cc/Y96LPskq/o-o-2.jpg" class="message-avatar avatar">
                                <div class="message-content-col">
                                    <div class="message-meta-info message-info"><span class="group-nickname">对方</span></div>
                                    <div class="message-bubble received">这是一条对方发来的消息，用于测试气泡。</div>
                                </div>
                            </div>
                        </div>
                        <!-- 第二条连续接收消息 (用于测试连续气泡隐藏头像) -->
                        <div class="message-wrapper received" data-sender-id="test1">
                            <div class="message-bubble-row">
                                <img src="https://i.postimg.cc/Y96LPskq/o-o-2.jpg" class="message-avatar avatar">
                                <div class="message-content-col">
                                    <div class="message-meta-info message-info"><span class="group-nickname">对方</span></div>
                                    <div class="message-bubble received">这是连续发来的第二条消息！</div>
                                </div>
                            </div>
                        </div>
                        <!-- 发送方的消息 -->
                        <div class="message-wrapper sent" data-sender-id="user_me">
                            <div class="message-bubble-row">
                                <img src="https://i.postimg.cc/GtbTnxhP/o-o-1.jpg" class="message-avatar avatar">
                                <div class="message-content-col">
                                    <div class="message-meta-info message-info"><span class="group-nickname">我</span></div>
                                    <div class="message-bubble sent">这是我方回复的消息。</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </main>
            </div>
        `
    },
    {
        title: '预览 2/3：顶部栏 (Header)',
        template: `
            <div id="chat-room-screen" class="screen active">
                <header class="app-header" id="chat-room-header-default">
                    <button class="back-btn" data-target="chat-list-screen">‹</button>
                    <div class="title-container">
                        <h1 class="title" id="chat-room-title">聊天对象</h1>
                        <div class="subtitle" id="chat-room-subtitle">
                            <div class="online-indicator"></div>
                            <span id="chat-room-status-text">在线</span>
                        </div>
                    </div>
                    <div class="action-btn-group">
                        <button class="action-btn" id="peek-btn">
                            <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path transform="scale(1.4) translate(0.5 0.5)" d="M3.654 1.328a.678.678 0 0 0-1.015-.063L1.605 2.3c-.483.484-.661 1.169-.45 1.77a17.568 17.568 0 0 0 4.168 6.608 17.569 17.569 0 0 0 6.608 4.168c.601.211 1.286.033 1.77-.45l1.034-1.034a.678.678 0 0 0-.063-1.015l-2.307-1.794a.678.678 0 0 0-.58-.122l-2.19.547a1.745 1.745 0 0 1-1.657-.459L5.482 8.062a1.745 1.745 0 0 1-.46-1.657l.548-2.19a.678.678 0 0 0-.122-.58L3.654 1.328zM1.83 1.83l.002-.001-.002.001z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
                        </button>
                        <button class="action-btn" id="chat-settings-btn">
                            <svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="1.5" rx="0.75" /><rect x="3" y="11" width="18" height="1.5" rx="0.75" /><rect x="3" y="17" width="18" height="1.5" rx="0.75" /></svg>
                        </button>
                    </div>
                </header>
            </div>
        `
    },
    {
        title: '预览 3/3：底部栏 (Footer & Input)',
        template: `
            <div id="chat-room-screen" class="screen active">
                <div class="chat-input-wrapper" style="position: absolute; bottom: 0; left: 0; width: 100%;">
                    <div id="reply-preview-bar" style="display:none;">
                        <div class="reply-preview-content">
                            <span class="reply-preview-name"></span>
                            <p class="reply-preview-text"></p>
                        </div>
                        <button id="cancel-reply-btn">×</button>
                    </div>
                    <div class="message-input-area" id="message-input-default">
                        <input type="text" id="message-input" placeholder="输入消息..." disabled>
                        <button id="send-message-btn" class="icon-btn send-btn">发送</button>
                        <button id="get-reply-btn" class="icon-btn">
                            <svg viewBox="0 0 24 24"><path d="M12,2A10,10 0 1,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 1,1 20,12A8,8 0 0,1 12,20M16.24,7.76C15.07,6.58 13.53,6 12,6V12L7.76,16.24C10.1,18.58 13.9,18.58 16.24,16.24C18.58,13.9 18.58,10.1 16.24,7.76Z" /></svg>
                        </button>
                    </div>
                    <div id="sticker-bar">
                        <button class="sticker-bar-btn" id="regenerate-btn" title="重回"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65,6.35C16.2,4.9,14.21,4,12,4A8,8,0,0,0,4,12A8,8,0,0,0,12,20C15.73,20,18.84,17.45,19.73,14H17.65C16.83,16.33,14.61,18,12,18A6,6,0,0,1,6,12A6,6,0,0,1,12,6C13.66,6,15.14,6.69,16.22,7.78L13,11H20V4L17.65,6.35Z" /></svg></button>
                        <button class="sticker-bar-btn" id="voice-message-btn"><svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" /></svg></button>
                        <button class="sticker-bar-btn" id="image-recognition-btn"><svg viewBox="0 0 24 24"><path d="M20,4H4C2.9,4,2,4.9,2,6v12c0,1.1,0.9,2,2,2h16c1.1,0,2-0.9,2-2V6C22,4.9,21.1,4,20,4z M20,18H4v-4.57l5.36-4.91l4.06,3.72l3.43-3.09L20,12.27V18z" /></svg></button>
                        <button class="sticker-bar-btn" id="photo-video-btn"><svg viewBox="0 0 24 24"><path d="M4,4H7L9,2H15L17,4H20A2,2 0 0,1 22,6V18A2,2 0 0,1 20,20H4A2,2 0 0,1 2,18V6A2,2 0 0,1 4,4M12,7A5,5 0 0,0 7,12A5,5 0 0,0 12,17A5,5 0 0,0 17,12A5,5 0 0,0 12,7M12,9A3,3 0 0,1 15,12A3,3 0 0,1 12,15A3,3 0 0,1 9,12A3,3 0 0,1 12,9Z" /></svg></button>
                        <button class="sticker-bar-btn" id="wallet-btn"><svg viewBox="0 0 24 24"><path d="M20,4H4C2.9,4,2,4.9,2,6v12c0,1.1,0.9,2,2,2h16c1.1,0,2-0.9,2-2V6C22,4.9,21.1,4,20,4z M20,8l-8,5L4,8V6l8,5l8-5V8z" /></svg></button>
                        <button class="sticker-bar-btn" id="sticker-toggle-btn"><svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" /></svg></button>
                        <button class="sticker-bar-btn" id="placeholder-plus-btn"><svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" /></svg></button>
                    </div>
                </div>
            </div>
        `
    }
];

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
                <img src="https://i.postimg.cc/${isSent ? 'GtbTnxhP/o-o-1.jpg' : 'Y96LPskq/o-o-2.jpg'}" class="message-avatar avatar">
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

    // 3. 语音气泡
    html += getRow(false, `
        <div class="message-bubble voice-bubble received">
            <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
            <span class="duration">12"</span>
        </div>
    `);
    html += getRow(true, `
        <div class="message-bubble voice-bubble sent">
            <svg class="play-icon" style="transform: scaleX(-1);" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>
            <span class="duration">8"</span>
        </div>
    `);
    return `
        <div id="chat-room-screen" class="screen active">
            <main class="content">
                <div class="message-area" style="padding: 10px;">
                    ${html}
                </div>
            </main>
        </div>
    `;
}

function updateBubbleCssPreview(previewContainer, css, useDefault, theme) {
    if (!previewContainer) return;
    
    let innerContainer = document.getElementById('preview-inner-container');
    let titleEl = document.getElementById('preview-mode-title');
    if (!innerContainer) return;

    titleEl.textContent = previewModes[currentPreviewMode].title;
    
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
    
    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).map(el => el.outerHTML).join('\n');
    // 不加 !important，这样你手写的高级 CSS 可以轻松覆盖它，也能防止气泡无 CSS 时变透明
    let fallbackCss = `
        /* 强制提供底层主题色兜底 */
        .message-wrapper.sent .message-bubble, .message-wrapper.sent .voice-bubble { background-color: ${theme.sent.bg}; color: ${theme.sent.text}; }
        .message-wrapper.received .message-bubble, .message-wrapper.received .voice-bubble { background-color: ${theme.received.bg}; color: ${theme.received.text}; }
    `;
    const userCss = (!useDefault && css) ? css : '';

    let templateHtml = previewModes[currentPreviewMode].template;
    if (currentPreviewMode === 0) {
        templateHtml = getDynamicBubblePreview(); // 不再需要传参，直接输出全家福
    }

doc.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            ${styles}
            <style>
                html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: transparent; }
                
                /* --- 修改：预览窗口基础背景色 --- */
                #chat-room-screen { 
                    position: relative !important; height: 100% !important; width: 100% !important; 
                    display: block !important; transform: none !important; 
                    background-color: #eef2f5 !important; /* 舒适的浅灰蓝背景 */
                    overflow: hidden !important; 
                }
                
                /* --- 新增：超大号居中倾斜的 SAMPLE 水印 --- */
                #chat-room-screen::before {
                    content: "OuO";
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%) rotate(-35deg);
                    font-size: 120px; /* 超大字号 */
                    font-weight: 600;
                    color: rgba(0, 0, 0, 0.1); /* 非常浅的颜色，不喧宾夺主 */
                    font-family: Arial, sans-serif;
                    letter-spacing: 10px;
                    pointer-events: none; /* 关键：穿透点击，绝不会阻挡鼠标 */
                    white-space: nowrap;
                }

                /* 去除自带的 iframe 滚动条 */
                .message-area::-webkit-scrollbar { width: 4px; }
                .message-area::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }
                ${fallbackCss}
            </style>
            <style id="user-custom-css">${userCss}</style>
        </head>
        <body>
            ${templateHtml}
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
                if (conf.strokeW > 0) {
                    const sides = conf.strokeSides ||[];
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
            if (updatedP || updatedG) await saveGlobalKeys(['bubbleCssPresets']);

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
                if (updatedP || updatedG) await saveGlobalKeys(['bubbleCssPresets']);

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
                    if (updatedP || updatedG) await saveGlobalKeys(['bubbleCssPresets']);

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
                    if (updatedP || updatedG) await saveGlobalKeys(['bubbleCssPresets']);

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