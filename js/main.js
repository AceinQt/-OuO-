// --- js/main.js ---

// ⭐ 创建广播频道(放在最顶部)
const syncChannel = new BroadcastChannel('qchat_sync');
let shouldSaveOnHide = true;

// ⭐ 监听其他标签页的消息
syncChannel.onmessage = (event) => {
    if (event.data.type === 'DATA_SAVED') {
        console.log('⚠️ 其他标签页保存了数据,标记本地数据为过期');
        window.dbLoadTimestamp = 0; // 标记为过期
        shouldSaveOnHide = false; // 暂时禁止自动保存
        
        // 如果当前页面可见,自动重新加载数据
        if (document.visibilityState === 'visible') {
            loadData().then(() => {
                showToast('已同步最新数据');
                shouldSaveOnHide = true;
            }).catch(e => {
                console.error('重新加载数据失败:', e);
                shouldSaveOnHide = true;
            });
        }
    }
};

// 1. 全局 DOM 缓存
const screens = document.querySelectorAll('.screen'),
    settingsScreen = document.getElementById('settings-screen'),
    toastElement = document.getElementById('toast-notification'),
    darkModeToggle = document.getElementById('dark-mode-toggle'),
    customizeForm = document.getElementById('customize-form');

// 2. 辅助函数：补零 (用于时钟)
const pad = (num) => num.toString().padStart(2, '0');

// 3. 全局时钟函数
function updateClock() {
    const now = new Date();
    const timeString = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const dateString = `${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 ✧ 星期${['日', '一', '二', '三', '四', '五', '六'][now.getDay()]}`;

    const homeTime = document.getElementById('time-display');
    const homeDate = document.getElementById('date-display');
    if (homeTime) homeTime.textContent = timeString;
    if (homeDate) homeDate.textContent = dateString;

    const peekTime = document.getElementById('peek-time-display');
    const peekDate = document.getElementById('peek-date-display');
    if (peekTime) peekTime.textContent = timeString;
    if (peekDate) peekDate.textContent = dateString;
}

const resetChatListTabs = () => {
    // 渲染列表 (以防数据变动)
    if (typeof renderChatList === 'function') renderChatList();
    
    // 强制切换回第一个 Tab (消息)
    const messagesTab = document.querySelector('.nav-tab-item[data-tab="messages"]');
    if (messagesTab) {
        // 模拟点击，这会触发 chat_list.js 里的监听器来处理 UI 切换和标题变更
        messagesTab.click();
    }
};

// 4. 路由表 (Router)
const pageActions = {
    'world-book-screen': typeof renderWorldBookList !== 'undefined' ? renderWorldBookList : null,
    'customize-screen': typeof renderCustomizeForm !== 'undefined' ? renderCustomizeForm : null,
    'tutorial-screen': typeof renderTutorialContent !== 'undefined' ? renderTutorialContent : null,
    'storage-analysis-screen': window.refreshStorageScreen,
    'chat-list-screen': resetChatListTabs 
};

// 5. 统一跳转函数
function navigateTo(targetId) {
    if (!targetId) return;

    // 开发中的页面提示
    if (['screen', 'diary-screen', 'piggy-bank-screen'].includes(targetId)) {
        showToast('该应用正在开发中，敬请期待！');
        return;
    }

    // 调用 utils.js 里的切换函数
    if (typeof switchScreen === 'function') {
        switchScreen(targetId);
    }

    // 如果路由表里有动作，则执行
    if (pageActions[targetId]) {
        pageActions[targetId]();
    }
}

// 6. 程序入口 init
window.init = async () => {
    console.log("正在初始化...");

    try {
        // 加载数据库
        if (typeof loadData === 'function') {
            await loadData();
            // ⭐ 初始化时间戳(如果 loadData 没设置的话)
            if (!window.dbLoadTimestamp) {
                window.dbLoadTimestamp = Date.now();
            }
        } else {
            console.error("Critical: loadData function not found!");
        }
        
        // 数据加载完毕后，立刻应用安全区设置        
        if (typeof applySafeAreaSettings === 'function') {
            applySafeAreaSettings();
        }

        // 设置状态栏颜色
        if (typeof setAndroidThemeColor === 'function') {
            setAndroidThemeColor(db.homeStatusBarColor || '#FFFFFF');
        }

        // 确保默认配置存在 (依赖 globals.js 中的 defaultWidgetSettings)
        if (!db.homeWidgetSettings && typeof defaultWidgetSettings !== 'undefined') {
            db.homeWidgetSettings = JSON.parse(JSON.stringify(defaultWidgetSettings));
        } else if (db.homeWidgetSettings && typeof defaultWidgetSettings !== 'undefined') {
            // 合并缺失的默认属性，但不覆盖已有值
            db.homeWidgetSettings = { ...defaultWidgetSettings, ...db.homeWidgetSettings };
        }

        // --- 核心：全局点击事件代理 ---
        document.body.addEventListener('click', (e) => {
            // A. 处理右键菜单的关闭
            if (e.target.closest('.context-menu')) {
                e.stopPropagation();
                return;
            }
            if (typeof removeContextMenu === 'function') removeContextMenu();

            // B. 处理导航点击
            const navTarget = e.target.closest('[data-target]');
            if (navTarget) {
                e.preventDefault();
                const targetId = navTarget.getAttribute('data-target');
                navigateTo(targetId);
            }

            // C. 关闭弹窗逻辑
            const openOverlay = document.querySelector('.modal-overlay.visible, .action-sheet-overlay.visible');
            if (openOverlay && e.target === openOverlay) {
                openOverlay.classList.remove('visible');
            }
        });

        // 绑定夜间模式开关
        if (darkModeToggle) {
            darkModeToggle.addEventListener('change', function () {
                if (typeof applyHomeScreenMode === 'function') {
                    applyHomeScreenMode(this.checked ? 'day' : 'night');
                }
            });
        }

        // 启动定时器
        updateClock();
        setInterval(updateClock, 30000);

        // 应用全局设置
        if (typeof applyGlobalFont === 'function') applyGlobalFont(db.fontUrl);
        if (typeof applyGlobalCss === 'function') applyGlobalCss(db.globalCss);
        if (typeof applyPomodoroBackgrounds === 'function') applyPomodoroBackgrounds();

        // 初始化各个模块
        if (typeof setupHomeScreen === 'function') setupHomeScreen();
        if (typeof setupChatListScreen === 'function') setupChatListScreen();
        if (typeof setupAddCharModal === 'function') setupAddCharModal();
        if (typeof setupChatRoom === 'function') setupChatRoom();
        if (typeof setupChatSettings === 'function') setupChatSettings();
        if (typeof setupApiSettingsApp === 'function') setupApiSettingsApp();
        if (typeof setupWallpaperApp === 'function') setupWallpaperApp();
        if (typeof setupStickerSystem === 'function') await setupStickerSystem();
        if (typeof setupCustomizeApp === 'function') setupCustomizeApp();
        if (typeof setupTutorialApp === 'function') setupTutorialApp();
        if (typeof setupSafeAreaToggles === 'function') {
            setupSafeAreaToggles();
        }
        

        // 预设相关
        if (typeof window.setupApiPresets === 'function') setupApiPresets();
        if (typeof window.setupBubblePresets === 'function') setupBubblePresets();

        // 其他功能
        if (typeof setupGlobalCssPresetsListeners === 'function') setupGlobalCssPresetsListeners();
        if (typeof setupVoiceMessageSystem === 'function') setupVoiceMessageSystem();
        if (typeof setupPhotoVideoSystem === 'function') setupPhotoVideoSystem();
        if (typeof setupImageRecognition === 'function') setupImageRecognition();
        if (typeof setupWalletSystem === 'function') setupWalletSystem();
        if (typeof setupGiftSystem === 'function') setupGiftSystem();
        if (typeof setupTimeSkipSystem === 'function') setupTimeSkipSystem();
        if (typeof setupWorldBookApp === 'function') setupWorldBookApp();
        if (typeof setupFontSettingsApp === 'function') setupFontSettingsApp();
        if (typeof setupGroupChatSystem === 'function') setupGroupChatSystem();

        // 独立功能页
        if (typeof checkForUpdates === 'function') checkForUpdates();
        if (typeof setupPeekFeature === 'function') setupPeekFeature();
        if (typeof setupOfflineModeLogic === 'function') setupOfflineModeLogic();
        if (typeof setupChatExpansionPanel === 'function') setupChatExpansionPanel();
        if (typeof setupMemoryJournalScreen === 'function') setupMemoryJournalScreen();
        if (typeof setupDeleteHistoryChunk === 'function') setupDeleteHistoryChunk();
        if (typeof setupForumBindingFeature === 'function') setupForumBindingFeature();
        if (typeof setupForumFeature === 'function') setupForumFeature();
        if (typeof setupShareModal === 'function') setupShareModal();
        if (typeof setupFavoritesFeature === 'function') setupFavoritesFeature();
        
        
        if (typeof setupStorageAnalysisScreen === 'function') setupStorageAnalysisScreen();
        if (typeof setupPomodoroApp === 'function') setupPomodoroApp();
        if (typeof setupPomodoroSettings === 'function') setupPomodoroSettings();
        if (typeof setupPomodoroGlobalSettings === 'function') setupPomodoroGlobalSettings();
        if (typeof setupInsWidgetAvatarModal === 'function') setupInsWidgetAvatarModal();
        if (typeof setupRpgGame === 'function') setupRpgGame();
        if (typeof setupUserPersonaModal === 'function') setupUserPersonaModal();

        // 绑定特殊按钮
        const delWbBtn = document.getElementById('delete-selected-world-books-btn');
        if (delWbBtn) delWbBtn.addEventListener('click', deleteSelectedWorldBooks);

        const cancelWbBtn = document.getElementById('cancel-wb-multi-select-btn');
        if (cancelWbBtn) cancelWbBtn.addEventListener('click', exitWorldBookMultiSelectMode);

        // 申请持久化存储权限 (防止手机空间不足时删数据)
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().then(granted => {
                if (granted) {
                    console.log("✅ 已获得持久化存储权限");
                }
            });
        }

        console.log("✅ 初始化流程执行完毕");
const splash = document.getElementById('app-splash-screen');
        if (splash) {
            // 稍微延迟 500 毫秒，让用户看清启动画面，同时确保 DOM 渲染彻底完成
            setTimeout(() => {
                splash.classList.add('fade-out');
                }, 500); // 500ms 延迟
        }
    } catch (err) {
        console.error("❌ 初始化过程发生致命错误:", err);
        const splash = document.getElementById('app-splash-screen');
        if (splash) splash.classList.add('fade-out');
        if (typeof showToast === 'function') showToast("初始化失败，请查看控制台");
    }
};

// --- 7. 每日自动备份逻辑 ---
async function runDailyBackupCheck() {
    if (typeof GitHubService === 'undefined' || typeof createFullBackupData === 'undefined') return;

    const config = GitHubService.getConfig();
    if (!config || !config.autoBackup) return;

    const LAST_BACKUP_KEY = 'qchat_last_auto_backup_date';
    const lastDate = localStorage.getItem(LAST_BACKUP_KEY);
    const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');

    if (lastDate === today) {
        console.log("今日已自动备份过，跳过。");
        return;
    }

    console.log("检测到今日首次启动，准备自动备份...");
    setTimeout(async () => {
        try {
            const data = await createFullBackupData();
            await GitHubService.upload(data);
            localStorage.setItem(LAST_BACKUP_KEY, today);
            if (typeof showToast === 'function') showToast("每日自动备份完成");
            console.log("每日自动备份成功");
        } catch (e) {
            console.error("自动备份失败:", e);
        }
    }, 5000);
}

// ==========================================
// --- 8. 启动与生命周期管理 ---
// ==========================================

// A. Service Worker 注册
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./js/sw.js')
            .then(reg => console.log('SW 注册成功:', reg.scope))
            .catch(err => console.log('SW 注册失败:', err));
        
        setTimeout(runDailyBackupCheck, 2000);
    });
} else {
    window.addEventListener('load', () => setTimeout(runDailyBackupCheck, 2000));
}

// B. DOM 准备就绪后启动 init
document.addEventListener('DOMContentLoaded', async () => {
    console.log("应用启动...");
    if (typeof window.init === 'function') {
        window.init();
    } else {
        await AppUI.alert("错误：init 函数未定义，请刷新重试。");
    }

    // ⭐⭐⭐ C. 【核心】改进的防数据丢失逻辑
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'hidden' && shouldSaveOnHide) {
            try {
                // 保存前检查数据新鲜度(可选,额外保险)
                if (typeof dexieDB !== 'undefined') {
                    try {
                        const storedMeta = await dexieDB.globalSettings.get('app_metadata');
                        if (storedMeta?.lastUpdateTime > (window.dbLoadTimestamp || 0)) {
                            console.warn('⚠️ 检测到远程数据更新,跳过保存避免覆盖');
                            return;
                        }
                    } catch (e) {
                        console.log('元数据检查跳过:', e.message);
                    }
                }
                
                // 执行保存
                await saveData();
                console.log('✅ 后台保存成功');
                
                // 通知其他标签页
                syncChannel.postMessage({ 
                    type: 'DATA_SAVED', 
                    timestamp: Date.now() 
                });
            } catch (e) {
                console.error("❌ 后台保存出错:", e);
                // 生产环境建议注释掉 alert
                await AppUI.alert("后台保存出错: " + e.message);
            }
        } else if (document.visibilityState === 'visible') {
            // 页面重新可见时,检查是否需要重新加载
            console.log('📱 页面重新可见,检查数据同步...');
            shouldSaveOnHide = true;
            
            if (typeof dexieDB !== 'undefined') {
                try {
                    const storedMeta = await dexieDB.globalSettings.get('app_metadata');
                    if (storedMeta?.lastUpdateTime > (window.dbLoadTimestamp || 0)) {
                        console.log('🔄 检测到新数据,重新加载...');
                        await loadData();
                        showToast('已加载最新数据');
                    }
                } catch (e) {
                    console.error('数据同步检查失败:', e);
                }
            }
        }
    });

    // 页面关闭时的最后保险
    window.addEventListener('pagehide', () => {
        if (typeof saveData === 'function') {
            saveData();
        }
    });
});