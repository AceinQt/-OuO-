// --- START OF FILE js/settings/backup_data.js ---

// 全局变量防止重复点击
window.isBackupLoading = false;

// --- 1. 核心工具:压缩与解压 ---

/**
 * 将数据对象压缩为 Gzip 格式的 Base64 字符串 (用于上传)
 */
async function compressDataToEeBase64(dataObj) {
    const jsonString = JSON.stringify(dataObj);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
    const compressedResponse = new Response(stream);
    const compressedBlob = await compressedResponse.blob();

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64data = reader.result.split(',')[1];
            resolve(base64data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(compressedBlob);
    });
}

/**
 * ★ V5：把 JSONL 生成器流式压缩为 Gzip Base64（用于云端上传）。
 * 与 compressDataToEeBase64 的区别：不需要先把整个数据 JSON.stringify 成巨串，
 * 任意时刻内存只持有生成器 yield 的当前一行 + 压缩器缓冲。
 * 注：最终的 base64 字符串本身仍需驻留内存（GitHub Contents API 的要求），
 * 26MB 备份 → ~35MB base64，这在可接受范围；巨串风险在"解压后的 JSON"，不在这里。
 */
async function compressStreamToEeBase64(jsonChunkGenerator) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    const writePromise = (async () => {
        try {
            for await (const chunk of jsonChunkGenerator) {
                await writer.write(encoder.encode(chunk));
            }
        } catch (e) {
            await writer.abort(e);
            throw e;
        } finally {
            await writer.close().catch(() => {});
        }
    })();

    const gzipStream = readable.pipeThrough(new CompressionStream('gzip'));
    const [compressedBlob] = await Promise.all([
        new Response(gzipStream).blob(),
        writePromise,
    ]);

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(compressedBlob);
    });
}

/**
 * 从 GitHub 下载并解压 .ee 文件 (用于恢复)
 */
async function fetchAndDecompressGitHubFile(config, fileName) {
    const fileInfo = await GitHubService.getFileInfo(config, fileName);
    if (!fileInfo || !fileInfo.download_url) {
        throw new Error(`找不到文件: ${fileName}`);
    }
    const response = await fetch(fileInfo.download_url);
    if (!response.ok) throw new Error(`下载失败 ${fileName}: ${response.status}`);
    
    const blob = await response.blob();
    const ds = new DecompressionStream('gzip');
    const stream = blob.stream().pipeThrough(ds);
    const jsonResponse = new Response(stream);

    return await jsonResponse.json();
}

/**
 * 从 GitHub 下载并解压 .ee 文件，返回解压后的字符串（不 parse）。
 * 工单 C：供惰性切分导入路径使用，避免 jsonResponse.json() 一次性 parse 大文件导致 OOM。
 */
async function fetchAndDecompressGitHubFileAsString(config, fileName) {
    const fileInfo = await GitHubService.getFileInfo(config, fileName);
    if (!fileInfo || !fileInfo.download_url) {
        throw new Error(`找不到文件: ${fileName}`);
    }
    const response = await fetch(fileInfo.download_url);
    if (!response.ok) throw new Error(`下载失败 ${fileName}: ${response.status}`);

    const blob = await response.blob();
    const ds = new DecompressionStream('gzip');
    const stream = blob.stream().pipeThrough(ds);
    return await new Response(stream).text();
}

// --- 2. 初始化按钮事件 ---
window.setupBackupButtons = function() {
    const backupBtn = document.getElementById('btn-backup-full');
    const importInput = document.getElementById('import-data-input');

    if (backupBtn) backupBtn.onclick = handleFullBackup; 
    
    if (importInput) {
        const newImportInput = importInput.cloneNode(true);
        importInput.parentNode.replaceChild(newImportInput, importInput);
        newImportInput.addEventListener('change', handleImport);
    }
};

// --- 3. 本地备份/导出逻辑 ---
async function handleFullBackup(e) {
    if (e) e.preventDefault();
    if (window.isBackupLoading) return;

    window.isBackupLoading = true;
    const btn = document.getElementById('btn-backup-full');
    const originalText = btn ? btn.innerHTML : '备份全部数据';
    if (btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 打包中...'; btn.style.opacity = '0.7'; }

    try {
        showToast('正在准备导出全部数据...');
        await new Promise(r => setTimeout(r, 50));
        // ★ 改为流式导出，不再一次性创建大对象
        await downloadDataStream(createFullBackupStream(), '全量备份');
        showToast('备份导出成功');
    } catch (err) {
        console.error(err);
        showToast(`导出失败: ${err.message}`);
    } finally {
        window.isBackupLoading = false;
        if (btn) { btn.innerHTML = originalText; btn.style.opacity = '1'; }
    }
}

// ★★★ 修复:单项导出逻辑 (补充缺失字段) ★★★
window.exportPartialData = async function(categoryKey) {
    if (window.isBackupLoading) return;
    window.isBackupLoading = true;

    try {
        showToast(`正在导出: ${categoryKey}...`);
        const partialData = {
            _exportVersion: '4.0',
            _exportTimestamp: Date.now(),
            _partialType: categoryKey 
        };

        if (!window.db) throw new Error("数据库未就绪");

        switch (categoryKey) {
            case 'worldBooks': partialData.worldBooks = db.worldBooks || []; break;
            case 'rpg': partialData.rpgProfiles = db.rpgProfiles || []; break;
            case 'forum':
                partialData.forumPosts = db.forumPosts || [];
                partialData.forumBindings = db.forumBindings || {};
                partialData.forumUserIdentity = db.forumUserIdentity || {}; 
                partialData.watchingPostIds = db.watchingPostIds || [];
                partialData.favoritePostIds = db.favoritePostIds || [];
                break;
            case 'personalization':
                partialData.myStickers = db.myStickers || [];
                partialData.userPersonas = db.userPersonas || [];
                partialData.wallpaper = db.wallpaper;
                partialData.customIcons = db.customIcons;
                partialData.bubbleCssPresets = db.bubbleCssPresets;
                partialData.globalCss = db.globalCss;
                partialData.globalCssPresets = db.globalCssPresets;
                partialData.homeSignature = db.homeSignature;
                partialData.insWidgetSettings = db.insWidgetSettings;
                partialData.homeWidgetSettings = db.homeWidgetSettings;
                break;
            case 'settings':
                partialData.apiSettings = db.apiSettings;
                partialData.apiPresets = db.apiPresets;
                partialData.pomodoroSettings = db.pomodoroSettings;
                partialData.pomodoroTasks = db.pomodoroTasks;
                partialData.homeScreenMode = db.homeScreenMode;
                partialData.fontUrl = db.fontUrl;
                partialData.homeStatusBarColor = db.homeStatusBarColor;
                partialData.homeNavigationBarColor = db.homeNavigationBarColor;
    partialData.enableTopSafeArea = db.enableTopSafeArea;
    partialData.enableBottomSafeArea = db.enableBottomSafeArea;
    partialData.enableScreenAdaptation = db.enableScreenAdaptation;
    partialData.enableSwipeBack = db.enableSwipeBack;
                break;
            case 'characters':
                partialData.characters = db.characters || [];
                partialData.groups = db.groups || [];
                partialData.peekData = db.peekData || {};
                break;
            default: throw new Error("未知分类");
        }

        await downloadData(partialData, categoryKey);
        showToast(`${categoryKey} 导出完成`);

    } catch (err) {
        console.error(err);
        showToast(`导出错误: ${err.message}`);
    } finally {
        window.isBackupLoading = false;
    }
};

// --- 4. 导入逻辑 (文件选择) ---
async function handleImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (await AppUI.confirm('此操作将覆盖当前数据。确定要导入吗?', "系统提示", "确认", "取消")) {
        // ★ 改用持续的 showLoadingToast，覆盖整个导入过程（解析+入库+保存），避免短暂提示后无反馈
        const hideLoading = (typeof showLoadingToast === 'function') ? showLoadingToast('正在解析文件...') : null;
        try {
            // ★ V5：先只解压文件头部探测格式（几百字节，不占内存，也不动数据库）
            const head = await sniffBackupHead(file);
            let importResult;

            if (head.trimStart().startsWith('{"_type":"meta"')) {
                // ── 路径 1：V5 JSONL 流式导入（边解压边逐行入库，内存峰值几百 KB）──
                importResult = await importJsonlStream(file.stream());
                console.log('[Import] 使用路径: v5-jsonl');
            } else {
                // ── 路径 2：V4 旧版单体 JSON ──
                // 仍需把整个字符串解压进内存（这是 V4 格式的固有限制），
                // 但走惰性切分避免整棵对象树。大文件在手机上仍可能崩 —— 给出明确提示。
                const decompressedStream = file.stream().pipeThrough(new DecompressionStream('gzip'));
                const jsonString = await new Response(decompressedStream).text();

                try {
                    importResult = await lazyImportBackupData(jsonString);
                    console.log('[Import] 使用路径: v4-lazy');
                } catch (lazyErr) {
                    console.warn('⚠️ 惰性切分导入失败:', lazyErr.message);
                    // ── 路径 3：整体 JSON.parse 回退 ──
                    // ★ 只允许小文件走此路径。大文件 JSON.parse 会造出数倍于字符串的对象树，
                    //   手机端必 OOM 崩溃 —— 与其崩溃丢数据，不如明确告知解决办法。
                    const FALLBACK_LIMIT = 30 * 1024 * 1024; // 30MB（解压后）
                    if (jsonString.length > FALLBACK_LIMIT) {
                        throw new Error(
                            `惰性解析失败(${lazyErr.message})，且文件过大(解压后${(jsonString.length / 1024 / 1024).toFixed(0)}MB)，` +
                            `无法在手机端整体解析。请在电脑浏览器上导入此备份，再重新导出为新版(V5)格式后到手机导入。`
                        );
                    }
                    let data = JSON.parse(jsonString);
                    importResult = await importBackupData(data);
                    console.log('[Import] 使用路径: v4-fallback');
                }
            }

            // 导入完成，关闭持续提示
            if (hideLoading) hideLoading();

            if (importResult.success) {
                showToast(`导入成功!${importResult.message}`);
                setTimeout(() => window.location.reload(), 1500);
            } else {
                await AppUI.alert(`导入失败: ${importResult.error}`);
            }
        } catch (error) {
            console.error("Import error:", error);
            if (hideLoading) hideLoading(); // 异常时也要关闭
            await AppUI.alert(`文件解析错误: ${error.message}`);
        } finally {
            event.target.value = null;
        }
    } else {
        event.target.value = null;
    }
}

// --- 5. （已移除）createFullBackupData ---
// ★ V5：全量备份统一走 createFullBackupStream（JSONL 流式），
//   旧的"整棵 db 深拷贝 + 全量 history 挂载"路径是 OOM 源头，已删除。

// --- 6. 下载辅助函数（保留给小数据用） ---
async function downloadData(dataObj, filenameSuffix) {
    const jsonString = JSON.stringify(dataObj);
    const dataBlob = new Blob([jsonString]);
    const compressionStream = new CompressionStream('gzip');
    const compressedStream = dataBlob.stream().pipeThrough(compressionStream);
    const compressedBlob = await new Response(compressedStream, { headers: { 'Content-Type': 'application/octet-stream' } }).blob();

    const url = URL.createObjectURL(compressedBlob);
    const a = document.createElement('a');
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
    a.href = url;
    a.download = `QChat_${filenameSuffix}_${date}_${time}.ee`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

// ★ 新增：流式下载（用于全量备份，大数据专用）
async function downloadDataStream(jsonChunkGenerator, filenameSuffix) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // 后台把 generator 的 JSON 片段逐块写入管道
    const writePromise = (async () => {
        try {
            for await (const chunk of jsonChunkGenerator) {
                await writer.write(encoder.encode(chunk));
            }
        } catch (e) {
            await writer.abort(e);
            throw e;
        } finally {
            await writer.close().catch(() => {});
        }
    })();

    // 同时把管道接上 gzip，收集成 Blob
    const gzipStream = readable.pipeThrough(new CompressionStream('gzip'));
    const [compressedBlob] = await Promise.all([
    new Response(gzipStream, { headers: { 'Content-Type': 'application/octet-stream' } }).blob(),
    writePromise,
]);

    const url = URL.createObjectURL(compressedBlob);
    const a = document.createElement('a');
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '');
    a.href = url;
    a.download = `QChat_${filenameSuffix}_${date}_${time}.ee`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

// ★ V5：全量备份改为 JSONL 流格式（每行一个独立的小 JSON 对象）
// 关键设计：聊天记录不再挂在角色对象上整体序列化（旧版一个重度角色的 history
// 单行就能到 20~40MB，导入时 JSON.parse 这一行照样 OOM），而是每 500 条消息一行，
// 单行体积始终控制在几百 KB —— 导入端逐行 parse 入库，内存峰值极低。
// 第一行固定是 meta（_type 必须是第一个 key，导入端靠文件头探测格式）。
async function* createFullBackupStream() {
    // ── 1. meta 行：所有小数据（设置、世界书等）──
    const meta = {
        _type: 'meta',                       // ★ 必须是第一个 key（格式探测依据）
        _exportVersion: '5.0',
        _exportTimestamp: Date.now(),
        worldBooks:             db.worldBooks             || [],
        rpgProfiles:            db.rpgProfiles            || [],
        forumBindings:          db.forumBindings          || {},
        forumUserIdentity:      db.forumUserIdentity      || {},
        watchingPostIds:        db.watchingPostIds         || [],
        favoritePostIds:        db.favoritePostIds         || [],
        myStickers:             db.myStickers              || [],
        userPersonas:           db.userPersonas            || [],
        wallpaper:              db.wallpaper,
        customIcons:            db.customIcons,
        bubbleCssPresets:       db.bubbleCssPresets,
        globalCss:              db.globalCss,
        globalCssPresets:       db.globalCssPresets,
        homeSignature:          db.homeSignature,
        insWidgetSettings:      db.insWidgetSettings,
        homeWidgetSettings:     db.homeWidgetSettings,
        apiSettings:            db.apiSettings,
        apiPresets:             db.apiPresets,
        pomodoroSettings:       db.pomodoroSettings,
        pomodoroTasks:          db.pomodoroTasks           || [],
        homeScreenMode:         db.homeScreenMode,
        fontUrl:                db.fontUrl,
        homeStatusBarColor:     db.homeStatusBarColor,
        homeNavigationBarColor: db.homeNavigationBarColor,
        enableTopSafeArea:      db.enableTopSafeArea,
        enableBottomSafeArea:   db.enableBottomSafeArea,
        enableScreenAdaptation: db.enableScreenAdaptation,
        enableSwipeBack:        db.enableSwipeBack,
        studySettings:          db.studySettings,
        studyBanks:             db.studyBanks              || [],
        studyExams:             db.studyExams              || [],
        studyExamRecords:       db.studyExamRecords        || [],
        studyBooks:             db.studyBooks              || [],
        studyQuestions:         db.studyQuestions          || [],
        studyRecords:           db.studyRecords            || [],
    };
    yield JSON.stringify(meta) + '\n';

    // ── 2. 角色/群组元数据行：剥离 history/memoryChunks（它们独立成行）──
    const chatLists = [
        { list: db.characters || [], type: 'character', chatType: 'private' },
        { list: db.groups     || [], type: 'group',     chatType: 'group'   },
    ];
    for (const { list, type } of chatLists) {
        for (const c of list) {
            const lite = { ...c };
            delete lite.history;      // 消息独立成行（见下方第 3 步）
            delete lite.memoryChunks; // 向量块独立成行（见下方第 4 步）
            yield JSON.stringify({ _type: type, data: lite }) + '\n';
        }
    }

    // ── 3. 消息：逐会话从 messages 表读取（基线 v7 起消息一律存独立表，
    //    懒加载与否都以表为准），每 500 条一行。峰值内存 = 单个会话的消息数组 ──
    const MSG_LINE_SIZE = 500;
    for (const { list, chatType } of chatLists) {
        for (const c of list) {
            let msgs = await dexieDB.messages.where('chatId').equals(c.id).toArray();
            msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            for (let i = 0; i < msgs.length; i += MSG_LINE_SIZE) {
                yield JSON.stringify({ _type: 'messages', chatId: c.id, chatType, items: msgs.slice(i, i + MSG_LINE_SIZE) }) + '\n';
            }
            msgs = null; // 释放当前会话的消息数组
            await new Promise(r => setTimeout(r, 0)); // 让出主线程给 GC/UI
        }
    }

    // ── 4. 向量块：逐会话从 memoryChunks 表读取，每 100 条一行（含向量，单条较大）──
    const CHUNK_LINE_SIZE = 100;
    for (const { list } of chatLists) {
        for (const c of list) {
            let chunks = await dexieDB.memoryChunks.where('chatId').equals(c.id).toArray();
            for (let i = 0; i < chunks.length; i += CHUNK_LINE_SIZE) {
                yield JSON.stringify({ _type: 'memoryChunks', chatId: c.id, items: chunks.slice(i, i + CHUNK_LINE_SIZE) }) + '\n';
            }
            chunks = null;
        }
    }

    // ── 5. peekData：每个角色一行 ──
    for (const [charId, data] of Object.entries(db.peekData || {})) {
        yield JSON.stringify({ _type: 'peek', charId, data }) + '\n';
    }

    // ── 6. 论坛帖子：每 50 条一行（帖子含楼层可能较大）──
    const posts = db.forumPosts || [];
    for (let i = 0; i < posts.length; i += 50) {
        yield JSON.stringify({ _type: 'forumPosts', items: posts.slice(i, i + 50) }) + '\n';
    }

    // ── 7. 学习模块大表 ──
    try {
        // 书籍正文：单本正文可达数 MB，先取主键再逐本读取，避免全量正文同时驻留内存
        const bookKeys = await dexieDB.studyBookContents.toCollection().primaryKeys();
        for (const key of bookKeys) {
            const item = await dexieDB.studyBookContents.get(key);
            if (item) yield JSON.stringify({ _type: 'studyBookContents', items: [item] }) + '\n';
        }
        const coread = await dexieDB.studyCoreadMessages.toArray();
        for (let i = 0; i < coread.length; i += 500) {
            yield JSON.stringify({ _type: 'studyCoreadMessages', items: coread.slice(i, i + 500) }) + '\n';
        }
        const bookSums = await dexieDB.studyBookSummaries.toArray();
        for (let i = 0; i < bookSums.length; i += 500) {
            yield JSON.stringify({ _type: 'studyBookSummaries', items: bookSums.slice(i, i + 500) }) + '\n';
        }
    } catch (e) {
        console.error('❌ [Backup] 读取书籍正文/共读消息/书本总结失败:', e);
    }
}

// --- 7. 数据合并/恢复核心逻辑 ---

// =========================================================
// --- 6.9 V5 JSONL 流式导入 ---
// 边解压边按行解析边入库，内存峰值 = 一个 chunk + 一行 JSON（几百 KB），
// 手机端可导入任意大小的 V5 备份。
// =========================================================

/**
 * 只解压文件头部若干字节用于格式探测（不会把整个文件读进内存）。
 * V5 JSONL 的第一行固定以 {"_type":"meta" 开头。
 */
async function sniffBackupHead(file) {
    const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let head = '';
    try {
        while (head.length < 256) {
            const { done, value } = await reader.read();
            if (done) break;
            head += decoder.decode(value, { stream: true });
        }
    } finally {
        try { await reader.cancel(); } catch (e) { /* 已取消/已结束均可忽略 */ }
    }
    return head;
}

/**
 * V5 JSONL 流式导入主函数。
 * @param byteStream gzip 压缩的字节流（本地文件传 file.stream()，云端下载传 response.body）
 * 安全顺序：先解析第一行 meta 并校验版本，校验通过才清空数据库 ——
 * 避免"清完库才发现文件格式不对"导致现有数据丢失。
 */
async function importJsonlStream(byteStream, onProgress) {
    const startTime = Date.now();
    const stream = byteStream
        .pipeThrough(new DecompressionStream('gzip'))
        .pipeThrough(new TextDecoderStream());
    const reader = stream.getReader();

    let buffer = '';
    let metaProcessed = false;
    let lineCount = 0;

    // ── 入库批次缓冲 ──
    const BATCH_SIZE = 500;
    let msgBatch = [];
    let msgSeq = 0;
    const flushMsgBatch = async () => {
        if (!msgBatch.length) return;
        for (let i = 0; i < msgBatch.length; i += BATCH_SIZE) {
            await dexieDB.messages.bulkPut(msgBatch.slice(i, i + BATCH_SIZE));
        }
        msgBatch = [];
    };
    let memBatch = [];
    const flushMemBatch = async () => {
        if (!memBatch.length) return;
        await dexieDB.memories.bulkPut(memBatch);
        memBatch = [];
    };
    let hasMessages = false;

    // ── meta 行处理：校验 → 清库 → 小数据进内存 db ──
    const processMeta = async (meta) => {
        if (meta._type !== 'meta' || !meta._exportVersion) {
            throw new Error('备份文件第一行不是有效的 meta 记录');
        }
        // 校验通过，现在才清空所有表（与 lazyImportBackupData 的清表清单一致）
        await Promise.all([
            dexieDB.characters.clear(), dexieDB.groups.clear(), dexieDB.worldBooks.clear(),
            dexieDB.myStickers.clear(), dexieDB.userPersonas.clear(), dexieDB.globalSettings.clear(),
            dexieDB.forumPosts.clear(), dexieDB.peekData.clear(), dexieDB.rpgProfiles.clear(),
            dexieDB.forumMetadata.clear(),
            dexieDB.messages.clear(),
            dexieDB.memories.clear(),
            dexieDB.memoryChunks.clear(),
            dexieDB.studyBooks.clear(),
            dexieDB.studyBookContents.clear(),
            dexieDB.studyCoreadMessages.clear(),
            dexieDB.studyPageCache.clear(),
            dexieDB.studyQuestions.clear(),
            dexieDB.studyRecords.clear(),
            dexieDB.studyBanks.clear(),
            dexieDB.studyExams.clear(),
            dexieDB.studyExamRecords.clear(),
            dexieDB.studyBookSummaries.clear(),
        ]);
        // 小数据整体进内存 db
        Object.keys(meta).forEach(key => {
            if (!key.startsWith('_')) db[key] = meta[key];
        });
        // characters/groups/peekData 由后续行逐条填充
        db.characters = [];
        db.groups = [];
        db.peekData = {};
        db.forumPosts = [];
        metaProcessed = true;
    };

    // ── 逐行分发 ──
    const processLine = async (line) => {
        const item = JSON.parse(line);
        lineCount++;

        if (!metaProcessed) {
            // 第一行必须是 meta，否则立即中止（此时还没清库，现有数据无损）
            await processMeta(item);
            return;
        }

        switch (item._type) {
            case 'character':
            case 'group': {
                const obj = item.data;
                // 记忆字段抽取到 memories 独立表（与 lazyImportBackupData 一致）
                const pushMem = (arr, memType) => (arr || []).forEach(m => {
                    if (!m.id) m.id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    memBatch.push({ ...m, chatId: obj.id, memType });
                });
                pushMem(obj.memorySummaries, 'short');
                pushMem(obj.memoryJournals, 'journal');
                pushMem(obj.longTermSummaries, 'long');
                if (memBatch.length >= BATCH_SIZE) await flushMemBatch();
                if (item._type === 'character') db.characters.push(obj);
                else db.groups.push(obj);
                break;
            }
            case 'messages': {
                hasMessages = true;
                for (const m of (item.items || [])) {
                    if (!m.id) m.id = `msg_${Date.now()}_${msgSeq++}`;
                    m.chatId = item.chatId;
                    m.chatType = item.chatType;
                    msgBatch.push(m);
                }
                if (msgBatch.length >= BATCH_SIZE) {
                    await flushMsgBatch();
                    await new Promise(r => setTimeout(r, 0)); // 让出主线程
                }
                break;
            }
            case 'memoryChunks': {
                const chunks = (item.items || []).map(chunk => {
                    if (!chunk.id) chunk.id = `chunk_${item.chatId}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                    return { ...chunk, chatId: item.chatId };
                });
                if (chunks.length) await dexieDB.memoryChunks.bulkPut(chunks);
                break;
            }
            case 'peek': {
                if (item.charId) db.peekData[item.charId] = item.data;
                break;
            }
            case 'forumPosts': {
                const posts = item.items || [];
                db.forumPosts.push(...posts);
                if (posts.length) await dexieDB.forumPosts.bulkPut(posts);
                break;
            }
            case 'studyBookContents':
            case 'studyCoreadMessages':
            case 'studyBookSummaries': {
                const items = item.items || [];
                if (items.length) await dexieDB[item._type].bulkPut(items);
                break;
            }
            default:
                console.warn('[ImportV5] 未知行类型，已跳过:', item._type);
        }
    };

    // ── 主循环：读流 → 拆行 → 逐行处理 ──
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 最后一段可能不完整，留到下一轮
        for (const line of lines) {
            if (!line.trim()) continue;
            await processLine(line);
            if (onProgress && lineCount % 50 === 0) onProgress(lineCount);
        }
    }
    if (buffer.trim()) await processLine(buffer); // 收尾：最后一行没有换行符

    if (!metaProcessed) throw new Error('文件为空或缺少 meta 记录');

    // ── 收尾 flush + 标记 ──
    await flushMsgBatch();
    await flushMemBatch();
    if (hasMessages) window.isMessageMigrated = true;
    window.isChunkMigrated = true; // V5 备份中 chunk 已独立成行，char 对象上没有 memoryChunks

    // 论坛帖按时间倒序（与 loadData 一致）
    db.forumPosts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // studyBanks/studyExams/studyExamRecords 在 meta 里进了内存 db，需显式写表
    // （否则 loadData 会用 Dexie 空表覆盖内存，导致恢复后丢失）
    const batchBulkPut = async (table, items) => {
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            await table.bulkPut(items.slice(i, i + BATCH_SIZE));
        }
    };
    if (Array.isArray(db.studyBanks) && db.studyBanks.length)             await batchBulkPut(dexieDB.studyBanks,       db.studyBanks);
    if (Array.isArray(db.studyExams) && db.studyExams.length)             await batchBulkPut(dexieDB.studyExams,       db.studyExams);
    if (Array.isArray(db.studyExamRecords) && db.studyExamRecords.length) await batchBulkPut(dexieDB.studyExamRecords, db.studyExamRecords);

    // 兜底补全（与 lazyImportBackupData 一致）
    if (!db.pomodoroTasks) db.pomodoroTasks = [];
    if (!db.forumUserIdentity) db.forumUserIdentity = { nickname: '新用户', avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', persona: '', realName: '', anonCode: '0311', customDetailCss: '' };
    if (typeof defaultWidgetSettings !== 'undefined') {
        if (!db.homeWidgetSettings) {
            db.homeWidgetSettings = JSON.parse(JSON.stringify(defaultWidgetSettings));
        } else if (!db.homeWidgetSettings.centralCircleImage) {
            db.homeWidgetSettings.centralCircleImage = defaultWidgetSettings.centralCircleImage;
        }
    }

    // 保存 + 应用设置
    if (typeof saveData === 'function') await saveData(db);
    if (typeof applySafeAreaSettings === 'function') applySafeAreaSettings();
    if (typeof applyScreenAdaptation === 'function') applyScreenAdaptation();

    const duration = Date.now() - startTime;
    return { success: true, message: `全量数据已恢复 (${lineCount} 行, 耗时${duration}ms, V5流式)` };
}

// =========================================================
// --- 6.8 惰性切分解析器（工单 C）---
// 不一次性 JSON.parse 整个 73MB 字符串（会造出 200MB+ 对象树导致手机 Chrome OOM），
// 而是先扫描出顶层各 key 的 value 边界（不 parse），大数组字段逐元素 parse 入库释放，
// 小数据字段整体 parse。峰值内存 = 字符串本身 + 当前一个角色对象。
// 已通过 14 项边界用例自测（含特殊字符/嵌套/数字字面量/字段乱序），见 lazy_parse_test.js
// =========================================================

// 大数组字段：这些 key 的 value 是数组且元素可能很大，需逐元素 parse 入库
const LAZY_ARRAY_KEYS = new Set(['characters', 'groups', 'studyBookContents', 'studyCoreadMessages', 'studyBookSummaries', 'forumPosts']);

// 跳过空白，返回第一个非空白字符位置
function _lazySkipWs(str, i) {
    const len = str.length;
    while (i < len && (str[i] === ' ' || str[i] === '\t' || str[i] === '\n' || str[i] === '\r')) i++;
    return i;
}

// 给定 value 起始位置（指向第一个非空白字符），返回 value 结束位置（不含）
// 支持：对象/数组/字符串/数字/true/false/null，正确处理字符串内转义和括号配平
function _lazyFindValueEnd(str, start) {
    let i = start;
    const len = str.length;
    if (i >= len) throw new Error('findValueEnd: 流结尾');
    const ch = str[i];
    if (ch === '"') {
        i++;
        let escape = false;
        while (i < len) {
            const c = str[i];
            if (escape) { escape = false; i++; continue; }
            if (c === '\\') { escape = true; i++; continue; }
            if (c === '"') return i + 1;
            i++;
        }
        throw new Error('findValueEnd: 字符串未闭合');
    }
    if (ch === '{' || ch === '[') {
        let depth = 1, inStr = false, esc = false;
        i++;
        while (i < len) {
            const c = str[i];
            if (inStr) {
                if (esc) { esc = false; i++; continue; }
                if (c === '\\') { esc = true; i++; continue; }
                if (c === '"') { inStr = false; i++; continue; }
                i++; continue;
            }
            if (c === '"') { inStr = true; i++; continue; }
            if (c === '{' || c === '[') { depth++; i++; continue; }
            if (c === '}' || c === ']') { depth--; i++; if (depth === 0) return i; continue; }
            i++;
        }
        throw new Error('findValueEnd: 括号未配平');
    }
    // 字面量：数字/true/false/null，遇 , } ] 空白结束
    while (i < len) {
        const c = str[i];
        if (c === ',' || c === '}' || c === ']' || c === ' ' || c === '\t' || c === '\n' || c === '\r') return i;
        i++;
    }
    return i;
}

// 读取字符串字面量（从 " 开始），返回 [字符串值, 结束位置]
function _lazyReadStringLiteral(str, start) {
    if (str[start] !== '"') throw new Error('readStringLiteral: 期望 "');
    let i = start + 1;
    const len = str.length;
    let result = '';
    let escape = false;
    while (i < len) {
        const c = str[i];
        if (escape) {
            if (c === '"') result += '"';
            else if (c === '\\') result += '\\';
            else if (c === '/') result += '/';
            else if (c === 'b') result += '\b';
            else if (c === 'f') result += '\f';
            else if (c === 'n') result += '\n';
            else if (c === 'r') result += '\r';
            else if (c === 't') result += '\t';
            else if (c === 'u') { result += String.fromCharCode(parseInt(str.slice(i + 1, i + 5), 16)); i += 4; }
            else result += c;
            escape = false; i++; continue;
        }
        if (c === '\\') { escape = true; i++; continue; }
        if (c === '"') return [result, i + 1];
        result += c; i++;
    }
    throw new Error('readStringLiteral: 未闭合');
}

// 解析顶层对象各 key 的 value 起止位置（不 parse，只定位边界）
// 返回 { keyName: { vStart, vEnd }, ... }  vStart 指向 value 第一个非空白字符，vEnd 为结束位置（不含）
function _lazyParseTopLevelKeys(str) {
    const result = {};
    let i = _lazySkipWs(str, 0);
    const len = str.length;
    if (str[i] !== '{') throw new Error('parseTopLevelKeys: 期望 {');
    i++;
    while (i < len) {
        i = _lazySkipWs(str, i);
        if (i >= len) throw new Error('parseTopLevelKeys: 流结尾');
        if (str[i] === '}') return result;
        if (str[i] === ',') { i++; continue; }
        if (str[i] !== '"') throw new Error('parseTopLevelKeys: 期望 key " at ' + i);
        const [key, afterKey] = _lazyReadStringLiteral(str, i);
        i = _lazySkipWs(str, afterKey);
        if (str[i] !== ':') throw new Error('parseTopLevelKeys: 期望 : at ' + i);
        i++;
        i = _lazySkipWs(str, i);
        const vStart = i;
        const vEnd = _lazyFindValueEnd(str, i);
        result[key] = { vStart, vEnd };
        i = vEnd;
    }
    throw new Error('parseTopLevelKeys: 未闭合');
}

// 在数组 value 区间内逐元素定位边界，回调传入每个元素的完整 JSON 子串
// arrStart 指向 [，arrEnd 指向 ] 之后。onItem(elemStr) 返回 false 可停止
function _lazyIterArrayItems(str, arrStart, arrEnd, onItem) {
    let i = arrStart;
    if (str[i] !== '[') throw new Error('iterArrayItems: 期望 [');
    i++;
    while (i < arrEnd) {
        i = _lazySkipWs(str, i);
        if (i >= arrEnd || str[i] === ']') break;
        if (str[i] === ',') { i++; continue; }
        const elemStart = i;
        const elemEnd = _lazyFindValueEnd(str, i);
        if (onItem(str.slice(elemStart, elemEnd)) === false) return;
        i = elemEnd;
    }
}

// ★ Step 5b：异步版本的逐元素遍历（同上，但 onItem 可以是 async；每个元素 await）
//   目的：让"解析一个 char → 立即 flush 它的 history 到 DB → 释放"成为可能，
//   避免所有 characters 的 history 同时常驻内存导致手机 Chrome OOM。
async function _lazyIterArrayItemsAsync(str, arrStart, arrEnd, onItem) {
    let i = arrStart;
    if (str[i] !== '[') throw new Error('iterArrayItems: 期望 [');
    i++;
    while (i < arrEnd) {
        i = _lazySkipWs(str, i);
        if (i >= arrEnd || str[i] === ']') break;
        if (str[i] === ',') { i++; continue; }
        const elemStart = i;
        const elemEnd = _lazyFindValueEnd(str, i);
        const res = await onItem(str.slice(elemStart, elemEnd));
        if (res === false) return;
        i = elemEnd;
    }
}

// ★ Step 5c：从对象 JSON 字符串中剥离指定"大数组字段"，返回元数据 + 大字段的字节区间
//   输入：完整的对象 JSON 字符串（如一个 char 的 elemStr）+ 大 key 集合
//   输出：{ meta: 已 parse 的对象（不含大 key）, largeSpans: { keyName: {vStart, vEnd} } }
//   largeSpans 里的偏移是相对于输入字符串本身的，供 _lazyIterArrayItemsAsync 使用。
//   目的：避免对含 12 万条 history 的 char 做一次性 JSON.parse（会造 30~40MB 对象树）。
function _lazyStripLargeKeysFromObject(objStr, largeKeySet) {
    const spans = _lazyParseTopLevelKeys(objStr);
    const parts = [];
    const largeSpans = {};
    for (const key of Object.keys(spans)) {
        if (largeKeySet.has(key)) {
            largeSpans[key] = spans[key];
        } else {
            const { vStart, vEnd } = spans[key];
            parts.push(JSON.stringify(key) + ':' + objStr.slice(vStart, vEnd));
        }
    }
    // 拼出的字符串只含元数据（不含大数组的值），parse 峰值几 KB
    const meta = JSON.parse('{' + parts.join(',') + '}');
    return { meta, largeSpans };
}

// =========================================================
// 惰性切分全量导入（工单 C 核心）
// 输入：完整的备份 JSON 字符串（已解压，73MB 量级）
// 流程：先扫描顶层 key 边界（不 parse），大数组字段逐元素 parse 入库释放，
//       小数据字段整体 parse。避免一次性 JSON.parse 造出 200MB+ 对象树导致 OOM。
// 只处理全量导入（!isPartial），云端部分恢复仍走 importBackupData（数据量小）。
// 任何步骤抛错由调用方 fallback 到 importBackupData(JSON.parse(jsonString))。
// =========================================================
async function lazyImportBackupData(jsonString) {
    const startTime = Date.now();
    // 1) 扫描顶层 key 边界（不 parse 整棵树）
    const spans = _lazyParseTopLevelKeys(jsonString);

    // 2) 判断是否部分恢复（含 _partialType）。若是，不走惰性路径，抛错让调用方 fallback
    if (spans._partialType) {
        throw new Error('lazyImport: 检测到 _partialType，应走 importBackupData');
    }

    // 3) 清空所有表（与原全量分支一致）
    // ★ V9~V12：补清 studyBanks/studyExams/studyExamRecords/studyBookSummaries，避免恢复后旧数据残留
    if (typeof dexieDB !== 'undefined') {
        await Promise.all([
            dexieDB.characters.clear(), dexieDB.groups.clear(), dexieDB.worldBooks.clear(),
            dexieDB.myStickers.clear(), dexieDB.userPersonas.clear(), dexieDB.globalSettings.clear(),
            dexieDB.forumPosts.clear(), dexieDB.peekData.clear(), dexieDB.rpgProfiles.clear(),
            dexieDB.forumMetadata.clear(),
            dexieDB.messages.clear(),
            dexieDB.memories.clear(),
            dexieDB.memoryChunks.clear(),
            dexieDB.studyBooks.clear(),
            dexieDB.studyBookContents.clear(),
            dexieDB.studyCoreadMessages.clear(),
            dexieDB.studyPageCache.clear(),
            dexieDB.studyQuestions.clear(),
            dexieDB.studyRecords.clear(),
            dexieDB.studyBanks.clear(),
            dexieDB.studyExams.clear(),
            dexieDB.studyExamRecords.clear(),
            dexieDB.studyBookSummaries.clear(),
        ]);
    }

    // normalizePeek（与原逻辑一致）
    const normalizePeek = (pd) => {
        if (!pd) return {};
        if (Array.isArray(pd)) {
            let res = {};
            pd.forEach(item => { if (item.charId && item.data) res[item.charId] = item.data; });
            return res;
        }
        return JSON.parse(JSON.stringify(pd)); // 保留：格式转换语义，量小
    };

    // 4) 小数据字段：整体 parse 赋值给 db（除大数组字段和 peekData 特殊处理）
    //    大数组字段单独处理
    const message = "全量数据已恢复";

    // 先把 db 现有的 characters/groups 清空（后面逐元素填充）
    if (!db.characters) db.characters = []; else db.characters.length = 0;
    if (!db.groups) db.groups = []; else db.groups.length = 0;

    // 小数据 key 集合：顶层所有 key 减去大数组字段和 peekData
    const smallDataKeys = Object.keys(spans).filter(k =>
        !LAZY_ARRAY_KEYS.has(k) && k !== 'peekData' && !k.startsWith('_')
    );
    for (const key of smallDataKeys) {
        const { vStart, vEnd } = spans[key];
        db[key] = JSON.parse(jsonString.slice(vStart, vEnd));
    }
    // peekData 特殊处理（Step 5c：lazy 逐 charId 处理，避免整体 parse）
    //   备份中的 peekData 通常是 {"charId1": {...}, "charId2": {...}} 形态；
    //   兼容老格式的数组 [{charId, data}, ...]（走 fallback 整体 parse）。
    if (spans.peekData) {
        db.peekData = {};
        const { vStart, vEnd } = spans.peekData;
        // 快速判定：跳过空白后第一个字符是 { 则走 lazy，是 [ 则回退整体 parse
        let scanI = _lazySkipWs(jsonString, vStart);
        if (jsonString[scanI] === '{') {
            try {
                const entrySpans = _lazyParseTopLevelKeys(jsonString.slice(vStart, vEnd));
                for (const charId of Object.keys(entrySpans)) {
                    if (charId.startsWith('_')) continue;
                    const { vStart: es, vEnd: ee } = entrySpans[charId];
                    // 注意：entrySpans 的偏移是相对于切片的，转回原串
                    const abs = jsonString.slice(vStart + es, vStart + ee);
                    db.peekData[charId] = JSON.parse(abs);
                    // 每 20 个让出一次
                    if (Object.keys(db.peekData).length % 20 === 0) await new Promise(r => setTimeout(r, 0));
                }
            } catch (e) {
                console.warn('[lazyImport] peekData 分块失败，回退整体 parse:', e && e.message);
                db.peekData = normalizePeek(JSON.parse(jsonString.slice(vStart, vEnd)));
            }
        } else {
            // 老格式数组：整体 parse（一般量小）
            db.peekData = normalizePeek(JSON.parse(jsonString.slice(vStart, vEnd)));
        }
    }

    // 5) 分批写入辅助函数
    const BATCH_SIZE = 500;
    async function batchBulkPut(table, items) {
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            await table.bulkPut(items.slice(i, i + BATCH_SIZE));
        }
    }

    // 6) 处理 characters/groups 大数组（Step 5b + 5c）
    //    5b：解析一个 → 立即 flush 到 DB → 清 history 后 push 元数据（多个 char 不再叠加）
    //    5c：char 内部再分块——history/memoryChunks 从对象里剥离后 lazy 逐条 parse，
    //        避免单个"12 万条"char 一次性 JSON.parse 造出 30~40MB 对象树。
    const migrateChatIds = []; // 收集有 history 的 chatId
    let memBatch = [];   // memories 待入库批次
    let chunkBatch = []; // memoryChunks 待入库批次
    let msgBatch = [];   // messages 待入库批次
    let msgSeq = 0;      // ★ 用于生成缺失 id，避免同一毫秒内的碰撞

    const flushMemBatch   = async () => { if (memBatch.length)   { await batchBulkPut(dexieDB.memories,     memBatch);   memBatch = []; } };
    const flushChunkBatch = async () => { if (chunkBatch.length) { await dexieDB.memoryChunks.bulkPut(chunkBatch); chunkBatch = []; } };
    const flushMsgBatch   = async () => { if (msgBatch.length)   { await batchBulkPut(dexieDB.messages,     msgBatch);   msgBatch = []; } };

    // ★ 5c 关键：char 对象内部要 lazy 剥离的大字段
    const LARGE_KEYS_IN_CHAR = new Set(['history', 'memoryChunks']);

    // 每个 char/group：先尝试剥离大字段（5c），失败则回退到 5b 老逻辑（整体 parse）
    const processOneChat = async (elemStr, chatType) => {
        let obj;
        let historySpan = null;
        let chunksSpan  = null;
        try {
            const stripped = _lazyStripLargeKeysFromObject(elemStr, LARGE_KEYS_IN_CHAR);
            obj = stripped.meta;
            historySpan = stripped.largeSpans.history      || null;
            chunksSpan  = stripped.largeSpans.memoryChunks || null;
        } catch (e) {
            // 剥离失败（比如 char 结构异常），回退：整体 parse（可能占内存但保功能）
            console.warn('[lazyImport] char 内部剥离失败，回退整体 parse:', e && e.message);
            obj = JSON.parse(elemStr);
        }

        // 拆 memories（memories 通常不大，直接用 obj 上的数组处理）
        const pushMem = (arr, memType) => (arr || []).forEach(item => {
            if (!item.id) item.id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            memBatch.push({ ...item, chatId: obj.id, memType });
        });
        pushMem(obj.memorySummaries, 'short');
        pushMem(obj.memoryJournals, 'journal');
        pushMem(obj.longTermSummaries, 'long');

        // memoryChunks：lazy 剥离成功用 span 逐条 parse；否则从 obj 里读
        if (chunksSpan) {
            await _lazyIterArrayItemsAsync(elemStr, chunksSpan.vStart, chunksSpan.vEnd, async (chunkStr) => {
                const chunk = JSON.parse(chunkStr);
                if (!chunk.id) chunk.id = `chunk_${obj.id}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                chunkBatch.push({ ...chunk, chatId: obj.id });
                if (chunkBatch.length >= BATCH_SIZE) {
                    await flushChunkBatch();
                    await new Promise(r => setTimeout(r, 0));
                }
                return true;
            });
        } else if (obj.memoryChunks && obj.memoryChunks.length) {
            obj.memoryChunks.forEach(chunk => {
                if (!chunk.id) chunk.id = `chunk_${obj.id}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                chunkBatch.push({ ...chunk, chatId: obj.id });
            });
            obj.memoryChunks = []; // 释放
        }

        // history：lazy 剥离成功用 span 逐条 parse+flush；否则从 obj.history 读
        if (historySpan) {
            migrateChatIds.push(obj.id);
            await dexieDB.messages.where('chatId').equals(obj.id).delete();
            let idx = 0;
            await _lazyIterArrayItemsAsync(elemStr, historySpan.vStart, historySpan.vEnd, async (msgStr) => {
                const m = JSON.parse(msgStr);
                if (!m.id) m.id = `msg_${Date.now()}_${msgSeq++}_${idx}`;
                m.chatId = obj.id;
                m.chatType = chatType;
                msgBatch.push(m);
                idx++;
                if (msgBatch.length >= BATCH_SIZE) {
                    await flushMsgBatch();
                    await new Promise(r => setTimeout(r, 0));
                }
                return true;
            });
        } else if (obj.history && obj.history.length) {
            migrateChatIds.push(obj.id);
            await dexieDB.messages.where('chatId').equals(obj.id).delete();
            const hist = obj.history;
            for (let idx = 0; idx < hist.length; idx++) {
                const m = hist[idx];
                if (!m.id) m.id = `msg_${Date.now()}_${msgSeq++}_${idx}`;
                m.chatId = obj.id;
                m.chatType = chatType;
                msgBatch.push(m);
                if (msgBatch.length >= BATCH_SIZE) {
                    await flushMsgBatch();
                    await new Promise(r => setTimeout(r, 0));
                }
            }
            obj.history = [];
        }

        // 元数据入 db（history/memoryChunks 已剥离或清空，占用极小）
        if (chatType === 'private') db.characters.push(obj);
        else                        db.groups.push(obj);
    };

    if (spans.characters) {
        await _lazyIterArrayItemsAsync(jsonString, spans.characters.vStart, spans.characters.vEnd, async (elemStr) => {
            await processOneChat(elemStr, 'private');
            return true;
        });
    }

    if (spans.groups) {
        await _lazyIterArrayItemsAsync(jsonString, spans.groups.vStart, spans.groups.vEnd, async (elemStr) => {
            await processOneChat(elemStr, 'group');
            return true;
        });
    }

    // 收尾 flush
    await flushMsgBatch();
    if (migrateChatIds.length > 0) {
        window.isMessageMigrated = true; // 所有消息入库完成后才标记
    }
    await flushMemBatch();
    await flushChunkBatch();

    // 10.5) forumPosts（Step 5c：lazy 逐帖处理，避免整体 parse 10MB+ JSON）
    if (spans.forumPosts) {
        db.forumPosts = [];
        let postBatch = [];
        const flushPostBatch = async () => {
            if (!postBatch.length) return;
            // ★ forumPosts 是 db 挂载 + Dexie 写盘双持有；这里只入内存 + DB
            db.forumPosts.push(...postBatch);
            await batchBulkPut(dexieDB.forumPosts, postBatch);
            postBatch = [];
        };
        await _lazyIterArrayItemsAsync(jsonString, spans.forumPosts.vStart, spans.forumPosts.vEnd, async (postStr) => {
            postBatch.push(JSON.parse(postStr));
            if (postBatch.length >= BATCH_SIZE) {
                await flushPostBatch();
                await new Promise(r => setTimeout(r, 0));
            }
            return true;
        });
        await flushPostBatch();
        // 与 loadData 一致：按时间倒序
        db.forumPosts.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }

    // 11) study 大表逐元素分批入库（不入 db，db 不持有这些大表）
    if (spans.studyBookContents) {
        let studyBatch = [];
        _lazyIterArrayItems(jsonString, spans.studyBookContents.vStart, spans.studyBookContents.vEnd, (elemStr) => {
            studyBatch.push(JSON.parse(elemStr));
            return true;
        });
        await batchBulkPut(dexieDB.studyBookContents, studyBatch);
    }
    if (spans.studyCoreadMessages) {
        let studyBatch = [];
        _lazyIterArrayItems(jsonString, spans.studyCoreadMessages.vStart, spans.studyCoreadMessages.vEnd, (elemStr) => {
            studyBatch.push(JSON.parse(elemStr));
            return true;
        });
        await batchBulkPut(dexieDB.studyCoreadMessages, studyBatch);
    }
    if (spans.studyBookSummaries) {
        let studyBatch = [];
        _lazyIterArrayItems(jsonString, spans.studyBookSummaries.vStart, spans.studyBookSummaries.vEnd, (elemStr) => {
            studyBatch.push(JSON.parse(elemStr));
            return true;
        });
        await batchBulkPut(dexieDB.studyBookSummaries, studyBatch);
    }

    // 11.1) ★ V9~V11：studyBanks/studyExams/studyExamRecords 虽在 db 内存（已被 smallDataKeys 解析进 db），
    //        但 Dexie 表不会自动写入，需显式 bulkPut，否则 loadData() 会用 Dexie 旧数据覆盖 db，导致恢复后丢失
    if (Array.isArray(db.studyBanks) && db.studyBanks.length)       await batchBulkPut(dexieDB.studyBanks,       db.studyBanks);
    if (Array.isArray(db.studyExams) && db.studyExams.length)       await batchBulkPut(dexieDB.studyExams,       db.studyExams);
    if (Array.isArray(db.studyExamRecords) && db.studyExamRecords.length) await batchBulkPut(dexieDB.studyExamRecords, db.studyExamRecords);

    // 12) 兜底补全（与原逻辑一致）
    if (!db.pomodoroTasks) db.pomodoroTasks = [];
    if (!db.forumUserIdentity) db.forumUserIdentity = { nickname: '新用户', avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', persona: '', realName: '', anonCode: '0311', customDetailCss: '' };
    if (typeof defaultWidgetSettings !== 'undefined') {
        if (!db.homeWidgetSettings) {
            db.homeWidgetSettings = JSON.parse(JSON.stringify(defaultWidgetSettings));
        } else if (!db.homeWidgetSettings.centralCircleImage) {
            db.homeWidgetSettings.centralCircleImage = defaultWidgetSettings.centralCircleImage;
        }
    }

    // 13) 保存 + 应用设置（与原逻辑一致）
    if (typeof saveData === 'function') await saveData(db);
    if (typeof applySafeAreaSettings === 'function') applySafeAreaSettings();
    if (typeof applyScreenAdaptation === 'function') applyScreenAdaptation();

    const duration = Date.now() - startTime;
    return { success: true, message: `${message} (耗时${duration}ms, 惰性切分)` };
}

async function importBackupData(data, isCloudPartialRestore = false) {
    const startTime = Date.now();
    try {
        const isPartial = !!data._partialType;
        let message = "";

        // === 核心修复：标准化 PeekData 防止旧版数组格式导致崩溃 ===
        const normalizePeek = (pd) => {
            if (!pd) return {};
            if (Array.isArray(pd)) {
                let res = {};
                pd.forEach(item => { if(item.charId && item.data) res[item.charId] = item.data; });
                return res;
            }
            return JSON.parse(JSON.stringify(pd));
        };

        if (isCloudPartialRestore && isPartial) {
            message = `云端数据 (${data._partialType}) 已完整恢复`;
            Object.keys(data).forEach(key => {
                if (key.startsWith('_')) return; 
                // 针对 peekData 单独洗数据
                if (key === 'peekData') {
                    db.peekData = normalizePeek(data.peekData);
                } else if (data[key] !== undefined) {
                    // ★ B-2：云端部分恢复分支，data 同样是已解析的新对象，直接赋值
                    db[key] = data[key];
                }
            });
        }
        else if (!isPartial) {
if (typeof dexieDB !== 'undefined') {
    await Promise.all([
        dexieDB.characters.clear(), dexieDB.groups.clear(), dexieDB.worldBooks.clear(),
        dexieDB.myStickers.clear(), dexieDB.userPersonas.clear(), dexieDB.globalSettings.clear(),
        dexieDB.forumPosts.clear(), dexieDB.peekData.clear(), dexieDB.rpgProfiles.clear(),
        dexieDB.forumMetadata.clear(),
        dexieDB.messages.clear(),           // 全量恢复时清空消息表
        dexieDB.memories.clear(),           // ★ V6：清空记忆表
        dexieDB.memoryChunks.clear(),       // ★ V6：清空向量切块表
        dexieDB.studyBooks.clear(),         // ★ V8：清空学习书籍元数据
        dexieDB.studyBookContents.clear(),  // ★ V8：清空书籍正文
        dexieDB.studyCoreadMessages.clear(),// ★ V8：清空共读消息
        dexieDB.studyPageCache.clear(),     // ★ V8：清空分页缓存
        dexieDB.studyQuestions.clear(),     // ★ V8：清空题目
        dexieDB.studyRecords.clear(),       // ★ V8：清空答题记录
        dexieDB.studyBanks.clear(),         // ★ V9：清空题库
        dexieDB.studyExams.clear(),         // ★ V10：清空考卷
        dexieDB.studyExamRecords.clear(),   // ★ V11：清空考试记录
        dexieDB.studyBookSummaries.clear(), // ★ V12：清空书本总结
    ]);
}
            message = "全量数据已恢复";
            Object.keys(db).forEach(key => { 
                if (data[key] !== undefined) {
                    if (key === 'peekData') {
                        db.peekData = normalizePeek(data[key]);
                    } else {
                        // ★ B-1：data 来自 JSON.parse/json()，本身就是新对象树，无需深拷贝
                        db[key] = data[key];
                    }
                }
            });
        }
        else {
            message = `部分数据 (${data._partialType}) 已合并`;
            Object.keys(db).forEach(key => {
                if (data[key] !== undefined) {
                    // 安全合并 peekData，防止覆盖其他角色
                    if (key === 'peekData') {
                        if (!db.peekData) db.peekData = {};
                        Object.assign(db.peekData, normalizePeek(data.peekData));
                    }
                    else if (Array.isArray(db[key]) && key !== 'characters' && key !== 'groups') {
                        const existingIds = new Set(db[key].map(i => i.id));
                        data[key].forEach(item => {
                            if (!existingIds.has(item.id)) db[key].push(item);
                            else { const idx = db[key].findIndex(i => i.id === item.id); if (idx !== -1) db[key][idx] = item; }
                        });
                    } 
                    else if (key === 'characters' || key === 'groups') {
                        data[key].forEach(newItem => {
                            const existingItem = db[key].find(i => i.id === newItem.id);
                            if (existingItem) Object.assign(existingItem, newItem);
                            else db[key].push(newItem);
                        });
                    } 
                    else db[key] = data[key];
                }
            });
        }

        // =================================================================
        // ★★★ 数据导入后：把老备份文件包含的 History 对象抽取为独立的消息行入库 ★★★
        // ★ B-3：分批 bulkPut + 删除提前 + isMessageMigrated 延后，避免大数组常驻
        // =================================================================
        // 1) 先收集所有需要迁移的 chatId（用于一次性删除旧消息，避免边删边插）
        const migrateChatIds = [];
        if (db.characters) db.characters.forEach(c => { if (c.history && c.history.length) migrateChatIds.push(c.id); });
        if (db.groups)     db.groups.forEach(g =>     { if (g.history && g.history.length) migrateChatIds.push(g.id); });

        if (migrateChatIds.length > 0) {
            // 2) 一次性删除这些 chatId 下的旧消息，必须在 bulkPut 之前
            await dexieDB.messages.where('chatId').anyOf(migrateChatIds).delete();

            // 3) 边收集边分批 bulkPut，每批 500 条；保留浅拷贝避免污染 history 对象
            const BATCH_SIZE = 500;
            let batch = [];
            const flush = async () => {
                if (batch.length === 0) return;
                const toPut = batch;
                batch = [];
                await dexieDB.messages.bulkPut(toPut);
            };

            const collectFromHistory = async (historyArr, chatId, chatType) => {
                historyArr.forEach((m, idx) => {
                    if (!m.id) m.id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${idx}`;
                    batch.push({ ...m, chatId, chatType });
                });
                // 每个角色处理完，若批次满则 flush，避免 batch 无上限增长
                while (batch.length >= BATCH_SIZE) {
                    const toPut = batch.splice(0, BATCH_SIZE);
                    await dexieDB.messages.bulkPut(toPut);
                }
            };

            if (db.characters) for (const c of db.characters) { if (c.history && c.history.length) await collectFromHistory(c.history, c.id, 'private'); }
            if (db.groups)     for (const g of db.groups)     { if (g.history && g.history.length) await collectFromHistory(g.history, g.id, 'group'); }

            // 4) flush 剩余不足一批的尾巴
            await flush();
            // 5) 所有批次入库完成后才标记迁移完成
            window.isMessageMigrated = true; // ★ 修复：导入后标记迁移完成，防止 saveData 把 history 写回 IndexedDB 导致下次加载重复触发升级弹窗
        }

        // ★ V6：将备份中 character/group 携带的记忆字段写入 memories 独立表
        const importMemItems = [];
        const extractMemories = (objs) => {
            (objs || []).forEach(obj => {
                const push = (arr, memType) => (arr || []).forEach(item => {
                    if (!item.id) item.id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    importMemItems.push({ ...item, chatId: obj.id, memType });
                });
                push(obj.memorySummaries,  'short');
                push(obj.memoryJournals,   'journal');
                push(obj.longTermSummaries,'long');
            });
        };
        extractMemories(db.characters);
        extractMemories(db.groups);
        if (importMemItems.length > 0) {
            if (data.characters) await dexieDB.memories.where('chatId').anyOf(data.characters.map(c=>c.id)).delete();
            if (data.groups)     await dexieDB.memories.where('chatId').anyOf(data.groups.map(g=>g.id)).delete();
            await dexieDB.memories.bulkPut(importMemItems);
        }

        // ★ V6：将备份中 character/group 携带的 memoryChunks 写入 memoryChunks 独立表
        const importChunks = [];
        const extractChunks = (objs) => {
            (objs || []).forEach(obj => {
                (obj.memoryChunks || []).forEach(chunk => {
                    if (!chunk.id) chunk.id = `chunk_${obj.id}_${Date.now()}_${Math.random().toString(36).substr(2,5)}`;
                    importChunks.push({ ...chunk, chatId: obj.id });
                });
            });
        };
        extractChunks(db.characters);
        extractChunks(db.groups);
        if (importChunks.length > 0) {
            if (data.characters) await dexieDB.memoryChunks.where('chatId').anyOf(data.characters.map(c=>c.id)).delete();
            if (data.groups)     await dexieDB.memoryChunks.where('chatId').anyOf(data.groups.map(g=>g.id)).delete();
            await dexieDB.memoryChunks.bulkPut(importChunks);
        }

// ★ V8：将备份中的书籍正文写入 studyBookContents 独立表
        if (data.studyBookContents && data.studyBookContents.length > 0) {
            await dexieDB.studyBookContents.bulkPut(data.studyBookContents);
        }

        // ★ V8：将备份中的共读消息写入 studyCoreadMessages 独立表
        if (data.studyCoreadMessages && data.studyCoreadMessages.length > 0) {
            await dexieDB.studyCoreadMessages.bulkPut(data.studyCoreadMessages);
        }

        // ★ V12：将备份中的书本章节总结写入 studyBookSummaries 独立表
        if (data.studyBookSummaries && data.studyBookSummaries.length > 0) {
            await dexieDB.studyBookSummaries.bulkPut(data.studyBookSummaries);
        }

        // ★ V9~V11：studyBanks/studyExams/studyExamRecords 虽在 db 内存（已被 Object.keys 遍历赋值进 db），
        //   但 Dexie 表不会自动写入，需显式 bulkPut，否则 loadData() 会用 Dexie 旧数据覆盖 db，导致恢复后丢失
        if (Array.isArray(db.studyBanks) && db.studyBanks.length)             await dexieDB.studyBanks.bulkPut(db.studyBanks);
        if (Array.isArray(db.studyExams) && db.studyExams.length)             await dexieDB.studyExams.bulkPut(db.studyExams);
        if (Array.isArray(db.studyExamRecords) && db.studyExamRecords.length) await dexieDB.studyExamRecords.bulkPut(db.studyExamRecords);

        // 兜底补全
        if (!db.pomodoroTasks) db.pomodoroTasks =[];
        if (!db.forumUserIdentity) db.forumUserIdentity = { nickname: '新用户', avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', persona: '', realName: '', anonCode: '0311', customDetailCss: '' };
        if (typeof defaultWidgetSettings !== 'undefined') {
    if (!db.homeWidgetSettings) {
        db.homeWidgetSettings = JSON.parse(JSON.stringify(defaultWidgetSettings));
    } else if (!db.homeWidgetSettings.centralCircleImage) {
        // homeWidgetSettings 存在但 centralCircleImage 是空/undefined，补默认值
        db.homeWidgetSettings.centralCircleImage = defaultWidgetSettings.centralCircleImage;
    }
}

        if (typeof saveData === 'function') await saveData(db);
        if (typeof applySafeAreaSettings === 'function') applySafeAreaSettings();
        if (typeof applyScreenAdaptation === 'function') applyScreenAdaptation();
        
        const duration = Date.now() - startTime;
        return { success: true, message: `${message} (耗时${duration}ms)` };

    } catch (error) {
        console.error('导入数据失败:', error);
        return { success: false, error: error.message };
    }
}

// =========================================================
// --- 8. GitHub Sync Logic (云端备份核心) ---
// =========================================================

const GH_CONFIG_KEY = 'qchat_github_config';
const FILE_NAME_V5 = 'qchat_backup_v5.ee';   // ★ V5：单文件 JSONL 全量备份
const FILE_NAME_SYSTEM = 'qchat_backup_system.ee'; // 旧版分片（仅恢复回退用）
const FILE_NAME_CHATS = 'qchat_backup_chats.ee';   // 旧版分片（仅恢复回退用）
const FILE_NAME_LEGACY = 'qchat_auto_backup.json'; // ★ 新增:旧版备份文件名

const GitHubService = {
    getConfig: () => {
        try { return JSON.parse(localStorage.getItem(GH_CONFIG_KEY)); } catch (e) { return null; }
    },

    saveConfig: (token, username, repo, autoBackup) => {
        const config = { token, username, repo, autoBackup };
        localStorage.setItem(GH_CONFIG_KEY, JSON.stringify(config));
        return config;
    },

    getFileInfo: async (config, fileName) => {
        const url = `https://api.github.com/repos/${config.username}/${config.repo}/contents/${fileName}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `token ${config.token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`GitHub 连接失败: ${response.status}`);
        return await response.json();
    },

    uploadBlob: async (contentBase64, fileName) => {
        const config = GitHubService.getConfig();
        if (!config) throw new Error("请先配置 GitHub 连接");

        let sha = null;
        try {
            const existingFile = await GitHubService.getFileInfo(config, fileName);
            if (existingFile) sha = existingFile.sha;
        } catch (e) {
            console.warn(`新建文件: ${fileName}`);
        }

        const url = `https://api.github.com/repos/${config.username}/${config.repo}/contents/${fileName}`;
        const body = {
            message: `Backup ${fileName}: ${new Date().toLocaleString()}`,
            content: contentBase64
        };
        if (sha) body.sha = sha;

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.message || `上传 ${fileName} 失败`);
        }
        return true;
    },

    // ★★★ 新增:下载旧版备份的方法 ★★★
    // ★ 工单 C：返回字符串（未 parse），供惰性切分导入使用
    downloadLegacyBackup: async () => {
        const config = GitHubService.getConfig();
        if (!config) throw new Error("GitHub 未配置");

        try {
            return await fetchAndDecompressGitHubFileAsString(config, FILE_NAME_LEGACY);
        } catch (e) {
            console.warn("未找到旧版备份文件");
            return null;
        }
    },

    initUI: () => {
        const btnConfig = document.getElementById('btn-gh-config');
        const btnUpload = document.getElementById('btn-gh-upload');
        const btnDownload = document.getElementById('btn-gh-download');
        const modal = document.getElementById('github-settings-modal');
        const lastSync = document.getElementById('github-last-sync');
        
        GitHubService.updateUIState(!!GitHubService.getConfig());

        btnConfig.onclick = () => {
            modal.classList.add('visible');
            const currentConfig = GitHubService.getConfig();
            if (currentConfig) {
                document.getElementById('gh-token-input').value = currentConfig.token || '';
                document.getElementById('gh-username-input').value = currentConfig.username || '';
                document.getElementById('gh-repo-input').value = currentConfig.repo || '';
                document.getElementById('gh-auto-backup-switch').checked = !!currentConfig.autoBackup;
            }
        };

        document.getElementById('btn-gh-cancel').onclick = () => modal.classList.remove('visible');
        document.getElementById('btn-gh-save').onclick = async () => {
            const token = document.getElementById('gh-token-input').value.trim();
            const username = document.getElementById('gh-username-input').value.trim();
            const repo = document.getElementById('gh-repo-input').value.trim();
            const auto = document.getElementById('gh-auto-backup-switch').checked;

            if (!token || !username || !repo) {
                await AppUI.alert("请填写完整信息");
                return;
            }
            GitHubService.saveConfig(token, username, repo, auto);
            modal.classList.remove('visible');
            GitHubService.updateUIState(true);
            showToast("GitHub 配置已保存");
        };

        btnUpload.onclick = async () => {
            if(await AppUI.confirm("将覆盖原有云端备份数据,确定要备份到云端吗?", "系统提示", "确认", "取消")) {
                const btn = btnUpload;
                const oldText = btn.innerText;
                btn.innerText = "上传中";
                btn.disabled = true;
                
                try {
                    await performOptimizedCloudBackup();
                    showToast("云端备份全部完成!");
                } catch (e) {
                    console.error(e);
                    await AppUI.alert("上传过程中出错: " + e.message);
                } finally {
                    btn.innerText = oldText;
                    btn.disabled = false;
                }
            }
        };

        btnDownload.onclick = async () => {
            if(await AppUI.confirm("确定要从云端恢复吗?这会覆盖本地数据。", "系统提示", "确认", "取消")) {
                 const btn = btnDownload;
                 const oldText = btn.innerText;
                 btn.innerText = "恢复中";
                 btn.disabled = true;

                 try {
                     await performOptimizedCloudRestore();
                     await AppUI.alert("恢复成功！页面即将刷新...");
                     window.location.reload();
                 } catch (e) {
                     console.error("自动恢复失败:", e);
                     const config = GitHubService.getConfig();
                     const repoUrl = `https://github.com/${config ? config.username : 'your'}/${config ? config.repo : 'repo'}`;
                     
                     if(await AppUI.confirm(`自动恢复遇到问题: ${e.message}\n\n是否打开 GitHub 仓库手动下载备份文件?\n(下载 .ee 文件后,使用上方的"导入数据"按钮即可)`, "系统提示", "确认", "取消")) {
                        window.open(repoUrl, '_blank');
                     }
                 } finally {
                     btn.innerText = oldText;
                     btn.disabled = false;
                 }
            }
        };
    },

    updateUIState: (isConnected, lastDate) => {
        const btnConfig = document.getElementById('btn-gh-config');
        const btnUpload = document.getElementById('btn-gh-upload');
        const btnDownload = document.getElementById('btn-gh-download');
        const statusText = document.getElementById('github-status-text');
        const iconBg = document.getElementById('github-status-icon');
        const lastSync = document.getElementById('github-last-sync');

        if (isConnected) {
            statusText.innerText = "已连接 GitHub";
            statusText.style.color = "#3A9EF6";
            iconBg.style.background = "#3A9EF6";
            btnConfig.innerText = "设置";
            btnUpload.style.display = "inline-block";
            btnDownload.style.display = "inline-block";
            if (lastDate) {
                lastSync.style.display = "block";
                lastSync.innerText = "上次: " + lastDate.toLocaleTimeString();
            }
        } else {
            statusText.innerText = "未连接";
            statusText.style.color = "#888";
            iconBg.style.background = "#24292e";
            btnUpload.style.display = "none";
            btnDownload.style.display = "none";
            lastSync.style.display = "none";
        }
    }
};

// =========================================================
// --- 9. 业务逻辑:分片备份与恢复 (扁平化修复版) ---
// =========================================================

/**
 * ★ V5：执行云端备份（单文件 JSONL 流式）
 * 复用本地备份的 createFullBackupStream 生成器：消息/向量块等分批成行，
 * 不再走 buildFullHistoryMap 把全量消息挂回内存（旧版这一步在手机上就可能 OOM）。
 */
async function performOptimizedCloudBackup() {
    if (!window.db) throw new Error("数据库未加载");

    showToast("正在流式打包全量数据...");
    const base64 = await compressStreamToEeBase64(createFullBackupStream());

    showToast(`正在上传备份 (${(base64.length / 1024 / 1024).toFixed(1)}MB)...`);
    await GitHubService.uploadBlob(base64, FILE_NAME_V5);
    console.log('[Backup] V5 云端备份上传成功');

    GitHubService.updateUIState(true, new Date());
}

/**
 * ★ V5：执行云端恢复
 * 优先找 V5 单文件备份：response.body 直接接上流式导入管道，
 * 边下载边解压边逐行入库，全程不在内存落地大字符串（手机端安全）。
 * 找不到 V5 时回退旧版分片备份 / 旧版全量备份（兼容历史数据）。
 */
async function performOptimizedCloudRestore() {
    const config = GitHubService.getConfig();
    if (!config) throw new Error("GitHub 未配置");

    // ★★★ 步骤0: 优先尝试 V5 流式备份 ★★★
    let v5Info = null;
    try {
        v5Info = await GitHubService.getFileInfo(config, FILE_NAME_V5);
    } catch (e) {
        console.warn('[Restore] V5 备份检查失败，回退旧版:', e.message);
    }
    if (v5Info && v5Info.download_url) {
        // 找到 V5 就只走 V5：导入中途失败不回退旧分片（importJsonlStream 校验
        // meta 后才清库，清库后再失败时旧分片是更早的数据，静默回退反而危险）
        showToast("发现 V5 备份，正在流式恢复 (边下载边入库)...");
        const response = await fetch(v5Info.download_url);
        if (!response.ok) throw new Error(`下载 V5 备份失败: ${response.status}`);
        const result = await importJsonlStream(response.body);
        if (!result.success) throw new Error(result.error || 'V5 流式恢复失败');
        console.log('[Restore] V5 流式恢复完成:', result.message);
        return;
    }
    console.log('[Restore] 云端无 V5 备份，尝试旧版分片...');

    let systemData = null;
    let chatData = null;

    // ★★★ 步骤1: 尝试下载旧版分片备份 ★★★
    try {
        showToast("正在拉取系统配置...");
        systemData = await fetchAndDecompressGitHubFile(config, FILE_NAME_SYSTEM);
        console.log('[Restore] 系统数据下载成功');
    } catch (e) {
        console.warn("[Restore] 系统数据下载失败:", e.message);
    }

    try {
        showToast("正在拉取聊天记录 (文件较大,请稍候)...");
        chatData = await fetchAndDecompressGitHubFile(config, FILE_NAME_CHATS);
        console.log('[Restore] 聊天数据下载成功,角色数:', chatData.characters?.length || 0);
    } catch (e) {
        console.warn("[Restore] 聊天数据下载失败:", e.message);
    }

    // ★★★ 步骤2: 如果分片备份都失败,尝试旧版全量备份 ★★★
    if (!systemData && !chatData) {
        console.warn("[Restore] 未找到分片备份,尝试查找旧版全量备份...");
        try {
            const legacyData = await GitHubService.downloadLegacyBackup();
            if (legacyData) {
                showToast("发现旧版备份,正在恢复...");
                console.log('[Restore] 使用旧版全量备份');
                // ★ 工单 C：优先惰性切分导入，失败 fallback 到 JSON.parse + importBackupData
                try {
                    const r = await lazyImportBackupData(legacyData);
                    if (!r.success) throw new Error(r.error || '惰性导入失败');
                    console.log('[Restore] 惰性切分恢复完成:', r.message);
                } catch (lazyErr) {
                    console.warn('⚠️ 惰性切分失败,回退标准路径:', lazyErr.message);
                    const data = JSON.parse(legacyData);
                    await importBackupData(data, false);
                }
                return;
            }
        } catch (oldErr) {
            console.error("[Restore] 旧版备份也无法获取:", oldErr);
        }
        
        throw new Error("无法获取任何云端备份文件");
    }

    // ★★★ 步骤3: 恢复系统数据 (完整替换模式) ★★★
    if (systemData) {
        showToast("恢复系统配置中...");
        console.log('[Restore] 开始恢复系统数据...');
        const result = await importBackupData(systemData, true); // ★ 传入 true 启用完整替换
        if (!result.success) {
            throw new Error(`系统数据恢复失败: ${result.error}`);
        }
        console.log('[Restore] 系统数据恢复完成');
    }

    // ★★★ 步骤4: 恢复聊天数据 (完整替换模式) ★★★
    if (chatData) {
        showToast("恢复聊天记录中...");
        console.log('[Restore] 开始恢复聊天数据...');
        const result = await importBackupData(chatData, true); // ★ 传入 true 启用完整替换
        if (!result.success) {
            throw new Error(`聊天数据恢复失败: ${result.error}`);
        }
        console.log('[Restore] 聊天数据恢复完成,最终角色数:', db.characters?.length || 0);
    }

    // ★★★ 步骤5: 验证恢复结果 ★★★
    console.log('[Restore] === 恢复完成,数据摘要 ===');
    console.log('- 角色数:', db.characters?.length || 0);
    console.log('- 群组数:', db.groups?.length || 0);
    console.log('- 世界书数:', db.worldBooks?.length || 0);
    console.log('- 论坛帖子数:', db.forumPosts?.length || 0);
    try { console.log('- 消息数:', await dexieDB.messages.count()); } catch(e) {}
}
