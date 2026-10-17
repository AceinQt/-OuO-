// --- START OF FILE bubble_css/store.js ---
// ======================================================================
// 预设的增删读写、文件名/复名规则、管理弹窗那几颗行按钮的工厂，
// 以及「从一段 CSS 的 META 注释里读回某个设置」这三件套。
//
// ★ getMessageTimeFormatFromCss / getBarCollapseFromCss / applyBarCollapseClasses
//   有**外部调用方**（chat_settings.js 渲染真实聊天室时要用），别当内部函数删。
// ★ _getBubblePresets 同样是对外的（chat_room.js / chat_settings.js / group_settings.js）。
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

// 预设名直接当文件名用会踩两个坑：`\ / : * ? " < > |` 这些字符安卓会静默换掉、
// Chrome 还会把 `/` 当成路径分隔符（下载直接失败），而空格在某些文件管理器里
// 长按选中都费劲。统一替成下划线；整个名字全被替掉（比如只打了几个空格）才退回「外观」。
function _presetFileSafeName(name) {
    const safe = String(name || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '');
    return safe || '外观';
}

// 「复制」出来的新名字：`同名(1)`，占了就往后数。
// 口径和「新建预设」按钮的 `新建外观(n)` 一致（都从 1 开始找第一个空位），
// 别换成「最大序号 +1」—— 删掉中间一个以后两处的行为就不一样了。
function _nextCopyPresetName(baseName, presets) {
    let n = 1, name = `${baseName}(${n})`;
    while ((presets ||[]).some(p => p.name === name)) { n++; name = `${baseName}(${n})`; }
    return name;
}

// 管理弹窗里每行的操作按钮。原先是「编辑/重命名/删除」三颗**文字**按钮，加上「复制」
// 第四颗之后在窄屏（实测 390px 宽的手机）上会折行、把列表行撑成两层，所以整排换成
// 36×36 的方形图标按钮 —— 样式直接复用 api 设置页那 5 颗的 `.api-icon-btn`
// （api.css 在 main.css 里是全局 import 的，不用再抄一份；它的 `svg{width/height:18px}`
// 也顺带避开了「iOS 上 viewBox 没宽高的 svg 看不见」那个坑）。
//
// 图标一律 `fill="none" stroke="currentColor"` 的线型写法，和项目里别处同族图标一致。
const PRESET_ROW_ICONS = {
    // 铅笔 = 进编辑器调样式
    edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    // 和 api 设置「复制当前预设」同一个图标，保持两处语义一致
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    // 大写 T = 只改名字，和铅笔区分开（两颗都用笔形的话没人分得清）
    rename: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
    del: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
};

// title 之外必须再给一个 aria-label：图标按钮没有文字，title 在触屏上也摸不出来。
function mkPresetRowBtn(kind, label, extraClass) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'api-icon-btn' + (extraClass ? ' ' + extraClass : '');
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
        + 'stroke-linecap="round" stroke-linejoin="round">' + PRESET_ROW_ICONS[kind] + '</svg>';
    return b;
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

// 从一段预设 CSS 的 META 注释里取出时间格式。
// 位置是纯 CSS，格式不是 —— 它得由气泡工厂在渲染时拼成文字，所以要有人把它从 CSS 里
// 捞出来。实际聊天室走 chat_settings.js 的 updateCustomBubbleStyle（所有换预设/进聊天室
// 的唯一汇合点），预览走下面的 getDynamicBubblePreview，两边都调这一个函数，
// 免得"预览里是这个格式、聊天室里是另一个"。
function getMessageTimeFormatFromCss(css) {
    if (!css) return '';
    const m = String(css).match(/\/\* META:(.+?) \*\//);
    if (!m) return '';
    try {
        const parsed = JSON.parse(m[1]);
        return (typeof parsed.timeFormat === 'string') ? parsed.timeFormat : '';
    } catch (e) {
        return '';
    }
}

// 从一段预设 CSS 的 META 注释里取出三个「收纳」开关（第三个是「AI 回复键搬进输入框」）。
// 和 timeFormat 同一个处境：它们生成不出 CSS —— 要动的是「通话按钮在不在顶栏」
// 「工具栏整条在不在」这类结构，而结构上的例外（群聊没有通话）得由别的规则压回去，
// 生成出来的 scoped 选择器是 `#chat-room-screen.chat-active-xx.chat-active-xx …`
// （1 id + 3 class），权重比任何一条手写规则都高，压不住。所以改成在
// #chat-room-screen 上挂 class，真正的藏/放写死在 css/pages/chat/chat_room.css
// 那一段「顶栏/底栏的收纳态」里。
//
// 实际聊天室走 chat_settings.js 的 updateCustomBubbleStyle（所有换预设/进聊天室的
// 唯一汇合点），预览走 buildPreviewShellHtml，两边都调这一个函数 —— 和 timeFormat
// 一样，免得"预览里收起来了、聊天室里没有"。
function getBarCollapseFromCss(css) {
    const off = { call: false, toolbar: false, reply: false };
    if (!css) return off;
    const m = String(css).match(/\/\* META:(.+?) \*\//);
    if (!m) return off;
    try {
        const parsed = JSON.parse(m[1]);
        return {
            call: !!(parsed.header && parsed.header.collapseCall),
            toolbar: !!(parsed.footer && parsed.footer.collapseToolbar),
            reply: !!(parsed.footer && parsed.footer.collapseReply)
        };
    } catch (e) {
        return off;
    }
}

// 把两个收纳 class 同步到一个元素上（真实的 #chat-room-screen，或预览里 clone 的那份）。
// ★ 必须**每个都写**（该关的显式移除）：从"收纳"的预设切到"不收纳"的预设时，
//   只加不减会让上一个预设的 class 永远留在屏幕上。
function applyBarCollapseClasses(el, flags) {
    if (!el) return;
    el.classList.toggle('bar-collapse-call', !!(flags && flags.call));
    el.classList.toggle('bar-collapse-toolbar', !!(flags && flags.toolbar));
    el.classList.toggle('bar-collapse-reply', !!(flags && flags.reply));
}


// 供侧边栏获取选项并填充
function populateChatThemeSelects() {
    const privateSel = document.getElementById('setting-theme-color');
    const groupSel = document.getElementById('setting-group-theme-color');
    
    // 【修改点】过滤掉名称为“默认”的预设，防止和顶部的自带默认发生选项重复渲染
    const names = _getBubblePresets().filter(p => p.name !== '默认').map(p => p.name);

    // 预设名是用户自己起的，带 < 或 " 会把拼出来的 <option> 渲染坏，所以走
    // createElement + textContent —— 跟下面 renderGlobalBubblePresets 同一写法。
    // 两个 select 不能共用同一批 option 节点（会被搬走），所以每个现造一遍。
    const fill = (sel) => {
        if (!sel) return;
        sel.innerHTML = '';
        const def = document.createElement('option');
        def.value       = 'default';
        def.textContent = '默认';
        sel.appendChild(def);
        names.forEach(name => {
            const opt = document.createElement('option');
            opt.value       = `preset:${name}`;
            opt.textContent = name;
            sel.appendChild(opt);
        });
    };

    fill(privateSel);
    fill(groupSel);
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
