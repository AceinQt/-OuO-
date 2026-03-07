// --- js/settings/swipe_back.js ---

(function () {
    let startX = 0, startY = 0;
    let isSwiping = false, hasTriggered = false;
    let directionLocked = false;
    let overlay = null;

    function createOverlay() {
        overlay = document.createElement('div');
        overlay.id = 'swipe-back-overlay';
        Object.assign(overlay.style, {
            position:      'fixed',
            top:           '0',
            left:          '0',
            width:         '0px',
            height:        '100%',
            background:    'linear-gradient(to right, rgba(255,255,255,0.3), transparent)',
            pointerEvents: 'none',
            zIndex:        '9999',
            opacity:       '0',
        });
        document.body.appendChild(overlay);
    }

    function showOverlay(progress) {
        if (!overlay) return;
        overlay.style.width   = Math.min(progress * 60, 60) + 'px';
        overlay.style.opacity = String(Math.min(progress * 1.5, 1));
    }

    function hideOverlay() {
        if (!overlay) return;
        overlay.style.transition = 'width 0.18s ease, opacity 0.18s ease';
        overlay.style.width   = '0px';
        overlay.style.opacity = '0';
        setTimeout(() => { if (overlay) overlay.style.transition = ''; }, 200);
    }

    // ── 核心：双层同步动画 ───────────────────────────────────
function triggerBackAction() {
    const activeScreen = document.querySelector('.screen.active');
    if (!activeScreen || activeScreen.id === 'home-screen') return;

    const backBtn = activeScreen.querySelector('.back-btn');
    if (!backBtn) return;

    const targetId = backBtn.dataset.target
                  || backBtn.getAttribute('href')?.replace('#', '');
    const targetScreen = targetId ? document.getElementById(targetId) : null;

    const DURATION = 300;

    if (targetScreen) {
        // 目标页面静默铺在底层
        targetScreen.style.animation    = 'none';
        targetScreen.style.transform    = 'translateX(0)';
        targetScreen.style.opacity      = '1';
        targetScreen.style.zIndex       = '1';
        targetScreen.style.display      = 'flex'; // 临时显示，但在下层

        // 当前页面在上层向右飞出
        activeScreen.style.position     = 'absolute';
        activeScreen.style.width        = '100%';
        activeScreen.style.zIndex       = '2';
        activeScreen.style.transition   = `transform ${DURATION}ms ease, opacity ${DURATION}ms ease`;

        activeScreen.getBoundingClientRect(); // 强制重排

        activeScreen.style.transform    = 'translateX(100%)';
        activeScreen.style.opacity      = '0';

        setTimeout(() => {
            // 1. 提前打上标记并禁止动画
            targetScreen.dataset.swipeBack = 'true';
            targetScreen.classList.add('no-anim'); 

            // 2. 先触发页面切换！
            // 此时目标页面会被加上 .active (接管显示)，当前页面失去 .active (被隐藏)
            backBtn.click();

            // 3. 延迟一帧清除临时内联样式，实现视觉上的无缝交接
            requestAnimationFrame(() => {
                activeScreen.style.position   = '';
                activeScreen.style.zIndex     = '';
                activeScreen.style.transition = '';
                activeScreen.style.transform  = '';
                activeScreen.style.opacity    = '';

                targetScreen.style.display    = '';
                targetScreen.style.zIndex     = '';
                targetScreen.style.animation  = '';
            });
        }, DURATION);
    } else {
        // 找不到目标页面，退化处理
        activeScreen.style.transition   = `transform ${DURATION}ms ease, opacity ${DURATION}ms ease`;
        activeScreen.getBoundingClientRect();
        activeScreen.style.transform    = 'translateX(100%)';
        activeScreen.style.opacity      = '0';
        setTimeout(() => {
            activeScreen.style.transition = '';
            activeScreen.style.transform  = '';
            activeScreen.style.opacity    = '';
            backBtn.click();
        }, DURATION);
    }
}

    // ── touch 事件（与上一版相同）────────────────────────────
    document.addEventListener('touchstart', (e) => {
        if (!window.db || window.db.enableSwipeBack !== true) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isSwiping = true; hasTriggered = false; directionLocked = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!isSwiping || hasTriggered) return;
        const deltaX = e.touches[0].clientX - startX;
        const deltaY = e.touches[0].clientY - startY;

        if (!directionLocked) {
            if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
            if (Math.abs(deltaY) > Math.abs(deltaX)) { isSwiping = false; return; }
            directionLocked = true;
        }

        if (deltaX <= 0) return;
        showOverlay(Math.min(deltaX / 55, 1));

        if (deltaX >= 55) {
            hasTriggered = true;
            hideOverlay();
            triggerBackAction();
        }
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        if (isSwiping && !hasTriggered && directionLocked) {
            const deltaX = e.changedTouches[0].clientX - startX;
            const deltaY = e.changedTouches[0].clientY - startY;
            if (deltaX >= 40 && Math.abs(deltaY) < Math.abs(deltaX) * 1.2) {
                hideOverlay(); triggerBackAction();
            } else { hideOverlay(); }
        } else if (!hasTriggered) { hideOverlay(); }
        isSwiping = false; hasTriggered = false; directionLocked = false;
    }, { passive: true });

    document.addEventListener('touchcancel', () => {
        isSwiping = false; hasTriggered = false; directionLocked = false;
        hideOverlay();
    }, { passive: true });

    // ── 开关 UI ──────────────────────────────────────────────
    window.setupSwipeBackToggle = function () {
        createOverlay();
        const toggle = document.getElementById('swipe-back-toggle');
        if (toggle) {
            toggle.checked = !!(window.db && window.db.enableSwipeBack === true);
            toggle.addEventListener('change', function () {
                if (window.db) window.db.enableSwipeBack = this.checked;
                if (typeof window.saveData === 'function') window.saveData();
            });
        }
    };
})();