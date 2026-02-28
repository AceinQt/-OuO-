// --- js/settings/safe_toggle.js ---

// 1. 统一应用安全区设置的函数 (挂载到 window，方便全局初始化调用)
window.applySafeAreaSettings = function() {
    const root = document.documentElement;
    
    // 如果 db 尚未加载或开关为 true (默认)，则使用系统的 env()，否则设为 0px
    if (window.db && window.db.enableTopSafeArea !== false) { 
        root.style.setProperty('--safe-top', 'env(safe-area-inset-top, 0px)');
    } else {
        root.style.setProperty('--safe-top', '0px');
    }

    if (window.db && window.db.enableBottomSafeArea !== false) {
        root.style.setProperty('--safe-bottom', 'env(safe-area-inset-bottom, 0px)');
    } else {
        root.style.setProperty('--safe-bottom', '0px');
    }
};

// 2. 初始化开关 UI 并绑定事件
window.setupSafeAreaToggles = function() {
    const safeTopToggle = document.getElementById('safe-area-top-toggle');
    const safeBottomToggle = document.getElementById('safe-area-bottom-toggle');

    // 绑定顶部避让开关
    if (safeTopToggle) {
        safeTopToggle.checked = (window.db.enableTopSafeArea !== false);
        safeTopToggle.addEventListener('change', function() {
            window.db.enableTopSafeArea = this.checked;
            window.applySafeAreaSettings();
            if (typeof saveData === 'function') saveData(); // 保存到数据库
        });
    }

    // 绑定底部避让开关
    if (safeBottomToggle) {
        safeBottomToggle.checked = (window.db.enableBottomSafeArea !== false);
        safeBottomToggle.addEventListener('change', function() {
            window.db.enableBottomSafeArea = this.checked;
            window.applySafeAreaSettings();
            if (typeof saveData === 'function') saveData(); // 保存到数据库
        });
    }
};