// --- START OF FILE bubble_css/panel.js ---
// ======================================================================
// basicState → 面板控件（回显），以及「哪些行/选项此刻该收起或禁掉」。
//
// 三个函数，职责别混：
//   · syncConditionalRows —— 条件显隐 + 把「调了也看不见」的选项 disable 掉
//   · resetEditTargets    —— 三个「修改对象」下拉归位（★ 必须排在回显**前**）
//   · updateUIFromState   —— 把 basicState 的数值灌进几十个控件
//
// ★ 反方向（控件 → basicState）在 wire.js，CSS 生成在 generate.js。
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


// 两个条件行：头像弧度只在「显示头像」时有意义，时间格式只在时间真的显示时有意义。
// 收行用 display:'none' / 复原用 ''（让 CSS 里的 flex 生效），别写死 'flex' ——
// .row 和 .col 两种行的 flex-direction 不一样，写死会把竖排的滑块行压成横排。
function syncConditionalRows() {
    const radiusRow = document.getElementById('avatar-radius-row');
    if (radiusRow) radiusRow.style.display = basicState.hideAvatar ? 'none' : '';
    const fmtRow = document.getElementById('time-format-row');
    if (fmtRow) fmtRow.style.display = (basicState.timePos === 'none') ? 'none' : '';

    // 头像藏了就不该还能选「头像下方」：那一档生成的是「把头像列翻成 flex 列」，
    // 头像本身 display:none 之后列里只剩一个时间，宽度由时间文字决定，
    // 气泡左边缘会随每条消息的时间长短参差不齐。选中时强制退回「气泡上方」。
    const posSelect = document.getElementById('setting-time-pos');
    if (posSelect) {
        const avatarOpt = posSelect.querySelector('option[value="avatar"]');
        if (avatarOpt) avatarOpt.disabled = basicState.hideAvatar;
    }

    // 同理，发送按钮藏了就不该还能给它调色 —— 调了也看不见，只会让人以为没生效。
    // 正停在这一项上的话把「修改对象」顶到 AI 回复按钮。
    const ftrSelect = document.getElementById('setting-footer-target');
    if (ftrSelect) {
        const hideSend = !!(basicState.footer && basicState.footer.hideSend);
        const sendOpt = ftrSelect.querySelector('option[value="send"]');
        if (sendOpt) sendOpt.disabled = hideSend;
        if (hideSend && currentFooterTarget === 'send') {
            currentFooterTarget = 'reply';
            ftrSelect.value = 'reply';
        }
    }

    // 时间设成「不显示」时，「消息时间」那一组同样调了看不见 —— 照上面发送按钮
    // 那条的路子把选项禁掉，正停在它上面就顶回普通气泡。
    // ★ 不这么做的话症状很隐蔽：面板上色块、滑块全能拨，CSS 也确实生成了，
    //   但预览和聊天里都是空的（三个槽位全 display:none），像是功能坏了。
    const typeSel = document.getElementById('setting-bubble-type');
    if (typeSel) {
        const noTime = basicState.timePos === 'none';
        const timeOpt = typeSel.querySelector('option[value="msgtime"]');
        if (timeOpt) timeOpt.disabled = noTime;
        if (noTime && currentSelectType === 'msgtime') {
            currentSelectType = 'normal_sent';
            typeSel.value = 'normal';
            const sideSel = document.getElementById('setting-bubble-side');
            if (sideSel) { sideSel.disabled = false; sideSel.value = 'sent'; }
            const lbl = document.getElementById('current-type-label');
            if (lbl) lbl.textContent = '普通气泡 - 我方';
        }
    }

    // 「宽度占比」只对昵称栏有意义（返回键和按钮组本来就是按内容宽的）——
    // 停在别的对象上就整行收掉。
    // ★ 居中档也要收起来：那一档走的是 absolute（块贴着文字居中），
    //   flex-grow 对 absolute 的元素没有意义，生成端同样不会发那条规则。
    // 说明文字不用单独管显隐 —— 它已经是这一行 label 里的一个问号图标，
    // 整行 display:none 的时候跟着一起走（以前那条独立的 #hdrblk-width-hint
    // 要在这里多收一次，漏了就会出现「滑块没了、说明还孤零零留在页面上」）。
    const hdrNow = basicState.header || defaultBasicState.header;
    const showWidth = currentHeaderTarget === 'title' && hdrNow.namePos !== 'center';
    const widthRow = document.getElementById('hdrblk-width-row');
    if (widthRow) widthRow.style.display = showWidth ? '' : 'none';
}

// 把三个「修改对象」下拉归位到第一项。换预设 / 新建 / 重置基础设置时必须跑一遍。
//
// ★★ 必须在 `updateUIFromState()` **之前**调，绝不能在之后。★★
// `updateUIFromState` 会把 `currentXxxTarget` 写进下拉（`select.value = currentFooterTarget`），
// 而它顺带跑的 `syncConditionalRows` 还可能**反过来改** `currentFooterTarget`
// （新预设藏了发送键 → 把选中项顶到「AI 回复按钮」）。所以顺序只能是
// 「先归位 → 再回显」；写在后面就是让状态和下拉当场对不上：
// 下拉显示「AI 回复按钮」而 `currentFooterTarget` 是 `'send'`，用户调出来的颜色
// 全落到那颗藏起来的发送键上 —— 症状是「色块能拨、预览里什么都没变」。
// 这个坑原先在换预设和启动兜底两处各踩了一次（两处都把 `currentFooterTarget = 'send'`
// 写在了 `updateUIFromState()` 后面），所以收口成一个函数、由
// `syncBasicUiFromCss` 在开头统一调用，别再在调用点手写这三行。
//
// ★ 顺手把「我方/对方」那个下拉的 disabled 解掉：中立类（msgtime/timediv/systip/
//   groupname）选中时会把它禁掉（见 updateTypeLabel），不解就会出现「换了预设还是
//   灰的、切不回对方气泡」。
function resetEditTargets() {
    currentSelectType = 'normal_sent';
    currentHeaderTarget = 'back';
    currentFooterTarget = 'send';

    // 气泡那组的三个控件不在 updateUIFromState 的管辖范围内（它只认 currentSelectType
    // 算出来的那份数值），所以在这里一起摆正。
    const typeEl = document.getElementById('setting-bubble-type');
    if (typeEl) typeEl.value = 'normal';
    const sideEl = document.getElementById('setting-bubble-side');
    if (sideEl) { sideEl.value = 'sent'; sideEl.disabled = false; }
    const labelEl = document.getElementById('current-type-label');
    if (labelEl) labelEl.textContent = '普通气泡 - 我方';
}

function updateUIFromState() {
    document.getElementById('setting-hide-avatar').checked = basicState.hideAvatar;
    document.getElementById('setting-time-pos').value = basicState.timePos;
    document.getElementById('setting-time-format').value = basicState.timeFormat;
    document.getElementById('setting-avatar-radius').value = basicState.avatarRadius;
    document.getElementById('val-avatar-radius').textContent =
        basicState.avatarRadius >= 19 ? '正圆' : `${basicState.avatarRadius}px`;
    document.getElementById('setting-custom-font').value = basicState.customFont;
    syncConditionalRows();
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

    // ---- 顶栏那块面板 ----
    // ★ 这两个小工具必须定义在顶栏这一段**之前**：它们是 const，
    //   在声明之前用会撞上暂时性死区直接抛 ReferenceError，而这个函数
    //   每次切预设/切对象都要跑，一抛就是整页控件全不同步。
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    const hdrConf = basicState.header || defaultBasicState.header;
    const namePosEl = document.getElementById('setting-header-name-pos');
    if (namePosEl) namePosEl.value = hdrConf.namePos;
    const hideStatusEl = document.getElementById('setting-header-hide-status');
    if (hideStatusEl) hideStatusEl.checked = !!hdrConf.hideStatus;
    const collapseCallEl = document.getElementById('setting-header-collapse-call');
    if (collapseCallEl) collapseCallEl.checked = !!hdrConf.collapseCall;
    setVal('setting-header-bg', hdrConf.bg);
    setVal('setting-header-bg-text', String(hdrConf.bg).toUpperCase());
    setVal('setting-header-opacity', hdrConf.opacity);
    setTxt('val-header-opacity', hdrConf.opacity);
    setVal('setting-header-blur', hdrConf.blur);
    setTxt('val-header-blur', hdrConf.blur);
    setVal('setting-header-div-w', hdrConf.divW);
    setTxt('val-header-div-w', hdrConf.divW);
    setVal('setting-header-div-c', hdrConf.divC);
    setVal('setting-header-div-c-text', String(hdrConf.divC).toUpperCase());
    setVal('setting-header-btn-c', hdrConf.btnC);
    setVal('setting-header-btn-c-text', String(hdrConf.btnC).toUpperCase());

    // 顶栏三块元素共用下面这一组控件，靠「修改对象」下拉切换（同底栏那套路）。
    const hdrSelectEl = document.getElementById('setting-header-target');
    if (hdrSelectEl) hdrSelectEl.value = currentHeaderTarget;
    const hdrLabelEl = document.getElementById('current-header-label');
    if (hdrLabelEl && hdrSelectEl && hdrSelectEl.selectedIndex >= 0) {
        hdrLabelEl.textContent = hdrSelectEl.options[hdrSelectEl.selectedIndex].text;
    }
    const blkConf = hdrConf[currentHeaderTarget] || defaultBasicState.header[currentHeaderTarget];
    setVal('setting-hdrblk-bg', blkConf.bg);
    setVal('setting-hdrblk-bg-text', String(blkConf.bg).toUpperCase());
    setVal('setting-hdrblk-opacity', blkConf.opacity);
    setTxt('val-hdrblk-opacity', blkConf.opacity);
    setVal('setting-hdrblk-pad', blkConf.pad);
    setTxt('val-hdrblk-pad', blkConf.pad);
    setVal('setting-hdrblk-radius', blkConf.radius);
    setTxt('val-hdrblk-radius', blkConf.radius);
    setVal('setting-hdrblk-stroke-c', blkConf.strokeC);
    setVal('setting-hdrblk-stroke-c-text', String(blkConf.strokeC).toUpperCase());
    setVal('setting-hdrblk-stroke-w', blkConf.strokeW);
    setTxt('val-hdrblk-stroke-w', blkConf.strokeW);
    // 宽度占比只有昵称栏这一块有（别的两块读不到就按默认 100 回显，那一行反正是收着的）
    setVal('setting-hdrblk-width', blkConf.widthPct !== undefined ? blkConf.widthPct : 100);
    setTxt('val-hdrblk-width', blkConf.widthPct !== undefined ? blkConf.widthPct : 100);

    // ---- 底栏那块面板 ----
    const ftrBar = basicState.footer || defaultBasicState.footer;
    const hideSendEl = document.getElementById('setting-footer-hide-send');
    if (hideSendEl) hideSendEl.checked = !!ftrBar.hideSend;
    const collapseToolbarEl = document.getElementById('setting-footer-collapse-toolbar');
    if (collapseToolbarEl) collapseToolbarEl.checked = !!ftrBar.collapseToolbar;
    const collapseReplyEl = document.getElementById('setting-footer-collapse-reply');
    if (collapseReplyEl) collapseReplyEl.checked = !!ftrBar.collapseReply;
    setVal('setting-footer-bar-bg', ftrBar.bg);
    setVal('setting-footer-bar-bg-text', String(ftrBar.bg).toUpperCase());
    setVal('setting-footer-bar-opacity', ftrBar.opacity);
    setTxt('val-footer-bar-opacity', ftrBar.opacity);
    setVal('setting-footer-bar-blur', ftrBar.blur);
    setTxt('val-footer-bar-blur', ftrBar.blur);
    setVal('setting-footer-div-w', ftrBar.divW);
    setTxt('val-footer-div-w', ftrBar.divW);
    setVal('setting-footer-div-c', ftrBar.divC);
    setVal('setting-footer-div-c-text', String(ftrBar.divC).toUpperCase());
    // 工具栏图标颜色（靠一个 CSS 变量一次覆盖全部，见生成端那段注释）
    setVal('setting-footer-btn-c', ftrBar.btnC);
    setVal('setting-footer-btn-c-text', String(ftrBar.btnC).toUpperCase());
    const ftrSelectEl = document.getElementById('setting-footer-target');
    if (ftrSelectEl) ftrSelectEl.value = currentFooterTarget;
    const ftrLabelEl = document.getElementById('current-footer-label');
    if (ftrLabelEl && ftrSelectEl && ftrSelectEl.selectedIndex >= 0) {
        ftrLabelEl.textContent = ftrSelectEl.options[ftrSelectEl.selectedIndex].text;
    }
    const ftrConf = (basicState.footer || {})[currentFooterTarget]
        || defaultBasicState.footer[currentFooterTarget];
    setVal('setting-footer-bg', ftrConf.bg);
    setVal('setting-footer-bg-text', String(ftrConf.bg).toUpperCase());
    setVal('setting-footer-color', ftrConf.color);
    setVal('setting-footer-color-text', String(ftrConf.color).toUpperCase());
    setVal('setting-footer-stroke-c', ftrConf.strokeC);
    setVal('setting-footer-stroke-c-text', String(ftrConf.strokeC).toUpperCase());
    setVal('setting-footer-stroke-w', ftrConf.strokeW);
    setTxt('val-footer-stroke-w', ftrConf.strokeW);
    setVal('setting-footer-radius', ftrConf.radius);
    setTxt('val-footer-radius', ftrConf.radius);
}
