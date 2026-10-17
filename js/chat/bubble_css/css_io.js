// --- START OF FILE bubble_css/css_io.js ---
// ======================================================================
// 「高级」Tab 那两个框的拆/拼，以及预览页 ↔ 编辑面板的联动。
//
// 落盘永远是一个字段 preset.css（用户手写的在前、自动生成块在后），
// 界面上却是两个框。这里就是那层转换：split / join / compose / spread。
//
// ★ 要完整串的地方（存盘 / 预览 / 反解 META）一律走 composeBubbleCss()，
//   直接读那个 textarea 只拿到一半 —— 症状是「预览突然变回默认样式」
//   「存完基础设置全丢」。
// ★ 改 currentPreviewMode 一律走 setPreviewMode，直接赋值会出现
//   「预览翻到底栏、下面还停在气泡」。
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

// 预览停在第几页（0 气泡 / 1 顶栏 / 2 底栏）。三个视图的定义见下面 previewModes，
// iframe 怎么渲染见 preview.js。
let currentPreviewMode = 0; // 0:气泡, 1:顶部栏, 2:底部栏


// 三个预览视图。focus 决定 iframe 里滚动/裁切到哪个区域，
// 不再各自持有一份 HTML。
const previewModes = [
    { title: '预览 1/3：消息气泡 (Bubbles)', focus: 'bubbles' },
    { title: '预览 2/3：顶部栏 (Header)',    focus: 'header'  },
    { title: '预览 3/3：底部栏 (Footer & Input)', focus: 'footer' }
];

// 「基础」Tab 下面挂着三块面板，和上面三个预览视图一对一：
// 翻到顶栏就改顶栏、翻到底栏就改底栏。顺序必须和 previewModes 对齐。
// 「高级」只有一块 —— 三个视图写的是同一段 CSS，拆成三份没有意义。
const BASIC_PANE_IDS = ['pane-basic', 'pane-basic-header', 'pane-basic-footer'];
let currentAppearanceTab = 'basic'; // 'basic' | 'css'，对应 index.html 上的 data-tab

// 当前该亮哪块面板 = 「哪个 Tab」×「预览翻到第几页」。
// 两个维度都从模块级变量读，所以无论是点 Tab 还是点预览左右键都调这一个函数。
function syncAppearancePane() {
    const root = document.getElementById('tab-view-bubbles');
    if (!root) return;
    const paneId = (currentAppearanceTab === 'css') ? 'pane-css' : BASIC_PANE_IDS[currentPreviewMode];
    root.querySelectorAll('.content-pane').forEach(p => {
        p.classList.toggle('active', p.id === paneId);
    });
    root.querySelectorAll('.side-tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === currentAppearanceTab);
    });
}

// ============ 「高级」Tab 那两个框 ============
// 以前是**一个** textarea，自动生成的区块直接追加在用户手写内容的后面。问题是
// 用户想改自己那几行时，很容易连带把生成区块也改了（标记里写着"请勿在此区块内手写"
// 也挡不住手滑），而删掉它又等于没了参考。现在拆成两个：
//   · #global-bubble-custom-css  可编辑，**只装用户手写的那半边**
//   · #bubble-generated-css      只读，装自动生成的区块，默认折叠起来
// ★ 落盘仍然是**一个字段**（preset.css），格式一字不改 —— 用户那半边在前、
//   生成块追加在后。所以老预设、导出的 json、备份全部照旧能用，
//   scopeBubbleCss 和 chat.customBubbleCss 那条链路一无所知。
// ★ 要完整串的地方（存盘 / 预览 / 反解 META）一律走 composeBubbleCss()，
//   别直接读那个 textarea —— 读到的只有一半，预览会突然变回默认样式。
const START_MARKER = "/* --- 自动生成：基础外观开始 (请勿在此区块内手写) --- */";
const END_MARKER = "/* --- 自动生成：基础外观结束 --- */";

function _genBlockRegex() {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${esc(START_MARKER)}[\\s\\S]*?${esc(END_MARKER)}\\n?`);
}

// 把一段完整 CSS 拆成「用户手写」和「自动生成区块」两半
function splitBubbleCss(css) {
    const full = css || '';
    const m = full.match(_genBlockRegex());
    if (!m) return { user: full.trim(), gen: '' };
    return { user: full.replace(_genBlockRegex(), '').trim(), gen: m[0].trim() };
}

// 两半拼回完整串。顺序和分隔必须和拆分前一致（用户那半在前、生成块在后），
// 否则同一个预设存一次就变一次样。
// ★ 和拆分前有一处行为差异：生成块以前是**原地**替换的，所以用户如果在它后面
//   又写了几行，那几行会留在生成块之后；现在生成块一律落到末尾。这是故意的
//   （位置统一了才好折叠），而且和标记里那句"请勿在此区块内手写"的约定一致。
function joinBubbleCss(user, gen) {
    const u = (user || '').trim();
    const g = (gen || '').trim();
    if (!g) return u ? u + '\n' : '';
    return (u ? u + '\n\n' : '') + g + '\n';
}

function _userCssEl() { return document.getElementById('global-bubble-custom-css'); }
function _genCssEl() { return document.getElementById('bubble-generated-css'); }

// 当前编辑器里那份完整 CSS（两个框拼起来）
function composeBubbleCss() {
    const u = _userCssEl();
    const g = _genCssEl();
    return joinBubbleCss(u ? u.value : '', g ? g.textContent : '');
}

// 把一段完整 CSS 摊到两个框里。顺手更新折叠区的标题（让用户知道里面有没有东西）。
function spreadBubbleCss(css) {
    const { user, gen } = splitBubbleCss(css);
    const u = _userCssEl();
    const g = _genCssEl();
    if (u) u.value = user;
    if (g) g.textContent = gen;
    const hint = document.getElementById('bubble-generated-css-hint');
    if (hint) {
        const lines = gen ? gen.split('\n').length : 0;
        hint.textContent = gen ? `${lines} 行` : '暂无（没改过基础设置）';
    }
}

// 重画预览。setupBubblePresets 里原本自己闭包了一份，但「切预设」「换预览页」这些
// 入口散在闭包内外，所以提到模块级来，让所有人调同一个。
function refreshBubbleCssPreview() {
    const box = document.getElementById('global-bubble-css-preview');
    if (!box || !_userCssEl()) return;
    // ★ 必须喂**完整**串：只喂用户那半边的话，基础设置调出来的东西预览里全看不见
    updateBubbleCssPreview(box, composeBubbleCss(), false, colorThemes['white_blue']);
}

// 改 currentPreviewMode 的地方一律走这里 —— 直接赋值会出现
// 「预览翻到了底栏、下面的面板还停在气泡」。
function setPreviewMode(idx) {
    const n = previewModes.length;
    currentPreviewMode = ((idx % n) + n) % n;
    syncAppearancePane();
    refreshBubbleCssPreview();
}
