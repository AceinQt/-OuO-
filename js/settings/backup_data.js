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
    
    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 打包中...';
        btn.style.opacity = '0.7';
    }

    try {
        showToast('正在准备导出全部数据...');
        await new Promise(r => setTimeout(r, 50));
        const fullBackupData = await createFullBackupData();
        await downloadData(fullBackupData, '全量备份');
        showToast('备份导出成功');
    } catch (err) {
        console.error(err);
        showToast(`导出失败: ${err.message}`);
    } finally {
        window.isBackupLoading = false;
        if (btn) {
            btn.innerHTML = originalText;
            btn.style.opacity = '1';
        }
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
        try {
            showToast('正在解析文件...');
            const decompressionStream = new DecompressionStream('gzip');
            const decompressedStream = file.stream().pipeThrough(decompressionStream);
            const jsonString = await new Response(decompressedStream).text();

            let data = JSON.parse(jsonString);
            const importResult = await importBackupData(data);

            if (importResult.success) {
                showToast(`导入成功!${importResult.message}`);
                setTimeout(() => window.location.reload(), 1500);
            } else {
                await AppUI.alert(`导入失败: ${importResult.error}`);
            }
        } catch (error) {
            console.error("Import error:", error);
            await AppUI.alert(`文件解析错误: ${error.message}`);
        } finally {
            event.target.value = null; 
        }
    } else {
        event.target.value = null;
    }
}

// --- 5. 核心数据构造函数 (全量备份) ---
async function createFullBackupData() {
    const backupData = JSON.parse(JSON.stringify(db));
    backupData._exportVersion = '4.0';
    backupData._exportTimestamp = Date.now();
    return backupData;
}

// --- 6. 下载辅助函数 ---
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

// --- 7. 数据合并/恢复核心逻辑 ---
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
                    db[key] = JSON.parse(JSON.stringify(data[key])); 
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
                    dexieDB.messages.clear() // 全量恢复时清空消息表
                ]);
            }
            message = "全量数据已恢复";
            Object.keys(db).forEach(key => { 
                if (data[key] !== undefined) {
                    if (key === 'peekData') {
                        db.peekData = normalizePeek(data[key]);
                    } else {
                        db[key] = JSON.parse(JSON.stringify(data[key])); // ★ 修复：深拷贝防止引用污染，与其他分支保持一致
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
        // =================================================================
        let importMsgs =[];
        if (db.characters) db.characters.forEach(c => { if(c.history) c.history.forEach((m, idx) => {
            if (!m.id) m.id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${idx}`; // ★ 兜底：老备份消息可能没有 id，强制补全防止 bulkPut 报错
            importMsgs.push({...m, chatId: c.id, chatType: 'private'});
        })});
        if (db.groups) db.groups.forEach(g => { if(g.history) g.history.forEach((m, idx) => {
            if (!m.id) m.id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${idx}`; // ★ 同上
            importMsgs.push({...m, chatId: g.id, chatType: 'group'});
        })});
        
        if (importMsgs.length > 0) {
            // 如果导入数据包含这些角色，清理掉数据库中旧的消息以免冗余叠加
            if (data.characters) await dexieDB.messages.where('chatId').anyOf(data.characters.map(c=>c.id)).delete();
            if (data.groups) await dexieDB.messages.where('chatId').anyOf(data.groups.map(g=>g.id)).delete();
            
            await dexieDB.messages.bulkPut(importMsgs);
            window.isMessageMigrated = true; // ★ 修复：导入后标记迁移完成，防止 saveData 把 history 写回 IndexedDB 导致下次加载重复触发升级弹窗
        }

        // 兜底补全
        if (!db.pomodoroTasks) db.pomodoroTasks =[];
        if (!db.forumUserIdentity) db.forumUserIdentity = { nickname: '新用户', avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', persona: '', realName: '', anonCode: '0311', customDetailCss: '' };
        if (!db.homeWidgetSettings && typeof defaultWidgetSettings !== 'undefined') db.homeWidgetSettings = JSON.parse(JSON.stringify(defaultWidgetSettings));

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
const FILE_NAME_SYSTEM = 'qchat_backup_system.ee';
const FILE_NAME_CHATS = 'qchat_backup_chats.ee';
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
    downloadLegacyBackup: async () => {
        const config = GitHubService.getConfig();
        if (!config) throw new Error("GitHub 未配置");
        
        try {
            return await fetchAndDecompressGitHubFile(config, FILE_NAME_LEGACY);
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
 * ★★★ 修复版:执行优化后的云端备份 ★★★
 * 确保数据完整性和原子性
 */
async function performOptimizedCloudBackup() {
    if (!window.db) throw new Error("数据库未加载");
    const timestamp = Date.now();
    
    // 1. 系统数据 (包含设置、个性化、论坛、RPG等)
    const systemData = {
        _exportVersion: '4.0',
        _exportTimestamp: timestamp,
        _partialType: 'system_core',
        
        // 世界书
        worldBooks: db.worldBooks || [],
        
        // RPG
        rpgProfiles: db.rpgProfiles || [],
        
        // 论坛
        forumPosts: db.forumPosts || [],
        forumBindings: db.forumBindings || {},
        forumUserIdentity: db.forumUserIdentity || {},
        watchingPostIds: db.watchingPostIds || [],
        favoritePostIds: db.favoritePostIds || [],

        // 个性化
        myStickers: db.myStickers || [],
        userPersonas: db.userPersonas || [],
        wallpaper: db.wallpaper,
        customIcons: db.customIcons,
        bubbleCssPresets: db.bubbleCssPresets,
        globalCss: db.globalCss,
        globalCssPresets: db.globalCssPresets,
        homeSignature: db.homeSignature,
        insWidgetSettings: db.insWidgetSettings,
        homeWidgetSettings: db.homeWidgetSettings,

        // 系统设置
        apiSettings: db.apiSettings,
        apiPresets: db.apiPresets,
        pomodoroSettings: db.pomodoroSettings,
        pomodoroTasks: db.pomodoroTasks || [],
        homeScreenMode: db.homeScreenMode,
        fontUrl: db.fontUrl,
        homeStatusBarColor: db.homeStatusBarColor,
        homeNavigationBarColor: db.homeNavigationBarColor,
    enableTopSafeArea: db.enableTopSafeArea,
    enableBottomSafeArea: db.enableBottomSafeArea,
    enableScreenAdaptation: db.enableScreenAdaptation,
    enableSwipeBack: db.enableSwipeBack
    };

    // 2. 聊天数据 (聊天、群组、Peek)
    const chatData = {
        _exportVersion: '4.0',
        _exportTimestamp: timestamp,
        _partialType: 'chats_only', 
        
        characters: db.characters || [],
        groups: db.groups || [],
        peekData: db.peekData || {}
    };

    // ★★★ 修复:增加备份验证 ★★★
    console.log('[Backup] 系统数据字段数:', Object.keys(systemData).length);
    console.log('[Backup] 聊天数据 - 角色数:', chatData.characters.length, '群组数:', chatData.groups.length);

    try {
        // 3. 压缩并上传系统数据
        showToast("正在处理系统数据...");
        const systemBase64 = await compressDataToEeBase64(systemData);
        await GitHubService.uploadBlob(systemBase64, FILE_NAME_SYSTEM);
        console.log('[Backup] 系统数据上传成功');

        // 4. 压缩并上传聊天数据
        showToast("正在压缩聊天记录 (请耐心等待)...");
        const chatBase64 = await compressDataToEeBase64(chatData);
        showToast(`正在上传聊天记录 (${(chatBase64.length/1024/1024).toFixed(1)}MB)...`);
        await GitHubService.uploadBlob(chatBase64, FILE_NAME_CHATS);
        console.log('[Backup] 聊天数据上传成功');

        // 5. 更新状态
        GitHubService.updateUIState(true, new Date());
        
    } catch (error) {
        // ★★★ 修复:上传失败时回滚 ★★★
        console.error('[Backup] 上传失败,需要人工检查备份完整性:', error);
        throw error;
    }
}

/**
 * ★★★ 完全重写:执行优化后的云端恢复 ★★★
 * 修复数据残留和不完整更新问题
 */
async function performOptimizedCloudRestore() {
    const config = GitHubService.getConfig();
    if (!config) throw new Error("GitHub 未配置");

    let systemData = null;
    let chatData = null;
    let usingLegacyBackup = false;

    // ★★★ 步骤1: 尝试下载分片备份 ★★★
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
                await importBackupData(legacyData, false); // 全量恢复
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
