// --- START OF FILE group_info.js ---

/**
 * 初始化群聊信息页面的所有事件（仅 DOMContentLoaded 时调用一次）
 */
function setupGroupInfoScreen() {
    const screen = document.getElementById('group-info-screen');
    if (!screen) return;

    // ── 1. 返回按钮 ──────────────────────────────────────────────────
    const backBtn = document.getElementById('group-info-back-btn');
    if (backBtn) {
        const newBack = backBtn.cloneNode(true);
        backBtn.parentNode.replaceChild(newBack, backBtn);
        newBack.addEventListener('click', () => {
            const source = screen.dataset.source;
            if (source === 'chat-room') {
                switchScreen('chat-room-screen');
            } else {
                switchScreen('chat-list-screen');
            }
        });
    }

    // ── 2. 头像更换 ───────────────────────────────────────────────────
    const avatarUpload  = document.getElementById('group-info-avatar-upload');
    const avatarPreview = document.getElementById('group-info-avatar-preview');
    if (avatarUpload) {
        avatarUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const url = typeof compressImage === 'function'
                    ? await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 })
                    : await new Promise((res, rej) => {
                        const r = new FileReader();
                        r.onload = ev => res(ev.target.result);
                        r.onerror = () => rej(new Error('read failed'));
                        r.readAsDataURL(file);
                    });
                avatarPreview.src = url;
                const heroBg = document.getElementById('group-info-hero-bg');
                if (heroBg) heroBg.style.backgroundImage = `url(${url})`;
                // 不立即持久化，等点"保存"按钮时统一写回
            } catch {
                if (typeof showToast === 'function') showToast('头像处理失败');
            }
        });
    }

    // ── 3. 保存按钮（只保存头像 + 群名）──────────────────────────────
    const saveBtn = document.getElementById('group-info-save-btn');
    if (saveBtn) {
        const newSave = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSave, saveBtn);
        newSave.addEventListener('click', async () => {
            const groupId = screen.dataset.groupId;
            const group   = db.groups.find(g => g.id === groupId);
            if (!group) return;

            const newName   = (document.getElementById('group-info-name-input').value || '').trim();
            const newAvatar = avatarPreview ? avatarPreview.src : group.avatar;

            if (newName && newName !== group.name) {
                group.name = newName;
                // 同步通知消息
                if (typeof sendRenameNotification === 'function') sendRenameNotification(group, newName);
                // 如果当前就在这个群聊，更新标题
                if (window.currentChatId === groupId) {
                    const titleEl = document.getElementById('chat-room-title');
                    if (titleEl) titleEl.textContent = newName;
                }
            }
            if (newAvatar && newAvatar !== group.avatar) {
                group.avatar = newAvatar;
            }

            if (typeof saveSingleChat === 'function') await saveSingleChat(groupId, 'group');
            if (typeof renderChatList === 'function') renderChatList();
            // 同步更新 member-count 显示（群名可能变了）
            const countEl = document.getElementById('group-info-member-count-display');
            if (countEl) countEl.textContent = `${(group.members || []).length + 1} 位成员`;

            if (typeof showToast === 'function') showToast('群聊信息已更新');

            // 返回来源页面
            const source = screen.dataset.source;
            if (source === 'chat-room') switchScreen('chat-room-screen');
            else switchScreen('chat-list-screen');
        });
    }

    // ── 4. 删除（解散）群聊 ───────────────────────────────────────────
    const deleteBtn = document.getElementById('group-info-delete-btn');
    if (deleteBtn) {
        const newDel = deleteBtn.cloneNode(true);
        deleteBtn.parentNode.replaceChild(newDel, deleteBtn);
        newDel.addEventListener('click', async () => {
            const groupId = screen.dataset.groupId;
            const group   = db.groups.find(g => g.id === groupId);
            if (!group) return;

            const firstConfirm = await AppUI.prompt(
                `警告：此操作不可恢复！\n如果要解散"${group.name}"，请在下方输入"确定删除"：`,
                '输入 确定删除',
                '解散群聊 (1/2)',
                '下一步',
                '取消'
            );
            if (firstConfirm !== '确定删除') {
                if (firstConfirm !== null) showToast('输入错误，已取消');
                return;
            }

            const secondConfirm = await AppUI.prompt(
                `最后警告：解散后将无法找回任何数据！\n请再次输入"确定删除"以彻底解散群聊：`,
                '输入 确定删除',
                '最终确认 (2/2)',
                '彻底解散',
                '取消'
            );
            if (secondConfirm !== '确定删除') {
                if (secondConfirm !== null) showToast('输入错误，已取消');
                return;
            }

            // 执行删除
            if (typeof dexieDB !== 'undefined' && dexieDB.groups) await dexieDB.groups.delete(groupId);
            db.groups = db.groups.filter(g => g.id !== groupId);
            if (typeof clearChatHistoryInDB === 'function') await clearChatHistoryInDB(groupId);
            if (typeof renderChatList === 'function') renderChatList();

            showToast('群聊已解散');
            switchScreen('chat-list-screen');
        });
    }

    // ── 5. Tab 切换（事件委托） ───────────────────────────────────────
    const tabBar = document.getElementById('group-info-tab-bar');
    if (tabBar) {
        tabBar.addEventListener('click', async (e) => {
            const btn = e.target.closest('.char-info-tab-btn');
            if (!btn) return;
            const tab = btn.dataset.tab;
            screen.querySelectorAll('.char-info-tab-btn').forEach(b => b.classList.remove('active'));
            screen.querySelectorAll('.char-info-tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const panel = screen.querySelector(`.char-info-tab-panel[data-panel="${tab}"]`);
            if (panel) panel.classList.add('active');

            if (tab === 'stats') await renderGroupTokenStats(screen.dataset.groupId);
        });
    }
}

/**
 * 打开群聊信息页面并填充数据
 * @param {Object} group  - db.groups 中的群对象
 * @param {string} source - 来源屏幕 id，如 'chat-room'
 */
function openGroupInfoScreen(group, source = '') {
    const screen = document.getElementById('group-info-screen');
    if (!screen) return;

    screen.dataset.source  = source;
    screen.dataset.groupId = group.id;

    if (typeof switchScreen === 'function') switchScreen('group-info-screen');

    // Hero
    const avatarPreview = document.getElementById('group-info-avatar-preview');
    const heroBg        = document.getElementById('group-info-hero-bg');
    if (avatarPreview) avatarPreview.src = group.avatar || '';
    if (heroBg) heroBg.style.backgroundImage = group.avatar ? `url(${group.avatar})` : '';

    // 群名（可编辑）
    const nameInput = document.getElementById('group-info-name-input');
    if (nameInput) nameInput.value = group.name || '';

    // 成员数
    const countEl = document.getElementById('group-info-member-count-display');
    if (countEl) countEl.textContent = `${(group.members || []).length + 1} 位成员`;

    // 群主
    const ownerAvatar   = document.getElementById('group-info-owner-avatar');
    const ownerRealname = document.getElementById('group-info-owner-realname');
    const ownerNickname = document.getElementById('group-info-owner-nickname');
    const me = group.me || {};
    // 如果绑定了档案，读取最新
    let meAvatar = me.avatar || '';
    let meRealName = me.realName || '—';
    let meNickname = me.nickname || me.realName || '—';
    if (group.boundPersonaId) {
        const p = db.userPersonas && db.userPersonas.find(up => up.id === group.boundPersonaId);
        if (p) { meRealName = p.realName; meNickname = p.nickname; meAvatar = p.avatar || meAvatar; }
    }
    if (ownerAvatar)   ownerAvatar.src          = meAvatar;
    if (ownerRealname) ownerRealname.textContent = meRealName;
    if (ownerNickname) ownerNickname.textContent = meNickname;

    // 群主头像点击 → 跳转用户档案编辑页
const ownerAvatarEl = document.getElementById('group-info-owner-avatar');
if (ownerAvatarEl) {
    // 防止重复绑定：克隆替换
    const newOwnerAvatar = ownerAvatarEl.cloneNode(true);
    ownerAvatarEl.parentNode.replaceChild(newOwnerAvatar, ownerAvatarEl);
    newOwnerAvatar.src = meAvatar;  // 重新赋值（克隆后数据已在）

    // 找到绑定的 persona 对象
    const boundId = group.me && group.me.boundPersonaId;
    const persona = boundId && db.userPersonas && db.userPersonas.find(p => p.id === boundId);

    if (persona) {
        newOwnerAvatar.style.cursor = 'pointer';
        newOwnerAvatar.addEventListener('click', () => {
            if (typeof openUserPersonaScreen === 'function') {
                openUserPersonaScreen(persona, 'group-info');
            }
        });
    }
}
    
    // 成员列表
    _renderGroupInfoMembers(group);

    // 重置回第一个 tab
    screen.querySelectorAll('.char-info-tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    screen.querySelectorAll('.char-info-tab-panel').forEach((p, i) => p.classList.toggle('active', i === 0));
}

/**
 * 渲染成员网格
 */
function _renderGroupInfoMembers(group) {
    const container = document.getElementById('group-info-members-list');
    if (!container) return;
    container.innerHTML = '';

    (group.members || []).forEach(member => {
        let avatar   = member.avatar || '';
        let realName = member.realName || '—';

        if (member.originalCharId) {
            const orig = db.characters && db.characters.find(c => c.id === member.originalCharId);
            if (orig) { avatar = orig.avatar || avatar; realName = orig.realName || realName; }
        }

        const item = document.createElement('div');
        item.className = 'group-info-member-item';
        item.innerHTML = `
            <img src="${avatar}" alt="${realName}" class="group-info-member-avatar">
            <span class="group-info-member-nick">${realName}</span>
        `;

        // 有关联原始角色的，可点击跳转 char_info
        if (member.originalCharId) {
            item.style.cursor = 'pointer';
            item.addEventListener('click', () => {
                const origChar = db.characters && db.characters.find(c => c.id === member.originalCharId);
                if (origChar && typeof openCharacterScreen === 'function') {
                    openCharacterScreen(origChar, 'group-info');
                }
            });
        }

        container.appendChild(item);
    });
}

// ============================================================
//  Token 统计（6 维，完全对照 generateGroupSystemPrompt）
// ============================================================

/**
 * 计算并渲染群聊统计页面
 * 维度：基础 | 成员 | 上下文 | 世界书 | 记忆 | 论坛
 * 对照 group_prompt.js 中 generateGroupSystemPrompt() 的实际 prompt 组成
 */
function renderGroupTokenStats(groupId) {
    const group = db.groups.find(g => g.id === groupId);
    if (!group) return;

    // [懒加载 UI] 先把统计面板留空 + 弹出 loading，等全部算完再一次性揭开，避免空数据/旧数据闪烁
    const statsPanel = document.querySelector('#group-info-screen .char-info-tab-panel[data-panel="stats"]');
    if (statsPanel) statsPanel.style.visibility = 'hidden';
    const _hideLoading = (typeof showLoadingToast === 'function') ? showLoadingToast('正在统计数据...') : null;

    return _renderGroupTokenStatsInner(group, statsPanel, _hideLoading);
}

async function _renderGroupTokenStatsInner(group, statsPanel, _hideLoading) {
    try {
    // ── 消息总数 ──────────────────────────────────────────────────────
    // [懒加载] group.history 只有内存窗口内的 ~1500 条，真实总数必须走 DB count。
    //   关掉懒加载时回退到 group.history.length，行为与改造前一致。
    let msgCount;
    if (window.LAZY_LOAD && typeof window.getMessageCount === 'function') {
        try { msgCount = await window.getMessageCount(group.id); }
        catch (e) { msgCount = group.history ? group.history.length : 0; }
    } else {
        msgCount = group.history ? group.history.length : 0;
    }
    const msgCountEl = document.getElementById('group-stat-msg-count');
    if (msgCountEl) msgCountEl.textContent = msgCount;

    // ── 上下文 Context（history slice，同 char_info）────────────────
    const maxMem     = group.maxMemory || 10;
    const histSlice  = (group.history || []).slice(-maxMem).filter(m => !m.isAiIgnore);
    const contextStr = histSlice.map(m => m.content || '').join('');
    const contextTokens = _gEst(contextStr);

    // ── 世界书 WorldBook（before + after，不含 writing）──────────────
    const wbBefore = (group.worldBookIds || [])
        .map(id => db.worldBooks && db.worldBooks.find(wb => wb.id === id && wb.position === 'before'))
        .filter(Boolean).map(wb => wb.content).join('\n');
    const wbAfter  = (group.worldBookIds || [])
        .map(id => db.worldBooks && db.worldBooks.find(wb => wb.id === id && wb.position === 'after'))
        .filter(Boolean).map(wb => wb.content).join('\n');
    const wbTokens = _gEst(wbBefore + wbAfter);

    // ── 记忆 Memory（收藏的长期 + 短期总结，对应 prompt 的"已总结剧情"块）
    const longFavs  = (group.longTermSummaries  || []).filter(s => s.isFavorited).map(s => s.content).join('');
    const shortFavs = (group.memorySummaries || []).filter(s => s.isFavorited).map(s => s.content).join('');
    const memoryTokens = _gEst(longFavs + shortFavs);

    // ── 论坛 Forum（getWatchingPostsContext，与 char_info 相同调用）──
    let forumStr = '';
    if (typeof getWatchingPostsContext === 'function') {
        // group_prompt 里直接调 getWatchingPostsContext()（无参数）
        forumStr = getWatchingPostsContext(group) || getWatchingPostsContext() || '';
    }
    const forumTokens = _gEst(forumStr);

    // ── 成员 Members（群主人设 + 所有成员人设 + 表情包名称）─────────
    // 对应 prompt 的第 1 节（我的身份）+ 第 2 节（群聊成员列表）
    const me = group.me || {};
    let meRealName = me.realName || me.nickname || '';
    let mePersona  = me.persona  || '';
    if (group.boundPersonaId) {
        const p = db.userPersonas && db.userPersonas.find(up => up.id === group.boundPersonaId);
        if (p) { meRealName = p.realName; mePersona = p.persona || ''; }
    }
    let membersStr = meRealName + '\n' + mePersona + '\n';

    (group.members || []).forEach(member => {
        let realName = member.realName   || '';
        let nickname = member.groupNickname || '';
        let persona  = member.persona    || '';
        let stickers = '';
        if (member.originalCharId) {
            const orig = db.characters && db.characters.find(c => c.id === member.originalCharId);
            if (orig) {
                realName = orig.realName    || realName;
                nickname = orig.remarkName  || nickname;
                persona  = orig.persona     || persona;
                if (orig.stickerIds && orig.stickerIds.length > 0) {
                    stickers = orig.stickerIds
                        .map(id => db.myStickers && db.myStickers.find(s => s.id === id))
                        .filter(Boolean).map(s => s.name).join('、');
                }
            }
        }
        membersStr += realName + nickname + persona + stickers + '\n';
    });
    const membersTokens = _gEst(membersStr);

    // ── 基础 Base（prompt 的固定骨架文字：第 1/3/4/5/6 节的固定部分）
    //    直接镜像 generateGroupSystemPrompt 中不随人设/记忆变化的文本量
    const n = meRealName;
    const numMembers = (group.members || []).length;
    let baseStr = `你正在一个名为"404"的线上聊天软件中，在一个名为"${group.name}"的群聊里进行角色扮演。请严格遵守以下所有规则：\n\n`;
    baseStr += `1. **核心任务**: 你需要同时扮演这个群聊中的 **所有** AI 成员。我是群聊内唯一的人类用户。\n`;
    baseStr += `   - **我的身份**: 我是这个群聊的群主，我的真实姓名是 **${n}**\n`;
    baseStr += `2. **群聊成员列表**: 以下是你要扮演的所有角色信息：[已在成员维度单独计算]\n`;
    baseStr += `3. **消息格式解析**: 我（用户）的消息有多种格式：\n`;
    baseStr += `    - [${n}的消息：...], [${n} 向 {成员} 转账：...], [${n}的表情包：...], [${n}的语音：...], [${n}发来的照片/视频：...], [${n}引用"..."并回复：...], [${n}撤回了一条消息：...], [system: ...]\n`;
    baseStr += `4. **你的输出格式 (极其重要)**:\n`;
    baseStr += `  - [{成员真名}的消息：{消息内容}]\n  - [{成员真名}的表情包：{表情名称}]\n  - [{成员真名}的语音：...]\n  - [{成员真名}发来的照片/视频：...]\n  - [{成员真名}引用"..."并回复：...]\n`;
    baseStr += `5. **模拟群聊氛围**: 每次回复包含 ${numMembers * 3} 到 ${numMembers * 5} 条消息，发言者随机，内容多样。\n`;
    baseStr += `6. **行为准则**: 严格扮演人设，只输出合法格式消息，保持对话持续性。\n`;
    baseStr += `现在，请根据以上设定，开始扮演群聊中的所有角色。`;
    const baseTokens = _gEst(baseStr);

    // ── 汇总 ──────────────────────────────────────────────────────────
    const totalTokens = baseTokens + membersTokens + contextTokens + wbTokens + memoryTokens + forumTokens;
    const totalEl = document.getElementById('group-stat-total-tokens');
    if (totalEl) totalEl.textContent = totalTokens;

    // ── 柱状图 ────────────────────────────────────────────────────────
    const maxTk = Math.max(baseTokens, membersTokens, contextTokens, wbTokens, memoryTokens, forumTokens, 1);

    const renderBar = (suffix, tokens) => {
        const fillEl   = document.getElementById(`group-bar-fill-${suffix}`);
        const circleEl = document.getElementById(`group-bar-circle-${suffix}`);
        if (!fillEl || !circleEl) return;
        circleEl.textContent = _gFmt(tokens);
        if (tokens === 0) {
            fillEl.style.height     = '40px';
            fillEl.style.background = '#e6e8eb';
        } else {
            const ratio = tokens / maxTk;
            fillEl.style.height     = `calc(40px + (100% - 40px) * ${ratio})`;
            fillEl.style.background = tokens === maxTk ? '#8cbaf8' : '#bbd7fc';
        }
    };

    requestAnimationFrame(() => {
        renderBar('base',    baseTokens);
        renderBar('members', membersTokens);
        renderBar('context', contextTokens);
        renderBar('wb',      wbTokens);
        renderBar('memory',  memoryTokens);
        renderBar('forum',   forumTokens);
    });
    } finally {
        // [懒加载 UI] 数字/内容已就绪，揭开面板并关掉 loading（柱状图在下一帧动画长出）
        if (statsPanel) statsPanel.style.visibility = 'visible';
        if (_hideLoading) _hideLoading();
    }
}

// ── 辅助函数 ──────────────────────────────────────────────────────────
function _gEst(text) {
    if (!text) return 0;
    return Math.ceil(text.length * 1.2);
}
function _gFmt(num) {
    if (num >= 10000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
}

// 暴露到全局
window.setupGroupInfoScreen = setupGroupInfoScreen;
window.openGroupInfoScreen  = openGroupInfoScreen;

// --- END OF FILE group_info.js ---
