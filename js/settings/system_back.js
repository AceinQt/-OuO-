// --- js/settings/system_back.js ---
// 系统返回键接管（历史栈镜像方案）：
// 每次"前进"导航（切换页面/打开弹窗）都压入一条哨兵历史记录，
// 让历史栈深度始终镜像界面层级。安卓返回键每按一次弹出一条记录，
// 触发 popstate 后按 弹窗 → 页面 的顺序退一层；回到主屏时栈已清空，
// 此时按返回键就是真正退出。
//
// 注意：不能在 popstate 回调里补压记录 —— Chrome 会把非用户手势期间
// pushState 的记录标记为可跳过（防返回键劫持机制），返回键会直接穿透。
// 所以所有 pushState 都必须发生在用户点击的同步调用链里。

(function () {
    let depth = 0;          // 我们压入的哨兵条目数（页面层级 + 打开的弹窗）
    let suppress = 0;       // 待忽略的 popstate 次数（程序主动 back/go 触发的）
    let uiBack = false;     // 当前 switchScreen 是否由界面返回按钮触发
    let fromPop = false;    // 当前 switchScreen 是否由硬件返回键触发
    let modalStack = [];    // 已计入历史栈的弹窗/侧边栏元素

    const enabled = () => !!(window.db && window.db.enableSystemBack === true);

    function pushEntry() {
        history.pushState({ sysBack: true }, '');
        depth++;
    }
    // 程序性返回（点击界面返回按钮 / 弹窗被代码关闭）时同步消耗一条记录
    function consumeEntry() {
        if (depth <= 0) return;
        depth--; suppress++;
        history.back();
    }
    // 回到主屏：一次性清空所有哨兵（history.go 只触发一次 popstate）
    function clearEntries() {
        if (depth <= 0) return;
        suppress++;
        history.go(-depth);
        depth = 0;
    }
    function untrack(el) {
        const i = modalStack.indexOf(el);
        if (i !== -1) modalStack.splice(i, 1);
    }

    // ── 标记界面返回按钮点击（含滑动返回最终触发的合成点击）────
    document.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('.back-btn')) {
            uiBack = true;
            queueMicrotask(() => { uiBack = false; });
        }
    }, true);

    // ── 包装 switchScreen：前进压栈 / 界面返回出栈 / 回主屏清空 ──
    function wrapSwitchScreen() {
        const orig = window.switchScreen;
        if (typeof orig !== 'function' || orig._sysBackWrapped) return;
        const wrapped = function (targetId) {
            if (enabled()) {
                const cur = document.querySelector('.screen.active');
                const curId = cur ? cur.id : null;
                if (curId && curId !== targetId) {
                    if (targetId === 'home-screen') {
                        clearEntries();
                    } else if (fromPop) {
                        // 硬件返回键触发：记录已被浏览器弹出，计数在 popstate 里处理过了
                    } else if (uiBack) {
                        consumeEntry();
                    } else {
                        pushEntry();
                    }
                }
            }
            return orig.apply(this, arguments);
        };
        wrapped._sysBackWrapped = true;
        window.switchScreen = wrapped;
    }

    // ── 弹窗/侧边栏 开关同步进历史栈 ─────────────────────────────
    function isOverlayEl(el) {
        return el.classList.contains('modal-overlay')
            || el.classList.contains('action-sheet-overlay')
            || el.classList.contains('settings-sidebar');
    }
    function isOverlayOpen(el) {
        return el.classList.contains('visible') || el.classList.contains('open');
    }
    const mo = new MutationObserver((muts) => {
        for (const m of muts) {
            const el = m.target;
            if (!(el instanceof Element) || !isOverlayEl(el)) continue;
            const open = isOverlayOpen(el);
            const tracked = modalStack.indexOf(el) !== -1;
            if (open && !tracked) {
                // 弹窗打开都发生在用户点击的调用链里，此时压栈记录不会被跳过
                if (enabled()) { modalStack.push(el); pushEntry(); }
            } else if (!open && tracked) {
                // 被界面按钮或 switchScreen 关闭（硬件返回关闭的已提前 untrack）
                untrack(el);
                consumeEntry();
            }
        }
    });
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

    // ── 硬件返回键处理 ───────────────────────────────────────────
    function closeTopOverlay() {
        const sidebar = document.querySelector('.settings-sidebar.open');
        if (sidebar) {
            untrack(sidebar); // 先移出跟踪，防止 observer 再消耗一条记录
            sidebar.classList.remove('open');
            return true;
        }
        const overlays = document.querySelectorAll('.modal-overlay.visible, .action-sheet-overlay.visible');
        if (overlays.length > 0) {
            const top = overlays[overlays.length - 1];
            untrack(top);
            top.classList.remove('visible');
            return true;
        }
        return false;
    }

    function handleBack() {
        if (closeTopOverlay()) return;

        const active = document.querySelector('.screen.active');
        if (!active || active.id === 'home-screen') return; // 主屏残留记录：静默排掉

        const backBtn = active.querySelector('.back-btn');

        // Peek 多选模式：返回键先退出多选，页面不动，把消耗掉的哨兵补回来
        // （此处补压无手势、可能被标记可跳过，尽力而为）
        if (window.PeekDeleteManager && window.PeekDeleteManager.isEditMode && backBtn) {
            backBtn.click();
            pushEntry();
            return;
        }

        if (backBtn) { backBtn.click(); return; } // 计数由 wrapper 的 fromPop 分支处理
        if (typeof navigateTo === 'function') navigateTo('home-screen');
    }

    window.addEventListener('popstate', () => {
        if (suppress > 0) { suppress--; return; }
        if (!enabled()) return;
        if (depth > 0) depth--; // 硬件返回消耗了一条哨兵
        fromPop = true;
        try { handleBack(); } finally { fromPop = false; }
    });

    // ── 开关 UI ──────────────────────────────────────────────────
    window.setupSystemBackToggle = function () {
        wrapSwitchScreen();
        const toggle = document.getElementById('system-back-toggle');
        if (toggle) {
            toggle.checked = enabled();
            toggle.addEventListener('change', function () {
                if (window.db) window.db.enableSystemBack = this.checked;
                saveGlobalKeys(['enableSystemBack']);
                if (this.checked) {
                    // 开关在设置页打开：当前不在主屏，先压一条让返回键立即可用
                    const active = document.querySelector('.screen.active');
                    if (active && active.id !== 'home-screen') pushEntry();
                } else {
                    clearEntries();
                    modalStack = [];
                }
            });
        }
    };
})();
