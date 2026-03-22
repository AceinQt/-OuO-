// --- database.js ---

// 1. 定义全局设置的白名单
const globalSettingKeys =[
    'apiSettings', 'wallpaper', 'homeScreenMode', 'fontUrl', 'customIcons',
    'apiPresets', 'bubbleCssPresets', 'globalCss',
    'globalCssPresets', 'homeSignature',
    'homeWidgetSettings', 'insWidgetSettings', 'homeStatusBarColor','homeNavigationBarColor',
    'pomodoroTasks', 'pomodoroSettings' ,
    'enableTopSafeArea', 'enableBottomSafeArea', 
    'enableScreenAdaptation',
    'enableSwipeBack'
];

// 2. 初始化内存数据库对象 (db)
window.db = {
    characters:[],
    groups:[],
    worldBooks: [],
    myStickers: [],

    // --- 独立模块 ---
    userPersonas:[], // 用户档案
    forumPosts:[],   // 论坛帖子
    rpgProfiles:[],  // RPG存档

    // ★★★ 新增：Peek 数据字典 (Key: charId, Value: { memos:[], browser:[], ... }) ★★★
    peekData: {}, 

    // --- 论坛元数据 ---
    forumUserIdentity: { nickname: '新用户', avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', persona: '', realName: '', anonCode: '0311', customDetailCss: '' },
    forumBindings: { worldBookIds:[], charIds: [], userPersonaIds:[], useChatHistory: false, historyLimit: 50 },
    watchingPostIds: [],
    favoritePostIds:[],
    enableTopSafeArea: true,
    enableBottomSafeArea: true,
    enableScreenAdaptation: false,
    enableSwipeBack: false,
    homeStatusBarColor: '#ffffff',
    homeNavigationBarColor: '#ffffff',

    // --- 基础设置 ---
    apiSettings: {},
    wallpaper: 'https://i.postimg.cc/W4Z9R9x4/ins-1.jpg',
    homeScreenMode: 'day',
    fontUrl: '',
    customIcons: {},
    apiPresets: [],
    bubbleCssPresets:[],
    globalCss: '',
    globalCssPresets:[],
    homeSignature: '编辑个性签名...',
    pomodoroTasks:[],
    pomodoroSettings: { boundCharId: null, userPersona: '', focusBackground: '', taskCardBackground: '', encouragementMinutes: 25, pokeLimit: 5, globalWorldBookIds:[] },
    insWidgetSettings: { avatar1: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', bubble1: 'love u.', avatar2: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg', bubble2: 'miss u.' },
    homeWidgetSettings: typeof defaultWidgetSettings !== 'undefined' ? defaultWidgetSettings : {}
};

// 3. Dexie 数据库配置
const dexieDB = new Dexie('QChatDB_ee');

// 如果其他标签页占用数据库，导致升级卡死，给予提示
dexieDB.on('blocked', () => {
    alert("系统需要升级数据库。请关闭当前浏览器的其他应用标签页，然后再刷新此页面！");
});

// Version 1 (历史版本)
dexieDB.version(1).stores({ storage: 'key, value' });

// Version 2 (历史版本)
dexieDB.version(2).stores({ characters: '&id', groups: '&id', worldBooks: '&id', myStickers: '&id', globalSettings: 'key' });

// ★★★ Version 3 (全部分离 + Peek表) ★★★
dexieDB.version(3).stores({
    characters: '&id', groups: '&id', worldBooks: '&id', myStickers: '&id', globalSettings: 'key',

    // 独立表：
    userPersonas: '&id',
    forumPosts: '&id',
    rpgProfiles: '&id',
    forumMetadata: 'key',
    // ★★★ 新增：peekData 表 (主键是 charId) ★★★
    peekData: '&charId'
}).upgrade(async tx => {
    console.log("Upgrading database to version 3 (Independent tables + PeekData)...");
});

// ★★★ Version 4 (消息独立表，大幅提升性能) ★★★
dexieDB.version(4).stores({
    characters: '&id', groups: '&id', worldBooks: '&id', myStickers: '&id', globalSettings: 'key',
    userPersonas: '&id', forumPosts: '&id', rpgProfiles: '&id', forumMetadata: 'key', peekData: '&charId',
    messages: '&id, chatId, timestamp' // 核心：每条消息独立存储，提升速度
}).upgrade(async tx => {
    console.log("Upgrading database to version 4 (Message table added)...");
});

window.loadData = async () => {
    try {
        console.log("📦 正在加载数据...");

        // 并行读取所有表
        const[
            characters, groups, worldBooks, myStickers, settingsArray,
            newUserPersonas, newForumPosts, newRpgProfiles, newForumMeta,
            newPeekData,
            newMessages 
        ] = await Promise.all([
            dexieDB.characters.toArray(), dexieDB.groups.toArray(), dexieDB.worldBooks.toArray(),
            dexieDB.myStickers.toArray(), dexieDB.globalSettings.toArray(), dexieDB.userPersonas.toArray(),
            dexieDB.forumPosts.toArray(), dexieDB.rpgProfiles.toArray(), dexieDB.forumMetadata.toArray(),
            dexieDB.peekData.toArray(), dexieDB.messages.toArray()
        ]);

        // ★ 核心安全锁：优先读取持久化迁移标记，防止多标签页状态不同步
        // 只要 IndexedDB 里记录了 migrationV4Done，就信任它，不再扫描 history
        const migrationFlag = settingsArray.find(s => s.key === 'migrationV4Done');
        let needsMigration;
        if (migrationFlag && migrationFlag.value === true) {
            window.isMessageMigrated = true;
            needsMigration = false;
        } else {
            needsMigration = characters.some(c => c.history && c.history.length > 0) || groups.some(g => g.history && g.history.length > 0);
            window.isMessageMigrated = !needsMigration;
        }

        const messagesByChatId = {};
        newMessages.forEach(m => {
            if (!messagesByChatId[m.chatId]) messagesByChatId[m.chatId] = [];
            messagesByChatId[m.chatId].push(m);
        });

        // =========================================================
        // 【全新流水线】：一键备份 -> 自动迁移 -> 回归主页
        // =========================================================
        if (needsMigration) {
            // 1. 暂时隐藏开屏转圈，让弹窗可见
            const splash = document.getElementById('app-splash-screen');
            if (splash) {
                splash.classList.add('fade-out');
                splash.style.pointerEvents = 'none';
            }

            // 弹出双选按钮（左边确认直接迁移，右边一键备份）
            const choice = await AppUI.confirm(
                "检测到需要升级底层数据结构（以大幅提升后续加载与运行性能）。\n\n强烈建议您先进行【一键备份】，防止设备空间不足或意外断电导致数据丢失。\n\n请选择操作：", 
                "数据库核心升级", "直接迁移", "一键备份(推荐)"
            );

            // 2. 无论选什么，接下来都要花时间，重新恢复开屏转圈，并注入动态提示文本
            if (splash) {
                splash.classList.remove('fade-out');
                splash.style.pointerEvents = 'auto'; // 重新阻挡用户点击底层
                
                let statusText = document.getElementById('splash-status-text');
                if (!statusText) {
                    statusText = document.createElement('div');
                    statusText.id = 'splash-status-text';
                    statusText.style.marginTop = '20px';
                    statusText.style.fontSize = '14px';
                    statusText.style.color = '#666';
                    statusText.style.textAlign = 'center';
                    // 挂载到原有的内容区里
                    const splashContent = splash.querySelector('.splash-content') || splash;
                    splashContent.appendChild(statusText);
                }
            }
            const statusEl = document.getElementById('splash-status-text');

            // 3. 如果用户点击了右侧的 "一键备份(推荐)" (choice === false)
            if (choice === false) {
                if (statusEl) statusEl.textContent = "正在生成全量备份文件，请稍候...";
                try {
                    // 调用已有的全局备份函数
                    if (typeof createFullBackupData === 'function') {
                        const backupData = await createFullBackupData();
                        const jsonString = JSON.stringify(backupData);
                        const blob = new Blob([jsonString], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        
                        // 触发系统下载
                        const a = document.createElement('a');
                        a.href = url;
                        const dateStr = new Date().toLocaleString('zh-CN', { hour12: false }).replace(/[\/\s:]/g, '');
                        a.download = `QChat_Safe_Backup_${dateStr}.json`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        
                        if (statusEl) statusEl.textContent = "备份文件已生成！准备开始迁移...";
                        // 稍微停顿 1.5 秒，一方面让下载顺利弹出，一方面让用户看清状态
                        await new Promise(r => setTimeout(r, 1500)); 
                    } else {
                        console.warn("未找到备份函数，跳过备份步骤");
                    }
                } catch(e) {
                    console.error("备份失败:", e);
                    alert("备份过程遇到错误，将在没有备份的情况下强制继续迁移。");
                }
            }

            // 4. 无论是否备份，顺畅进入迁移阶段
            if (statusEl) statusEl.textContent = "正在执行核心数据结构剥离，请勿关闭页面...";
            
            let migrationMsgs =[];
            characters.forEach(c => {
                if (c.history && c.history.length > 0) {
                    c.history.forEach((m, idx) => { 
                        if (!m.id) m.id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}_${idx}`;
                        m.chatId = c.id; 
                        m.chatType = 'private'; 
                        migrationMsgs.push(m); 
                    });
                    delete c.history; // 剥离旧体积
                }
            });
            groups.forEach(g => {
                if (g.history && g.history.length > 0) {
                    g.history.forEach((m, idx) => { 
                        if (!m.id) m.id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}_${idx}`;
                        m.chatId = g.id; 
                        m.chatType = 'group'; 
                        migrationMsgs.push(m); 
                    });
                    delete g.history;
                }
            });
            
            // 分块写入
            const chunkSize = 5000;
            for (let i = 0; i < migrationMsgs.length; i += chunkSize) {
                await dexieDB.messages.bulkPut(migrationMsgs.slice(i, i + chunkSize));
                if (statusEl) statusEl.textContent = `正在落库消息 (${Math.min(i + chunkSize, migrationMsgs.length)} / ${migrationMsgs.length})...`;
            }
            
            if (statusEl) statusEl.textContent = "正在覆盖保存优化后的角色档案...";
            await dexieDB.characters.bulkPut(characters);
            await dexieDB.groups.bulkPut(groups);
            
            // 数据写回内存，保证当次加载正常运行
            migrationMsgs.forEach(m => {
                if (!messagesByChatId[m.chatId]) messagesByChatId[m.chatId] = [];
                messagesByChatId[m.chatId].push(m);
            });
            
            window.isMessageMigrated = true; 
            // ★ 写入持久化标记：保证多标签页/下次加载都能正确识别迁移状态
            // 这一步是最后写的，如果中途断电它不存在，下次加载会重新走迁移流程（安全）
            try { await dexieDB.globalSettings.put({ key: 'migrationV4Done', value: true }); } catch(e) { console.warn('⚠️ 迁移标记写入失败:', e); }
            if (statusEl) statusEl.textContent = "系统升级完成！即将进入主页...";
            await new Promise(r => setTimeout(r, 600)); // 让用户看清最后一句提示
        }

        // =========================================================
        // 将消息挂载回内存对象，对老代码的逻辑保持完全隐形
        // =========================================================
        Object.values(messagesByChatId).forEach(arr => {
            arr.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        });

        characters.forEach(c => { c.history = messagesByChatId[c.id] ||[]; });
        groups.forEach(g => { g.history = messagesByChatId[g.id] ||[]; });

        // 基础数据赋值
        db.characters = characters || []; db.groups = groups ||[];
        db.worldBooks = worldBooks ||[]; db.myStickers = myStickers ||[];

        // 将 key-value 数组转为对象
        const settings = settingsArray.reduce((acc, item) => { acc[item.key] = item.value; return acc; }, {});
        const forumMeta = newForumMeta.reduce((acc, item) => { acc[item.key] = item.value; return acc; }, {});

        // ★★★ 处理 Peek 数据：转为对象方便调用 ★★★
        db.peekData = {};
        if (newPeekData) { newPeekData.forEach(item => { db.peekData[item.charId] = item.data; }); }

        // =========================================================
        // 自动搬家逻辑 
        // =========================================================

        // 1. 用户档案迁移
        if (newUserPersonas.length > 0) {
            db.userPersonas = newUserPersonas;
        } else {
            const oldData = settings['myPersonaPresets'] || settings['userPersonas'];
            if (oldData && oldData.length > 0) {
                console.log("📦 迁移用户档案到独立表...");
                db.userPersonas = oldData;
                db.userPersonas.forEach(p => { if (!p.id) p.id = Date.now() + Math.random().toString().slice(2, 6); });
                await dexieDB.userPersonas.bulkPut(db.userPersonas);
                await dexieDB.globalSettings.delete('myPersonaPresets');
                await dexieDB.globalSettings.delete('userPersonas');
            } else {
                db.userPersonas =[];
            }
        }

        // 2. RPG 存档迁移
        if (newRpgProfiles.length > 0) {
            db.rpgProfiles = newRpgProfiles;
        } else if (settings['rpgProfiles']) {
            console.log("📦 迁移 RPG 存档到独立表...");
            db.rpgProfiles = settings['rpgProfiles'];
            await dexieDB.rpgProfiles.bulkPut(db.rpgProfiles);
            await dexieDB.globalSettings.delete('rpgProfiles');
        } else {
            db.rpgProfiles =[];
        }

        // 3. 论坛帖子迁移 (包含ID修复逻辑)
        if (newForumPosts.length > 0) {
            db.forumPosts = newForumPosts;
        } else if (settings['forumPosts']) {
            console.log("📦 迁移论坛帖子到独立表...");
            db.forumPosts = settings['forumPosts'];
            
            // 修复 ID
            db.forumPosts.forEach(post => {
                if (!post.id) post.id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
            });
            
            await dexieDB.forumPosts.bulkPut(db.forumPosts);
            await dexieDB.globalSettings.delete('forumPosts');
        } else {
            db.forumPosts =[];
        }

        // ★★★ 论坛帖子加载后立即按时间倒序排列 ★★★
        if (db.forumPosts && db.forumPosts.length > 0) {
            db.forumPosts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            console.log(`✅ 已按时间倒序排列 ${db.forumPosts.length} 条帖子`);
        }

        // 4. 论坛元数据迁移
        const forumMetaKeys =['forumUserIdentity', 'forumBindings', 'watchingPostIds', 'favoritePostIds'];
        forumMetaKeys.forEach(key => {
            if (forumMeta[key] !== undefined) {
                db[key] = forumMeta[key];
            } else if (settings[key] !== undefined) {
                console.log(`📦 迁移 [${key}] 到独立表...`);
                db[key] = settings[key];
                dexieDB.forumMetadata.put({ key: key, value: db[key] });
                dexieDB.globalSettings.delete(key);
            }
        });

        // =========================================================
        // 处理普通设置
        // =========================================================
        globalSettingKeys.forEach(key => { if (settings[key] !== undefined) db[key] = settings[key]; });

        // 兜底检查
        db.characters.forEach(c => {
            if (c.isPinned === undefined) c.isPinned = false;
            if (c.status === undefined) c.status = '在线';
            if (!c.worldBookIds) c.worldBookIds =[];
            // 确保 peek 设置存在
            if (!c.peekScreenSettings) c.peekScreenSettings = { wallpaper: '', customIcons: {}, unlockAvatar: '' };
        });

        // ⭐⭐⭐ 新增：记录加载时间戳(用于多标签页同步) ⭐⭐⭐
        window.dbLoadTimestamp = Date.now();

        // 同时在 IndexedDB 中记录(用于跨标签页对比)
        try {
            await dexieDB.globalSettings.put({ key: 'app_metadata', lastUpdateTime: window.dbLoadTimestamp });
        } catch (e) {
            console.warn('⚠️ 元数据保存失败:', e);
        }

        console.log("✅ 数据加载完成 (V4 独立消息表模式), 时间戳:", window.dbLoadTimestamp);

    } catch (err) {
        console.error("❌ loadData 致命错误:", err);
        await AppUI.alert("数据加载失败，请查看控制台");
    }
};

// 5. 核心：保存数据
window.saveData = async () => {
    // 1. 聊天 & 角色 & 组
    try {
        await dexieDB.transaction('rw', [dexieDB.characters, dexieDB.groups], async () => {
            if(db.characters) {
                const safeChars = db.characters.map(c => { 
                    const o = {...c}; 
                    // ★ 修复致命隐患：如果用户没做迁移，千万别把记录给强制剔除丢了
                    if(window.isMessageMigrated) delete o.history; 
                    return o; 
                });
                await dexieDB.characters.bulkPut(safeChars);
            }
            if(db.groups) {
                const safeGroups = db.groups.map(g => { 
                    const o = {...g}; 
                    if(window.isMessageMigrated) delete o.history; 
                    return o; 
                });
                await dexieDB.groups.bulkPut(safeGroups);
            }
        });
    } catch (e) {
        console.error("❌ 聊天保存失败:", e);
    }

    // 2. 用户档案
    try {
        if (db.userPersonas && db.userPersonas.length > 0) await dexieDB.userPersonas.bulkPut(JSON.parse(JSON.stringify(db.userPersonas)));
        else if (db.userPersonas && db.userPersonas.length === 0) await dexieDB.userPersonas.clear();
    } catch (e) { console.error("❌ 用户档案保存失败:", e); }

    // 3. 世界书
    try {
        if (db.worldBooks && db.worldBooks.length > 0) await dexieDB.worldBooks.bulkPut(db.worldBooks);
    } catch (e) { console.error("❌ 世界书保存失败:", e); }

    // 4. RPG 存档
    try {
        if (db.rpgProfiles && db.rpgProfiles.length > 0) await dexieDB.rpgProfiles.bulkPut(JSON.parse(JSON.stringify(db.rpgProfiles)));
        else if (db.rpgProfiles && db.rpgProfiles.length === 0) await dexieDB.rpgProfiles.clear();
    } catch (e) { console.error("❌ RPG保存失败:", e); }

    // 5. 论坛帖子 (保留排序逻辑)
    try {
        if (db.forumPosts && db.forumPosts.length > 0) {
            // ★★★ 保存前先排序，确保数据库中也是倒序 ★★★
            db.forumPosts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            await dexieDB.forumPosts.bulkPut(db.forumPosts);
        } else if (db.forumPosts && db.forumPosts.length === 0) {
            await dexieDB.forumPosts.clear();
        }
    } catch (e) { console.error("❌ 论坛帖子保存失败:", e); }

    // ★★★ 6. 保存 Peek 数据 (独立表) ★★★
    try {
        // 将内存中的字典对象转为数组存入数据库
        const peekArray = Object.entries(db.peekData).map(([charId, data]) => ({ charId: charId, data: data }));
        if(peekArray.length > 0) await dexieDB.peekData.bulkPut(JSON.parse(JSON.stringify(peekArray)));
    } catch (e) { console.error("❌ Peek数据保存失败:", e); }

    // 7. 论坛设置
    try {
        const metaKeys =['forumUserIdentity', 'forumBindings', 'watchingPostIds', 'favoritePostIds'];
        await Promise.all(metaKeys.map(key => db[key] !== undefined ? dexieDB.forumMetadata.put({ key: key, value: db[key] }) : null).filter(p => p));
    } catch (e) { console.error("❌ 论坛设置保存失败:", e); }

    // 8. 通用设置
    try {
        await Promise.all(globalSettingKeys.map(key => db[key] !== undefined ? dexieDB.globalSettings.put({ key: key, value: db[key] }) : null).filter(p => p));
        if (db.myStickers) await dexieDB.myStickers.bulkPut(db.myStickers);
    } catch (e) { console.error("❌ 通用设置保存失败:", e); }

    // ⭐⭐⭐ 新增：更新保存时间戳(用于多标签页同步) ⭐⭐⭐
    const now = Date.now();
    window.dbLoadTimestamp = now;

    // 同时在 IndexedDB 中记录
    try {
        await dexieDB.globalSettings.put({ key: 'app_metadata', lastUpdateTime: now });
    } catch (e) {
        console.warn('⚠️ 元数据更新失败:', e);
    }

    console.log('✅ 数据保存完成, 时间戳:', now);
};

// --- 元数据保存 ---
window.saveSingleChat = async (chatId, chatType) => {
    try {
        if (chatType === 'private') {
            const chat = db.characters.find(c => c.id === chatId);
            if (chat) {
                const safeChat = {...chat}; 
                if(window.isMessageMigrated) delete safeChat.history; // ★同理防御
                await dexieDB.characters.put(safeChat); // 只覆写当前这一个角色
            }
        } else if (chatType === 'group') {
            const group = db.groups.find(g => g.id === chatId);
            if (group) {
                const safeGroup = {...group}; 
                if(window.isMessageMigrated) delete safeGroup.history;
                await dexieDB.groups.put(safeGroup); // 只覆写当前这一个群聊
            }
        }
    } catch (e) { console.error("❌ 聊天信息保存失败:", e); }
};   

// ★ 如果未完成迁移，跳过对消息独立表的操作，完全依靠上面的 saveSingleChat 执行大一统保存机制
window.saveMessageToDB = async (msg, chatId, chatType) => {
    if(!window.isMessageMigrated) return; 
    try { await dexieDB.messages.put({ ...msg, chatId, chatType }); } catch (e) { console.error("❌ 消息保存失败:", e); }
};
window.saveMessagesToDB = async (msgs, chatId, chatType) => {
    if(!window.isMessageMigrated) return;
    try { await dexieDB.messages.bulkPut(msgs.map(m => ({ ...m, chatId, chatType }))); } catch (e) { console.error("❌ 批量消息保存失败:", e); }
};
// msgIds 必须是数组，如 ['id1', 'id2']，单条也要包裹成 [id]
window.deleteMessagesFromDB = async (msgIds) => {
    if(!window.isMessageMigrated) return;
    try { await dexieDB.messages.bulkDelete(msgIds); } catch (e) { console.error("❌ 消息删除失败:", e); }
};
window.clearChatHistoryInDB = async (chatId) => {
    if(!window.isMessageMigrated) return;
    try {
        const keys = await dexieDB.messages.where({chatId}).primaryKeys();
        await dexieDB.messages.bulkDelete(keys);
    } catch (e) { console.error("❌ 清空消息失败:", e); }
};

// --- 专门用于高效保存 Peek 数据的机制 ---
window.savePeekData = async (charId) => {
    try {
        if (!charId || !db.peekData[charId]) return;
        // Dexie的 put 会自动根据主键(charId)进行插入或更新，速度极快
        await dexieDB.peekData.put({ charId: charId, data: db.peekData[charId] });
        console.log(`✅ [Peek] 角色 ${charId} 的应用数据已独立保存`);
    } catch (e) {
        console.error("❌ Peek数据独立保存失败:", e);
    }
};

// --- 专门用于论坛：精准保存单条帖子 ---
window.saveSinglePost = async (postId) => {
    try {
        const post = db.forumPosts.find(p => p.id === postId);
        if (post) {
            await dexieDB.forumPosts.put(post);
            console.log(`✅ [Forum] 帖子 ${postId} 已独立保存`);
        }
    } catch (e) {
        console.error("❌ 帖子独立保存失败:", e);
    }
};

// --- 专门用于论坛：精准保存元数据 (设置、收藏、在看) ---
window.saveForumMeta = async () => {
    try {
        const metaKeys =['forumUserIdentity', 'forumBindings', 'watchingPostIds', 'favoritePostIds'];
        await Promise.all(metaKeys.map(key => db[key] !== undefined ? dexieDB.forumMetadata.put({ key: key, value: db[key] }) : null).filter(p => p));
        console.log("✅ [Forum] 论坛元数据已精准保存");
    } catch (e) {
        console.error("❌ 论坛设置精准保存失败:", e);
    }
};

// --- 针对主页与全局设置的精准保存 ---
window.saveGlobalKeys = async (keys) => {
    try {
        await Promise.all(keys.map(key => db[key] !== undefined ? dexieDB.globalSettings.put({ key: key, value: db[key] }) : null).filter(p => p));
        console.log(`✅ [Settings] 已精准保存: ${keys.join(', ')}`);
    } catch (e) { console.error("❌ 设置保存失败:", e); }
};

// --- 针对番茄钟的精准保存 ---
window.savePomodoroData = async () => {
    try {
        await dexieDB.globalSettings.put({ key: 'pomodoroTasks', value: db.pomodoroTasks });
        await dexieDB.globalSettings.put({ key: 'pomodoroSettings', value: db.pomodoroSettings });
        console.log("✅ [Pomodoro] 任务与设置已保存");
    } catch (e) { console.error("❌ 番茄钟保存失败:", e); }
};

// --- 针对世界书的精准保存 ---
window.saveWorldBookData = async (bookId = null) => {
    try {
        if (bookId) {
            const book = db.worldBooks.find(b => b.id === bookId);
            if (book) {
                await dexieDB.worldBooks.put(book);
                console.log("✅ [WorldBook] 数据已精准保存");
            } else {
                console.warn(`⚠️ [WorldBook] 未找到 bookId=${bookId}，跳过保存`);
            }
        } else {
            await dexieDB.worldBooks.bulkPut(db.worldBooks);
            console.log("✅ [WorldBook] 数据已精准保存");
        }
    } catch (e) { console.error("❌ 世界书保存失败:", e); }
};

// --- 针对 RPG 存档的精准保存 ---
window.saveSingleRPGProfile = async (profileId) => {
    try {
        const profile = db.rpgProfiles.find(p => p.id === profileId);
        if (profile) {
            await dexieDB.rpgProfiles.put(JSON.parse(JSON.stringify(profile)));
            console.log(`✅ [RPG] 存档 ${profileId} 已独立保存`);
        }
    } catch (e) { console.error("❌ RPG存档保存失败:", e); }
};

// --- [RPG模块] 整表保存（用于删除档案后同步） ---
window.saveRPGTable = async () => {
    try {
        // 先清空表，再把当前内存里的数组全部写进去
        await dexieDB.rpgProfiles.clear();
        if (db.rpgProfiles.length > 0) await dexieDB.rpgProfiles.bulkPut(JSON.parse(JSON.stringify(db.rpgProfiles)));
        console.log("✅ [RPG] 档案表已同步");
    } catch (e) { console.error("❌ RPG表保存失败:", e); }
};

// --- [世界书模块] 整表保存（用于删除条目后同步） ---
window.saveWorldBookTable = async () => {
    try {
        await dexieDB.worldBooks.clear();
        if (db.worldBooks.length > 0) await dexieDB.worldBooks.bulkPut(db.worldBooks);
        console.log("✅ [WorldBook] 世界书表已同步");
    } catch (e) { console.error("❌ 世界书表保存失败:", e); }
};

// --- [用户档案] 整表保存 ---
window.saveUserPersonaTable = async () => {
    try {
        await dexieDB.userPersonas.clear();
        if (db.userPersonas.length > 0) await dexieDB.userPersonas.bulkPut(db.userPersonas);
    } catch (e) { console.error("❌ 用户档案表保存失败:", e); }
};
