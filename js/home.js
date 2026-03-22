// --- js/home.js ---

// 辅助工具：更新单个 APP 图标 (处理 SVG 或 图片)
function updateOneAppIcon(key) {
    // 找到 HTML 里的图标元素
    const appEl = document.getElementById(`app-icon-${key}`);
    if (!appEl) return; // 如果找不到这个图标，就跳过
    
    const container = appEl.querySelector('.icon-container');
    const nameSpan = appEl.querySelector('.app-name');
    
    const item = defaultIcons[key];
    if (!item) return;

    // 更新名字 (如果有名字显示的话)
    if (nameSpan) nameSpan.textContent = item.name;

    // 判断是用自定义图片，还是默认图标
    const customUrl = db.customIcons && db.customIcons[key];
    const iconUrl = customUrl || item.url;
    
    // 如果没有自定义图片，且默认配置里有 SVG 代码，就用 SVG
    if (!customUrl && item.svgCode) {
        container.innerHTML = item.svgCode;
    } else {
        // 否则用 img 标签
        container.innerHTML = `<img src="${iconUrl}" alt="${item.name}" class="icon-img">`;
    }
}

// 核心函数：刷新主屏幕数据
// 注意：这个函数会被 customize.js 和 main.js 多次调用，所以只做“更新”操作
function setupHomeScreen() {
    // 1. 确保数据存在
    if (!db.insWidgetSettings) {
        db.insWidgetSettings = {
            avatar1: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
            bubble1: '„- ω -„',
            avatar2: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg',
            bubble2: 'ｷ...✩'
        };
    }
    const insWidget = db.insWidgetSettings;

    // 2. 更新中央圆圈背景图
    const centralCircle = document.getElementById('home-central-circle');
    if (centralCircle && db.homeWidgetSettings) {
        centralCircle.style.backgroundImage = `url('${db.homeWidgetSettings.centralCircleImage}')`;
    }

    // 3. 更新个性签名
    const sigEl = document.getElementById('widget-signature');
    if (sigEl) sigEl.textContent = db.homeSignature || '';

    // 4. 更新 INS 小组件 (头像和气泡)
    const avatar1 = document.getElementById('ins-widget-avatar-1');
    const avatar2 = document.getElementById('ins-widget-avatar-2');
    const bubble1 = document.getElementById('ins-widget-bubble-1');
    const bubble2 = document.getElementById('ins-widget-bubble-2');

    if (avatar1) avatar1.src = insWidget.avatar1;
    if (avatar2) avatar2.src = insWidget.avatar2;
    if (bubble1) bubble1.textContent = insWidget.bubble1;
    if (bubble2) bubble2.textContent = insWidget.bubble2;

    // 5. 更新所有 APP 图标
    // 这里列出所有在 index.html 里写了 id 的 APP
    const appKeys = [
        'chat-list-screen', 
        'pomodoro-screen', 
        'forum-screen', 
        'rpg-title-screen',
        'settings-screen', 
        'world-book-screen'
    ];
    appKeys.forEach(key => updateOneAppIcon(key));
    updateHomeChatBadge();



    // 7. 更新通用状态
    if(typeof updateClock === 'function') updateClock();
    applyWallpaper(db.wallpaper);
    applyHomeScreenMode(db.homeScreenMode);
    updateBatteryStatus();

    // 8. 绑定事件 (确保只绑定一次)
    bindHomeScreenEventsOnce();

}

// 辅助函数：只绑定一次事件，防止重复绑定
let isHomeEventsBound = false;

function bindHomeScreenEventsOnce() {
    if (isHomeEventsBound) return; // 如果已经绑定过，直接退出
    
    const homeScreen = document.getElementById('home-screen');
    const centralCircle = document.getElementById('home-central-circle');

    // 1. 中央圆圈点击事件 (换头像)
    if (centralCircle) {
        centralCircle.addEventListener('click', () => {
            const modal = document.getElementById('ins-widget-avatar-modal');
            const preview = document.getElementById('ins-widget-avatar-preview');
            const urlInput = document.getElementById('ins-widget-avatar-url-input');
            const fileUpload = document.getElementById('ins-widget-avatar-file-upload');
            const targetInput = document.getElementById('ins-widget-avatar-target');
            
            // 确保这些元素在 DOM 里存在 (你的代码里应该有这个弹窗的 HTML)
            if(modal && targetInput) {
                targetInput.value = 'centralCircle'; 
                preview.style.backgroundImage = `url("${db.homeWidgetSettings.centralCircleImage}")`;
                preview.innerHTML = '';
                urlInput.value = '';
                fileUpload.value = null;
                modal.classList.add('visible');
            }
        });
    }

    // 2. 签名和气泡的自动保存（失焦保存）
    homeScreen.addEventListener('blur', async (e) => {
        const target = e.target;
        if (target.hasAttribute('contenteditable')) {
            if (target.id === 'widget-signature') { 
                const newSignature = target.textContent.trim();
                if (db.homeSignature !== newSignature) {
                    db.homeSignature = newSignature;
                    await saveGlobalKeys(['homeSignature', 'insWidgetSettings']);
                    showToast('签名已保存');
                }
            } else if (target.id === 'ins-widget-bubble-1' || target.id === 'ins-widget-bubble-2') { 
                const bubbleId = target.id === 'ins-widget-bubble-1' ? 'bubble1' : 'bubble2';
                const newText = target.textContent.trim();
                if (db.insWidgetSettings[bubbleId] !== newText) {
                    db.insWidgetSettings[bubbleId] = newText;
                    await saveGlobalKeys(['homeSignature', 'insWidgetSettings']);
                    showToast('小组件文字已保存');
                }
            }
        }
    }, true);

    // 3. 滑动屏幕逻辑 (Swipe)
    const swiper = homeScreen.querySelector('.home-screen-swiper');
    if (swiper) {
        let touchStartX = 0;
        let touchEndX = 0;
        const totalPages = 1; // 目前只有一页，如果加页请改这里
        const swipeThreshold = 50;
        let isDragging = false;
        let currentPageIndex = 0;

        swiper.addEventListener('touchstart', (e) => {
            if (e.target.closest('[contenteditable]')) return;
            isDragging = true;
            touchStartX = e.changedTouches[0].screenX;
            touchEndX = e.changedTouches[0].screenX; 
        }, { passive: true });

        swiper.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            touchEndX = e.changedTouches[0].screenX;
        }, { passive: true });

        swiper.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            const deltaX = touchEndX - touchStartX;
            if (Math.abs(deltaX) > swipeThreshold) {
                if (deltaX < 0 && currentPageIndex < totalPages - 1) currentPageIndex++;
                else if (deltaX > 0 && currentPageIndex > 0) currentPageIndex--;
            }
            swiper.style.transform = `translateX(-${currentPageIndex * 100 / totalPages}%)`;
        });
    }

    // 4. 点击空白失焦 (让键盘收起)
    homeScreen.addEventListener('click', (e) => {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.hasAttribute('contenteditable') && e.target !== activeEl) {
            activeEl.blur();
        }
    });

    isHomeEventsBound = true; // 标记已绑定
}

// 辅助功能函数 (保持不变)
function applyWallpaper(url) {
    document.getElementById('home-screen').style.backgroundImage = `url(${url})`;
}

async function applyHomeScreenMode(mode) {
    const toggle = document.getElementById('dark-mode-toggle');
    const homeScreen = document.getElementById('home-screen');
    if (!mode) mode = 'day';

    if (mode === 'day') {
        homeScreen.classList.add('day-mode');
        if (toggle) toggle.checked = true;
    } else {
        homeScreen.classList.remove('day-mode');
        if (toggle) toggle.checked = false;
    }
    db.homeScreenMode = mode;
    await saveGlobalKeys(['homeScreenMode']);
}

// 电池状态
async function updateBatteryStatus() {
    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();
            const batteryLevelText = document.getElementById('battery-level');
            const batteryFillRect = document.getElementById('battery-fill-rect');

            const updateDisplay = () => {
                if (!batteryLevelText || !batteryFillRect) return;
                const level = Math.floor(battery.level * 100);
                batteryLevelText.textContent = `${level}%`;
                batteryFillRect.setAttribute('width', 18 * battery.level);
                let fillColor = "currentColor";
                if (battery.charging) fillColor = "#4CAF50"; 
                else if (level <= 20) fillColor = "#f44336";
                batteryFillRect.setAttribute('fill', fillColor);
            };
            updateDisplay();
            battery.addEventListener('levelchange', updateDisplay);
            battery.addEventListener('chargingchange', updateDisplay);
        } catch (error) {
            // 忽略错误
        }
    }
}

// 确保 setupInsWidgetAvatarModal 函数仍然存在
function setupInsWidgetAvatarModal() {
    const modal = document.getElementById('ins-widget-avatar-modal');
    const form = document.getElementById('ins-widget-avatar-form');
    const preview = document.getElementById('ins-widget-avatar-preview');
    const urlInput = document.getElementById('ins-widget-avatar-url-input');
    const fileUpload = document.getElementById('ins-widget-avatar-file-upload');
    const targetInput = document.getElementById('ins-widget-avatar-target');

    if (!modal) return; // 如果还没加载 HTML，直接返回

    // 监听主页上的头像点击
    document.getElementById('home-screen').addEventListener('click', (e) => {
        const avatar1 = e.target.closest('#ins-widget-avatar-1');
        const avatar2 = e.target.closest('#ins-widget-avatar-2');
        let targetAvatarId = null;
        let currentSrc = '';

        if (avatar1) {
            targetAvatarId = 'avatar1';
            currentSrc = db.insWidgetSettings.avatar1;
        } else if (avatar2) {
            targetAvatarId = 'avatar2';
            currentSrc = db.insWidgetSettings.avatar2;
        }

        if (targetAvatarId) {
            targetInput.value = targetAvatarId;
            preview.style.backgroundImage = `url("${currentSrc}")`;
            preview.innerHTML = ''; 
            urlInput.value = '';
            fileUpload.value = null;
            modal.classList.add('visible');
        }
    });

    // 弹窗逻辑...
    urlInput.addEventListener('input', () => {
        const url = urlInput.value.trim();
        if (url) {
            preview.style.backgroundImage = `url("${url}")`;
            preview.innerHTML = '';
            fileUpload.value = null;
        } else {
            preview.style.backgroundImage = 'none';
            preview.innerHTML = '<span>预览</span>';
        }
    });

    fileUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 200, maxHeight: 200 });
                preview.style.backgroundImage = `url("${compressedUrl}")`;
                preview.innerHTML = '';
                urlInput.value = ''; 
            } catch (error) {
                showToast('图片压缩失败');
            }
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const targetAvatar = targetInput.value;
        const bgImage = preview.style.backgroundImage;
        // 去掉 url("") 的包装
        const newSrc = bgImage.replace(/^url\(['"](.+)['"]\)$/, '$1');

        if (!targetAvatar || !newSrc) {
            showToast('没有要保存的图片');
            return;
        }

        if (targetAvatar === 'centralCircle') {
            db.homeWidgetSettings.centralCircleImage = newSrc;
        } else if (targetAvatar === 'avatar1') {
            db.insWidgetSettings.avatar1 = newSrc;
        } else if (targetAvatar === 'avatar2') {
            db.insWidgetSettings.avatar2 = newSrc;
        }

        await saveGlobalKeys(['homeWidgetSettings', 'insWidgetSettings']);
        setupHomeScreen(); // 刷新显示
        modal.classList.remove('visible');
        showToast('头像已更新');
    });
}

// --- 新增：更新主页聊天图标的未读消息角标 ---
function updateHomeChatBadge() {
    const chatAppIcon = document.getElementById('app-icon-chat-list-screen');
    if (!chatAppIcon) return;
    
    // 计算私聊和群聊的总未读数
    let totalUnread = 0;
    if (db && db.characters) {
        totalUnread += db.characters.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
    }
    if (db && db.groups) {
        totalUnread += db.groups.reduce((sum, g) => sum + (g.unreadCount || 0), 0);
    }
    
    let badge = chatAppIcon.querySelector('.home-unread-badge');
    
    // 如果有未读消息
    if (totalUnread > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'home-unread-badge';
            chatAppIcon.appendChild(badge);
        }
        badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
        badge.style.display = 'flex';
    } else {
        // 如果没有未读消息，隐藏/移除角标
        if (badge) {
            badge.style.display = 'none';
        }
    }
}