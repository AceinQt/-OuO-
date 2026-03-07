// --- js/settings/screen_adapt.js ---

// 1. 统一应用屏幕自适应设置的函数
window.applyScreenAdaptation = function() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;

    // 只有当数据库加载完毕，并且开关为 true 时才开启自适应
    if (window.db && window.db.enableScreenAdaptation === true) {
        // 【核心参数】这里的 375 是基准设计宽度。
        // 如果你的页面在 375 宽的手机上最完美，就填 375。如果在 390 上最完美，就改 390。
        var myPhoneWidth = 360; 
        var screenWidth = window.screen.width;
        var scale = screenWidth / myPhoneWidth;
        
        // 强制改变 viewport 缩放比例
        meta.setAttribute('content', 'width=' + myPhoneWidth + ', initial-scale=' + scale + ', maximum-scale=' + scale + ', minimum-scale=' + scale + ', user-scalable=no, viewport-fit=cover');
    } else {
        // 关闭自适应，恢复设备默认的 1:1 比例
        meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    }
};

// 2. 初始化开关 UI 并绑定事件
window.setupScreenAdaptToggle = function() {
    const screenAdaptToggle = document.getElementById('screen-adapt-toggle');
    if (screenAdaptToggle) {
        // 根据数据库状态设置开关UI
        screenAdaptToggle.checked = (window.db && window.db.enableScreenAdaptation === true);
        
        // 监听开关变化
        screenAdaptToggle.addEventListener('change', function() {
            if(window.db) {
                window.db.enableScreenAdaptation = this.checked;
            }
            window.applyScreenAdaptation(); // 立即改变屏幕缩放
            
            if (typeof window.saveData === 'function') {
                window.saveData(); // 保存到数据库
            }
        });
    }
};