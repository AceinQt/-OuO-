// --- js/main.js ---
// --- 开发者控制台拦截逻辑 ---
(function initDevConsole() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    // 缓存尚未渲染的日志（防止在DOM加载前输出的日志丢失）
    const logQueue =[];
    let outputElement = null;

    // 日志只保留最近 MAX_LINES 条。这个面板原本无上限地 appendChild，
    // 长时间挂机（含 60 秒一轮的主动消息轮询）会让 DOM 行数只增不减，
    // 内存跟着涨，安卓上更容易在切后台时被系统回收整个页面。
    const MAX_LINES = 300;
    // 单条日志的字符上限。formatArgs 对象走 JSON.stringify(obj,null,2)，
    // 打印一次大对象就能往 DOM 里钉进几百 KB（实测 20 次 → 0.58MB）。
    const MAX_MSG_CHARS = 2000;

    // 格式化输出参数
    function formatArgs(args) {
        return Array.from(args).map(arg => {
            if (arg === null) return 'null';
            if (arg === undefined) return 'undefined';
            if (typeof arg === 'object') {
                if (arg instanceof Error) return arg.stack || arg.message;
                try {
                    return JSON.stringify(arg, null, 2);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }).join(' ');
    }

    // 渲染单行日志到页面
    function renderLog(type, msg, color) {
        // 获取时间戳[HH:MM:SS.mmm]
        const now = new Date();
        const timeStr = `[${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}]`;

        if (!outputElement) {
            outputElement = document.getElementById('dev-console-output');
        }

        if (outputElement) {
            const line = document.createElement('div');
            line.className = 'output-item';
            line.style.color = color;
            const shown = (msg && msg.length > MAX_MSG_CHARS)
                ? msg.slice(0, MAX_MSG_CHARS) + `\n…（已截断，原长 ${msg.length} 字符）`
                : msg;
            line.textContent = `${timeStr} [${type.toUpperCase()}] ${shown}`;
            outputElement.appendChild(line);

            // 超出上限就从头部丢掉最旧的几行，保证 DOM 不无限增长
            while (outputElement.children.length > MAX_LINES) {
                outputElement.removeChild(outputElement.firstElementChild);
            }

            // 自动滚动到最新一条
            outputElement.scrollTop = outputElement.scrollHeight;
        } else {
            // 如果 DOM 还没准备好，加入队列（队列同样要有上限，否则 DOM 迟迟不就绪时会堆积）
            logQueue.push({ type, msg, color });
            if (logQueue.length > MAX_LINES) logQueue.shift();
        }
    }

    // 拦截方法
    console.log = function(...args) {
        renderLog('log', formatArgs(args), '#2c3e50'); // 白色（暗色主题下）/黑色改为白色以适应黑色背景更好看
        originalLog.apply(console, args);
    };

    console.warn = function(...args) {
        renderLog('warn', formatArgs(args), '#ff9800'); // 橙色
        originalWarn.apply(console, args);
    };

    console.error = function(...args) {
        renderLog('error', formatArgs(args), '#f44336'); // 红色
        originalError.apply(console, args);
    };

    // DOM加载后，处理积压的日志，并绑定清空按钮
    document.addEventListener('DOMContentLoaded', () => {
        outputElement = document.getElementById('dev-console-output');
        
        // 渲染积压在队列中的日志
        if (outputElement && logQueue.length > 0) {
            logQueue.forEach(item => renderLog(item.type, item.msg, item.color));
            logQueue.length = 0; 
        }

        // 绑定清空按钮
        const clearBtn = document.getElementById('clear-console-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (outputElement) outputElement.innerHTML = '';
            });
        }
    });
})();
// 跨窗口同步频道。
// 日常数据改动现在全部走精准保存（改内存的同时就把那一条/那一张表落盘），
// 不再有"用本窗口内存整个覆盖库"的全量保存，所以窗口之间不会互相覆盖，
// 也就不需要每次保存都互相通知了。
// 现在唯一的生产者是「备份恢复」——那是真正会把整个库换掉的操作，
// 其他窗口必须重新载入，否则它们的内存还是旧库的内容。
const syncChannel = new BroadcastChannel('qchat_sync');

// 供 database.js 的 restoreAllTablesToDB 在全量写回后调用（它拿不到脚本级的 syncChannel）
window.notifyDataWritten = () => {
    try { syncChannel.postMessage({ type: 'DATA_SAVED', timestamp: Date.now() }); }
    catch (e) { console.warn('跨窗口通知失败（忽略）:', e); }
};

// --- 核心修复：重新加载数据后，自动刷新当前页面 UI ---
function refreshUIAfterSync() {
    // 1. 刷新首页和聊天列表状态
    if (typeof updateClock === 'function') updateClock();
    if (typeof setupHomeScreen === 'function') setupHomeScreen();
    if (typeof renderChatList === 'function') renderChatList();
    if (typeof updateHomeChatBadge === 'function') updateHomeChatBadge();

    // 2. 如果用户正好停留在聊天室，强制重新渲染消息列表，并滚到底部！
    const chatRoomScreen = document.getElementById('chat-room-screen');
    if (chatRoomScreen && chatRoomScreen.style.display !== 'none' && typeof currentChatId !== 'undefined' && currentChatId) {
        if (typeof renderMessages === 'function') {
            console.log("🔄 强制刷新聊天室 UI...");
            renderMessages(false, true); 
        }
    }
}

// 监听其他窗口的「整库已被替换」通知（目前只有备份恢复会发）
syncChannel.onmessage = (event) => {
    if (event.data && event.data.type === 'DATA_SAVED') {
        console.log('⚠️ 其他窗口替换了整个数据库，本窗口内存已过期');
        window.dbLoadTimestamp = 0; // 标记为过期，下次切回前台会重新载入

        // 当前就在前台的话，立刻重载
        if (document.visibilityState === 'visible') {
            loadData().then(() => {
                if (typeof applySafeAreaSettings === 'function') applySafeAreaSettings();
                if (typeof applyScreenAdaptation === 'function') applyScreenAdaptation();
                refreshUIAfterSync();
                showToast('已同步最新数据');
            }).catch(e => {
                console.error('重新加载数据失败:', e);
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
    'study-screen': () => window.StudyModule?.renderMain(),
    'api-settings-screen': openApiSettingsScreen,
    'world-book-screen': typeof renderWorldBookList !== 'undefined' ? renderWorldBookList : null,
    'customize-screen': typeof renderCustomizeForm !== 'undefined' ? renderCustomizeForm : null,
    'tutorial-screen': typeof renderTutorialContent !== 'undefined' ? renderTutorialContent : null,
    'storage-analysis-screen': window.refreshStorageScreen,
    'github-repos-screen': () => openGithubReposScreen(),
    // 只为刷新「GitHub 仓库」那一行右侧的状态文案，不点进去也能看出配没配
    'settings-screen': () => {
        if (typeof refreshGithubReposSummary === 'function') refreshGithubReposSummary();
    },
    'notification-settings-screen': () => window.NotifyCenter?.initSettingsUI(),
    'chat-list-screen': resetChatListTabs ,
    'chat-appearance-screen': () => {
        // 防御：清除 chat-list-screen Tab 切换可能遗留的 inline display
        const tabBubbles = document.getElementById('tab-view-bubbles');
        if (tabBubbles) tabBubbles.style.display = '';
        if (typeof window.renderGlobalBubblePresets === 'function') {
            window.renderGlobalBubblePresets();
        }
    }
};

// 5. 统一跳转函数
function navigateTo(targetId) {
    if (!targetId) return;

    // 这里原先有个「该应用正在开发中」的拦截，挡的是 diary-screen / piggy-bank-screen
    // （日记本 / 存钱罐）和一个空占位 'screen'。这三个目标在 index.html 里都没有对应的
    // screen 元素，桌面上也没有能点出它们的入口，属于永远走不到的分支，已随图标一起删掉。

if (targetId === 'chat-list-screen') {
    try {
        currentChatId = null;
        currentChatType = null;
    } catch(e) {}
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
        
        // ★ 语音缓存键从 v1（含预设内容指纹）迁到 v2（只含预设 id）。
        //   不迁的话老片段全部对不上号，会被白白重新合成一遍。幂等。
        if (typeof migrateVoiceKeysToV2 === 'function') {
            try {
                await migrateVoiceKeysToV2();
            } catch (error) {
                console.warn('语音缓存键迁移失败：', error);
            }
        }

        // ★ 把备份功能原先存在 localStorage 的 GitHub 仓库配置迁进 db.githubRepos。
        //   幂等，迁完不删老配置（留作保险）。必须在 loadData 之后 —— 它要读写 db。
        if (typeof migrateLegacyGithubConfig === 'function') {
            try {
                await migrateLegacyGithubConfig();
            } catch (error) {
                console.warn('GitHub 仓库配置迁移失败（老配置仍在 localStorage 里）：', error);
            }
        }

        // 数据加载完毕后，立刻应用安全区设置        
        if (typeof applySafeAreaSettings === 'function') {
            applySafeAreaSettings();
        }
        if (typeof applyScreenAdaptation === 'function') {
         applyScreenAdaptation(); 
     }
        // 设置状态栏颜色
        if (typeof setAndroidThemeColor === 'function') {
            setAndroidThemeColor(db.homeStatusBarColor || '#FFFFFF');
            document.body.style.backgroundColor = window.db.homeNavigationBarColor || '#FFFFFF';
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

            // === 忙锁：长操作进行中（备份导出/导入等）一律不许换页 ===
            // CSS 的 pointer-events 只挡得住页面内部的点击，这里是第二道闸：
            // 底部导航栏在 .screen 之外，滑动返回和安卓返回键也都是合成 .back-btn 点击。
            // 程序自己调 switchScreen（导入完成后的跳转/刷新）不走这里，不受影响。
            if (typeof window.isUiBusy === 'function' && window.isUiBusy()) {
                return;
            }

            // === 修复1：拦截 Peek 编辑模式下的返回操作 ===
            // 如果处于多选删除模式，且点击的是返回按钮，则优先退出多选，不跳转页面
            if (window.PeekDeleteManager && window.PeekDeleteManager.isEditMode && navTarget.classList.contains('back-btn')) {
                window.PeekDeleteManager.exitMode();
                return; 
            }

            const targetId = navTarget.getAttribute('data-target');
                
                // ★ 提取判断条件
                const isFromHome = navTarget.classList.contains('app-icon') && navTarget.closest('#home-screen');

                // ★★★ 修复1：先执行跳转函数，让目标页面加上 .active，脱离 display: none 状态
                navigateTo(targetId);
                
                // ★★★ 修复2：页面显示后，再执行置顶操作（加上极短的延迟确保 DOM 已渲染计算高度）
                if (isFromHome) {
                    setTimeout(() => {
                        const targetScreen = document.getElementById(targetId);
                        if (targetScreen) {
                            // 1. 将屏幕自身的滚动条置顶
                            targetScreen.scrollTop = 0;
                            
                            // 2. 将目标屏幕内所有的子滚动容器置顶
                            const scrollContainers = targetScreen.querySelectorAll('.content, .message-area, .tab-content-view, .forum-content-area, .rpg-scroll-col, .world-content-wrapper, #favorites-list-container, #detail-content-area, #chat-list-container, #my-personas-list');
                            
                            scrollContainers.forEach(container => {
                                container.scrollTop = 0;
                            });
                        }
                    }, 10); // 10毫秒延迟足以让浏览器完成重绘
                }
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
        if (typeof setupCharacterEditScreen === 'function') setupCharacterEditScreen();
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
        if (typeof setupScreenAdaptToggle === 'function') {
         setupScreenAdaptToggle();
     }
     if (typeof setupSwipeBackToggle === 'function') {
            setupSwipeBackToggle();
        }
        if (typeof setupSystemBackToggle === 'function') {
            setupSystemBackToggle();
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
        if (typeof setupLocationSystem === 'function') setupLocationSystem();
        if (typeof setupShareFeature === 'function') setupShareFeature();
        if (typeof setupForwardMessagesModal === 'function') setupForwardMessagesModal();
        if (typeof setupTimeSkipSystem === 'function') setupTimeSkipSystem();
        if (typeof setupWorldBookApp === 'function') setupWorldBookApp();
        if (typeof setupFontSettingsApp === 'function') setupFontSettingsApp();
        if (typeof setupGroupChatSystem === 'function') setupGroupChatSystem();

        // 独立功能页
        if (typeof checkForUpdates === 'function') checkForUpdates();
        if (typeof setupPeekFeature === 'function') setupPeekFeature();
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
        if (typeof setupUserPersonaScreen === 'function') setupUserPersonaScreen();
        if (typeof setupGroupInfoScreen === 'function') setupGroupInfoScreen();

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
        // 供"点通知跳转"判断 App 是否已就绪（冷启动时通知点击会早于 init 完成）
        window.__appInitDone = true;

         if (typeof checkAndDeliverProactiveMessages === 'function') {
            // 延迟一点点执行，确保 UI 已经渲染完毕
            setTimeout(checkAndDeliverProactiveMessages, 50);
        }
        
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
    // ★ V5 修复：原代码调用不存在的 createFullBackupData/GitHubService.upload，自动备份从未生效。
    //   现在直接复用手动"上传云端"的 V5 流式备份路径。
    if (typeof GitHubService === 'undefined' || typeof performOptimizedCloudBackup !== 'function') return;

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
            await performOptimizedCloudBackup();
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

// A. Service Worker 注册与后台唤醒监听
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        // ★ 迁移：注销旧的 /js/ 作用域 SW（历史版本注册在 ./js/sw.js，
        //   作用域 /js/ 控制不了根页面、会导致 ready 永久挂起、点通知 404）。
        //   sw.js 现已移到根目录（作用域 /），这里先清掉旧的，避免新旧并存。
        try {
            const olds = await navigator.serviceWorker.getRegistrations();
            for (const r of olds) {
                if (r.scope && r.scope.endsWith('/js/')) {
                    await r.unregister();
                    console.log('🧹 已注销旧的 /js/ 作用域 SW:', r.scope);
                }
            }
        } catch (e) { console.log('清理旧 SW 时出错（忽略）:', e); }

        navigator.serviceWorker.register('./sw.js')
            .then(async reg => {
                console.log('✅ SW 注册成功:', reg.scope);
                // 存下 registration 供通知模块使用（虽然根作用域下 ready 可用，
                // 但沿用这个引用最稳，避免时序问题）
                window.__swRegistration = reg;

                // 向 SW 询问版本号（唯一来源：sw.js 的 CACHE_NAME），拿到后打印到控制台
                try {
                    const sw = reg.active || navigator.serviceWorker.controller;
                    if (sw) {
                        const ch = new MessageChannel();
                        ch.port1.onmessage = (e) => {
                            if (e.data && e.data.type === 'VERSION') {
                                window.__appVersion = e.data.version;
                                console.log('OuO 版本: ' + e.data.version);
                            }
                        };
                        sw.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
                    }
                } catch (e) { console.log('获取版本号失败（忽略）:', e); }

                // 尝试注册周期性后台同步 (Periodic Background Sync)
                if ('periodicSync' in reg) {
                    try {
                        const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
                        if (status.state === 'granted') {
                            // 注册后台唤醒任务 (这里的 minInterval 只是建议值，浏览器会自行决定真实频率)
                            await reg.periodicSync.register('check-proactive', {
                                minInterval: 30 * 60 * 1000 // 建议最小 30 分钟唤醒一次
                            });
                            console.log('✅ 周期性后台唤醒(Periodic Sync)注册成功！');
                        } else {
                            console.log('⚠️ 浏览器未授予后台唤醒权限');
                        }
                    } catch (e) {
                        console.log('周期性后台唤醒不可用或报错:', e);
                    }
                }
            })
            .catch(err => console.log('❌ SW 注册失败:', err));
        
        // 【核心】：监听 Service Worker 在后台发来的唤醒暗号！
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'PERIODIC_CHECK') {
                console.log('🔔 [后台唤醒] 收到 Service Worker 信号，开始执行主动消息检测！');
                
                // 收到暗号后，立刻执行那两个核心的主动消息函数
                if (typeof checkAndDeliverProactiveMessages === 'function') {
                    checkAndDeliverProactiveMessages();
                }
                if (typeof triggerIdleProactiveGeneration === 'function') {
                    triggerIdleProactiveGeneration();
                }
            }

            // 用户点了系统通知：直接跳进那条消息所属的聊天室
            if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
                console.log('🔔 [通知点击] 跳转到会话:', event.data.chatId, event.data.chatType);
                if (window.NotifyCenter && typeof NotifyCenter.openChatFromNotification === 'function') {
                    NotifyCenter.openChatFromNotification(event.data.chatId, event.data.chatType);
                }
            }
        });

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

    // App 被彻底关掉时点系统通知，SW 会用 './#chat=<id>&type=<t>' 冷启动页面。
    // 这里把参数读出来跳转，然后清掉 hash，避免刷新时重复跳。
    try {
        const m = (location.hash || '').match(/[#&]chat=([^&]+)(?:&type=([^&]+))?/);
        if (m) {
            const chatId = decodeURIComponent(m[1]);
            const chatType = m[2] ? decodeURIComponent(m[2]) : undefined;
            history.replaceState(null, '', location.pathname + location.search);
            if (window.NotifyCenter && typeof NotifyCenter.openChatFromNotification === 'function') {
                NotifyCenter.openChatFromNotification(chatId, chatType);
            }
        }
    } catch (e) { console.log('通知冷启动跳转解析失败（忽略）:', e); }

    // ⭐⭐⭐ C. 切后台 / 回前台的处理
    //
    // ★ 这里过去在「切后台」时调 saveData() 做全量保存，是丢数据和卡顿的根源，已彻底移除：
    //     - 全量 bulkPut 十几张表，而切后台那一刻正是系统在决定要不要回收页面，
    //       在这时制造内存与 IO 尖峰等于主动提高被杀概率；
    //     - 多窗口下会用本窗口的内存整个盖掉库，另一个窗口的改动就没了；
    //     - 消息数上万后每次切后台都要卡一下。
    //   现在所有数据改动都在发生时就精准落盘，切后台不需要做任何保存工作。
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible') return;

        // 回到前台：补投主动消息，并检查库是否被别的窗口整体替换过（备份恢复）
        console.log('📱 页面重新可见，检查数据同步...');
        if (typeof checkAndDeliverProactiveMessages === 'function') {
            checkAndDeliverProactiveMessages();
        }

        if (typeof window.dexieDB === 'undefined') return;
        try {
            // app_metadata.lastUpdateTime 现在只由 restoreAllTablesToDB（备份恢复）写，
            // 所以这里只会在「另一个窗口恢复了备份」时命中，不会像以前那样被普通刷新误触。
            const storedMeta = await window.dexieDB.globalSettings.get('app_metadata');
            if (storedMeta?.lastUpdateTime > (window.dbLoadTimestamp || 0)) {
                console.log('🔄 检测到数据库已被替换，重新加载...');
                await loadData();
                if (typeof applySafeAreaSettings === 'function') applySafeAreaSettings();
                if (typeof applyScreenAdaptation === 'function') applyScreenAdaptation();
                refreshUIAfterSync();
                showToast('已加载最新数据');
            }
        } catch (e) {
            console.error('数据同步检查失败:', e);
        }
    });

    // ★ 这里过去有一个 pagehide 兜底全量保存，已彻底移除。它有三重问题：
    //   1. 完全绕过了上面那套多窗口保护（既不看开关也不比时间戳），
    //      是"两个窗口互相覆盖"这个老 bug 唯一还没堵上的口子；
    //   2. saveData 是一长串 await，pagehide 之后浏览器随时可能销毁页面，
    //      结果往往是"表写了一半、末尾的时间戳没更新"的半保存状态，
    //      反而让其他窗口以为库没变；
    //   3. 它做的事本来就没必要——数据在改动的那一刻已经精准落盘了。
    //   （chat_image_store.js 里另有一个 pagehide，那是回收 objectURL，与保存无关，保留。）
});