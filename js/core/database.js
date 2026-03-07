// --- database.js ---

// 1. 定义全局设置的白名单
const globalSettingKeys = [
    'apiSettings', 'wallpaper', 'homeScreenMode', 'fontUrl', 'customIcons',
    'apiPresets', 'bubbleCssPresets', 'globalCss',
    'globalCssPresets', 'homeSignature',
    'homeWidgetSettings', 'insWidgetSettings', 'homeStatusBarColor',
    'pomodoroTasks', 'pomodoroSettings' ,
    'enableTopSafeArea', 'enableBottomSafeArea', 
    'enableScreenAdaptation',
    'enableSwipeBack'
];

// 2. 初始化内存数据库对象 (db)
window.db = {
    characters: [],
    groups: [],
    worldBooks: [],
    myStickers: [],
    
    // --- 独立模块 ---
    userPersonas: [], // 用户档案
    forumPosts: [],   // 论坛帖子
    rpgProfiles: [],  // RPG存档
    
    // ★★★ 新增：Peek 数据字典 (Key: charId, Value: { memos:[], browser:[], ... }) ★★★
    peekData: {}, 
    
    // --- 论坛元数据 ---
    forumUserIdentity: { nickname: '新用户',
            avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
            persona: '',
            realName: '',
            anonCode: '0311',
            customDetailCss: '' },
    forumBindings: { worldBookIds: [], charIds: [], userPersonaIds: [], useChatHistory: false, historyLimit: 50 },
    watchingPostIds: [],
    favoritePostIds: [],
    enableTopSafeArea: true,
    enableBottomSafeArea: true,
    enableScreenAdaptation: false,
    enableSwipeBack: false,
    homeStatusBarColor: '#ffffff',

    // --- 基础设置 ---
    apiSettings: {},
    wallpaper: 'https://i.postimg.cc/W4Z9R9x4/ins-1.jpg',
    homeScreenMode: 'day',
    fontUrl: '',
    customIcons: {},
    apiPresets: [],
    bubbleCssPresets: [],
    globalCss: '',
    globalCssPresets: [],
    homeSignature: '编辑个性签名...',
    pomodoroTasks: [],
    pomodoroSettings: { boundCharId: null, userPersona: '', focusBackground: '', taskCardBackground: '', encouragementMinutes: 25, pokeLimit: 5, globalWorldBookIds: [] },
    insWidgetSettings: { avatar1: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', bubble1: 'love u.', avatar2: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg', bubble2: 'miss u.' },
    homeWidgetSettings: typeof defaultWidgetSettings !== 'undefined' ? defaultWidgetSettings : {}
};

// 3. Dexie 数据库配置
const dexieDB = new Dexie('QChatDB_ee');

// Version 1 (历史版本)
dexieDB.version(1).stores({
    storage: 'key, value'
});

// Version 2 (历史版本)
dexieDB.version(2).stores({
    characters: '&id',
    groups: '&id',
    worldBooks: '&id',
    myStickers: '&id',
    globalSettings: 'key'
});

// ★★★ Version 3 (新版本：全部分离 + Peek表) ★★★
dexieDB.version(3).stores({
    characters: '&id',
    groups: '&id',
    worldBooks: '&id',
    myStickers: '&id',
    globalSettings: 'key',
    
    // 独立表：
    userPersonas: '&id',  
    forumPosts: '&id',    
    rpgProfiles: '&id',   
    forumMetadata: 'key',
    // ★★★ 新增：peekData 表 (主键是 charId) ★★★
    peekData: '&charId'   
}).upgrade(async tx => {
    console.log("Upgrading database to version 3...");
});


// 4. 核心：读取数据
window.loadData = async () => {
    try {
        console.log("📦 正在加载数据...");

        // 并行读取所有表
        const [
            characters, 
            groups, 
            worldBooks, 
            myStickers, 
            settingsArray,
            
            // 新表的数据
            newUserPersonas,
            newForumPosts,
            newRpgProfiles,
            newForumMeta,
            // ★★★ 读取 Peek 数据 ★★★
            newPeekData
        ] = await Promise.all([
            dexieDB.characters.toArray(),
            dexieDB.groups.toArray(),
            dexieDB.worldBooks.toArray(),
            dexieDB.myStickers.toArray(),
            dexieDB.globalSettings.toArray(),
            
            dexieDB.userPersonas.toArray(),
            dexieDB.forumPosts.toArray(),
            dexieDB.rpgProfiles.toArray(),
            dexieDB.forumMetadata.toArray(),
            dexieDB.peekData.toArray()
        ]);

        // 基础数据赋值
        db.characters = characters || [];
        db.groups = groups || [];
        db.worldBooks = worldBooks || [];
        db.myStickers = myStickers || [];

        // 将 key-value 数组转为对象
        const settings = settingsArray.reduce((acc, item) => { acc[item.key] = item.value; return acc; }, {});
        const forumMeta = newForumMeta.reduce((acc, item) => { acc[item.key] = item.value; return acc; }, {});

        // ★★★ 处理 Peek 数据：转为对象方便调用 ★★★
        db.peekData = {};
        if (newPeekData) {
            newPeekData.forEach(item => {
                db.peekData[item.charId] = item.data;
            });
        }

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
                db.userPersonas = [];
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
            db.rpgProfiles = [];
        }

        // 3. 论坛帖子迁移 (包含你的ID修复逻辑)
        if (newForumPosts.length > 0) {
            db.forumPosts = newForumPosts;
        } else if (settings['forumPosts']) {
            console.log("📦 迁移论坛帖子到独立表...");
            db.forumPosts = settings['forumPosts'];
            
            // 修复 ID
            db.forumPosts.forEach(post => {
                if (!post.id) {
                    post.id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                }
            });
            
            await dexieDB.forumPosts.bulkPut(db.forumPosts);
            await dexieDB.globalSettings.delete('forumPosts');
        } else {
            db.forumPosts = [];
        }

        // ★★★ 论坛帖子加载后立即按时间倒序排列 (保留你的修复) ★★★
        if (db.forumPosts && db.forumPosts.length > 0) {
            db.forumPosts.sort((a, b) => {
                const timeA = a.timestamp || 0;
                const timeB = b.timestamp || 0;
                return timeB - timeA; 
            });
            console.log(`✅ 已按时间倒序排列 ${db.forumPosts.length} 条帖子`);
        }

        // 4. 论坛元数据迁移
        const forumMetaKeys = ['forumUserIdentity', 'forumBindings', 'watchingPostIds', 'favoritePostIds'];
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
        globalSettingKeys.forEach(key => {
            if (settings[key] !== undefined) {
                db[key] = settings[key];
            }
        });

        // 兜底检查
        db.characters.forEach(c => {
            if (c.isPinned === undefined) c.isPinned = false;
            if (c.status === undefined) c.status = '在线';
            if (!c.worldBookIds) c.worldBookIds = [];
            // 确保 peek 设置存在
            if (!c.peekScreenSettings) c.peekScreenSettings = { wallpaper: '', customIcons: {}, unlockAvatar: '' };
        });

        // ⭐⭐⭐ 新增：记录加载时间戳(用于多标签页同步) ⭐⭐⭐
        window.dbLoadTimestamp = Date.now();
        
        // 同时在 IndexedDB 中记录(用于跨标签页对比)
        try {
            await dexieDB.globalSettings.put({
                key: 'app_metadata',
                lastUpdateTime: window.dbLoadTimestamp
            });
        } catch (e) {
            console.warn('⚠️ 元数据保存失败:', e);
        }

        console.log("✅ 数据加载完成 (V3 独立表模式), 时间戳:", window.dbLoadTimestamp);

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
            if(db.characters) await dexieDB.characters.bulkPut(db.characters);
            if(db.groups) await dexieDB.groups.bulkPut(db.groups);
        });
    } catch (e) {
        console.error("❌ 聊天保存失败:", e);
        await AppUI.alert("严重警告：聊天保存失败！");
    }

    // 2. 用户档案
    try {
        if (db.userPersonas && db.userPersonas.length > 0) {
            const safeData = JSON.parse(JSON.stringify(db.userPersonas));
            await dexieDB.userPersonas.bulkPut(safeData);
        } else if (db.userPersonas && db.userPersonas.length === 0) {
            await dexieDB.userPersonas.clear();
        }
    } catch (e) { console.error("❌ 用户档案保存失败:", e); }

    // 3. 世界书
    try {
        if (db.worldBooks && db.worldBooks.length > 0) {
            await dexieDB.worldBooks.bulkPut(db.worldBooks);
        }
    } catch (e) { console.error("❌ 世界书保存失败:", e); }

    // 4. RPG 存档
    try {
        if (db.rpgProfiles && db.rpgProfiles.length > 0) {
            const safeRpg = JSON.parse(JSON.stringify(db.rpgProfiles));
            await dexieDB.rpgProfiles.bulkPut(safeRpg);
        } else if (db.rpgProfiles && db.rpgProfiles.length === 0) {
            await dexieDB.rpgProfiles.clear();
        }
    } catch (e) { console.error("❌ RPG保存失败:", e); }

    // 5. 论坛帖子 (保留你的排序逻辑)
    try {
        if (db.forumPosts && db.forumPosts.length > 0) {
            // ★★★ 保存前先排序，确保数据库中也是倒序 ★★★
            db.forumPosts.sort((a, b) => {
                const timeA = a.timestamp || 0;
                const timeB = b.timestamp || 0;
                return timeB - timeA;
            });
            await dexieDB.forumPosts.bulkPut(db.forumPosts);
        } else if (db.forumPosts && db.forumPosts.length === 0) {
            await dexieDB.forumPosts.clear();
        }
    } catch (e) { console.error("❌ 论坛帖子保存失败:", e); }

    // ★★★ 6. 新增：保存 Peek 数据 (独立表) ★★★
    try {
        // 将内存中的字典对象转为数组存入数据库
        const peekArray = Object.entries(db.peekData).map(([charId, data]) => ({
            charId: charId,
            data: data
        }));
        if(peekArray.length > 0) {
            const safePeek = JSON.parse(JSON.stringify(peekArray));
            await dexieDB.peekData.bulkPut(safePeek);
        }
    } catch (e) {
        console.error("❌ Peek数据保存失败:", e);
    }

    // 7. 论坛设置
    try {
        const metaKeys = ['forumUserIdentity', 'forumBindings', 'watchingPostIds', 'favoritePostIds'];
        const promises = metaKeys.map(key => {
            if (db[key] !== undefined) return dexieDB.forumMetadata.put({ key: key, value: db[key] });
            return null;
        }).filter(p => p);
        await Promise.all(promises);
    } catch (e) { console.error("❌ 论坛设置保存失败:", e); }

    // 8. 通用设置
    try {
        const settingsPromises = globalSettingKeys.map(key => {
            if (db[key] !== undefined) {
                return dexieDB.globalSettings.put({ key: key, value: db[key] });
            }
            return null;
        }).filter(p => p);

        await Promise.all(settingsPromises);
        if (db.myStickers) await dexieDB.myStickers.bulkPut(db.myStickers);
        
    } catch (e) { console.error("❌ 通用设置保存失败:", e); }

    // ⭐⭐⭐ 新增：更新保存时间戳(用于多标签页同步) ⭐⭐⭐
    const now = Date.now();
    window.dbLoadTimestamp = now;
    
    // 同时在 IndexedDB 中记录
    try {
        await dexieDB.globalSettings.put({
            key: 'app_metadata',
            lastUpdateTime: now
        });
    } catch (e) {
        console.warn('⚠️ 元数据更新失败:', e);
    }
    
    console.log('✅ 数据保存完成, 时间戳:', now);
};