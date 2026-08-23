// --- 文件位置: js/settings/data_storage.js ---

const dataStorage = {
    // ★ 唯一的顺序真相：饼图和详情列表都按这个数组来排。
    //   顺序是**按导出关系和依赖关系**排的，不是按体积：
    //     1  系统设置        —— 哪怕什么都没建，这里也有内容，放第一个
    //     2-4 角色与聊天 / 记忆与向量 / 角色手机数据 —— 这三项一起导出，必须挨着
    //     5  个性化          —— 很多也是聊天相关的设置
    //     6  世界书          —— 体积小，但几乎所有功能都用到
    //     7  喵坛            —— 聊天之外最占空间的，但本身依赖聊天+世界书
    //     8  ToDouo
    //     9  游戏            —— 体积很小，同样依赖聊天+世界书
    //     10 本地媒体        —— 唯一不参与导出的，放最后
    //   往下加新分类时**必须**同时加进这里，否则详情列表不会显示它
    //   （历史上语音/图片就是这么漏掉的）。
    categoryOrder: [
        'settings',
        'characters',
        'memory',
        'peek',
        'personalization',
        'worldBooks',
        'forum',
        'study',
        'rpg',
        'localMedia'
    ],

    // ★ 配色 = 沿 categoryOrder 从深到浅的单色蓝渐变，一一对应，无重复色。
    //   为什么是渐变而不是"相邻色差最大化"：饼图的作用只是让人一眼看出**哪几项很大**，
    //   不需要分辨挨着的扇区 —— 精确数值下面的列表里有数字，看得更清楚。
    //   而顺序本身已经把几个大项拉开了距离（角色与聊天 2、喵坛 7、ToDouo 8、本地媒体 10），
    //   在渐变上自然落到深/中/浅不同段位，该区分的地方就已经区分开了。
    //   渐变还顺带保证了列表从上到下颜色是连续过渡的，比跳变好看。
    categoryColors: {
        settings:        '#1B60A1',
        characters:      '#1B6CB3',
        memory:          '#1F78BC',
        peek:            '#2E81C2',
        personalization: '#3991CC',
        worldBooks:      '#4EA2D8',
        forum:           '#77B7E3',
        study:           '#A5D2F1',
        rpg:             '#CEE9FB',
        localMedia:      '#E6F5FB'
    },

    categoryNames: {
        settings:        '系统设置',
        characters:      '角色与聊天',
        memory:          '记忆与向量',
        peek:            '角色手机数据',
        personalization: '个性化',
        worldBooks:      '世界书',
        forum:           '喵坛',
        study:           'ToDouo',
        rpg:             '游戏',
        localMedia:      '本地媒体'
    },

    /**
     * 把 categorizedSizes 拉平成 [{key, value}]，按 categoryOrder 排好、滤掉 0。
     * 饼图和详情列表都走这里 —— 顺序只有一份实现，两边不可能再排得不一样。
     * 不在 categoryOrder 里的分类会被追加到末尾（见 categoryOrder 上的说明）。
     */
    orderedEntries: function (categorizedSizes) {
        const sizes = categorizedSizes || {};
        const known = this.categoryOrder.filter(key => key in sizes);
        const unregistered = Object.keys(sizes).filter(key => !this.categoryOrder.includes(key));
        return known.concat(unregistered)
            .map(key => ({ key, value: sizes[key] || 0 }))
            .filter(item => item.value > 0);
    },

    getStorageInfo: async function () {
        const stringify = (obj) => {
            try {
                if (!obj) return 0;
                return JSON.stringify(obj).length;
            } catch (e) {
                return 0;
            }
        };

        if (typeof db === 'undefined' || !db.characters) {
            console.error("Database not loaded.");
            return null;
        }

        let categorizedSizes = {
            settings: 0,
            characters: 0,
            memory: 0,
            peek: 0,
            personalization: 0,
            worldBooks: 0,
            forum: 0,
            study: 0,
            rpg: 0,
            localMedia: 0
        };

        try {
            // ★ [懒加载] char/group.history 只有内存窗口内的 ~1500 条，
            //   直接 stringify 会严重低估"角色与聊天"体积。先从 DB 流式累加每个 chat 的全量消息体积，
            //   后面 char 统计时删掉内存 history、改用这份全量体积补回。关掉懒加载时不走这步。
            const histBytesByChat = {};
            if (window.LAZY_LOAD && typeof dexieDB !== 'undefined') {
                try {
                    await dexieDB.messages.toCollection().each(msg => {
                        const cid = msg && msg.chatId;
                        if (!cid) return;
                        try { histBytesByChat[cid] = (histBytesByChat[cid] || 0) + JSON.stringify(msg).length; } catch (e) {}
                    });
                } catch (e) { console.warn('[storage] 消息体积统计失败:', e); }
            }

            // 1. 角色与聊天 (不含 PeekData 与已剥离的记忆/向量字段，PeekData 单独统计)
            (db.characters || []).forEach(char => {
                const safeChar = { ...char };
                delete safeChar.memorySummaries;
                delete safeChar.memoryJournals;
                delete safeChar.longTermSummaries;
                delete safeChar.memoryChunks;
                if (window.LAZY_LOAD) {
                    // history 只是窗口，不能代表全量；删掉后用 DB 全量体积补回
                    delete safeChar.history;
                    categorizedSizes.characters += stringify(safeChar) + (histBytesByChat[char.id] || 0);
                } else {
                    // history 已挂载回内存，直接 stringify 统计消息体积，无需估算
                    categorizedSizes.characters += stringify(safeChar);
                }
            });
            (db.groups || []).forEach(group => {
                const safeGroup = { ...group };
                delete safeGroup.memorySummaries;
                delete safeGroup.memoryJournals;
                delete safeGroup.longTermSummaries;
                delete safeGroup.memoryChunks;
                if (window.LAZY_LOAD) {
                    delete safeGroup.history;
                    categorizedSizes.characters += stringify(safeGroup) + (histBytesByChat[group.id] || 0);
                } else {
                    categorizedSizes.characters += stringify(safeGroup);
                }
            });
            // ★ 1.5 偷看手机数据（单独统计，随角色导出，不提供独立导出）
            categorizedSizes.peek += stringify(db.peekData);

            // 2. 世界书
            categorizedSizes.worldBooks += stringify(db.worldBooks);

            // ★ 3. 记忆与向量（从独立表精确统计，不依赖内存挂载）
            if (typeof dexieDB !== 'undefined') {
                try {
                    const [allMemories, allChunks] = await Promise.all([
                        dexieDB.memories.toArray(),
                        dexieDB.memoryChunks.toArray()
                    ]);
                    allMemories.forEach(m => categorizedSizes.memory += stringify(m));
                    allChunks.forEach(c => categorizedSizes.memory += stringify(c));
                } catch(e) {}
            }

            // 4. 论坛
            // ★ [论坛懒加载 F6] 懒加载下内存 db.forumPosts 只有窗口，直接 stringify 会严重低估。
            //   改从 DB 流式累加每帖体积（与上面消息的做法一致）。关掉懒加载时走原路径。
            if (window.LAZY_FORUM && typeof dexieDB !== 'undefined') {
                try {
                    await dexieDB.forumPosts.toCollection().each(post => {
                        try { categorizedSizes.forum += JSON.stringify(post).length; } catch (e) {}
                    });
                } catch (e) { console.warn('[storage] 论坛体积统计失败:', e); }
            } else {
                categorizedSizes.forum += stringify(db.forumPosts);
            }
            categorizedSizes.forum += stringify(db.forumBindings);
            categorizedSizes.forum += stringify(db.forumUserIdentity);
            categorizedSizes.forum += stringify(db.watchingPostIds);
            categorizedSizes.forum += stringify(db.favoritePostIds);

            // 5. RPG
            categorizedSizes.rpg += stringify(db.rpgProfiles);

            // 6. 个性化
            categorizedSizes.personalization += stringify(db.userPersonas);
            categorizedSizes.personalization += stringify(db.myStickers);
            categorizedSizes.personalization += stringify(db.wallpaper);
            categorizedSizes.personalization += stringify(db.customIcons);
            categorizedSizes.personalization += stringify(db.bubbleCssPresets);
            categorizedSizes.personalization += stringify(db.globalCss);
            categorizedSizes.personalization += stringify(db.globalCssPresets);
            categorizedSizes.personalization += stringify(db.homeSignature);
            categorizedSizes.personalization += stringify(db.insWidgetSettings);
            categorizedSizes.personalization += stringify(db.homeWidgetSettings);

            // 7. 系统设置
            // ★ 这里原先只统计了 8 个 key，globalSettingKeys 白名单里另外 14 个
            //   （识图/天气/向量/通知/推送/语音图片配置、GitHub 仓库凭据与绑定、
            //   各种开关）一项都没算，导致"什么都没建"时这一类显示得比实际小。
            //   现在直接对着 database.js 的 globalSettingKeys 走一遍，
            //   以后往白名单加 key 就自动算进来，不用再改这里。
            if (typeof globalSettingKeys !== 'undefined' && Array.isArray(globalSettingKeys)) {
                // 个性化那一类已经单独统计过的 key，别重复计一遍
                const countedElsewhere = new Set([
                    'wallpaper', 'customIcons', 'bubbleCssPresets', 'globalCss', 'globalCssPresets',
                    'homeSignature', 'insWidgetSettings', 'homeWidgetSettings',
                    'studySettings'   // 归到 ToDouo
                ]);
                globalSettingKeys.forEach(key => {
                    if (countedElsewhere.has(key)) return;
                    categorizedSizes.settings += stringify(db[key]);
                });
            } else {
                // 白名单拿不到时的兜底：至少保住原有的几项
                categorizedSizes.settings += stringify(db.apiSettings);
                categorizedSizes.settings += stringify(db.apiPresets);
                categorizedSizes.settings += stringify(db.pomodoroSettings);
                categorizedSizes.settings += stringify(db.pomodoroTasks);
                categorizedSizes.settings += stringify(db.homeScreenMode);
                categorizedSizes.settings += stringify(db.fontUrl);
                categorizedSizes.settings += stringify(db.homeStatusBarColor);
                categorizedSizes.settings += stringify(db.homeNavigationBarColor);
            }

// ★ 8. ToDouo 模块
categorizedSizes.study += stringify(db.studyBooks);
categorizedSizes.study += stringify(db.studyQuestions);
categorizedSizes.study += stringify(db.studyRecords);
categorizedSizes.study += stringify(db.studyBanks);
categorizedSizes.study += stringify(db.studyExams);
categorizedSizes.study += stringify(db.studyExamRecords);
categorizedSizes.study += stringify(db.studySettings);
// ★ V8：正文和共读消息在独立表，需从 Dexie 读取；★ V12：章节总结同
// ★ studyPageCache 原先整张表都没统计：它按 bookId 存整本书的分页结果，
//   等于把正文又存了一份，体积和 studyBookContents 同量级 —— 漏掉它会让
//   ToDouo 显示的占用差出快一半。虽然可随时重算，但空间是实打实占着的。
if (typeof dexieDB !== 'undefined') {
    try {
        const [allContents, allCoreadMsgs, allBookSummaries, allPageCache] = await Promise.all([
            dexieDB.studyBookContents.toArray(),
            dexieDB.studyCoreadMessages.toArray(),
            dexieDB.studyBookSummaries.toArray(),
            dexieDB.studyPageCache ? dexieDB.studyPageCache.toArray() : Promise.resolve([]),
        ]);
        allContents.forEach(r => categorizedSizes.study += stringify(r));
        allCoreadMsgs.forEach(r => categorizedSizes.study += stringify(r));
        allBookSummaries.forEach(r => categorizedSizes.study += stringify(r));
        allPageCache.forEach(r => categorizedSizes.study += stringify(r));
    } catch(e) {}
}

// ★ 9. 本地媒体 = 语音音频字节 + 语音元数据 + 生图图片字节，合成一项统计。
//   两者都是"只存在于本机的媒体缓存"：不进备份、恢复时会被清空、可按限额淘汰，
//   归档过的还能从 GitHub 仓库拉回来 —— 性质完全一致，所以不拆成两项。
//   ★ 绝不能 stringify 这两张表：几兆的音频/图片字节读进内存只为算个大小。
//   统一走各自的 stats 函数，它们只遍历元数据里的 size 字段。
if (typeof getVoiceCacheStats === 'function') {
    try {
        const voiceStats = await getVoiceCacheStats();
        // metaBytes 原先没算：voiceClips 元数据带 TTS 原文，条数多了不可忽略。
        // 字节被淘汰、只剩元数据的 clip 也照样占空间，所以两项都要加。
        categorizedSizes.localMedia += voiceStats.cachedBytes + (voiceStats.metaBytes || 0);
    } catch (e) { console.warn('[storage] 语音缓存统计失败:', e); }
}

if (typeof getImageCacheStats === 'function') {
    try {
        const imageStats = await getImageCacheStats();
        categorizedSizes.localMedia += imageStats.cachedBytes;
    } catch (e) { console.warn('[storage] 图片缓存统计失败:', e); }
}

            const totalSize = Object.values(categorizedSizes).reduce((sum, size) => sum + size, 0);
            return { totalSize, categorizedSizes };
        } catch (error) {
            console.error("Error calculating storage:", error);
            return null;
        }
    }
};

window.refreshStorageScreen = async function() {
    const contentEl = document.querySelector('#storage-analysis-screen .content');
    
    // 1. 开始计算前：立即隐藏内容并禁用点击
    if (contentEl) {
        contentEl.style.transition = 'none';
        contentEl.style.opacity = '0';
        contentEl.style.pointerEvents = 'none'; // <--- 新增：加载时禁用点击
        void contentEl.offsetWidth; 
        contentEl.style.transition = 'opacity 0.3s ease';
    }

    let hideLoading = () => {};
    if (typeof showLoadingToast === 'function') {
        hideLoading = showLoadingToast("数据统计中，请稍候……");
    }

    try {
        if (window.setupBackupButtons) {
            window.setupBackupButtons();
        }

        const chartContainer = document.getElementById('storage-chart-container');
        const detailsList = document.getElementById('storage-details-list');
        const totalSizeEl = document.getElementById('storage-total-size');

        const info = await dataStorage.getStorageInfo();
        if (!info) return;

        if (totalSizeEl) {
            totalSizeEl.textContent = formatBytes(info.totalSize);
        }

        renderStorageChart(chartContainer, info);
        renderStorageDetails(detailsList, info);
        
        if (typeof GitHubService !== 'undefined') {
            GitHubService.initUI();
        }

    } catch (e) {
        console.error("加载存储分析数据异常:", e);
    } finally {
        // 3. 计算完成：隐藏 Toast，内容淡入，恢复点击
        hideLoading();
        if (contentEl) {
            contentEl.style.opacity = '1';
            contentEl.style.pointerEvents = 'auto'; // <--- 新增：显示后恢复正常点击
        }
    }
};

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

let myStorageChart = null;
function renderStorageChart(container, info) {
    if (!container) return;
    if (typeof echarts === 'undefined') {
        container.innerHTML = '<div style="text-align:center; padding-top:20px; color:#999;">图表组件未加载</div>';
        return;
    }

    if (!myStorageChart) {
        myStorageChart = echarts.init(container);
    }

    // ★ 饼图与详情列表共用 dataStorage.orderedEntries()：
    //   扇区顺序 = 列表顺序 = 配色深浅顺序。
    const chartData = dataStorage.orderedEntries(info.categorizedSizes)
        .map(item => ({
            name: dataStorage.categoryNames[item.key] || item.key,
            value: item.value,
            itemStyle: {
                color: dataStorage.categoryColors[item.key] || '#999'
            }
        }));

    const option = {
        tooltip: { 
            trigger: 'item',
            confine: true, // 关键配置：限制tooltip在图表容器内
            position: function (point, params, dom, rect, size) {
                // 自适应位置计算，防止超出屏幕
                const x = point[0];
                const y = point[1];
                const viewWidth = size.viewSize[0];
                const viewHeight = size.viewSize[1];
                const boxWidth = size.contentSize[0];
                const boxHeight = size.contentSize[1];
                
                let posX = x + 10;
                let posY = y + 10;
                
                // 如果右侧空间不够，显示在左侧
                if (x + boxWidth + 10 > viewWidth) {
                    posX = x - boxWidth - 10;
                }
                
                // 如果下方空间不够，显示在上方
                if (y + boxHeight + 10 > viewHeight) {
                    posY = y - boxHeight - 10;
                }
                
                return [posX, posY];
            },
            formatter: function(params) {
                // 格式化显示内容，使其更紧凑
                return `${params.name}<br/>${formatBytes(params.value)} (${params.percent}%)`;
            }
        },
        series: [{
            name: '存储分布',
            type: 'pie',
            radius: ['60%', '85%'],
            center: ['50%', '50%'],
            avoidLabelOverlap: false,
            label: { show: false },
            data: chartData 
        }]
    };
    
    myStorageChart.setOption(option);
    setTimeout(() => { 
        try { myStorageChart.resize(); } catch(e){} 
    }, 200);
}

// 重点修改：调整了HTML结构，将 Size 移到了右侧
function renderStorageDetails(container, info) {
    if (!container) return;
    container.innerHTML = ''; 
    container.classList.add('storage-details-container');

    // ★ 顺序与饼图共用 orderedEntries()。以前这里另有一份写死的 categoryOrder 白名单，
    //   新加的语音/图片没登记进去，于是"算进了总量、画进了饼图、却不在列表里"。
    const sortedData = dataStorage.orderedEntries(info.categorizedSizes);

    // 没有独立导出通道的分类，右侧显示说明文字而不是导出按钮。
    // 能导出的分类见 exportPartialData() 的 switch。
    const noExportNotes = {
        memory:     '随角色导出',
        peek:       '随角色导出',
        localMedia: '不参与备份'
    };

    sortedData.forEach((item) => {
        const name = dataStorage.categoryNames[item.key] || item.key;
        const color = dataStorage.categoryColors[item.key] || '#ccc';
        const note = noExportNotes[item.key];

        const row = document.createElement('div');
        row.className = 'storage-detail-item';

        row.innerHTML = `
            <div class="storage-item-left">
                <div class="storage-color-indicator" style="background-color: ${color};"></div>
                <span class="storage-detail-name">${name}</span>
            </div>
            <div class="storage-item-right">
                <span class="storage-detail-size">${formatBytes(item.value)}</span>
                ${note ? `<span style="font-size:11px;color:#aaa;">${note}</span>` : `<button class="btn-export-sm">导出</button>`}
            </div>
        `;

        const exportBtn = row.querySelector('.btn-export-sm');
        if (exportBtn) {
            exportBtn.onclick = async function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (window.exportPartialData) {
                    window.exportPartialData(item.key);
                } else {
                    await AppUI.alert('功能加载中...');
                }
            };

            exportBtn.ontouchstart = function() { this.style.filter = 'brightness(0.9)'; };
            exportBtn.ontouchend = function() { this.style.filter = 'brightness(1)'; };
        }

        container.appendChild(row);
    });
}

// ========================================================
// === 数据瘦身与异常修复模块 ===
// ========================================================
function setupStorageAnalysisScreen() {
    const cleanupBtn = document.getElementById('btn-cleanup-duplicates');
    if (!cleanupBtn) return;

    cleanupBtn.addEventListener('click', async () => {
        // 防抖：防止重复点击
        if (cleanupBtn.disabled) return;
        
        cleanupBtn.disabled = true;
        const originalText = cleanupBtn.innerText;
        cleanupBtn.innerText = "扫描中...";
        cleanupBtn.style.opacity = "0.7";

        // 引入你 utils.js 中的加载提示动画
        const hideLoading = typeof showLoadingToast === 'function' ? showLoadingToast("正在全盘扫描数据库...") : () => {};

        try {
            // 1. 读取所有消息
            const allMsgs = await dexieDB.messages.toArray();
            
            // 2. 按聊天室分组 (这种在内存中分组排序的方式最稳妥，兼容所有安卓设备)
            const chatGroups = {};
            for (const msg of allMsgs) {
                if (!chatGroups[msg.chatId]) chatGroups[msg.chatId] = [];
                chatGroups[msg.chatId].push(msg);
            }

            const toDelete = [];

            // 3. 逐个聊天室排查幽灵消息
            for (const chatId in chatGroups) {
                const msgs = chatGroups[chatId];
                // 确保消息严格按照时间先后排序
                msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

                let prevMsg = null;
                for (const msg of msgs) {
                    // 判断条件：同角色、同内容、发送时间相差不到 1000 毫秒
                    if (prevMsg &&
                        prevMsg.role === msg.role &&
                        prevMsg.content === msg.content &&
                        (msg.timestamp - prevMsg.timestamp) < 1000
                    ) {
                        toDelete.push(msg.id);
                    } else {
                        prevMsg = msg; // 记录为正常消息
                    }
                }
            }

            hideLoading();

            // 3.5 扫描短期总结旧快照：正文已由片段块实时拼接（getShortSummaryContent），
            //     有"带正文的存活块"的总结，其 item.content 只是生成时的冗余快照，可安全清空。
            //     无块的旧式整篇总结仍依赖 content 兜底，跳过不动。
            const snapshotTargets = [];
            let snapshotBytes = 0;
            const allChats = [...(db.characters || []), ...(db.groups || [])];
            for (const chat of allChats) {
                for (const s of (chat.memorySummaries || [])) {
                    if (!s.content || !s.blockIds || s.blockIds.length === 0) continue;
                    const idSet = new Set(s.blockIds);
                    const hasLiveBlock = (chat.memoryChunks || []).some(c => idSet.has(c.blockId) && c.detailedContent);
                    if (hasLiveBlock) {
                        snapshotTargets.push({ item: s, chatId: chat.id });
                        snapshotBytes += s.content.length * 2; // UTF-16 估算
                    }
                }
            }

            // 4. 结果汇报与清理
            if (toDelete.length > 0 || snapshotTargets.length > 0) {
                const foundParts = [];
                if (toDelete.length > 0) foundParts.push(`${toDelete.length} 条重复消息`);
                if (snapshotTargets.length > 0) foundParts.push(`${snapshotTargets.length} 篇短期总结的冗余正文快照（约 ${formatBytes(snapshotBytes)}，正文已由片段块实时提供，清理不影响任何功能）`);

                const confirmed = await AppUI.confirm(
                    `扫描完成！发现：\n· ${foundParts.join('\n· ')}\n\n是否立刻清理以释放存储空间？`,
                    "发现垃圾数据",
                    "一键清理",
                    "取消"
                );

                if (confirmed) {
                    const hideDeleting = typeof showLoadingToast === 'function' ? showLoadingToast("正在执行清理...") : () => {};
                    if (toDelete.length > 0) {
                        if (typeof deleteMessagesFromDB === 'function') {
                            await deleteMessagesFromDB(toDelete);
                        } else {
                            await dexieDB.messages.bulkDelete(toDelete);
                        }
                    }
                    if (snapshotTargets.length > 0) {
                        // 同步清空内存对象与 memories 表（挂载对象与表记录是两份，须都更新）
                        snapshotTargets.forEach(t => { t.item.content = ''; });
                        await dexieDB.memories.bulkPut(
                            snapshotTargets.map(t => ({ ...t.item, chatId: t.chatId, memType: 'short' }))
                        );
                    }
                    hideDeleting();

                    const doneParts = [];
                    if (toDelete.length > 0) doneParts.push(`删除了 ${toDelete.length} 条重复消息`);
                    if (snapshotTargets.length > 0) doneParts.push(`清空了 ${snapshotTargets.length} 篇总结快照（约 ${formatBytes(snapshotBytes)}）`);
                    await AppUI.alert(`✅ 清理成功！共${doneParts.join('，')}。\n您的设备空间已得到释放。`, "瘦身完成");

                    // 清理完立刻刷新图表和容量统计
                    if (typeof refreshStorageScreen === 'function') {
                        refreshStorageScreen();
                    }
                }
            } else {
                await AppUI.alert("🎉 您的数据库非常健康，没有发现可清理的垃圾数据。", "扫描完成");
            }

        } catch (err) {
            console.error("扫描失败:", err);
            hideLoading();
            await AppUI.alert("扫描过程中出现异常：" + err.message, "操作失败");
        } finally {
            // 恢复按钮状态
            cleanupBtn.disabled = false;
            cleanupBtn.innerText = originalText;
            cleanupBtn.style.opacity = "1";
        }
    });
}
