// ============================================================
//  summary_render.js
//
//  【职责】日记与总结的内容渲染层。
//  负责把原始文本转换成可展示的 HTML，以及动态加载自定义字体。
//
//  包含：
//  - JOURNAL_FONTS：日记可选字体列表（name / value / scale）
//  - renderJournalMarkdown()：日记专用 Markdown 渲染
//    · 保护颜文字（分流普通/泰文字体）
//    · 保护加粗内容
//    · 还原引用高亮
//  - renderSimpleText()：总结页用的普通纯文本渲染
//  - applyJournalFont()：动态注入 @font-face，切换日记页手写字体
//
//  依赖：summary_core.js（无直接依赖，但须同 DOM 一起使用）
// ============================================================


// --- 全局配置：日记字体列表 ---
const JOURNAL_FONTS = [
    { name: '默认', value: '' , scale: 1.0 },
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

// --- 渲染函数：普通文本渲染 (用于总结页) ---
function renderSimpleText(text, container) {
    if (!text) {
        container.innerHTML = '';
        return;
    }
    container.className = 'content'; 
    container.style.whiteSpace = 'pre-wrap';
    container.textContent = text; 
}
