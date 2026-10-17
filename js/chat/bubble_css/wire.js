// --- START OF FILE bubble_css/wire.js ---
// ======================================================================
// setupBubblePresets 本体：把上面那些函数接到几十个控件上，
// 外加预设的新建/保存/删除、管理弹窗、导入导出、以及启动兜底。
//
// 这一个文件里仍然留着闭包 —— 但闭包里只剩**真正局部**的东西：
// 几个缓存的 DOM 引用、当前编辑的预设名、几张「控件 id → 字段」对照表。
// 状态（basicState 等）已经全在 state.js。
//
// ★ 只许初始化一次，理由见下面 _bubblePresetsInited 那段。
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


// ★★ 只许初始化一次。★★
// `setupBubblePresets` 有**两个**调用点（`main.js` 的 init 直接调一次、它上一行的
// `setupChatListScreen` 里又调一次），而下面整个函数体是个**闭包** —— `basicState`、
// `currentSelectType`、`currentFooterTarget`、`currentHeaderTarget` 全是 `let`，
// 调两次就是**两份互不相干的状态，绑在同一批控件上**。后果不是"把同一个值写两遍"：
//
//   · 「管理」「新建」「保存」「删除」这几颗按钮是 cloneNode 去重绑定的，所以**只有
//     第二个闭包**收得到"换预设"这件事；第一个闭包的状态从此冻结在启动时那一份。
//   · 可是滑块/取色器/下拉/开关**没有**去重，两个闭包都在听，而且第一个先触发。
//   · 于是：在 A 预设里勾了「收纳发送按钮」→ 两个闭包都记下 hideSend=true（开关是共听的）；
//     切到没收纳的 B 预设 → 只有第二个闭包把状态换成了 B，第一个还停在 hideSend=true。
//     这时去点「修改对象 → 发送按钮」，第一个闭包的 change 先跑，它的 syncConditionalRows
//     按自己那份陈旧状态把这个 option 重新 disabled、并把下拉顶回「AI 回复按钮」；
//     第二个闭包紧接着读 `e.target.value`，读到的已经是被顶回去的 'reply'。
//     症状就是用户报的「从 A 切到 B 以后，B 的发送按钮点不中、改色没反应」。
//
// 修法是守卫掉第二次调用，不是去把两份状态同步 —— 同一套控件只该有一个状态源。
// 两个调用点都保留（`tests/appearance_bars.test.cjs` 明写了两处都要在，那是故意的：
// 哪条路径先走到都能完成初始化），谁先到谁生效。
// 下面那些 cloneNode 去重因此降级成第二道保险，留着不碍事。
let _bubblePresetsInited = false;

function setupBubblePresets() {
    if (_bubblePresetsInited) return;
    _bubblePresetsInited = true;

    // 记录当前正在编辑的预设原始名称 (空表示全新新建)
    let currentEditingPresetOriginalName = "";

    const nameInput = document.getElementById('global-bubble-preset-name');
    const cssInput = document.getElementById('global-bubble-custom-css');
    const saveBtn = document.getElementById('global-bubble-save-btn');
    const delBtn = document.getElementById('global-bubble-delete-btn');
    const addBtn = document.getElementById('global-bubble-add-btn');

    const updatePreview = () => refreshBubbleCssPreview();
    updatePreview();

    // ================== 分栏 Tab 切换逻辑 ==================
    // 按钮只管「哪个分组」，具体亮哪块面板交给 syncAppearancePane ——
    // 「基础」下面有三块（气泡/顶栏/底栏），选哪块取决于预览翻到了第几页。
    const tabContainer = document.getElementById('tab-view-bubbles');
    if (tabContainer) {
        tabContainer.querySelectorAll('.side-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                currentAppearanceTab = btn.dataset.tab || 'basic';
                syncAppearancePane();
            });
        });
    }


    // ================= 绑定所有的 UI 事件 =================
    const typeSelect = document.getElementById('setting-bubble-type');
    const sideSelect = document.getElementById('setting-bubble-side');

    function updateTypeLabel() {
        const t = typeSelect.value;
        const s = sideSelect.value;
        const tName = typeSelect.options[typeSelect.selectedIndex].text;
        // 旁白以前是「中立」的一类、side 下拉被禁用；现在和普通气泡一样分两侧：
        // 我方 = 用户自己发的剧情旁白，对方 = AI 写的旁白。
        // 真正中立的是后面补的那四类小字（时间 / 分割线 / 系统提示 / 群昵称）——
        // 它们在静态 CSS 里两侧共用一条规则，拆成两套只是让用户多调一遍。
        if (NEUTRAL_TYPES.has(t)) {
            sideSelect.disabled = true;
            currentSelectType = t;
            document.getElementById('current-type-label').textContent = tName;
        } else {
            sideSelect.disabled = false;
            currentSelectType = `${t}_${s}`;
            const sName = sideSelect.options[sideSelect.selectedIndex].text;
            document.getElementById('current-type-label').textContent = `${tName} - ${sName}`;
        }
        updateUIFromState();
        // 这两个下拉本来就只在气泡那块面板上，能点到它说明已经停在第 0 页了；
        // 保留这句是为了「换气泡类型一定看得到气泡」，顺带把面板也校准回去。
        setPreviewMode(0);
    }
    typeSelect.addEventListener('change', updateTypeLabel);
    sideSelect.addEventListener('change', updateTypeLabel);['setting-hide-avatar', 'setting-time-pos', 'setting-time-format', 'setting-custom-font'].forEach(id => {
        document.getElementById(id).addEventListener('change', (e) => {
            if(id === 'setting-hide-avatar') {
                basicState.hideAvatar = e.target.checked;
                // 藏头像的同时正停在「头像下方」的话，把位置退回「气泡上方」——
                // 理由见 syncConditionalRows 里那段注释（头像列宽度会随时间文字变化）
                if (basicState.hideAvatar && basicState.timePos === 'avatar') {
                    basicState.timePos = 'above';
                    document.getElementById('setting-time-pos').value = 'above';
                }
            }
            if(id === 'setting-time-pos') basicState.timePos = e.target.value;
            if(id === 'setting-time-format') basicState.timeFormat = e.target.value.trim() || defaultBasicState.timeFormat;
            if(id === 'setting-custom-font') basicState.customFont = e.target.value;
            syncConditionalRows();
            // 时间位置拨到「不显示」会把「消息时间」那个选项禁掉、可能顺带把当前选中的
            // 修改对象顶回普通气泡（见 syncConditionalRows），所以得重新同步一遍控件 ——
            // 不同步的话色块里还显示着时间那组的数值，而再拨一下写进去的是普通气泡，
            // 用户会看到"我调的是时间，普通气泡却变色了"。同底栏藏发送键那条处理。
            if(id === 'setting-time-pos') updateUIFromState();
            generateCssFromState();
        });
    });

    // 时间格式用 input 而不是 change：边打字边在预览里看效果，不用先失焦
    const timeFormatInput = document.getElementById('setting-time-format');
    if (timeFormatInput) {
        timeFormatInput.addEventListener('input', (e) => {
            basicState.timeFormat = e.target.value.trim() || defaultBasicState.timeFormat;
            generateCssFromState();
        });
    }

    // 头像弧度滑块。到顶显示「正圆」而不是「19px」—— 用户要的是那个语义，
    // 而且头像尺寸一改，19 这个数字就不成立了
    const avatarRadiusInput = document.getElementById('setting-avatar-radius');
    if (avatarRadiusInput) {
        avatarRadiusInput.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10) || 0;
            basicState.avatarRadius = v;
            const disp = document.getElementById('val-avatar-radius');
            if (disp) disp.textContent = v >= 19 ? '正圆' : `${v}px`;
            generateCssFromState();
        });
    }

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

    // ================== 顶栏 / 底栏的控件 ==================
    // 两块面板的控件都只改 basicState 再 generateCssFromState()，
    // 和气泡那块完全一个路子 —— 生成端是唯一出口，别在这里自己拼 CSS。
    const bindHeaderInput = (id, apply) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', (e) => {
            if (!basicState.header) basicState.header = { ...defaultBasicState.header };
            apply(e.target);
            // 「昵称位置」切到/离开居中档时，下面那条「宽度占比」要跟着收起/露出
            // （居中走 absolute，flex-grow 对它没意义）。顺手都过一遍，便宜。
            syncConditionalRows();
            generateCssFromState();
        });
    };
    bindHeaderInput('setting-header-name-pos', t => { basicState.header.namePos = t.value; });
    bindHeaderInput('setting-header-hide-status', t => { basicState.header.hideStatus = t.checked; });
    bindHeaderInput('setting-header-collapse-call', t => { basicState.header.collapseCall = t.checked; });

    const collapseToolbarCb = document.getElementById('setting-footer-collapse-toolbar');
    if (collapseToolbarCb) {
        collapseToolbarCb.addEventListener('change', (e) => {
            if (!basicState.footer) basicState.footer = JSON.parse(JSON.stringify(defaultBasicState.footer));
            basicState.footer.collapseToolbar = e.target.checked;
            generateCssFromState();
        });
    }

    const collapseReplyCb = document.getElementById('setting-footer-collapse-reply');
    if (collapseReplyCb) {
        collapseReplyCb.addEventListener('change', (e) => {
            if (!basicState.footer) basicState.footer = JSON.parse(JSON.stringify(defaultBasicState.footer));
            basicState.footer.collapseReply = e.target.checked;
            generateCssFromState();
        });
    }

    // 顶栏/底栏「栏本体 + 顶栏按钮」那几组控件。和下面 footerInputsMap 同一个路子，
    // 区别只在写进 basicState.header / basicState.footer 的**顶层**
    // （footerInputsMap 写的是 footer 底下 send/reply/input 三个对象之一）。
    // peer 一栏：'number' 填数值回显的 span id，色值两项互填对方的 id。
    const BAR_INPUTS = [
        ['setting-header-bg',            'header', 'bg',      'color',  'setting-header-bg-text'],
        ['setting-header-bg-text',       'header', 'bg',      'text',   'setting-header-bg'],
        ['setting-header-opacity',       'header', 'opacity', 'number', 'val-header-opacity'],
        ['setting-header-blur',          'header', 'blur',    'number', 'val-header-blur'],
        ['setting-header-btn-c',         'header', 'btnC',    'color',  'setting-header-btn-c-text'],
        ['setting-header-btn-c-text',    'header', 'btnC',    'text',   'setting-header-btn-c'],
        ['setting-header-div-w',         'header', 'divW',    'number', 'val-header-div-w'],
        ['setting-header-div-c',         'header', 'divC',    'color',  'setting-header-div-c-text'],
        ['setting-header-div-c-text',    'header', 'divC',    'text',   'setting-header-div-c'],
        ['setting-footer-bar-bg',        'footer', 'bg',      'color',  'setting-footer-bar-bg-text'],
        ['setting-footer-bar-bg-text',   'footer', 'bg',      'text',   'setting-footer-bar-bg'],
        ['setting-footer-bar-opacity',   'footer', 'opacity', 'number', 'val-footer-bar-opacity'],
        ['setting-footer-bar-blur',      'footer', 'blur',    'number', 'val-footer-bar-blur'],
        ['setting-footer-btn-c',         'footer', 'btnC',    'color',  'setting-footer-btn-c-text'],
        ['setting-footer-btn-c-text',    'footer', 'btnC',    'text',   'setting-footer-btn-c'],
        ['setting-footer-div-w',         'footer', 'divW',    'number', 'val-footer-div-w'],
        ['setting-footer-div-c',         'footer', 'divC',    'color',  'setting-footer-div-c-text'],
        ['setting-footer-div-c-text',    'footer', 'divC',    'text',   'setting-footer-div-c']
    ];
    BAR_INPUTS.forEach(([id, section, key, kind, peerId]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            let val = e.target.value;
            if (kind === 'number') {
                val = parseFloat(val) || 0;
                const disp = document.getElementById(peerId);
                if (disp) disp.textContent = val;
            }
            if (!basicState[section]) {
                basicState[section] = JSON.parse(JSON.stringify(defaultBasicState[section]));
            }
            basicState[section][key] = val;

            // 取色器 ↔ 手输框互相回填。手输的只在凑够 6 位合法 HEX 时才回填取色器，
            // 否则打字到一半（#0 / #00…）就会把取色器推成黑色。
            if (kind === 'color') {
                const t = document.getElementById(peerId);
                if (t) t.value = String(val).toUpperCase();
            }
            if (kind === 'text' && /^#[0-9A-F]{6}$/i.test(val)) {
                const c = document.getElementById(peerId);
                if (c) c.value = val;
            }
            generateCssFromState();
        });
    });

    // ---- 顶栏三块元素：「修改对象」下拉 + 共用的那一组控件 ----
    // 和下面底栏的 footerInputsMap 同一个路子，区别只在写进的是 basicState.header
    // 底下 back/title/group 三个对象之一。
    //
    // 往当前对象上写一个字段。老预设里 header 可能整块缺失、或缺这三个子对象，
    // 所以每次都以默认值为底板补齐再写（和底栏那边同一套防御）。
    const writeHeaderBlock = (key, val) => {
        if (!basicState.header) {
            basicState.header = JSON.parse(JSON.stringify(defaultBasicState.header));
        }
        if (!basicState.header[currentHeaderTarget]) {
            basicState.header[currentHeaderTarget] =
                { ...defaultBasicState.header[currentHeaderTarget] };
        }
        basicState.header[currentHeaderTarget][key] = val;
    };

    const headerTargetSel = document.getElementById('setting-header-target');
    if (headerTargetSel) {
        headerTargetSel.addEventListener('change', (e) => {
            currentHeaderTarget = e.target.value;
            // 换对象只是换一组数值进控件，不产生新 CSS。但「贴合文字」那行只属于昵称栏，
            // 得跟着藏/放 —— 所以这里要多走一趟 syncConditionalRows。
            syncConditionalRows();
            updateUIFromState();
        });
    }

    // 控件 id → [字段, 类型, 伙伴 id]。'number' 的伙伴是数值回显的 span，
    // 色值两项互填对方的 id（取色器 ↔ 手输框）。
    const HDR_BLOCK_INPUTS = {
        'setting-hdrblk-bg':            ['bg',      'color',  'setting-hdrblk-bg-text'],
        'setting-hdrblk-bg-text':       ['bg',      'text',   'setting-hdrblk-bg'],
        'setting-hdrblk-opacity':       ['opacity', 'number', 'val-hdrblk-opacity'],
        'setting-hdrblk-pad':           ['pad',     'number', 'val-hdrblk-pad'],
        'setting-hdrblk-radius':        ['radius',  'number', 'val-hdrblk-radius'],
        'setting-hdrblk-stroke-c':      ['strokeC', 'color',  'setting-hdrblk-stroke-c-text'],
        'setting-hdrblk-stroke-c-text': ['strokeC', 'text',   'setting-hdrblk-stroke-c'],
        'setting-hdrblk-stroke-w':      ['strokeW', 'number', 'val-hdrblk-stroke-w'],
        'setting-hdrblk-width':         ['widthPct', 'number', 'val-hdrblk-width']
    };
    Object.keys(HDR_BLOCK_INPUTS).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            const [key, kind, peerId] = HDR_BLOCK_INPUTS[id];
            let val = e.target.value;
            if (kind === 'number') {
                val = parseFloat(val) || 0;
                const disp = document.getElementById(peerId);
                if (disp) disp.textContent = val;
            }
            writeHeaderBlock(key, val);

            // 取色器 ↔ 手输框互相回填。手输的只在凑够 6 位合法 HEX 时才回填取色器，
            // 否则打字到一半（#0 / #00…）就会把取色器推成黑色。
            if (kind === 'color') {
                const t = document.getElementById(peerId);
                if (t) t.value = String(val).toUpperCase();
            }
            if (kind === 'text' && /^#[0-9A-F]{6}$/i.test(val)) {
                const c = document.getElementById(peerId);
                if (c) c.value = val;
            }
            generateCssFromState();
        });
    });

    const hideSendCb = document.getElementById('setting-footer-hide-send');    if (hideSendCb) {
        hideSendCb.addEventListener('change', (e) => {
            if (!basicState.footer) basicState.footer = JSON.parse(JSON.stringify(defaultBasicState.footer));
            basicState.footer.hideSend = e.target.checked;
            // 藏发送键会把「修改对象」里那一项禁掉（可能顺带把当前选中项顶走），
            // 所以得重新同步一遍控件，不然下面的色块还停在刚才那个对象上。
            syncConditionalRows();
            updateUIFromState();
            generateCssFromState();
        });
    }

    const footerTargetSel = document.getElementById('setting-footer-target');
    if (footerTargetSel) {
        footerTargetSel.addEventListener('change', (e) => {
            currentFooterTarget = e.target.value;
            updateUIFromState();   // 换对象只是换一组数值进控件，不产生新 CSS
        });
    }

    // 控件 → 当前对象的字段。'text' 那两对是色值的手输框。
    const footerInputsMap = {
        'setting-footer-bg':         ['bg', 'color'],
        'setting-footer-bg-text':    ['bg', 'text'],
        'setting-footer-color':      ['color', 'color'],
        'setting-footer-color-text': ['color', 'text'],
        'setting-footer-stroke-c':   ['strokeC', 'color'],
        'setting-footer-stroke-c-text': ['strokeC', 'text'],
        'setting-footer-stroke-w':   ['strokeW', 'number'],
        'setting-footer-radius':     ['radius', 'number']
    };
    Object.keys(footerInputsMap).forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            const [key, kind] = footerInputsMap[id];
            let val = e.target.value;
            if (kind === 'number') {
                val = parseFloat(val) || 0;
                const disp = document.getElementById(id.replace('setting-footer-', 'val-footer-'));
                if (disp) disp.textContent = val;
            }
            if (!basicState.footer) basicState.footer = JSON.parse(JSON.stringify(defaultBasicState.footer));
            if (!basicState.footer[currentFooterTarget]) {
                basicState.footer[currentFooterTarget] = { ...defaultBasicState.footer[currentFooterTarget] };
            }
            basicState.footer[currentFooterTarget][key] = val;

            // 取色器 ↔ 手输框互相回填。手输的只在凑够 6 位合法 HEX 时才回填取色器，
            // 否则打字到一半（#0 / #00…）就会把取色器推成黑色。
            // ★ 这里按「手输框 id = 取色器 id + '-text'」的命名约定推出对方，
            //   不要再逐个 id 硬写 —— 原先 bg / strokeC 各抄了一份四行的 if，
            //   加第三对（color）时很容易只抄一半，症状是"取色器调了手输框不跟着变"。
            if (kind === 'color') {
                const t = document.getElementById(`${id}-text`);
                if (t) t.value = String(val).toUpperCase();
            }
            if (kind === 'text' && /^#[0-9A-F]{6}$/i.test(val)) {
                const c = document.getElementById(id.replace(/-text$/, ''));
                if (c) c.value = val;
            }
            generateCssFromState();
        });
    });

    const resetBasicBtn = document.getElementById('reset-basic-css-btn');
    if (resetBasicBtn) {
        resetBasicBtn.addEventListener('click',async () => {
             if (!await AppUI.confirm('是否确定重置基础设置，默认气泡样式将恢复原始样式。', "系统提示", "确认", "取消")) return; 
            basicState = JSON.parse(JSON.stringify(defaultBasicState));
            resetEditTargets();   // 同新建：归位要排在回显前面
            updateUIFromState();
            generateCssFromState(); 
            updatePreview();
            if(window.showToast) showToast('已清除基础配置');
        });
    }

    // 翻预览 = 翻下面的编辑栏目（气泡 / 顶栏 / 底栏），所以走 setPreviewMode 而不是直接赋值。
    //
    // ★ 必须先 cloneNode 去掉旧监听：setupBubblePresets 被调**两次**
    //   （main.js 的 init 一次、chat_list.js 的 setupChatListScreen 一次），
    //   不去重就是一次点击挂两个 +1，三页里点一下跳两页 —— 点 ▶ 看起来像在倒着翻。
    //   别的控件多绑一遍只是把同一个值写两遍（浪费但无害），只有这两颗是累加型的，
    //   所以单独处理它们。文件里的 addBtn/saveBtn/delBtn 用的也是这个套路。
    const rebind = (id, handler) => {
        const old = document.getElementById(id);
        if (!old) return;
        const fresh = old.cloneNode(true);
        old.parentNode.replaceChild(fresh, old);
        fresh.addEventListener('click', handler);
    };
    rebind('preview-prev-btn', () => setPreviewMode(currentPreviewMode - 1));
    rebind('preview-next-btn', () => setPreviewMode(currentPreviewMode + 1));

    // 「自动生成的样式」那个折叠框。用的是全项目共用的 .collapsible-section
    // （components.css），toggle 写法照抄 customize.js。
    // ★ 必须像 addBtn/saveBtn/翻页键那样 cloneNode 去重绑定：setupBubblePresets 会被
    //   调两次（main.js 的 init + chat_list.js 的 setupChatListScreen），绑两遍的话
    //   点一下 toggle 两次 = 原地不动，症状是「点了没反应」。
    const genHeader = document.querySelector('#bubble-generated-css-section .collapsible-header');
    if (genHeader) {
        const freshHeader = genHeader.cloneNode(true);
        genHeader.parentNode.replaceChild(freshHeader, genHeader);
        freshHeader.addEventListener('click', () => {
            freshHeader.parentElement.classList.toggle('open');
        });
    }

    if(cssInput) {
        cssInput.addEventListener('input', () => {
            // ★ 这里**不能**再无脑 syncBasicUiFromCss(cssInput.value)。
            //   拆两个框之后这个 textarea 里只有用户手写的那半边、不含 META 注释，
            //   反解会把整块基础设置重置成默认值 —— 症状是"在高级框里随便敲个字，
            //   上面调好的气泡全变回出厂样子"。面板状态的权威来源是 basicState，
            //   它已经镜像在只读框的 META 里了，用户打字不该动它。
            // 唯一要反解的情况：用户整段粘进来一份别人分享的完整 CSS（里面带生成块）。
            //   这时把它摊回两个框，再按 META 还原面板 —— 比拆之前更顺手。
            if (cssInput.value.includes(START_MARKER)) {
                const full = cssInput.value;
                spreadBubbleCss(full);
                syncBasicUiFromCss(full);
            }
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

            // 新建 = 一份出厂状态，三个「修改对象」下拉也得跟着回到第一项
            // （归位必须排在 updateUIFromState 前面，理由见 resetEditTargets 的注释）。
            basicState = JSON.parse(JSON.stringify(defaultBasicState));
            resetEditTargets();
            updateUIFromState();
            currentEditingPresetOriginalName = ""; 
            if(nameInput) nameInput.value = newName;
            
            // 两个框一起清空。生成块那半边交给 generateCssFromState ——
            // basicState 刚重置成默认，hasChanges 为假，它会把只读框清掉。
            spreadBubbleCss('');
            generateCssFromState();
            if(delBtn) delBtn.style.display = 'none';
            if(window.showToast) showToast('已准备新建模板，请配置后保存');
        });
    }

    // ================== 保存预设逻辑 ==================
    if (saveBtn) {
        const newSaveBtn = saveBtn.cloneNode(true); saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
        newSaveBtn.addEventListener('click', async () => {
            const newName = nameInput ? nameInput.value.trim() : "";
            const newCss = composeBubbleCss().trim();
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

            const editBtn = mkPresetRowBtn('edit', '编辑');
            editBtn.onclick = function() {
                currentEditingPresetOriginalName = p.name;
                if(nameInput) nameInput.value = p.name;
                if(cssInput) { spreadBubbleCss(p.css); syncBasicUiFromCss(p.css); }
                if(delBtn) delBtn.style.display = p.isDefault ? 'none' : 'block';

                // 三个「修改对象」下拉的归位 + 控件回显都在 syncBasicUiFromCss 里做完了
                // （它开头 resetEditTargets()、结尾 updateUIFromState()）。
                // 这里原先手抄了一遍那几行，而且把 `currentFooterTarget = 'send'` 落在了
                // updateUIFromState **后面** —— 新预设要是藏了发送键，syncConditionalRows
                // 刚把选中项顶到「AI 回复按钮」，这一行又偷偷把状态改回 'send'，
                // 于是下拉显示的和实际在改的不是同一个按钮。别再往这里加归位代码。

                // 换了预设就回到第一页：下面的面板跟着回到「气泡」，
                // 否则上一次停在底栏、换完预设看到的还是底栏那组控件。
                setPreviewMode(0);
                if(window.showToast) showToast(`已加载预设: ${p.name}`);
                modal.style.display = 'none'; modal.classList.remove('visible');
            };
            btnWrap.appendChild(editBtn);

            // ★ 复制（= 另存为）。用户的真实处境：手滑把「默认」改了并保存，而「默认」
            //   会强制注入到所有还没单独指定外观的聊天，于是一改就是全局生效、想单独
            //   留一份都没地方留。复制一份出来就能把改好的样子落成独立预设，
            //   然后把「默认」改回去。所以**「默认」这行也要有这颗按钮**。
            // ★ 只复制**存盘的那份 css**，不碰编辑器里的未保存改动 —— 行上的按钮应该
            //   对应行上的那个预设，顺手把编辑器状态塞进来会变成「复制出来的东西和
            //   我点的那行不一样」。（想另存编辑器里的未保存改动：在名称框里换个名字
            //   直接点保存就是新建，保存逻辑的 else 分支已经是这个行为。）
            // ★ 新预设不需要动任何聊天：还没有聊天指向它。
            const copyBtn = mkPresetRowBtn('copy', '复制为新预设');
            copyBtn.onclick = async function () {
                const presetsAll = _getBubblePresets();
                const newName = _nextCopyPresetName(p.name, presetsAll);
                presetsAll.push({ name: newName, css: p.css || '' });
                _saveBubblePresets(presetsAll);
                await saveGlobalKeys(['bubbleCssPresets']);

                openManagePresetsModal();
                if (typeof window.populateChatThemeSelects === 'function') window.populateChatThemeSelects();
                if (window.showToast) showToast(`已复制为「${newName}」`);
            };
            btnWrap.appendChild(copyBtn);

            if (!p.isDefault) {
                const renameBtn = mkPresetRowBtn('rename', '重命名');
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

                const delListBtn = mkPresetRowBtn('del', '删除', 'del-btn');
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

    // ================== 导出：只导「当前这一套」 ==================
    // ★ 导的是**编辑器里现在这一份**（名字取名称框、CSS 取 composeBubbleCss()），
    //   不是整个预设库 —— 用户要的是单独分享一套外观，以前一点就把全部预设打包出去。
    //   取 composeBubbleCss() 而不是读那个 textarea：高级 Tab 已经拆成两个框，
    //   直接读只拿到用户手写的那半边，生成块会整段丢掉。
    // ★ 格式仍是**数组**（只装一个元素）：导入端按数组解析，老版本导出的多预设文件、
    //   别人分享的文件都还能照常导进来，别图省事换成裸对象。
    // ★ 必须走 Blob + `application/json`，**不能用 `data:text/json;charset=utf-8,...`**
    //   那套老写法（2026-10-08 之前就是）：安卓下载管理器把 `text/json` 原样记进
    //   MediaStore，而系统文件选择器是按 MIME 过滤的（accept 里的 `.json` 被 Chrome
    //   翻成 `application/json`），两边对不上 —— 文件明明躺在下载目录里，导入列表里
    //   却根本看不见，症状是「别的 json 都在，就我导的这个没有」。项目里别处的导出
    //   （api_settings.js 那几个预设）一直用的就是 Blob + application/json，照抄它。
    const exportBtn = document.getElementById('global-bubble-export-btn');
    if (exportBtn) {
        const newExportBtn = exportBtn.cloneNode(true); exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);
        newExportBtn.addEventListener('click', () => {
            const name = (nameInput ? nameInput.value.trim() : '') || currentEditingPresetOriginalName;
            if (!name) return (window.showToast && showToast('请先给这套外观起个名字'));

            const one = { name, css: composeBubbleCss().trim() };
            const blob = new Blob([JSON.stringify([one], null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${_presetFileSafeName(name)}_ouobubblepreset.json`;
            document.body.appendChild(a); a.click();
            setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
            if (window.showToast) showToast(`已导出外观：${name}`);
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
        spreadBubbleCss(defaultPreset.css);
        syncBasicUiFromCss(defaultPreset.css);
    } else {
        spreadBubbleCss('');
        syncBasicUiFromCss('');
        generateCssFromState();
    }

    // 「修改对象」的归位 + 控件回显同样由 syncBasicUiFromCss 一手做完
    // （开头 resetEditTargets()、结尾 updateUIFromState()）。这里原先手抄了一遍，
    // 并且把 `currentFooterTarget = 'send'` 写在了 updateUIFromState 后面 ——
    // 「默认」预设本身就藏了发送键的话，刚启动就是「下拉显示 AI 回复按钮、
    // 实际在改发送键」，不换预设也能复现「改了色没反应」。详见 resetEditTargets。

    // 初始态：预览停在第一页，下面的面板也就是「基础 → 气泡」。
    currentAppearanceTab = 'basic';
    setPreviewMode(0);
}

// 确保页面加载完成后执行绑定
window.setupBubblePresets = setupBubblePresets;
