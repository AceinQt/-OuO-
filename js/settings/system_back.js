// --- js/settings/system_back.js ---
// 系统返回键接管（历史栈镜像方案）：
// 每次"前进"导航（切换页面/打开弹窗）都压入一条哨兵历史记录，
// 让历史栈深度始终镜像界面层级。安卓返回键每按一次弹出一条记录，
// 触发 popstate 后按 弹窗 → 页面 的顺序退一层；回到主屏时栈已清空，
// 此时按返回键就是真正退出。
//
// ★ 层级标记对账（2026-09-15 假重启修复）：
// 老实现只用内存计数 depth 做加减，计数一旦漂移（Chrome 会把无手势期间
// pushState 的记录标记为"可跳过"，硬件返回键遇到它一次弹多层却只来一个
// popstate，depth 少减一条；back() 的异步遍历还会和紧随其后的 pushState
// 交错），depth 就会大于真实层数。此时 back()/go(-depth) 会退过本文档在
// 历史栈里的第一条记录、落到同 URL 的前一个文档条目上 —— 页面被卸载，
// 又以 back_forward 方式重新载入，用户看到的就是"假重启"（每次发生还会
// 往标签历史里再添一条同 URL 文档条目，越滚越容易复发）。
// 现在每条哨兵都带 { sysBack, lvl } 层级号，起始条目标记 lvl 0；
// 每次 popstate 先用 event.state.lvl 把 depth 一次对平，漂移不再累积；
// consumeEntry/clearEntries 在栈底一律拒绝继续回退，保证绝不跨文档。
//
// 注意：不能在 popstate 回调里补压记录 —— Chrome 会把非用户手势期间
// pushState 的记录标记为可跳过（防返回键劫持机制），返回键会直接穿透。
// 所以所有 pushState 都必须发生在用户点击的同步调用链里。

(function () {
    let depth = 0;          // 当前 history 层级（0 = 本文档的起始条目）
    let suppress = 0;       // 待忽略的 popstate 次数（程序主动 back/go 触发的）
    let uiBack = false;     // 当前 switchScreen 是否由界面返回按钮触发
    let fromPop = false;    // 当前 switchScreen 是否由硬件返回键触发
    let modalStack = [];    // 已计入历史栈的弹窗/侧边栏元素

    // 本文档起始条目在标签历史栈中的序号。文档加载时它必然是最后一条
    // （导航会截断前向记录、把新条目追加到末尾），此后整个文档生命周期不变。
    const baseIndex = history.length - 1;
    // 给起始条目打上 lvl 0 标记。此后每条哨兵带自己的层级号，
    // popstate 的 event.state 就成了"现在真实在第几层"的唯一事实来源。
    // （main.js 通知冷启动时的 replaceState(null) 可能抹掉这个标记，
    //  对账逻辑对无标记条目一律按 lvl 0 处理，结果相同。）
    try { history.replaceState({ sysBack: true, lvl: 0 }, '', location.href); } catch (_) {}

    const enabled = () => !!(window.db && window.db.enableSystemBack === true);

    function pushEntry() {
        history.pushState({ sysBack: true, lvl: depth + 1 }, '');
        depth++;
    }
    // 程序性返回（点击界面返回按钮 / 弹窗被代码关闭）时同步消耗一条记录。
    // depth<=0 说明已在本文档栈底：绝不能再 back() —— 那会退到同 URL 的
    // 前一个文档条目上，页面被卸载重载，正是"假重启"的形态。
    function consumeEntry() {
        if (depth <= 0) return;
        depth--; suppress++;
        history.back();
    }
    // 回到主屏：一次性清空所有哨兵（history.go 只触发一次 popstate）。
    // depth 经 popstate 对账，正常就是准确值；再加一道保险 —— 回退步数
    // 不得超过"本文档起始条目到栈顶"的距离，无论如何不跨文档。
    function clearEntries() {
        if (depth <= 0) return;
        const maxBack = Math.max(0, history.length - 1 - baseIndex);
        const steps = Math.min(depth, maxBack);
        if (steps > 0) { suppress++; history.go(-steps); }
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

        // 忙锁：长操作进行中（备份导出/导入等）不响应返回键。
        // 记录已经被浏览器弹掉了，得补压一条回去，否则解锁后按返回键会少一层
        // ——直接穿透退出 app。（同 Peek 多选模式那段，无手势期间的补压是尽力而为）
        if (typeof window.isUiBusy === 'function' && window.isUiBusy()) {
            pushEntry();
            return;
        }

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

        // 喵坛长按多选：同上，返回键先退出多选，页面不动。
        // 这里不能走 backBtn.click() —— 喵坛主页那个返回键是直接回主屏的
        if (typeof isForumMultiSelectActive === 'function' && isForumMultiSelectActive()) {
            exitForumMultiSelectMode();
            pushEntry();
            return;
        }

        if (backBtn) { backBtn.click(); return; } // 计数由 wrapper 的 fromPop 分支处理
        if (typeof navigateTo === 'function') navigateTo('home-screen');
    }

    window.addEventListener('popstate', (e) => {
        // ★ 先对账：event.state.lvl 是浏览器给的事实。无论这次 popstate 是
        // 程序 back/go 触发的，还是硬件返回键（含"跳过可跳过条目"一次弹多层，
        // 只有这一个 popstate），落点层级都以它为准、depth 一次对平。
        // 老实现只做 depth--：条目被跳过时就少减一条，depth 越积越大，
        // 最终 back()/go(-depth) 退出了本文档 —— 2026-09-15 两次"假重启"就是这么来的。
        const st = e.state;
        depth = (st && st.sysBack && typeof st.lvl === 'number') ? st.lvl : 0;
        if (suppress > 0) { suppress--; return; }
        if (!enabled()) return;
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
