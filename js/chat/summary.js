// --- 全局配置：日记字体列表 ---
const JOURNAL_FONTS = [
    { name: '默认', value: '' , scale: 1.0 }, // 空值表示使用 CSS 中定义的默认字体
 { name: '千图纤墨体', value: './font/QianTuXianMoTi-2.ttf' , scale: 1.0}, 
 { name: '平方公子体', value: './font/PingFangGongZiTi-2.ttf', scale: 1.15 }, 
 { name: '平方长安体', value: './font/PingFangChangAnTi-2.ttf' , scale: 1.2}, 
 { name: '平方江南体', value: './font/PingFangJiangNanTi-2.ttf', scale: 1.0 }, 
 { name: '平方上上谦体', value: './font/PingFangShangShangQianTi-2.ttf', scale: 1.6 }, 
 { name: '平方韶华体', value: './font/PingFangShaoHuaTi-2.ttf', scale: 1.4 }, 
 { name: '平方战狼体', value: './font/PingFangZhanLangTi-2.ttf' , scale: 1.2}, 
 { name: '新叶念体', value: './font/XinYeNianTi-2.otf', scale: 1.25}
];

// --- 辅助函数：日记 Markdown 渲染 (精准字体分流版) ---
function renderJournalMarkdown(text, container) {
    if (!text) {
        container.innerHTML = '';
        return;
    }
    
    container.className = 'journal-paper-content';

    let raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // 1. 段落标准化
    raw = raw.replace(/[ \t]+$/gm, '');
    raw = raw.replace(/\n+/g, '\n\n');
    
    // 2. 保护反斜杠
    raw = raw.replace(/\\/g, '\\\\'); 

    // === 3. 【核心】提取并保护颜文字 ===
    const kaomojiMatches = [];
    
    // 正则扩展：
    // 1. 中间部分：捕获括号内的颜文字
    // 2. 末尾部分 |([ ... ])：捕获括号外单独出现的符号
    //    在这里加入了 ง 和 ว，确保它们即使单独出现也能被识别为颜文字
    const smartKaomojiRegex = /((?:\(|（)[^()\n]*?(?:[^\u4e00-\u9fa5a-zA-Z0-9，。！？、：；“”‘’\s]|井|皿|口|Д|ω)[^()\n]*?(?:\)|）)(?:[♡✧])?)|([งว])/g;
    
    let protectedText = raw.replace(smartKaomojiRegex, (match) => {
        // === 【核心修复】 ===
        // 只有当字符串里包含 "三星显示不了的那个古泰文 (ฅ)" 时，才标记为 'thai' (强制用 Noto 字体)
        // 其他普通泰文 (ง, ว)，标记为 'gen' (优先用系统字体，保持原生原样)
        
        // \u0E05 是 ฅ (Kho Khon)
        // \u0E03 是 ฃ (Kho Khuad) - 另一个可能出问题的废弃字符
        const needsNotoFont = /[\u0E05\u0E03]/.test(match);
        
        kaomojiMatches.push({
            content: match,
            type: needsNotoFont ? 'thai' : 'gen' 
        });
        
        return `%%%KAOMOJI_PLACEHOLDER_${kaomojiMatches.length - 1}%%%`;
    });

    // 4. 保护加粗内容
    const boldMatches = [];
    protectedText = protectedText.replace(/\*\*([\s\S]*?)\*\*/g, (match, content) => {
        boldMatches.push(content);
        return `%%%BOLD_PLACEHOLDER_${boldMatches.length - 1}%%%`;
    });

    // 5. 转义 Markdown 敏感符
    protectedText = protectedText.replace(/\*/g, '\\*');
    protectedText = protectedText.replace(/_/g, '\\_');

    // 6. 解析
    marked.setOptions({ breaks: false, gfm: true });
    let html = marked.parse(protectedText);

    // 7. 还原
    
    // A. 还原加粗
    html = html.replace(/%%%BOLD_PLACEHOLDER_(\d+)%%%/g, (match, index) => {
        return `<strong>${boldMatches[index]}</strong>`;
    });

    // B. 还原颜文字 (分流应用样式)
    html = html.replace(/%%%KAOMOJI_PLACEHOLDER_(\d+)%%%/g, (match, index) => {
        const item = kaomojiMatches[index];
        // 'thai' -> .kaomoji-thai (Noto字体，解决方框)
        // 'gen'  -> .kaomoji (系统字体，解决样式不统一)
        const className = item.type === 'thai' ? 'kaomoji-thai' : 'kaomoji';
        return `<span class="${className}">${item.content}</span>`;
    });

    // C. 还原引用高亮
    html = html.replace(/(“[^”]*”)/g, '<span class="journal-inline-quote">$1</span>');

    container.innerHTML = html;
}



// 普通文本渲染 (用于总结)
function renderSimpleText(text, container) {
    if (!text) {
        container.innerHTML = '';
        return;
    }
    container.className = 'content'; 
    container.style.whiteSpace = 'pre-wrap';
    container.textContent = text; 
}

// --- 辅助函数：应用日记字体 (英文手写 + 颜文字全兼容版) ---
function applyJournalFont(fontUrl) {
    const screen = document.getElementById('journal-detail-screen');
    const styleId = 'dynamic-journal-font-style';
    let styleTag = document.getElementById(styleId);

    // 1. 缩放设置
    const fontConfig = JOURNAL_FONTS.find(f => f.value === fontUrl) || { scale: 1.0 };
    const scale = fontConfig.scale || 1.0;
    const sizeAdjustVal = (scale * 100).toFixed(0) + '%';

    // 2. 字体路径 (确保文件已上传)
    const notoSansPath = './font/NotoSans-Regular.ttf';       
    const notoThaiPath = './font/NotoSansThai-Regular.ttf';   
    
    // 3. 系统字体
    const systemFonts = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'";

    let cssContent = '';

    // --- A. 定义备胎字体 (Noto) ---
    cssContent += `
        @font-face {
            font-family: 'NotoGeneral';
            src: url('${notoSansPath}') format('truetype');
            font-display: swap;
            size-adjust: 100%; 
        }
        @font-face {
            font-family: 'NotoThai';
            src: url('${notoThaiPath}') format('truetype');
            font-display: swap;
            size-adjust: 100%; 
        }
    `;

    // --- B. 用户手写字体 ---
    let userHandwritingFont = ''; 
    
    if (fontUrl) {
        const fontName = 'CustomFont_' + fontUrl.replace(/[^a-zA-Z0-9]/g, '_');
        userHandwritingFont = `'${fontName}',`;

        cssContent += `
            @font-face {
                font-family: '${fontName}';
                src: url('${fontUrl}') format('truetype');
                font-display: swap;
                size-adjust: ${sizeAdjustVal}; 
                
                /* 【核心】手写体范围：汉字 + 数字 + 英文 */
                unicode-range: U+2E80-2EFF, U+2F00-2FDF, U+3000-303F, 
                               U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FF00-FFEF,
                               U+0030-0039, U+FF10-FF19, /* 数字 */
                               U+0041-005A, U+0061-007A; /* 英文 (A-Z, a-z) */
            }
        `;
    } else {
        userHandwritingFont = "'Ma Shan Zheng','Long Cang', ";
    }

    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = styleId;
        document.head.appendChild(styleTag);
    }
    styleTag.textContent = cssContent;

    if (screen) {
        // === 页面主体优先级 ===
        // 手写体优先 (负责汉字/英文/数字) -> 剩下交给系统 -> 实在不行交给 Noto
        screen.style.setProperty('--handwriting-font', `${userHandwritingFont} ${systemFonts}, 'NotoThai', 'NotoGeneral'`);
        
        screen.style.removeProperty('--font-scale');
    }
}

// --- 辅助函数：获取当前聊天对象 (通用) ---
function getCurrentChatObject() {
    if (currentChatType === 'private') {
        return db.characters.find(c => c.id === currentChatId);
    } else {
        return db.groups.find(g => g.id === currentChatId);
    }
}

// ============================================================
//  主初始化函数
// ============================================================

function setupMemoryJournalScreen() {
    // 1. 获取通用元素
    const generateNewBtn = document.getElementById('generate-new-journal-btn');
    const generateModal = document.getElementById('generate-journal-modal');
    const generateForm = document.getElementById('generate-journal-form');
    const journalListContainer = document.getElementById('journal-list-container');
    const bindWorldBookBtn = document.getElementById('bind-journal-worldbook-btn');
    const worldBookModal = document.getElementById('journal-worldbook-selection-modal');
    const worldBookList = document.getElementById('journal-worldbook-selection-list');
    const saveWorldBookBtn = document.getElementById('save-journal-worldbook-selection-btn');
    const tabs = document.querySelectorAll('.mem-tab-btn');
    
    // 侧边栏与长期总结
    const summarySidebar = document.getElementById('summary-sidebar');
    const sidebarItems = document.querySelectorAll('.summary-sidebar-item');
    const longTermModal = document.getElementById('generate-long-term-modal');
    const longTermForm = document.getElementById('generate-long-term-form');

    // 2. 获取详情页特有元素 (Summaries)
    const editSummaryBtn = document.getElementById('edit-summary-btn');
    const summaryTitleEl = document.getElementById('summary-detail-title');
    const summaryContentEl = document.getElementById('summary-detail-content');
    const summaryDateInput = document.getElementById('summary-occurred-at');

    // 3. 获取详情页特有元素 (Journals)
    const editJournalBtn = document.getElementById('edit-journal-btn');
    const journalTitleEl = document.getElementById('journal-detail-title');
    const journalContentEl = document.getElementById('journal-detail-content');
    const journalSettingsBtn = document.getElementById('journal-settings-btn');
    
    // 4. 设置模态框元素
    const journalCssModal = document.getElementById('journal-css-modal');
    const journalCssForm = document.getElementById('journal-css-form');
    const journalCssInput = document.getElementById('journal-css-input');
    const journalFontSelect = document.getElementById('journal-font-select');

    // --- 初始化字体下拉框 ---
    journalFontSelect.innerHTML = '';
    JOURNAL_FONTS.forEach(font => {
        const option = document.createElement('option');
        option.value = font.value;
        option.textContent = font.name;
        journalFontSelect.appendChild(option);
    });

    // --- Tab 切换逻辑 ---
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (currentChatType === 'group' && tab.dataset.tab === 'journal') {
                showToast('群聊模式暂不支持角色日记');
                return;
            }
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentMemoryTab = tab.dataset.tab;
            
            // 侧边栏显隐控制
            if (currentMemoryTab === 'summary') {
                summarySidebar.classList.remove('hidden');
                // 默认切回短期总结，或者保持状态
                if (!currentSummarySubTab) currentSummarySubTab = 'short';
                sidebarItems.forEach(i => {
                    if (i.dataset.sub === currentSummarySubTab) i.classList.add('active');
                    else i.classList.remove('active');
                });
            } else {
                summarySidebar.classList.add('hidden');
            }
            
            renderMemoryScreen();
        });
    });

    // --- 侧边栏 (Sub Tab) 切换 ---
    sidebarItems.forEach(item => {
        item.addEventListener('click', () => {
            sidebarItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            currentSummarySubTab = item.dataset.sub;
            renderMemoryScreen();
        });
    });

    // --- 生成按钮逻辑分流 (+号) ---
    generateNewBtn.addEventListener('click', () => {    
    if (currentChatType === 'group' && currentMemoryTab === 'journal') {
            showToast('群聊无法生成个人日记');
            return;
        }
        // 如果在“剧情总结”且是“长期总结”
        if (currentMemoryTab === 'summary' && currentSummarySubTab === 'long') {
            const now = new Date();
            document.getElementById('long-start-year').value = now.getFullYear();
            document.getElementById('long-end-year').value = now.getFullYear();
            longTermForm.reset();
            // reset后再次填充年份
            document.getElementById('long-start-year').value = now.getFullYear();
            document.getElementById('long-end-year').value = now.getFullYear();
            longTermModal.classList.add('visible');
        } else {
            // 短期总结 或 日记
            const chat = getCurrentChatObject();
            const totalMessages = chat ? chat.history.length : 0;
            
            const modalTitle = document.querySelector('#generate-journal-modal h3');
            const bothToggleContainer = document.getElementById('generate-both-toggle-container');
            
            if (currentMemoryTab === 'summary') {
                modalTitle.textContent = '生成短期总结';
                if (currentChatType === 'group') {
                    bothToggleContainer.style.display = 'none';
                } else {
                    bothToggleContainer.style.display = 'flex';
                }
            } else {
                modalTitle.textContent = '生成角色日记';
                bothToggleContainer.style.display = 'none';
            }
                

            document.getElementById('journal-range-info').textContent = `当前聊天总消息数: ${totalMessages}`;
            generateForm.reset();
            generateModal.classList.add('visible');
        }
    });

    // --- 提交生成表单 (短期/日记) ---
    generateForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const startInput = document.getElementById('journal-range-start');
        const endInput = document.getElementById('journal-range-end');
        const bothSwitch = document.getElementById('generate-both-switch');

        const start = parseInt(startInput.value);
        const end = parseInt(endInput.value);
        // 只有在 Summary Tab 且勾选了开关才同时生成
        const generateBoth = (currentMemoryTab === 'summary' && bothSwitch.checked && currentChatType !== 'group');

        if (isNaN(start) || isNaN(end) || start <= 0 || end < start) {
            showToast('请输入有效的起止范围');
            return;
        }
        generateModal.classList.remove('visible');
        await generateMemoryContent(start, end, generateBoth);
    });

    // --- 提交生成表单 (长期总结) ---
    longTermForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const sY = pad(document.getElementById('long-start-year').value);
        const sM = pad(document.getElementById('long-start-month').value);
        const sD = pad(document.getElementById('long-start-day').value);
        
        const eY = pad(document.getElementById('long-end-year').value);
        const eM = pad(document.getElementById('long-end-month').value);
        const eD = pad(document.getElementById('long-end-day').value);
        
        const startDateStr = `${sY}-${sM}-${sD}`;
        const endDateStr = `${eY}-${eM}-${eD}`;

        if (startDateStr > endDateStr) {
            showToast('开始日期不能晚于结束日期');
            return;
        }
        longTermModal.classList.remove('visible');
        await generateLongTermSummaryContent(startDateStr, endDateStr);
    });

    // --- 绑定世界书 ---
    bindWorldBookBtn.addEventListener('click', () => {
        const chat = getCurrentChatObject(); // 【修改】
        if (!chat) return;
        
        const currentBoundIds = currentMemoryTab === 'summary' 
            ? (chat.summaryWorldBookIds || []) 
            : (chat.journalWorldBookIds || []);
        renderCategorizedWorldBookList(worldBookList, db.worldBooks, currentBoundIds, 'journal-wb-select');
        worldBookModal.classList.add('visible');
    });

    saveWorldBookBtn.addEventListener('click', async () => {
        const chat = getCurrentChatObject(); // 【修改】
        if (!chat) return;
        const selectedIds = Array.from(worldBookList.querySelectorAll('.item-checkbox:checked')).map(input => input.value);
        if (currentMemoryTab === 'summary') {
            chat.summaryWorldBookIds = selectedIds;
            showToast('总结绑定的世界书已更新');
        } else {
            chat.journalWorldBookIds = selectedIds;
            showToast('日记绑定的世界书已更新');
        }

await saveSingleChat(currentChatId, currentChatType);
        
        worldBookModal.classList.remove('visible');
    });

    // --- 列表点击 (事件委托) ---
    // --- 列表点击 (事件委托) ---
    journalListContainer.addEventListener('click', async (e) => {
         const target = e.target;
         const card = target.closest('.journal-card');
         if (!card) return;

         const id = card.dataset.id;
         const chat = getCurrentChatObject(); // 【修改】
         if (!chat) return;

         let targetArrayName = 'memoryJournals';
         if (currentMemoryTab === 'summary') {
             if (currentSummarySubTab === 'long') targetArrayName = 'longTermSummaries';
             else targetArrayName = 'memorySummaries';
         }

         // 防止数组不存在
         if (!chat[targetArrayName]) chat[targetArrayName] = [];
         
         const item = chat[targetArrayName].find(j => j.id === id);
         if (!item) return;

         // 删除
         if (target.closest('.delete-journal-btn')) {
             if (await AppUI.confirm('确定要删除这条记录吗？', "系统提示", "确认", "取消")) {
                 chat[targetArrayName] = chat[targetArrayName].filter(j => j.id !== id);
                 
                 await saveSingleChat(currentChatId, currentChatType);

                 renderMemoryScreen();
                 showToast('已删除');
             }
             return;
         }

         // 收藏
         if (target.closest('.favorite-journal-btn')) {
             item.isFavorited = !item.isFavorited;
             await saveSingleChat(currentChatId, currentChatType);
             
             target.closest('.favorite-journal-btn').classList.toggle('favorited', item.isFavorited);
             showToast(item.isFavorited ? '已收藏' : '已取消收藏');
             return;
         }
         
         // 进入详情
         openMemoryDetail(item);
    });

    // --- 总结页详情编辑 ---
    editSummaryBtn.addEventListener('click', async () => {
        const isEditing = summaryTitleEl.getAttribute('contenteditable') === 'true';
        if (isEditing) {
            // 保存
            const chat = getCurrentChatObject(); // 【修改】
            let item;
            if (currentSummarySubTab === 'long') item = chat.longTermSummaries.find(j => j.id === currentJournalDetailId);
            else item = chat.memorySummaries.find(j => j.id === currentJournalDetailId);

            if (item) {
                item.title = summaryTitleEl.textContent.trim();
                item.content = summaryContentEl.innerText; 
                item.occurredAt = summaryDateInput.value.trim(); 
                
                await saveSingleChat(currentChatId, currentChatType);

                showToast('保存成功');
                renderMemoryScreen();
            }
            
            // 退出编辑 UI
            summaryTitleEl.setAttribute('contenteditable', 'false');
            summaryContentEl.setAttribute('contenteditable', 'false');
            summaryTitleEl.style.border = 'none';
            summaryContentEl.style.border = 'none';
            summaryDateInput.readOnly = true;
            summaryDateInput.style.borderBottom = '1px dashed #ccc';
            
            // 重绘 (普通文本)
            renderSimpleText(item.content, summaryContentEl);
            editSummaryBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25Z" /></svg>`;
        } else {
const chat = getCurrentChatObject(); // 【修改】
            let item;
            if (currentSummarySubTab === 'long') item = chat.longTermSummaries.find(j => j.id === currentJournalDetailId);
            else item = chat.memorySummaries.find(j => j.id === currentJournalDetailId);
            if (item) summaryContentEl.innerText = item.content;
            
            summaryTitleEl.setAttribute('contenteditable', 'true');
            summaryContentEl.setAttribute('contenteditable', 'true');
            summaryTitleEl.style.border = '1px dashed #ccc';
            summaryContentEl.style.border = '1px dashed #ccc';
            if (currentSummarySubTab !== 'long') {
                summaryDateInput.readOnly = false;
                summaryDateInput.style.borderBottom = '1px solid var(--primary-color)';
            }
            editSummaryBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9,16.17L4.83,12L3.41,13.41L9,19L21,7L19.59,5.59L9,16.17Z" /></svg>`;
        }
    });

    // --- 日记页详情编辑 (关键修复：标题样式重置) ---
    editJournalBtn.addEventListener('click', async () => {
        const yearInput = document.getElementById('journal-date-year');
        const monthInput = document.getElementById('journal-date-month');
        const dayInput = document.getElementById('journal-date-day');
        
        const isEditing = journalTitleEl.getAttribute('contenteditable') === 'true';

        if (isEditing) {
            // 保存
            const character = db.characters.find(c => c.id === currentChatId);
            const item = character.memoryJournals.find(j => j.id === currentJournalDetailId);
            
            if (item) {
                // 1. 获取纯文本，防止 HTML 脏标签
                const cleanTitle = journalTitleEl.textContent.trim();
                const cleanContent = journalContentEl.innerText;
                
                item.title = cleanTitle;
                item.content = cleanContent;
                
                const y = pad(yearInput.value);
                const m = pad(monthInput.value);
                const d = pad(dayInput.value);
                item.occurredAt = `${y}-${m}-${d}`;
                
                await saveSingleChat(currentChatId, currentChatType);
                showToast('保存成功');
                renderMemoryScreen();

                // 2. 强制重置 DOM 为纯文本
                journalTitleEl.textContent = cleanTitle;
            }
            
            // 退出编辑
            journalTitleEl.setAttribute('contenteditable', 'false');
            journalContentEl.setAttribute('contenteditable', 'false');
            
            // 3. 彻底清除 style，再应用无边框样式
            journalTitleEl.removeAttribute('style'); 
            journalTitleEl.style.border = '1px solid transparent';
            
            // 重绘 (Markdown)
            renderJournalMarkdown(item.content, journalContentEl);
            journalContentEl.className = 'journal-paper-content'; // 恢复拟物类名

            yearInput.readOnly = true;
            monthInput.readOnly = true;
            dayInput.readOnly = true;
            
            editJournalBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25Z" /></svg>`;
        } else {
            // 编辑
            const character = db.characters.find(c => c.id === currentChatId);
            const item = character.memoryJournals.find(j => j.id === currentJournalDetailId);
            
            journalContentEl.innerText = item.content; // 源码
            journalContentEl.className = 'journal-markdown-content'; // 编辑模式样式
            journalContentEl.setAttribute('contenteditable', 'true');

            journalTitleEl.setAttribute('contenteditable', 'true');
            journalTitleEl.style.border = '1px dashed #999';
            
            yearInput.readOnly = false;
            monthInput.readOnly = false;
            dayInput.readOnly = false;

            editJournalBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9,16.17L4.83,12L3.41,13.41L9,19L21,7L19.59,5.59L9,16.17Z" /></svg>`;
        }
    });

    // --- 日记设置 (CSS & Font) ---
journalSettingsBtn.addEventListener('click', () => {
        const character = db.characters.find(c => c.id === currentChatId);
        if (!character) return;
        
        journalCssInput.value = character.customJournalCss || '';
        journalFontSelect.value = character.journalFontUrl || '';
        journalCssModal.classList.add('visible');
    });

    journalCssForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const character = db.characters.find(c => c.id === currentChatId);
        if (!character) return;
        
        const cssContent = journalCssInput.value.trim();
        const fontUrl = journalFontSelect.value;

        character.customJournalCss = cssContent;
        character.journalFontUrl = fontUrl;
        
        await saveSingleChat(currentChatId, currentChatType);
        
        // 立即应用
        const styleTag = document.getElementById('dynamic-journal-style');
        if (styleTag) styleTag.textContent = cssContent;
        applyJournalFont(fontUrl);
        
        journalCssModal.classList.remove('visible');
        showToast('设置已保存');
    });
}

// ============================================================
//  列表渲染函数
// ============================================================

function renderMemoryScreen() {
    const container = document.getElementById('journal-list-container');
    const placeholder = document.getElementById('no-journals-placeholder');
    const placeholderText = document.getElementById('placeholder-text-content');
    container.innerHTML = '';

    const chat = getCurrentChatObject(); // 【修改】通用获取
    if (!chat) return;

    let items = [];
    
    // 数据源选择
    if (currentMemoryTab === 'summary') {
        if (currentSummarySubTab === 'long') {
            items = chat.longTermSummaries || [];
            placeholderText.textContent = '还没有长期总结哦~';
        } else {
            items = chat.memorySummaries || [];
            placeholderText.textContent = '还没有短期总结哦~';
        }
    } else {
        // 群聊不应该进到这里，但做了兼容
        items = chat.memoryJournals || [];
        placeholderText.textContent = '还没有角色日记哦~';
    }

    if (!items || items.length === 0) {
        placeholder.style.display = 'block';
        return;
    }
    placeholder.style.display = 'none';

    // 倒序排列
    const sortedItems = [...items].sort((a, b) => {
        const timeA = new Date(a.startDate || a.occurredAt || a.createdAt).getTime();
        const timeB = new Date(b.startDate || b.occurredAt || b.createdAt).getTime();
        return timeB - timeA;
    });

    sortedItems.forEach(item => {
        const card = document.createElement('li');
        card.className = 'journal-card';
        card.dataset.id = item.id;
        
        const isLongTerm = (currentMemoryTab === 'summary' && currentSummarySubTab === 'long');
        if (isLongTerm) {
            card.classList.add('long-term');
        }

        // --- 1. 日期/时间 ---
        let displayTime = '';
        if (item.startDate && item.endDate) {
            displayTime = `${item.startDate} ~ ${item.endDate}`;
        } else {
            let t = item.occurredAt;
            if (!t) {
                const date = new Date(item.createdAt);
                t = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
            } else {
                t = t.split(' ')[0];
            }
            displayTime = t;
        }

        // --- 2. 范围 (仅短期/日记显示) ---
        let rangeTextHtml = '';
        if (!isLongTerm) {
             rangeTextHtml = `<span class="journal-card-range">范围: ${item.range?.start || '?'}-${item.range?.end || '?'}</span>`;
        }

        // --- 3. 按钮组 ---
        let favoriteBtnHtml = '';
        // 只有总结页显示收藏
        if (currentMemoryTab === 'summary') {
            favoriteBtnHtml = `
            <button class="action-icon-btn favorite-journal-btn ${item.isFavorited ? 'favorited' : ''}" title="收藏">
                 <svg viewBox="0 0 24 24">
                    <path class="star-outline" d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z" fill="currentColor"/>
                    <path class="star-solid" d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/>
                </svg>
            </button>`;
        }

        const deleteBtnHtml = `
            <button class="action-icon-btn delete-journal-btn" title="删除">
                <svg viewBox="0 0 24 24"><path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" /></svg>
            </button>
        `;

        card.innerHTML = `
            <div class="journal-card-header">
                <div class="journal-card-title">${item.title}</div>
            </div>
            
            <div class="journal-card-footer">
                <span class="journal-card-date">${displayTime}</span>
                ${rangeTextHtml}
                <div class="footer-actions">
                    ${favoriteBtnHtml}
                    ${deleteBtnHtml}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// ============================================================
//  详情页分流函数
// ============================================================

function openMemoryDetail(item) {
    currentJournalDetailId = item.id;
        if (currentChatType === 'private') {
         const character = db.characters.find(c => c.id === currentChatId);
         applyJournalFont(character ? character.journalFontUrl : '');
    }
    const styleTag = document.getElementById('dynamic-journal-style');

    // 通用日期处理 (YYYY-MM-DD)
    let dateStr = '';
    if (item.occurredAt) {
        dateStr = item.occurredAt.split(' ')[0];
    } else if (item.startDate) {
        dateStr = item.startDate; // 长期总结用开始日期
    } else {
        const date = new Date(item.createdAt);
        dateStr = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    if (currentMemoryTab === 'summary') {
        // ================= 1. 总结详情页 =================
        
        // 清空日记专用样式，防止污染
        if (styleTag) styleTag.textContent = ''; 
        // 清除自定义字体变量 (可选，如果 CSS 隔离做得好也可以不清除)
        const journalScreen = document.getElementById('journal-detail-screen');
        if (journalScreen) journalScreen.style.removeProperty('--handwriting-font');

        const titleEl = document.getElementById('summary-detail-title');
        const contentEl = document.getElementById('summary-detail-content');
        const dateInput = document.getElementById('summary-occurred-at');
        const rangeDisplay = document.getElementById('summary-range-display');
        const editBtn = document.getElementById('edit-summary-btn');

        titleEl.textContent = item.title;
        // 使用普通文本渲染
        renderSimpleText(item.content, contentEl);
        
        // 显示时间 (总结页显示 2023-10-01 或 范围)
        if (currentSummarySubTab === 'long') {
            dateInput.value = `${item.startDate} ~ ${item.endDate}`;
            rangeDisplay.textContent = '长期精炼';
            dateInput.readOnly = true; 
        } else {
            dateInput.value = dateStr;
            rangeDisplay.textContent = `消息范围: ${item.range.start}-${item.range.end}`;
            dateInput.readOnly = true;
            dateInput.style.borderBottom = 'none'; // 初始无下划线
        }

        // 重置 UI
        titleEl.setAttribute('contenteditable', 'false');
        contentEl.setAttribute('contenteditable', 'false');
        titleEl.style.border = 'none';
        contentEl.style.border = 'none';
        
        editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25Z" /></svg>`;

        switchScreen('summary-detail-screen');

    } else {
        // ================= 2. 日记详情页 =================
        
        const character = db.characters.find(c => c.id === currentChatId);
        
        // 加载自定义 CSS
        if (character && character.customJournalCss && styleTag) {
            styleTag.textContent = character.customJournalCss;
        } else if (styleTag) {
            styleTag.textContent = '';
        }
        
        // 加载自定义字体
        applyJournalFont(character ? character.journalFontUrl : '');

        const titleEl = document.getElementById('journal-detail-title');
        const contentEl = document.getElementById('journal-detail-content');
        const yearInput = document.getElementById('journal-date-year');
        const monthInput = document.getElementById('journal-date-month');
        const dayInput = document.getElementById('journal-date-day');
        const editBtn = document.getElementById('edit-journal-btn');

        titleEl.textContent = item.title;
        // 初始无边框
        titleEl.style.border = '1px solid transparent';
        
        // 使用 Markdown 渲染
        renderJournalMarkdown(item.content, contentEl);
        contentEl.className = 'journal-paper-content'; // 确保是拟物样式

        // 填充日期拆分
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            yearInput.value = parts[0];
            monthInput.value = parts[1];
            dayInput.value = parts[2];
        }

        // 重置 UI
        titleEl.setAttribute('contenteditable', 'false');
        contentEl.setAttribute('contenteditable', 'false');
        contentEl.style.border = 'none';
        
        yearInput.readOnly = true;
        monthInput.readOnly = true;
        dayInput.readOnly = true;
        
        editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.13,5.12L18.88,8.87M3,17.25V21H6.75L17.81,9.94L14.06,6.19L3,17.25Z" /></svg>`;

        switchScreen('journal-detail-screen');
    }
}

// ============================================================
//  生成逻辑函数
// ============================================================

async function performGeneration(chat, start, end, type) {
    const startIndex = start - 1;
    const endIndex = end;
    
    const messagesToSummarize = chat.history.slice(startIndex, endIndex)
        .filter(m => {
            // 1. 过滤掉被显式标记为隐身或忽略的消息 (如开启线下模式、主动消息的系统提示)
            if (m.isAiIgnore || m.isHidden) return false;
            // 2. 过滤掉纯粹的系统通知 (role === 'system')
            if (m.role === 'system') return false;
            // 3. 过滤掉自动插入的底层时间流逝提示
            if (m.id && m.id.includes('msg_context_timesense')) return false;
            // 4. 双重保险：文本内容包含 system-display 或者是强制系统指令的
            if (m.content && m.content.includes('[system-display:')) return false;
            if (m.content && m.content.trim().startsWith('[system:')) return false;
            
            return true; // 只有通过层层筛选的真实对话才保留
        })
        .map(m => {
            let name = '';
            if (m.role === 'user') {
                name = (currentChatType === 'private' ? '我' : (chat.me.realName || '我'));
            } else {
                if (currentChatType === 'private') {
                    name = chat.realName;
                } else {
                    // 群聊查找发送者
                    const sender = chat.members.find(mem => mem.id === m.senderId);
                    name = sender ? sender.realName : '未知成员';
                }
            }
            return `${name}: ${m.content}`;
        }).join('\n');

    // === 1. 获取并拆分世界书 ===
    // 确定使用哪一组绑定ID
    const boundIds = type === 'summary' ? (chat.summaryWorldBookIds || []) : (chat.journalWorldBookIds ||[]);
    
    // 获取所有绑定的世界书对象
    const allBoundWbs = boundIds.map(id => db.worldBooks.find(w => w.id === id)).filter(Boolean);

    // 分类提取内容
    const wbBefore = allBoundWbs.filter(wb => wb.position === 'before').map(wb => wb.content).join('\n');
    const wbAfter = allBoundWbs.filter(wb => wb.position === 'after').map(wb => wb.content).join('\n');
    const wbWriting = allBoundWbs.filter(wb => wb.position === 'writing').map(wb => wb.content).join('\n');

    // === 2. 提取人物设定 (区分群聊/私聊) ===
    let charName, charPersona, userName, userPersona;
    
    if (currentChatType === 'private') {
        charName = chat.realName || '未知角色';
        charPersona = chat.persona || '无特定人设';
        userName = chat.myName || '用户';
        userPersona = chat.myPersona || '无特定人设';
    } else {
        // 群聊逻辑
        charName = chat.name || '群聊'; // 群名
        userName = chat.me.realName || '用户';
        userPersona = chat.me.persona || '无特定人设';
        // 构建群成员人设列表
        const membersInfo = chat.members.map(m => `- ${m.realName} (昵称: ${m.groupNickname}): ${m.persona || '无'}`).join('\n');
        charPersona = `这是一个名为“${charName}”的群聊。\n成员列表：\n${membersInfo}`;
    }
    
   // === 3. 新增：构建【已总结剧情】上下文 ===
    // 3.1 获取收藏的长期总结 (按开始时间排序)
    const longFavs = (chat.longTermSummaries ||[])
        .filter(s => s.isFavorited)
        .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
        .map(s => `[长期回顾 ${s.startDate}~${s.endDate}] ${s.title}\n${s.content}`)
        .join('\n\n');

    // 3.2 获取收藏的短期总结 (按发生时间排序)
    const shortFavs = (chat.memorySummaries ||[])
        .filter(s => s.isFavorited)
        .sort((a, b) => {
            const tA = a.occurredAt || a.createdAt;
            const tB = b.occurredAt || b.createdAt;
            return new Date(tA).getTime() - new Date(tB).getTime();
        })
        .map(s => {
            const dateStr = s.occurredAt ? s.occurredAt.split(' ')[0] : '未知日期';
            return `[短期剧情 ${dateStr}] ${s.title}\n${s.content}`;
        })
        .join('\n\n');
        
    // 3.3 组合文本
    let summaryContext = "";
    if (longFavs || shortFavs) {
        summaryContext = `【已总结剧情】\n这是过去发生的重要事件回顾，请基于这些背景来理解当前的对话：\n`;
        if (longFavs) summaryContext += `${longFavs}\n\n`;
        if (shortFavs) summaryContext += `${shortFavs}\n`;
        summaryContext += `----------------\n`;
    }

    let systemPrompt = "";
    
    const outputInstruction = `
请严格遵守以下输出格式（不要使用Markdown代码块，不要加粗）：
【标题】这里写标题
【内容】这里写正文内容

要求：
1. **标题**：根据对话内容起一个有具体意义的标题。
2. **格式**：必须包含【标题】和【内容】这两个标记，否则无法识别。
`;
    
    // 判断是否在总结“最新记录”（如果不是最新进度，绝不触发主动消息）
    const isLatest = (end === chat.history.length);
    let nextSlots =[];
    
    if (type === 'summary') {
        systemPrompt = `你是一个专业的剧情记录员。

【世界观/背景设定】
${wbBefore}

【人物档案】
- 主角名：${charName}
- 主角人设：${charPersona}
- 用户名：${userName}
- 用户人设：${userPersona}

【重要事项】
${wbAfter}

【写作要求】
请以**第三人称上帝视角**，客观、精准地总结以下对话内容。
请保留关键事件、关键人物姓名、关键道具、约定、角色情感变化以及重要的伏笔。
${wbWriting ? `特别指导：\n${wbWriting}\n` : ''}

【对话内容】
${summaryContext}

${outputInstruction}`;

        function getNextTwoSlots(hour) {
            const slots =[
                { id: 'night', name: '深夜(22:00-次日6:00)' },
                { id: 'morning', name: '早晨(6:00-10:00)' },
                { id: 'noon', name: '中午(10:00-14:00)' },
                { id: 'afternoon', name: '下午(14:00-18:00)' },
                { id: 'evening', name: '晚上(18:00-22:00)' }
            ];
            let currIdx = 0;
            if (hour >= 22 || hour < 6) currIdx = 0;
            else if (hour >= 6 && hour < 10) currIdx = 1;
            else if (hour >= 10 && hour < 14) currIdx = 2;
            else if (hour >= 14 && hour < 18) currIdx = 3;
            else currIdx = 4;
            
            return [slots[currIdx], slots[(currIdx + 1) % 5]];
        }

        if (type === 'summary' && isLatest) {
            nextSlots = getNextTwoSlots(new Date().getHours());
            
            // ★ 新增：判断是否处于线下模式
            const isOffline = (currentChatType === 'private' && chat.offlineModeEnabled);
            const actionPromptText = isOffline ? "做什么事" : "主动发消息";
                            const now = new Date();
                const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const currentWeekDay = weekDays[now.getDay()]; // getDay() 返回 0-6，0是周日
            const currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 星期${currentWeekDay} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
                
            let senderInstruction = '';
            let exampleFormat = '';
            
            // ★ 修改：针对顺风车，给出对应的线上/线下格式示例，且保持每个时段只发1个组（块）
            if (currentChatType === 'private') {
                senderInstruction = `私聊必须是你自己的名字（${charName}）`;
                if (isOffline) {
                    exampleFormat = `#SECRET_CHAT_${nextSlots[0].id.toUpperCase()}_5%#\n[02:15|${charName}的动作:他在床上翻来覆去睡不着。]\n\n#SECRET_CHAT_${nextSlots[1].id.toUpperCase()}_80%#\n[07:30|${charName}的动作:他在餐厅看到你，走上前拍了拍你。]\n[07:31|${charName}的语言:居然扔下我，一个人跑出来吃早餐……！]`;
                } else {
                    exampleFormat = `#SECRET_CHAT_${nextSlots[0].id.toUpperCase()}_5%#\n[02:15|${charName}的消息:睡不着，你在干嘛……]\n\n#SECRET_CHAT_${nextSlots[1].id.toUpperCase()}_80%#\n[08:20|${charName}的消息:起床了吗？]\n[08:21|${charName}的语音:大懒虫快起来！]`;
                }
            } else {
                const m1 = (chat.members && chat.members.length > 0) ? chat.members[0].realName : '群成员A';
                const m2 = (chat.members && chat.members.length > 1) ? chat.members[1].realName : m1;
                senderInstruction = `群聊必须严格使用群成员的真名（当前成员名单：${(chat.members ||[]).map(m => m.realName).join('、')}）`;
                exampleFormat = `#SECRET_CHAT_${nextSlots[0].id.toUpperCase()}_5%#\n[02:15|${m1}的消息:大半夜的有人没睡吗？]\n\n#SECRET_CHAT_${nextSlots[1].id.toUpperCase()}_80%#\n[07:30|${m2}的消息:早安！今天天气真好！]\n[07:32|${m1}的语音:早上好！]`;
            }

            systemPrompt += `\n\n【最后的一项绝对指令】：
在完成上面的总结任务后，请你立刻脱离“总结员”身份，切换回情境中。现在是 ${currentTime}，你们刚聊完，请你预先想好在接下来的两个时间段（${nextSlots[0].name} 和 ${nextSlots[1].name}），你可能会${actionPromptText}。
要求：
1. 每个时段支持生成 1~3 条连贯的互动。
2. 根据你们刚才聊天的氛围和人设，评估在这两个时间段主动发起的**概率（0到100的整数）**。
3. 每条消息必须独占一行，严格使用格式：[HH:MM|发送者名字的动作或消息:具体内容]
   - HH:MM 是你根据情境决定的合理时间（例如睡不着可能是 23:30，吃午饭可能是 12:15）。
   - 发送者：${senderInstruction}。
   - 动作支持：${isOffline ? "的动作、的语言" : "的消息、发来的照片/视频、的语音、的转账:xx元；备注、送来的礼物"}。
4. 严格使用以下标签独占一行包裹这些消息：
#SECRET_CHAT_${nextSlots[0].id.toUpperCase()}_概率%#[HH:MM|发送者名字的...:内容1]
[HH:MM|发送者名字的...:内容2]
#SECRET_CHAT_${nextSlots[1].id.toUpperCase()}_概率%#[HH:MM|发送者名字的...:内容1]

例如：
${exampleFormat}`;
        }
    } else {
        if (currentChatType === 'group') throw new Error("群聊不支持生成日记");
        // === 日记 Prompt 修改 ===
            
        systemPrompt = `你正在扮演角色“${chat.realName}”。
    
【世界观/背景设定】
${wbBefore}

【你的人设】
${charPersona}

【互动对象（${userName}）的人设】
${userPersona}

${summaryContext}

【重要事项】
${wbAfter}

请你根据以上经历写一篇**私密日记**。

为了拒绝流水账，请在**正式动笔前**，先进行【Step 1 深度思考】，构建日记骨架，然后再进行【Step 2 正文撰写】。

## Step 1: 写作前思考 (Pre-writing Reflection)
1. **【定调】**：今天的时间、地点、天气是怎样的？当下你的能量状态（疲惫、兴奋、平静）如何？
2. **【选材】**：如果把这一天剪辑成电影，你觉得哪几个“镜头”或瞬间最值得被保留？
3. **【捕捉】**：在这个瞬间里，有哪些特殊的感官细节（气味、光影、声音、触感）可以强化画面感？
4. **【深挖】**：表层情绪之下，你内心真实的渴望、恐惧或价值观是什么？
5. **【收尾】**：基于今日感悟，哪怕再糟糕，有什么值得感恩的小事？或者想对自己说的一句结束语是什么？

## Step 2: 撰写日记 (Drafting)
基于 Step 1 的思考，按照以下要求进行撰写：
1. **第一人称沉浸**：必须完全遵循你的【人设】语气，感情细腻真实，注重剖析内心世界。
2. **删除线**：使用**删除线**来表现你突然改变了主意。
3. **强调重点**：对于你特别在意的事情，使用Markdown的**加粗**（格式：**这个很重要**）来标记。
4. **拒绝平铺直叙**：不要从起床写到睡觉，直接切入重点瞬间。行文结构可以看起来略微凌乱，但不要流水账。
5. **颜文字**：使用颜文词表达心情。
${wbWriting ? `6. **文风指导**：\n${wbWriting}\n` : ''}
7. **格式严格执行**：
   - 你可以先输出思考过程（可选）。
   - **必须**使用【标题】标记包裹标题。
   - **必须**使用【内容】标记包裹正文。
   - 正文内容不要包含"Step 1"等字样，只保留日记本体。

${outputInstruction}
(提示：你可以先输出一段 "### 🧠 思考脉络" 用于热身，但在那之后必须严格输出 【标题】 和 【内容】)`;
    }

    const { url, key, model } = db.apiSettings;
    const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
            model: model,
            messages:[
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `请根据以下对话生成内容：\n\n${messagesToSummarize}` }
            ],
            // 总结需要准确（0.3-0.5），日记需要情感和文笔（0.8-0.95）
            temperature: type === 'summary' ? 0.3 : 0.9
        })
    });

    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const result = await response.json();
    const rawContent = result.choices[0].message.content;

    let processedContent = rawContent; 
    
    // ★ 原汁原味的单块匹配，仅做了动作的分离
    if (type === 'summary' && isLatest) {
        let proactiveOptions = {};
        const isOffline = (currentChatType === 'private' && chat.offlineModeEnabled);
        
        const slotsToMatch = [nextSlots[0].id, nextSlots[1].id];

        slotsToMatch.forEach(slotId => {
            const tagRegex = new RegExp(`#SECRET_CHAT_${slotId.toUpperCase()}(?:_(\\d+)%?)?#\\s*([\\s\\S]*?)(?=#SECRET_CHAT_|$)`, 'i');
            const match = processedContent.match(tagRegex);
            
            if (match) {
                let prob = match[1] ? parseInt(match[1], 10) : null;
                let textBlock = match[2].trim();                
                
                let messages =[];
                // 正则匹配[07:30|小明的消息:早安]
                const lineRegex = /\[(\d{1,2}:\d{2})\|([^:：]+)[:：](.*?)\]/g;
                let lineMatch;
                
                while ((lineMatch = lineRegex.exec(textBlock)) !== null) {
                    let prefix = lineMatch[2].trim();
                    let senderName = prefix;
                    let actionType = "的消息"; // 默认动作

                    // 核心：剥离特殊动作后缀（新版核心渲染必需）
                    const actionKeywords =[
    "的消息", "的表情包", 
    "发来的照片/视频", "的照片/视频", "发来的照片", "的照片", 
    "的语音", "发来的语音", "撤回了一条消息","撤回了上一条消息",
    "的转账", "发来的转账", 
    "送来的礼物", "的礼物", 
    "的动作", "的语言"
];
                    for (const kw of actionKeywords) {
                        if (prefix.endsWith(kw)) {
                            senderName = prefix.slice(0, -kw.length); // 留下纯名字
                            actionType = kw; // 记录真实动作
                            break;
                        }
                    }

                    messages.push({
                        time: lineMatch[1],
                        sender: senderName,
                        action: actionType, // ★ 保存剥离出的动作
                        text: lineMatch[3].trim()
                    });
                }
                
                // 兜底：如果 AI 没按格式输出，整体抓取
                if (messages.length === 0 && textBlock.length > 0) {
                    let defaultSender = currentChatType === 'private' ? charName : ((chat.members && chat.members.length > 0) ? chat.members[0].realName : '系统');
                    messages.push({
                        time: null,
                        sender: defaultSender,
                        action: isOffline ? "的动作" : "的消息",
                        text: textBlock.replace(/^[（(]|[）)]$/g, '').trim() 
                    });
                }

                if (messages.length > 0) {
                    // ★ 依旧存入原原本本的 slotId (不切分 morning_0 之类)，保持一组互相覆盖的单发特性
                    proactiveOptions[slotId] = {
                        probability: prob !== null ? prob : 100,
                        messages: messages
                    };
                }
            }
        });

        // 强力切割：只要遇到秘密标签，后面的全部砍掉，绝对不会污染正文
        processedContent = processedContent.replace(/#SECRET_CHAT_[A-Z]+(?:_\d+%?)?#[\s\S]*/gi, "").trim();

        // ★ 修改存入类型为 time_window_summary，这是新框架识别的“顺风车”类型
        if (Object.keys(proactiveOptions).length > 0 && typeof pushProactiveMessage === 'function') {
            pushProactiveMessage(chat.id, 'time_window_summary', proactiveOptions, 24); 
            console.log("[赠品] 已将赠品放入奖池，等待开奖！");
        }
    }
    
    let title = "无题";
    let content = processedContent;

    // 查找标记的位置
    const titleIndex = processedContent.indexOf('【标题】');
    const contentIndex = processedContent.indexOf('【内容】');

    if (titleIndex !== -1 && contentIndex !== -1 && contentIndex > titleIndex) {
        const rawTitle = processedContent.substring(titleIndex + 4, contentIndex).trim();
        title = rawTitle.replace(/\*\*/g, '').replace(/^#+\s*/, '').replace(/[:：]/g, '').trim();
        content = processedContent.substring(contentIndex + 4).trim();
    } else {
        // 兜底逻辑优化：尝试去除思考脉络
        let cleanContent = processedContent;
        // 如果包含 "###"，通常是思考部分，尝试截取掉
        if (cleanContent.includes('### 📖') || cleanContent.includes('### 🧠')) {
             cleanContent = cleanContent.split(/###[📖🧠]/)[1];
        } else if (cleanContent.includes('【内容】')) {
             cleanContent = cleanContent.split('【内容】')[1];
        }
        
        // 兜底：如果 AI 没听话，尝试用正则提取，或者直接取第一行
        const lines = cleanContent.split('\n').filter(l => l.trim() !== '');
        if (lines.length > 0) {
            const firstLine = lines[0].replace(/^(标题|Title)[:：]?\s*/i, '').replace(/\*\*/g, '');
            if (firstLine.length < 50) { // 如果第一行不太长，就当做标题
                title = firstLine;
                content = lines.slice(1).join('\n').trim();
            }
        }
    }
    
    // 如果依然是无题，根据日期自动生成一个 (兜底中的兜底)
    if (!title || title === "无题") {
        const d = new Date();
        title = `${d.getMonth() + 1}月${d.getDate()}日的记录`;
    }

    // 5. 默认发生时间为当前生成时间
    const now = new Date();
    const formattedNow = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const newItem = {
        id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        range: { start, end },
        title: title,
        content: content,
        createdAt: Date.now(),
        occurredAt: formattedNow,
        isFavorited: false
    };

    if (currentChatType === 'group') {
        if (type === 'summary') {
             if (!chat.memorySummaries) chat.memorySummaries =[];
             chat.memorySummaries.push(newItem);
        }
    } else {
        // 私聊存 db.characters (实际上是在内存对象改，最后 save)
        if (type === 'summary') {
            if (!chat.memorySummaries) chat.memorySummaries =[];
            chat.memorySummaries.push(newItem);
        } else {
            if (!chat.memoryJournals) chat.memoryJournals =[];
            chat.memoryJournals.push(newItem);
        }
    }
}

async function generateMemoryContent(start, end, generateBoth) {
    const generateBtn = document.getElementById('generate-new-journal-btn');
    generateBtn.disabled = true;
    generateBtn.style.opacity = '0.5';
    isGenerating = true;
    let toastMsg = currentMemoryTab === 'summary' ? '正在生成剧情总结...' : '正在生成角色日记...';
    if (generateBoth) toastMsg = '正在同时生成总结和日记...';
    const hideLoading = showLoadingToast(toastMsg);

    try {
        const chat = getCurrentChatObject(); // 【修改】
        if (!chat) throw new Error("未找到聊天对象");
        const startIndex = start - 1;
        const endIndex = end;
        if (startIndex < 0 || endIndex > chat.history.length || startIndex >= endIndex) {
            throw new Error("无效的消息范围");
        }

        if (currentMemoryTab === 'summary') {
            await performGeneration(chat, start, end, 'summary');
            if (generateBoth) await performGeneration(chat, start, end, 'journal');
        } else {
        if (currentChatType === 'group') throw new Error("群聊不支持日记");
            await performGeneration(chat, start, end, 'journal');
        }
        await saveSingleChat(currentChatId, currentChatType);
        renderMemoryScreen();
        showToast('生成完成！');
    } catch (error) {
        console.error(error);
        showToast('生成失败: ' + error.message);
    } finally {
        hideLoading();
        isGenerating = false;
        generateBtn.disabled = false;
        generateBtn.style.opacity = '1';
    }
}

async function generateLongTermSummaryContent(startDateStr, endDateStr) {
    const generateBtn = document.getElementById('generate-new-journal-btn');
    generateBtn.disabled = true;
    generateBtn.style.opacity = '0.5';
    isGenerating = true;
    
    const hideLoading = showLoadingToast('正在精炼长期总结...');

    try {
        const chat = getCurrentChatObject(); // 【修改】
        if (!chat) throw new Error("未找到聊天对象");

        // 1. 筛选当前时间范围内的短期总结 (作为素材)
        const shortSummaries = (chat.memorySummaries || []).filter(item => {
            if (!item.occurredAt) return false;
            const itemDate = item.occurredAt.split(' ')[0];
            return itemDate >= startDateStr && itemDate <= endDateStr;
        });

        if (shortSummaries.length === 0) {
            throw new Error(`在 ${startDateStr} 至 ${endDateStr} 期间没有找到可用的短期总结。`);
        }

        const contextText = shortSummaries.map(s => {
            return `[日期: ${s.occurredAt.split(' ')[0]}] ${s.title}\n${s.content}`;
        }).join('\n\n----------------\n\n');

        // === 2. 新增：获取此日期之前的长期总结 (作为历史背景) ===
        // 逻辑：只获取已收藏的，且结束日期早于本次开始日期的总结，按时间正序排列
        const previousLongTermContext = (chat.longTermSummaries || [])
            .filter(s => s.isFavorited && s.endDate < startDateStr) 
            .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
            .map(s => `[历史阶段 ${s.startDate}~${s.endDate}] ${s.title}\n${s.content}`)
            .join('\n\n');

        let historyPromptPart = "";
        if (previousLongTermContext) {
            historyPromptPart = `【前情提要 / 历史阶段总结】\n以下是本次总结之前发生过的长期剧情，请基于这些历史脉络进行续写和总结：\n${previousLongTermContext}\n`;
        }

        // === 3. 获取并拆分世界书 ===
        const boundIds = chat.summaryWorldBookIds || [];
        const allBoundWbs = boundIds.map(id => db.worldBooks.find(w => w.id === id)).filter(Boolean);

        const wbBefore = allBoundWbs.filter(wb => wb.position === 'before').map(wb => wb.content).join('\n');
        const wbAfter = allBoundWbs.filter(wb => wb.position === 'after').map(wb => wb.content).join('\n');
        const wbWriting = allBoundWbs.filter(wb => wb.position === 'writing').map(wb => wb.content).join('\n');

        // === 4. 提取人物设定 ===
        const charName = chat.realName || '未知角色';
        const charPersona = chat.persona || '无特定人设';
        const userName = chat.myName || '用户';
        const userPersona = chat.myPersona || '无特定人设';

        // === 5. 构建 Prompt (已修改优化) ===
        const systemPrompt = `你是一个专业的传记作家和剧情记录官。
任务：将用户提供的多段“短期剧情总结”合并并精炼成一份“长期总结”。
时间范围：${startDateStr} 至 ${endDateStr}。

【世界观/背景设定】
${wbBefore}

【人物关系背景】
- 主角（${charName}）：${charPersona}
- 互动对象（${userName}）：${userPersona}

${historyPromptPart}

【重要事项】
${wbAfter}

【写作核心指令 - 请严格遵守】
1. **精准的因果叙事**：
   - **拒绝模糊概括**：严禁使用“通过了考验”、“解决了问题”这种笼统描述。必须写出**具体的考验内容**（如：岳父的学术盘问）和**具体的解决手段**（如：承诺去收集魔法材料）。
   - **保留关键背景**：重要事件发生时，必须交代**时间节点与特殊场合**（例如：不能只写“见家长”，要写明是“在魔界入冬节的家庭聚会上”）。

2. **伏笔与任务线（极重要）**：
   - 必须单独关注并记录**未完结的剧情**、**新开启的任务**以及**遗留的代价**。
   - **特别是**：若有宠物/人员被迫滞留、或者为了达成未来目标需要进行特定的行动（如收集材料、打工等），这是推动后续剧情的核心动力，**绝不可省略**。

3. **去重与精炼逻辑**：
   - 仅合并重复的日常打情骂俏（如反复的早安吻）。
   - **保留**所有推动剧情向前发展的具体事件、冲突、新道具获得、新地图开启。

${wbWriting ? `\n【特别文风/内容指导】：\n${wbWriting}\n` : ''}

请严格遵守以下输出格式：
【标题】(概括这段时期的核心转折或大事件，富有文学性)
【内容】(按时间发展脉络撰写，保留上述要求的关键细节和伏笔)
`;

        const { url, key, model } = db.apiSettings;
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `以下是本阶段(${startDateStr}至${endDateStr})的详细记录，请进行精炼：\n\n${contextText}` }
                ],
                temperature: 0.5
            })
        });

        if (!response.ok) throw new Error(`API Error: ${response.status}`);
        const result = await response.json();
        const rawContent = result.choices[0].message.content;

        // === 解析逻辑 ===
        let title = "长期阶段总结";
        let content = rawContent;

        const titleIndex = rawContent.indexOf('【标题】');
        const contentIndex = rawContent.indexOf('【内容】');

        if (titleIndex !== -1 && contentIndex !== -1 && contentIndex > titleIndex) {
            const rawTitle = rawContent.substring(titleIndex + 4, contentIndex).trim();
            title = rawTitle.replace(/\*\*/g, '').replace(/^#+\s*/, '').replace(/[:：]/g, '').trim();
            content = rawContent.substring(contentIndex + 4).trim();
        } else {
             // 兜底
             const lines = rawContent.split('\n').filter(l => l.trim() !== '');
             if (lines.length > 0) {
                 const firstLine = lines[0].replace(/^(标题|Title)[:：]?\s*/i, '').replace(/\*\*/g, '');
                 if (firstLine.length < 50) {
                     title = firstLine;
                     content = lines.slice(1).join('\n').trim();
                 }
             }
        }

        const newItem = {
            id: `long_mem_${Date.now()}`,
            startDate: startDateStr,
            endDate: endDateStr,
            title: title,
            content: content,
            createdAt: Date.now(),
            isFavorited: false 
        };

        if (!chat.longTermSummaries) chat.longTermSummaries = [];
        chat.longTermSummaries.push(newItem);

        // 自动取消短期总结收藏
        let cancelCount = 0;
        shortSummaries.forEach(s => {
            if (s.isFavorited) {
                s.isFavorited = false;
                cancelCount++;
            }
        });

         await saveSingleChat(currentChatId, currentChatType);
        renderMemoryScreen();
        showToast(`长期总结已生成！已取消 ${cancelCount} 条短期总结的收藏。`);

    } catch (error) {
        console.error(error);
        showToast('生成失败: ' + error.message);
    } finally {
        hideLoading();
        isGenerating = false;
        generateBtn.disabled = false;
        generateBtn.style.opacity = '1';
    }
}