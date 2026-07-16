// --- 文件位置: js/settings/data_storage.js ---

const dataStorage = {
    categoryColors: {
        settings:        '#0C3A6C',
        worldBooks:      '#05519F',
        characters:      '#0462C2',
        memory:          '#1080E6',
        study:           '#3A9EF6',
        forum:           '#7EBEFB',
        rpg:             '#BADBFC',
        personalization: '#E0EDFE'
    },

    categoryNames: {
        characters:      '角色与聊天',
        worldBooks:      '世界书',
        memory:          '记忆与向量',
        study:           '学习',
        forum:           '喵坛',
        rpg:             '游戏',
        personalization: '个性化',
        settings:        '系统设置'
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
            characters: 0,
            worldBooks: 0,
            memory: 0,
            study: 0,
            forum: 0,
            rpg: 0,
            personalization: 0,
            settings: 0
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

            // 1. 角色与聊天 (包含 PeekData，不含已剥离的记忆/向量字段)
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
            categorizedSizes.characters += stringify(db.peekData);

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
            categorizedSizes.forum += stringify(db.forumPosts);
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
            categorizedSizes.settings += stringify(db.apiSettings);
            categorizedSizes.settings += stringify(db.apiPresets);
            categorizedSizes.settings += stringify(db.pomodoroSettings);
            categorizedSizes.settings += stringify(db.pomodoroTasks);
            categorizedSizes.settings += stringify(db.homeScreenMode);
            categorizedSizes.settings += stringify(db.fontUrl);
            categorizedSizes.settings += stringify(db.homeStatusBarColor);
            categorizedSizes.settings += stringify(db.homeNavigationBarColor);

// ★ 8. 学习模块
categorizedSizes.study += stringify(db.studyBooks);
categorizedSizes.study += stringify(db.studyQuestions);
categorizedSizes.study += stringify(db.studyRecords);
categorizedSizes.study += stringify(db.studyBanks);
categorizedSizes.study += stringify(db.studyExams);
categorizedSizes.study += stringify(db.studyExamRecords);
categorizedSizes.study += stringify(db.studySettings);
// ★ V8：正文和共读消息在独立表，需从 Dexie 读取；★ V12：章节总结同
if (typeof dexieDB !== 'undefined') {
    try {
        const [allContents, allCoreadMsgs, allBookSummaries] = await Promise.all([
            dexieDB.studyBookContents.toArray(),
            dexieDB.studyCoreadMessages.toArray(),
            dexieDB.studyBookSummaries.toArray(),
        ]);
        allContents.forEach(r => categorizedSizes.study += stringify(r));
        allCoreadMsgs.forEach(r => categorizedSizes.study += stringify(r));
        allBookSummaries.forEach(r => categorizedSizes.study += stringify(r));
    } catch(e) {}
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

    const chartData = Object.entries(info.categorizedSizes)
        .filter(([_, value]) => value > 0)
        .map(([key, value]) => ({
            name: dataStorage.categoryNames[key] || key,
            value: value,
            itemStyle: {
                color: dataStorage.categoryColors[key] || '#999' 
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

    // 定义类别的显示顺序（与顶部定义的顺序一致）
    const categoryOrder = ['settings', 'worldBooks', 'characters', 'memory', 'study', 'forum', 'rpg', 'personalization'];

    // 按照预定义的顺序排序
    const sortedData = categoryOrder
        .map(key => ({ 
            key, 
            value: info.categorizedSizes[key] || 0 
        }))
        .filter(item => item.value > 0); // 只显示有数据的类别

    sortedData.forEach((item) => {
        const name = dataStorage.categoryNames[item.key] || item.key;
        const color = dataStorage.categoryColors[item.key] || '#ccc';

        const row = document.createElement('div');
        row.className = 'storage-detail-item';

        row.innerHTML = `
            <div class="storage-item-left">
                <div class="storage-color-indicator" style="background-color: ${color};"></div>
                <span class="storage-detail-name">${name}</span>
            </div>
            <div class="storage-item-right">
                <span class="storage-detail-size">${formatBytes(item.value)}</span>
                ${item.key !== 'memory' ? `<button class="btn-export-sm">导出</button>` : '<span style="font-size:11px;color:#aaa;">随角色导出</span>'}
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

            // 4. 结果汇报与清理
            if (toDelete.length > 0) {
                const confirmed = await AppUI.confirm(
                    `扫描完成！发现了 ${toDelete.length} 条由于系统异常产生的重复消息。\n\n是否立刻清理以释放存储空间？`,
                    "发现垃圾数据", 
                    "一键清理", 
                    "取消"
                );
                
                if (confirmed) {
                    const hideDeleting = typeof showLoadingToast === 'function' ? showLoadingToast("正在执行清理...") : () => {};
                    await dexieDB.messages.bulkDelete(toDelete); // 从数据库抹除
                    hideDeleting();
                    
                    await AppUI.alert(`✅ 清理成功！共删除了 ${toDelete.length} 条重复消息。\n您的设备空间已得到释放。`, "瘦身完成");
                    
                    // 清理完立刻刷新图表和容量统计
                    if (typeof refreshStorageScreen === 'function') {
                        refreshStorageScreen();
                    }
                }
            } else {
                await AppUI.alert("🎉 您的数据库非常健康，没有发现重复的垃圾消息。", "扫描完成");
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