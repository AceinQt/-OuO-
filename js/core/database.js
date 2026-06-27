// --- database.js ---

// 1. 定义全局设置的白名单
const globalSettingKeys =[
    'apiSettings', 'wallpaper', 'homeScreenMode', 'fontUrl', 'customIcons',
    'apiPresets', 'embeddingSettings', 'bubbleCssPresets', 'globalCss',
    'globalCssPresets', 'homeSignature',
    'homeWidgetSettings', 'insWidgetSettings', 'homeStatusBarColor','homeNavigationBarColor',
    'pomodoroTasks', 'pomodoroSettings' ,
    'enableTopSafeArea', 'enableBottomSafeArea', 
    'enableScreenAdaptation',
    'enableSwipeBack',
    // ★ 学习模块设置（绑定人设/API预设，存量小放 globalSettings）
    'studySettings'
];

// 2. 初始化内存数据库对象 (db) -> 唯一来源
window.db = {
    characters:[],
    groups:[],
    worldBooks: [],
    myStickers: [],

    // --- 独立模块 ---
    userPersonas:[], // 用户档案
    myPersonaPresets: [], // (旧字段兼容，从globals合并)
    forumPosts:[],   // 论坛帖子
    rpgProfiles:[],  // RPG存档

    // ★★★ 新增：Peek 数据字典 (Key: charId, Value: { memos:[], browser:[], ... }) ★★★
    peekData: {}, 

    // --- 论坛元数据 ---
    forumUserIdentity: { nickname: '新用户', avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', persona: '', realName: '', anonCode: '0311', customDetailCss: '' },
    forumBindings: { worldBookIds:[], charIds: [], userPersonaIds:[], useChatHistory: false, historyLimit: 50 },
    watchingPostIds: [],
    favoritePostIds:[],
    currentViewingPostId: null, // 当前查看的帖子ID (从globals合并)

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
    homeWidgetSettings: typeof defaultWidgetSettings !== 'undefined' ? defaultWidgetSettings : {},

    // ★ 学习模块独立数组（存大量数据，放独立 Dexie 表）
    studyBooks: [],
    studyQuestions: [],
    studyRecords: [],
    studyBanks: [],
    studyExams: [],
    studyExamRecords: [], 
    // ★ 学习模块配置（存量小，放 globalSettings）
    studySettings: { boundPersonaId: null, textApiPresetId: null, embeddingApiPresetId: null },
};

// 3. Dexie 数据库配置
window.dexieDB = new Dexie('QChatDB_ee');
const dexieDB = window.dexieDB; // ← 加这行，让模块内 const 引用和 window 都指向同一个实例

// 如果其他标签页占用数据库，导致升级卡死，给予提示
dexieDB.on('blocked', () => {
    alert("系统需要升级数据库。请关闭当前浏览器的其他应用标签页，然后再刷新此页面！");
});

// ★★★ Version 7 (用户基线版本：向量切块独立表) ★★★
dexieDB.version(7).stores({
    characters: '&id', groups: '&id', worldBooks: '&id', myStickers: '&id', globalSettings: 'key',
    userPersonas: '&id', forumPosts: '&id', rpgProfiles: '&id', forumMetadata: 'key', peekData: '&charId',
    messages: '&id, chatId, timestamp',
    studyBooks: '&id, category', studyQuestions: '&id, bookId', studyRecords: '&id, bookId, questionId',
    memories: '&id, chatId, memType',
    memoryChunks: '&id, chatId'
});

// ★★★ Version 8 (学习模块拆分：正文/共读消息/分页缓存独立表) ★★★
// studyBookContents  — 书籍正文（导入时写一次，体积大）
// studyCoreadMessages— 共读聊天记录（按 bookId 查，删书级联删）
// studyPageCache     — 分页缓存（按 bookId 查，可随时重算）
dexieDB.version(8).stores({
    characters: '&id', groups: '&id', worldBooks: '&id', myStickers: '&id', globalSettings: 'key',
    userPersonas: '&id', forumPosts: '&id', rpgProfiles: '&id', forumMetadata: 'key', peekData: '&charId',
    messages: '&id, chatId, timestamp',
    studyBooks: '&id, category', studyQuestions: '&id, bookId', studyRecords: '&id, bookId, questionId',
    memories: '&id, chatId, memType',
    memoryChunks: '&id, chatId',
    // ★ V8 新增三张表
    studyBookContents:    '&bookId',
    studyCoreadMessages:  '&id, bookId',
    studyPageCache:       '&bookId',
}).upgrade(async tx => {
    console.log("Upgrading database to version 8 (Study book content/coread/pageCache split)...");
});

dexieDB.version(9).stores({
    // 新增 studyBanks 表
    studyBanks: '&id',
    // studyQuestions 索引改为同时支持 bankId（旧数据 bookId 兼容保留）
    studyQuestions: '&id, bookId, bankId',
    // 其余表不变，照抄 v8
    studyBooks: '&id, category',
    studyRecords: '&id, bookId, questionId',
    studyBookContents:   '&bookId',
    studyCoreadMessages: '&id, bookId',
    studyPageCache:      '&bookId',
}).upgrade(async tx => {
    console.log("Upgrading database to version 9 (studyBanks table + bankId index added)...");
});

// ★★★ Version 10（测试考卷独立表）★★★
dexieDB.version(10).stores({
    studyExams: '&id',
    // 其余照抄 v9，保持不变
    studyBanks: '&id',
    studyQuestions: '&id, bookId, bankId',
    studyBooks: '&id, category',
    studyRecords: '&id, bookId, questionId',
    studyBookContents:   '&bookId',
    studyCoreadMessages: '&id, bookId',
    studyPageCache:      '&bookId',
}).upgrade(async tx => {
    console.log("Upgrading database to version 10 (studyExams table added)...");
});

dexieDB.version(11).stores({
    studyExamRecords: '&id, examId',   // ★ 新增：考试记录（examId 索引供按卷查询）
    // 以下照抄 v10，保持不变
    studyExams:          '&id',
    studyBanks:          '&id',
    studyQuestions:      '&id, bookId, bankId',
    studyBooks:          '&id, category',
    studyRecords:        '&id, bookId, questionId',
    studyBookContents:   '&bookId',
    studyCoreadMessages: '&id, bookId',
    studyPageCache:      '&bookId',
    memories:            '&id, chatId, memType',
    memoryChunks:        '&id, chatId',
    messages:            '&id, chatId, timestamp',
    characters: '&id', groups: '&id', worldBooks: '&id', myStickers: '&id',
    globalSettings: 'key',
    userPersonas: '&id', forumPosts: '&id', rpgProfiles: '&id',
    forumMetadata: 'key', peekData: '&charId',
}).upgrade(async tx => {
    console.log("Upgrading database to version 11 (studyExamRecords table added)...");
});

dexieDB.version(12).stores({
    studyBookSummaries: '&id, bookId, memType', // ★ 新增：书本章节总结
    // 以下照抄 v11，保持不变
    studyExamRecords:    '&id, examId',
    studyExams:          '&id',
    studyBanks:          '&id',
    studyQuestions:      '&id, bookId, bankId',
    studyBooks:          '&id, category',
    studyRecords:        '&id, bookId, questionId',
    studyBookContents:   '&bookId',
    studyCoreadMessages: '&id, bookId',
    studyPageCache:      '&bookId',
    memories:            '&id, chatId, memType',
    memoryChunks:        '&id, chatId',
    messages:            '&id, chatId, timestamp',
    characters: '&id', groups: '&id', worldBooks: '&id', myStickers: '&id',
    globalSettings: 'key',
    userPersonas: '&id', forumPosts: '&id', rpgProfiles: '&id',
    forumMetadata: 'key', peekData: '&charId',
}).upgrade(async tx => {
    console.log("Upgrading database to version 12 (studyBookSummaries table added)...");
});

window.loadData = async () => {
    try {
        console.log("📦 正在加载数据...");

        // 并行读取所有表
        const[
            characters, groups, worldBooks, myStickers, settingsArray,
            newUserPersonas, newForumPosts, newRpgProfiles, newForumMeta,
            newPeekData,
            newMessages,
            newStudyBooks, newStudyQuestions, newStudyRecords, newStudyBanks, newStudyExams,newStudyExamRecords,
            newMemories,
            newChunks,
    newStudyBookSummaries,
        ] = await Promise.all([
            dexieDB.characters.toArray(), dexieDB.groups.toArray(), dexieDB.worldBooks.toArray(),
            dexieDB.myStickers.toArray(), dexieDB.globalSettings.toArray(), dexieDB.userPersonas.toArray(),
            dexieDB.forumPosts.toArray(), dexieDB.rpgProfiles.toArray(), dexieDB.forumMetadata.toArray(),
            dexieDB.peekData.toArray(), dexieDB.messages.toArray(),
            dexieDB.studyBooks.toArray(), dexieDB.studyQuestions.toArray(), dexieDB.studyRecords.toArray(), dexieDB.studyBanks.toArray(), dexieDB.studyExams.toArray(), dexieDB.studyExamRecords.toArray(), 
            dexieDB.memories.toArray(),
            dexieDB.memoryChunks.toArray(),
    dexieDB.studyBookSummaries.toArray(),
        ]);

        // ★ 消息已完全迁移到独立表（用户基线 v7 起）
        window.isMessageMigrated = true;

        // ★ V7 chunk 迁移安全锁
        const chunkMigFlagEarly = settingsArray.find(s => s.key === 'migrationV7Done');
        if (chunkMigFlagEarly && chunkMigFlagEarly.value === true) {
            window.isChunkMigrated = true;
        } else {
            // 还没迁移：只要有任意 char/group 的 memoryChunks 非空就说明数据还在 char 上
            window.isChunkMigrated = !characters.some(c => c.memoryChunks && c.memoryChunks.length > 0)
                                  && !groups.some(g => g.memoryChunks && g.memoryChunks.length > 0);
        }

        const messagesByChatId = {};
        newMessages.forEach(m => {
            if (!messagesByChatId[m.chatId]) messagesByChatId[m.chatId] = [];
            messagesByChatId[m.chatId].push(m);
        });

        // =========================================================
        // 将消息挂载回内存对象，对老代码的逻辑保持完全隐形
        // =========================================================
        Object.values(messagesByChatId).forEach(arr => {
            arr.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        });

        characters.forEach(c => { c.history = messagesByChatId[c.id] ||[]; });
        groups.forEach(g => { g.history = messagesByChatId[g.id] ||[]; });

        // =========================================================
        // ★ V7 向量迁移：memoryChunks → memoryChunks 独立表
        // =========================================================
        const chunkMigrationFlag = settingsArray.find(s => s.key === 'migrationV7Done');
        if (!chunkMigrationFlag) {
            const migrationChunks = [];
            const processChunkMigration = (objs) => {
                objs.forEach(obj => {
                    (obj.memoryChunks || []).forEach(chunk => {
                        migrationChunks.push({ ...chunk, chatId: obj.id });
                    });
                    delete obj.memoryChunks;
                });
            };
            processChunkMigration(characters);
            processChunkMigration(groups);

            if (migrationChunks.length > 0) {
                console.log(`📦 V7向量迁移：共 ${migrationChunks.length} 块，写入 memoryChunks 表...`);
                const chunkSize = 500;
                for (let i = 0; i < migrationChunks.length; i += chunkSize) {
                    await dexieDB.memoryChunks.bulkPut(migrationChunks.slice(i, i + chunkSize));
                }
                newChunks.push(...migrationChunks);
                await dexieDB.characters.bulkPut(characters);
                await dexieDB.groups.bulkPut(groups);
                console.log("✅ V7向量迁移完成");
            }
            try { await dexieDB.globalSettings.put({ key: 'migrationV7Done', value: true }); } catch(e) { console.warn('⚠️ V7迁移标记写入失败:', e); }
            window.isChunkMigrated = true;
        }

        // ★ 将 memories 表数据挂载回 char/group 对象（供现有代码透明访问）
        const memoriesByChatId = {};
        newMemories.forEach(m => {
            if (!memoriesByChatId[m.chatId]) memoriesByChatId[m.chatId] = { short: [], journal: [], long: [] };
            if (memoriesByChatId[m.chatId][m.memType]) memoriesByChatId[m.chatId][m.memType].push(m);
        });
        characters.forEach(c => {
            const mems = memoriesByChatId[c.id];
            c.memorySummaries  = mems ? (mems.short   || []) : [];
            c.memoryJournals   = mems ? (mems.journal || []) : [];
            c.longTermSummaries = mems ? (mems.long   || []) : [];
        });
        groups.forEach(g => {
            const mems = memoriesByChatId[g.id];
            g.memorySummaries   = mems ? (mems.short || []) : [];
            g.longTermSummaries = mems ? (mems.long  || []) : [];
        });

        // ★ 将 memoryChunks 表数据挂载回 char/group 对象
        const chunksByChatId = {};
        newChunks.forEach(c => {
            if (!chunksByChatId[c.chatId]) chunksByChatId[c.chatId] = [];
            chunksByChatId[c.chatId].push(c);
        });
        characters.forEach(c => { c.memoryChunks = chunksByChatId[c.id] || []; });
        groups.forEach(g     => { g.memoryChunks = chunksByChatId[g.id] || []; });

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

        // ★ 学习模块数据赋值（studyBooks 已不含 content / coreadMessages）
        db.studyBooks     = newStudyBooks     || [];
        db.studyQuestions = newStudyQuestions || [];
        db.studyRecords   = newStudyRecords   || [];
        db.studyBanks = newStudyBanks || [];
        db.studyExams = newStudyExams || [];
        db.studyExamRecords  = newStudyExamRecords  || [];
        const bookSumsByBookId = {};
(newStudyBookSummaries || []).forEach(s => {
    if (!bookSumsByBookId[s.bookId]) bookSumsByBookId[s.bookId] = { short: [], long: [] };
    const bucket = bookSumsByBookId[s.bookId][s.memType];
    if (bucket) bucket.push(s);
});
db.studyBooks.forEach(b => {
    const sums = bookSumsByBookId[b.id];
    b.memorySummaries   = sums ? (sums.short || []) : [];
    b.longTermSummaries = sums ? (sums.long  || []) : [];
});

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

        console.log("✅ 数据加载完成 (V11), 时间戳:", window.dbLoadTimestamp);

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
                    delete o.history;
                    // ★ V6：记忆字段已独立存储，不写回 characters 表
                    delete o.memorySummaries;
                    delete o.memoryJournals;
                    delete o.longTermSummaries;
                    if(window.isChunkMigrated) delete o.memoryChunks; // ★ V7：迁移完成后才剥离
                    return o; 
                });
                await dexieDB.characters.bulkPut(safeChars);
            }
            if(db.groups) {
                const safeGroups = db.groups.map(g => { 
                    const o = {...g}; 
                    delete o.history;
                    delete o.memorySummaries;
                    delete o.longTermSummaries;
                    if(window.isChunkMigrated) delete o.memoryChunks; // ★ V7：迁移完成后才剥离
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

    // 9. 学习模块（独立表）
    // ★ V8：studyBooks 已不含 content / coreadMessages，正常 bulkPut 即可
    // ★ studyBookContents / studyCoreadMessages / studyPageCache 均由精准函数单独写，不在此处全量写
    try {
        if (db.studyBooks     && db.studyBooks.length     > 0) await dexieDB.studyBooks.bulkPut(db.studyBooks);
        if (db.studyQuestions && db.studyQuestions.length > 0) await dexieDB.studyQuestions.bulkPut(db.studyQuestions);
        if (db.studyRecords   && db.studyRecords.length   > 0) await dexieDB.studyRecords.bulkPut(db.studyRecords);
        if (db.studyBanks && db.studyBanks.length > 0) await dexieDB.studyBanks.bulkPut(db.studyBanks);
    } catch (e) { console.error("❌ 学习模块保存失败:", e); }

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
                delete safeChat.history;
                // ★ V6：记忆字段独立存储，不写入 characters 表
                delete safeChat.memorySummaries;
                delete safeChat.memoryJournals;
                delete safeChat.longTermSummaries;
                if(window.isChunkMigrated) delete safeChat.memoryChunks; // ★ V7：迁移完成后才剥离
                await dexieDB.characters.put(safeChat); // 只覆写当前这一个角色
            }
        } else if (chatType === 'group') {
            const group = db.groups.find(g => g.id === chatId);
            if (group) {
                const safeGroup = {...group}; 
                delete safeGroup.history;
                // ★ V6：同上
                delete safeGroup.memorySummaries;
                delete safeGroup.longTermSummaries;
                if(window.isChunkMigrated) delete safeGroup.memoryChunks; // ★ V7：迁移完成后才剥离
                await dexieDB.groups.put(safeGroup); // 只覆写当前这一个群聊
            }
        }
    } catch (e) { console.error("❌ 聊天信息保存失败:", e); }
};   

// ★ 如果未完成迁移，跳过对消息独立表的操作，完全依靠上面的 saveSingleChat 执行大一统保存机制
window.saveMessageToDB = async (msg, chatId, chatType) => {
    try { 
        await dexieDB.messages.put({ ...msg, chatId, chatType }); 
    } catch (e) { 
        console.error("❌ 消息保存失败:", e); 
        if (typeof AppUI !== 'undefined') {
            AppUI.alert("数据库写入失败，请检查设备存储空间是否充足！\n错误详情：" + e.message, "存储失败");
        }
    }
};
window.saveMessagesToDB = async (msgs, chatId, chatType) => {
    try { 
        await dexieDB.messages.bulkPut(msgs.map(m => ({ ...m, chatId, chatType }))); 
    } catch (e) { 
        console.error("❌ 批量消息保存失败:", e);
        if (typeof AppUI !== 'undefined') {
            AppUI.alert("数据库批量写入失败！这通常是因为设备空间不足或频繁操作导致的。\n错误详情：" + e.message, "存储失败");
        }
    }
};
// msgIds 必须是数组，如 ['id1', 'id2']，单条也要包裹成 [id]
window.deleteMessagesFromDB = async (msgIds) => {
    try { await dexieDB.messages.bulkDelete(msgIds); } catch (e) { console.error("❌ 消息删除失败:", e); }
};
window.clearChatHistoryInDB = async (chatId) => {
    try {
        const keys = await dexieDB.messages.where({chatId}).primaryKeys();
        await dexieDB.messages.bulkDelete(keys);
    } catch (e) { console.error("❌ 清空消息失败:", e); }
};

// --- ★ V6：记忆/日记/长期总结的精准保存与删除 ---
// memType: 'short'(短期总结) | 'journal'(日记) | 'long'(长期总结)
window.saveMemoryItem = async (item, chatId, memType) => {
    try {
        await dexieDB.memories.put({ ...item, chatId, memType });
    } catch (e) { console.error("❌ 记忆条目保存失败:", e); }
};

window.deleteMemoryItem = async (itemId) => {
    try {
        await dexieDB.memories.delete(itemId);
    } catch (e) { console.error("❌ 记忆条目删除失败:", e); }
};

// 清空某个角色/群组的全部记忆（角色删除时调用）
window.clearChatMemoriesInDB = async (chatId) => {
    try {
        const keys = await dexieDB.memories.where({ chatId }).primaryKeys();
        if (keys.length) await dexieDB.memories.bulkDelete(keys);
    } catch (e) { console.error("❌ 清空记忆失败:", e); }
};

// --- ★ V6：向量切块的精准保存与删除 ---
// replaceChunksToDB：切块完成后全量替换（先清再存）
window.replaceChunksToDB = async (chunks, chatId) => {
    try {
        await dexieDB.memoryChunks.where({ chatId }).delete();
        if (chunks && chunks.length > 0) {
            await dexieDB.memoryChunks.bulkPut(chunks.map(c => ({ ...c, chatId })));
        }
    } catch (e) { console.error("❌ 向量切块替换失败:", e); }
};

// saveChunksToDB：局部更新（embedding后、清理后、accessCount更新后）
window.saveChunksToDB = async (chunks) => {
    try {
        if (!chunks || chunks.length === 0) return;
        await dexieDB.memoryChunks.bulkPut(chunks);
    } catch (e) { console.error("❌ 向量切块保存失败:", e); }
};

// 清空某角色的全部切块（角色删除时调用）
window.clearChatChunksInDB = async (chatId) => {
    try {
        await dexieDB.memoryChunks.where({ chatId }).delete();
    } catch (e) { console.error("❌ 清空向量切块失败:", e); }
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

// ============================================================
// ★ 学习模块 — 精准保存函数 (供 study_db.js 调用)
// ★ V8：content / coreadMessages / pageCache 已独立，各走各的函数
// ============================================================

// 单条书籍元数据 put（不含 content / coreadMessages）
window.saveStudyBookToDB = async (book) => {
    try {
        // 防御：确保不把正文或共读消息塞进元数据表
        const meta = { ...book };
        delete meta.content;
        delete meta.coreadMessages;
        await dexieDB.studyBooks.put(meta);
    } catch (e) { console.error("❌ [Study] 书籍元数据保存失败:", e); }
};

// 保存书籍正文（导入时调用一次）
window.saveStudyBookContentToDB = async (bookId, content) => {
    try {
        await dexieDB.studyBookContents.put({ bookId, content });
    } catch (e) { console.error("❌ [Study] 书籍正文保存失败:", e); }
};

// 读取书籍正文（打开阅读器时按需读）
window.getStudyBookContentFromDB = async (bookId) => {
    try {
        const row = await dexieDB.studyBookContents.get(bookId);
        return row ? row.content : '';
    } catch (e) { console.error("❌ [Study] 书籍正文读取失败:", e); return ''; }
};

// 删除书籍及其所有关联数据（元数据/正文/题目/记录/共读消息/分页缓存）
window.deleteStudyBookFromDB = async (bookId) => {
    try {
        await dexieDB.studyBooks.delete(bookId);
        await dexieDB.studyBookContents.delete(bookId);
        await dexieDB.studyPageCache.delete(bookId);

        const qKeys = await dexieDB.studyQuestions.where('bookId').equals(bookId).primaryKeys();
        if (qKeys.length) await dexieDB.studyQuestions.bulkDelete(qKeys);

        const rKeys = await dexieDB.studyRecords.where('bookId').equals(bookId).primaryKeys();
        if (rKeys.length) await dexieDB.studyRecords.bulkDelete(rKeys);

        const cmKeys = await dexieDB.studyCoreadMessages.where('bookId').equals(bookId).primaryKeys();
        if (cmKeys.length) await dexieDB.studyCoreadMessages.bulkDelete(cmKeys);
        
        const bsKeys = await dexieDB.studyBookSummaries.where('bookId').equals(bookId).primaryKeys();
if (bsKeys.length) await dexieDB.studyBookSummaries.bulkDelete(bsKeys);


        console.log(`✅ [Study] 书籍 ${bookId} 及全部关联数据已删除`);
    } catch (e) { console.error("❌ [Study] 书籍删除失败:", e); }
};

// ── 共读消息 ──────────────────────────────────────────────

// 读取某本书的共读消息（升序）
window.getCoreadMessagesFromDB = async (bookId) => {
    try {
        const rows = await dexieDB.studyCoreadMessages.where('bookId').equals(bookId).sortBy('timestamp');
        return rows.map(r => ({
    role:      r.role,
    content:   r.content,
    timestamp: r.timestamp,
    userName:  r.userName  || null,   // ← 新增
    charName:  r.charName  || null,   // ← 新增
}));
    } catch (e) { console.error("❌ [Study] 共读消息读取失败:", e); return []; }
};

// 追加单条共读消息
window.appendCoreadMessageToDB = async (bookId, msg) => {
    try {
        await dexieDB.studyCoreadMessages.put({
    id: `crm_${bookId}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    bookId,
    role:      msg.role,
    content:   msg.content,
    timestamp: msg.timestamp || Date.now(),
    userName:  msg.userName  || null,   // ← 新增
    charName:  msg.charName  || null,   // ← 新增
});
    } catch (e) { console.error("❌ [Study] 共读消息追加失败:", e); }
};

// 更新最后一条共读消息（流式结束后更新 content）
window.updateLastCoreadMessageInDB = async (bookId, content) => {
    try {
        const rows = await dexieDB.studyCoreadMessages
            .where('bookId').equals(bookId)
            .reverse().limit(1).toArray();
        if (rows.length) {
            rows[0].content = content;
            await dexieDB.studyCoreadMessages.put(rows[0]);
        }
    } catch (e) { console.error("❌ [Study] 共读消息更新失败:", e); }
};

// 清空某本书的全部共读消息
window.clearCoreadMessagesInDB = async (bookId) => {
    try {
        const keys = await dexieDB.studyCoreadMessages.where('bookId').equals(bookId).primaryKeys();
        if (keys.length) await dexieDB.studyCoreadMessages.bulkDelete(keys);
    } catch (e) { console.error("❌ [Study] 共读消息清空失败:", e); }
};

// ── 分页缓存 ──────────────────────────────────────────────

// 读取分页缓存（返回 pages 数组，或 null 表示无缓存）
window.getStudyPageCacheFromDB = async (bookId, contentHash) => {
    try {
        const row = await dexieDB.studyPageCache.get(bookId);
        if (!row) return null;
        // 内容 hash 不一致说明书已更新，缓存失效
        if (contentHash && row.contentHash !== contentHash) return null;
        return row.pages || null;
    } catch (e) { console.error("❌ [Study] 分页缓存读取失败:", e); return null; }
};

// 保存分页缓存
window.saveStudyPageCacheToDB = async (bookId, pages, contentHash) => {
    try {
        await dexieDB.studyPageCache.put({ bookId, pages, contentHash, savedAt: Date.now() });
    } catch (e) { console.error("❌ [Study] 分页缓存保存失败:", e); }
};

// ── 其余学习模块函数（题目/记录/设置，不变）─────────────────

// 单条题目 put
window.saveStudyQuestionToDB = async (question) => {
    try { await dexieDB.studyQuestions.put(question); }
    catch (e) { console.error("❌ [Study] 题目保存失败:", e); }
};

// 批量题目 put（生成题库时使用）
window.bulkSaveStudyQuestionsToDB = async (questions) => {
    try { if (questions.length) await dexieDB.studyQuestions.bulkPut(questions); }
    catch (e) { console.error("❌ [Study] 批量题目保存失败:", e); }
};

// 删除单条题目
window.deleteStudyQuestionFromDB = async (qId) => {
    try { await dexieDB.studyQuestions.delete(qId); }
    catch (e) { console.error("❌ [Study] 题目删除失败:", e); }
};

// 单条答题记录 put
window.saveStudyRecordToDB = async (record) => {
    try { await dexieDB.studyRecords.put(record); }
    catch (e) { console.error("❌ [Study] 答题记录保存失败:", e); }
};

// 学习设置（绑定人设/API预设）精准保存
window.saveStudySettingsToDB = async () => {
    try {
        await dexieDB.globalSettings.put({ key: 'studySettings', value: db.studySettings });
        console.log("✅ [Study] 学习设置已保存");
    } catch (e) { console.error("❌ [Study] 学习设置保存失败:", e); }
};

window.saveStudyBankToDB = async (bank) => {
    try { await dexieDB.studyBanks.put(bank); }
    catch (e) { console.error('❌ [Study] 题库保存失败:', e); }
};

window.deleteStudyBankFromDB = async (bankId) => {
    try {
        await dexieDB.studyBanks.delete(bankId);
        // 级联删题目
        const qKeys = await dexieDB.studyQuestions.where('bankId').equals(bankId).primaryKeys();
        if (qKeys.length) await dexieDB.studyQuestions.bulkDelete(qKeys);
    } catch (e) { console.error('❌ [Study] 题库删除失败:', e); }
};

window.updateStudyQuestionToDB = async (question) => {
    try { await dexieDB.studyQuestions.put(question); }
    catch (e) { console.error('❌ [Study] 题目更新失败:', e); }
};

// 删除某本书最后 1 条共读消息（重新生成时用）
window.deleteLastCoreadMessageFromDB = async (bookId) => {
    try {
        const rows = await dexieDB.studyCoreadMessages
            .where('bookId').equals(bookId).reverse().limit(1).toArray();
        if (rows.length) await dexieDB.studyCoreadMessages.delete(rows[0].id);
    } catch (e) { console.error("❌ [Study] 共读消息删除(last 1)失败:", e); }
};

// 删除某本书最后 N 条共读消息（发送失败回滚时用）
window.deleteLastNCoreadMessagesFromDB = async (bookId, n) => {
    try {
        const rows = await dexieDB.studyCoreadMessages
            .where('bookId').equals(bookId).reverse().limit(n).toArray();
        if (rows.length) await dexieDB.studyCoreadMessages.bulkDelete(rows.map(r => r.id));
    } catch (e) { console.error("❌ [Study] 共读消息批量删除(last n)失败:", e); }
};

// ── 书本章节总结：精准保存 ──
window.saveBookSummaryItem = async (item, bookId, memType) => {
    try {
        await dexieDB.studyBookSummaries.put({ ...item, bookId, memType });
    } catch (e) { console.error('❌ [Study] 书本总结保存失败:', e); }
};

// ── 书本章节总结：删除单条 ──
window.deleteBookSummaryItem = async (itemId) => {
    try {
        await dexieDB.studyBookSummaries.delete(itemId);
    } catch (e) { console.error('❌ [Study] 书本总结删除失败:', e); }
};

// ── 书本章节总结：清空某本书的所有总结 ──
window.clearBookSummariesInDB = async (bookId) => {
    try {
        const keys = await dexieDB.studyBookSummaries.where('bookId').equals(bookId).primaryKeys();
        if (keys.length) await dexieDB.studyBookSummaries.bulkDelete(keys);
    } catch (e) { console.error('❌ [Study] 书本总结清空失败:', e); }
};