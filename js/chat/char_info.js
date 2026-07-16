// --- START OF FILE char_info.js ---

function setupCharacterEditScreen() {
    const charScreen = document.getElementById('character-edit-screen');
    if (!charScreen) return;

    // 1. 返回按钮
    const backBtn = document.getElementById('character-edit-back-btn');
    if (backBtn) {
        const newBackBtn = backBtn.cloneNode(true);
        backBtn.parentNode.replaceChild(newBackBtn, backBtn);
        newBackBtn.addEventListener('click', () => {
            const source = charScreen.dataset.source;
            if (source === 'chat-room') {
                switchScreen('chat-room-screen');
            } else if (source === 'group-info') {
                // 从群聊信息页面的成员列表进入时，原路返回 group-info
                switchScreen('group-info-screen');
            } else {
                goBackToContacts();
            }
        });
    }

    // 2. 头像上传
    const charAvatarUpload = document.getElementById('character-edit-avatar-upload');
    const charAvatarPreview = document.getElementById('character-edit-avatar-preview');

    if (charAvatarUpload) {
        charAvatarUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                if (typeof compressImage === 'function') {
                    charAvatarPreview.src = await compressImage(file, { quality: 0.8, maxWidth: 400, maxHeight: 400 });
                } else {
                    const reader = new FileReader();
                    reader.onload = (ev) => { charAvatarPreview.src = ev.target.result; };
                    reader.readAsDataURL(file);
                }
                // 同步模糊背景
                const heroBg = document.getElementById('character-edit-hero-bg');
                if (heroBg) heroBg.style.backgroundImage = `url(${charAvatarPreview.src})`;
            } catch (err) {
                if (typeof showToast === 'function') showToast('头像处理失败');
            }
        });
    }

    // 3. 保存表单
    const charForm = document.getElementById('character-edit-form');
    if (charForm) {
        charForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const charId = document.getElementById('character-edit-id').value;
            const char = db.characters.find(c => c.id === charId);
            if (!char) return;

            char.realName   = document.getElementById('character-edit-realname').value;
            char.remarkName = document.getElementById('character-edit-remarkname').value;
            char.persona    = document.getElementById('character-edit-desc').value;
            char.avatar     = charAvatarPreview.src;

            if (typeof saveSingleChat === 'function') await saveSingleChat(charId, 'private');
            if (typeof renderContacts === 'function') renderContacts();
            if (typeof renderChatList === 'function') renderChatList();

            if (window.currentChatId === charId && window.currentChatType === 'private') {
                const titleEl = document.getElementById('chat-room-title');
                if (titleEl) titleEl.textContent = char.remarkName;
            }

            showToast('角色信息已更新');

            const source = charScreen.dataset.source;
            if (source === 'chat-room') {
                switchScreen('chat-room-screen');
                if (typeof loadSettingsToSidebar === 'function') loadSettingsToSidebar();
            } else {
                goBackToContacts();
            }
        });
    }

    // 4. 删除角色 (增加了两步验证确认机制)
    const charDeleteBtn = document.getElementById('character-edit-delete-btn');
    if (charDeleteBtn) {
        charDeleteBtn.addEventListener('click', async () => {
            const charId = document.getElementById('character-edit-id').value;
            const char = db.characters.find(c => c.id === charId);
            if (!char) return;

            // 第一步：第一次输入确认
            const firstConfirm = await AppUI.prompt(
                `警告：此操作不可恢复！\n如果要删除与"${char.remarkName}"的聊天和角色，请在下方输入“确定删除”：`, 
                "输入 确定删除", 
                "删除确认 (1/2)", 
                "下一步", 
                "取消"
            );

            // 如果点击了取消 (返回null) 或输入内容不对
            if (firstConfirm !== "确定删除") {
                if (firstConfirm !== null) showToast('输入错误，已取消删除');
                return;
            }

            // 第二步：第二次输入确认
            const secondConfirm = await AppUI.prompt(
                `最后警告：删除后将无法找回任何数据！\n请再次输入“确定删除”以彻底删除角色：`, 
                "输入 确定删除", 
                "最终确认 (2/2)", 
                "彻底删除", 
                "取消"
            );

            if (secondConfirm !== "确定删除") {
                if (secondConfirm !== null) showToast('输入错误，已取消删除');
                return;
            }

            // 执行真正的删除逻辑
            if (typeof dexieDB !== 'undefined' && dexieDB.characters) await dexieDB.characters.delete(charId);
            db.characters = db.characters.filter(c => c.id !== charId);
            if (typeof clearChatHistoryInDB === 'function') await clearChatHistoryInDB(charId);
            if (typeof renderContacts === 'function') renderContacts();
            if (typeof renderChatList === 'function') renderChatList();
            
            showToast('角色及聊天记录已彻底删除');
            goBackToContacts();
        });
    }

    // 5. 偷看手机
    const peekBtn = document.getElementById('peek-btn');
    if (peekBtn) {
        const newPeekBtn = peekBtn.cloneNode(true);
        peekBtn.parentNode.replaceChild(newPeekBtn, peekBtn);
        newPeekBtn.addEventListener('click', () => {
            const charId = document.getElementById('character-edit-id').value;
            if (!charId) return;
            document.getElementById('peek-screen').dataset.source = 'character-edit';
            if (typeof window.openPeekScreen === 'function') {
                window.openPeekScreen(charId);
            } else {
                showToast('偷看功能初始化中...');
            }
        });
    }

    // 6. Tab 切换（事件委托，避免重复绑定）
    const tabBar = charScreen.querySelector('.char-info-tab-bar');
    if (tabBar) {
        tabBar.addEventListener('click', async (e) => {
            const btn = e.target.closest('.char-info-tab-btn');
            if (!btn) return;
            const tab = btn.dataset.tab;
            charScreen.querySelectorAll('.char-info-tab-btn').forEach(b => b.classList.remove('active'));
            charScreen.querySelectorAll('.char-info-tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const panel = charScreen.querySelector(`.char-info-tab-panel[data-panel="${tab}"]`);
            if (panel) panel.classList.add('active');
            if (tab === 'stats') {
    const charId = document.getElementById('character-edit-id').value;
    await renderTokenStats(charId);
}
        });
    }
}

// 打开并填充角色信息页
// source: 'chat-room' 表示从聊天室进入，'' 或不传表示从通讯录进入
function openCharacterScreen(character, source = '') {
    const screen = document.getElementById('character-edit-screen');

    // ✅ 每次进入都强制覆写 source，防止上次残留的脏值导致返回路径错误
    screen.dataset.source = source;

    if (typeof switchScreen === 'function') switchScreen('character-edit-screen');

    document.getElementById('character-edit-id').value           = character.id;
    document.getElementById('character-edit-avatar-preview').src = character.avatar || '';
    document.getElementById('character-edit-realname').value     = character.realName || '';
    document.getElementById('character-edit-remarkname').value   = character.remarkName || '';
    document.getElementById('character-edit-desc').value         = character.persona || '';

    // 状态（有就显示，没有默认"在线"）
    const statusEl = document.getElementById('character-edit-status-display');
    if (statusEl) statusEl.textContent = character.status || '在线';

    // 同步模糊背景
    const heroBg = document.getElementById('character-edit-hero-bg');
    if (heroBg) heroBg.style.backgroundImage = character.avatar ? `url(${character.avatar})` : '';

    // 每次打开重置回第一个 tab
    if (screen) {
        screen.querySelectorAll('.char-info-tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
        screen.querySelectorAll('.char-info-tab-panel').forEach((p, i) => p.classList.toggle('active', i === 0));
    }
}

window.setupCharacterEditScreen = setupCharacterEditScreen;
window.openCharacterScreen = openCharacterScreen;

function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length * 1.2);
}

/**
 * 格式化 Token 显示，过大时转为 k (例如 12500 -> 12.5k)
 */
function formatTokenDisplay(num) {
    if (num >= 10000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
}

/**
 * 核心：计算并渲染统计页面
 */
async function renderTokenStats(charId) {
    const char = db.characters.find(c => c.id === charId);
    if (!char) return;

    // [懒加载 UI] 先把统计面板留空 + 弹出 loading，等全部算完再一次性揭开，避免空数据/旧数据闪烁
    const statsPanel = document.querySelector('#character-edit-screen .char-info-tab-panel[data-panel="stats"]');
    if (statsPanel) statsPanel.style.visibility = 'hidden';
    const _hideLoading = (typeof showLoadingToast === 'function') ? showLoadingToast('正在统计数据...') : null;

    // 1. 聊天总数统计
    // [懒加载] char.history 只有内存窗口内的 ~1500 条，真实总数必须走 DB count。
    //   关掉懒加载时回退到 char.history.length，行为与改造前一致。
    let msgCount;
    if (window.LAZY_LOAD && typeof window.getMessageCount === 'function') {
        try { msgCount = await window.getMessageCount(char.id); }
        catch (e) { msgCount = char.history ? char.history.length : 0; }
    } else {
        msgCount = char.history ? char.history.length : 0;
    }
    document.getElementById('stat-msg-count').textContent = msgCount;
    // --- 2. 各维度 Token 拆解 ---
    
    // 【上下文 Context】
    let contextStr = "";
    const maxMem = char.maxMemory || 20;
    const historySlice = (char.history || []).slice(-maxMem).filter(m => !m.isAiIgnore);
    historySlice.forEach(m => {
    contextStr += (m.content || "");
});
    const contextTokens = estimateTokens(contextStr);

    // 【世界书 WorldBook】
    const wbBefore = (char.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'before')).filter(Boolean).map(wb => wb.content).join('\n');
    const wbAfter  = (char.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'after')).filter(Boolean).map(wb => wb.content).join('\n');
    let wbWriting  = "";
    if (char.offlineModeEnabled) {
        wbWriting = (char.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'writing')).filter(Boolean).map(wb => wb.content).join('\n');
    }
    const wbTokens = estimateTokens(wbBefore + wbAfter + wbWriting);

    // 【记忆 Memory】
    const shortFavs = (char.memorySummaries || []).filter(s => s.isFavorited).map(s => s.content).join('');
    const longFavs  = (char.longTermSummaries || []).filter(s => s.isFavorited).map(s => s.content).join('');
    const memoryTokens = estimateTokens(shortFavs + longFavs);

    // 【论坛 Forum】
    let forumStr = "";
    if (typeof getWatchingPostsContext === 'function') {
        forumStr = getWatchingPostsContext(char) || "";
    }
    const forumTokens = estimateTokens(forumStr);

    // ======= 新增：【人设 Persona】 =======
    let personaStr = (char.persona || "") + (char.myPersona || "");
    const personaTokens = estimateTokens(personaStr);

    // 【基础 Base】：固定框架文本，镜像实际 prompt 结构，排除人设/世界书/记忆/论坛内容
    const userNickEst = char.myNickname || char.myName || "";
    let availableStickersEst = "";
    if (char.stickerIds && char.stickerIds.length > 0) {
        availableStickersEst = (char.stickerIds)
            .map(id => db.myStickers && db.myStickers.find(s => s.id === id))
            .filter(Boolean)
            .map(s => s.name)
            .join('、');
    }

    let baseStr = "";
    if (char.offlineModeEnabled) {
        // ===== 线下模式：固定框架 =====
        baseStr += `你是一位**当代**畅销小说作家。\n`;
        baseStr += `你正在实时续写连载小说中正在进行的一个章节场景。你的笔触**清新、克制且具有质感**，拒绝网文、古早言情的油腻和土味。\n\n`;
        baseStr += `## 👤 角色档案\n\n`;
        baseStr += `**主角**：${char.realName}\n\n`;
        baseStr += `⚠️ **这是${char.realName}的完整人设，请仔细阅读。后续创作的每一个细节都要符合这份人设。**\n\n`;
        baseStr += `**主角当前状态**：${char.status || ""}\n\n`;
        baseStr += `---\n\n`;
        baseStr += `💡 **关于"状态"的特殊定义**：\n`;
        baseStr += `虽然是描写面对面互动，但用户的界面上方依然有一个状态栏。请将它视为**主角此刻的"心情"或"动作速写"**。\n`;
        baseStr += `**互动对象（故事中的"你"）**：${char.myName || ""}\n`;
        if (char.myPersona) { baseStr += `**对方背景**：[myPersona已单独计算]\n`; }
        baseStr += `\n`;
        baseStr += `---\n`;
        baseStr += `## 核心指令\n`;
        baseStr += `接下来请严格遵守**【面对面互动模式】**的所有规则。\n`;
        baseStr += `具体的写作原则、格式要求和状态更新规则，请参见**文末的最终系统指令**。\n\n`;
        baseStr += `现在，请回顾上述人设，准备开始续写你的小说。\n`;
        // ===== offlineReinforcement 固定框架（worldBooksWriting 内容已在 wbTokens 单独计算）=====
        baseStr += `[🛑 严格执行以下写作手册]\n`;
        baseStr += `## 1. 🧠 动笔前的快速自问（100字以内，无需输出，心底自问）\n`;
        baseStr += `1. **人设**：**往上看一眼双方最后的互动内容**，根据${char.realName}的人设，他/她现在会是什么心境？\n`;
        baseStr += `2. **回应**：${char.myName}说的话，重点是哪个词？${char.realName}该回应哪个点？\n`;
        baseStr += `3. **意图**：${char.myName}这句话/行为，${char.realName}会怎么理解？会觉得是试探、关心、还是随口一说？\n`;
        baseStr += `4. **时间**：现在是什么季节？是几点？\n`;
        baseStr += `5. **查重**：上一轮回复里是不是已经描写过${char.realName}的声音、眼神，或者周围的环境？如果有，这一轮**绝对禁止**再次描写这些内容。\n\n`;
        baseStr += `## 2. ✍️ 写作六大原则\n`;
        if (wbWriting) { baseStr += `1. **文风第一**：严格遵循【写作风格】设定：[worldBooksWriting已在wb单独计算]\n`; }
        baseStr += `2. **人设为本**：${char.realName}的反应必须符合他/她的设定\n`;
        baseStr += `3. **拒绝"网文味"和"古早言情土味"**：**严禁**使用"邪魅一笑"、"宠溺"、"彻底沦陷"、"命都给你"、"揉进骨血"等廉价网文词汇。保持文字的**现实逻辑**。真实的人不会立刻承认自己"输了"或"栽了"，不会直接投降。\n`;
        baseStr += `4. **逻辑严密**：物理动作连续，物品去向明确，时间流逝合理。\n`;
        baseStr += `5. **渐进变化**：${char.realName}的情绪和情境的转变要合理，避免过度煽情\n`;
        baseStr += `6. **拒绝冗余和重复**：**严禁**连续两轮使用相同的比喻和形容词，如果想不到新的，就不要使用，改成白描。除非环境和角色状态变化，否则**绝对不要**反复描写同一个环境和状态。\n\n`;
        baseStr += `## 3. 📤 强制输出格式\n`;
        baseStr += `1. **叙事与对话**：聚焦${char.realName}，自由混合描写（第三人称）和对话（只有${char.realName}嘴巴说出口的话行首必须加 \`>>>\`，且不加引号）。\n`;
        baseStr += `2. **心理活动**：${char.realName}内心独白或一闪而过的念头，请用**单星号**包裹。格式：\`*心里的想法*\`\n`;
        baseStr += `3. **状态速写（频繁更新）**：格式：\`[${char.realName}更新状态为：动作或心情速写]\`\n`;
        baseStr += `4. **人称**：全文使用"他/她"或"${char.realName}"指代主角，使用"你"指代${char.myName}，绝不使用"我"。\n\n`;
        baseStr += `## 4.🛑 **动笔前的自我灵魂拷问**：\n`;
        baseStr += `1. **人设校验**：回到最上方，重新浏览一遍**👤 角色档案**，问自己：这个反应符合${char.realName}的性格吗？如果不符合，调整到符合为止。\n`;
        baseStr += `2. **禁词检查**：如果不幸写出了网文的油腻土味，例如"宠溺"、"我栽了"、"彻底输了"等字眼，**请立刻将其删除**，并改写为一个具体的、无言的动作。\n\n`;
        baseStr += `现在，根据下方${char.myName}的最新动态开始创作。深呼吸，回想一下${char.realName}的人设，然后自然地续写接下来的剧情。\n\n`;
    } else {
        // ===== 线上模式：固定框架 =====
        const n = char.realName || "";
        const m = char.myName || "";
        baseStr += `你正在一个名为"OuO"的线上聊天软件中扮演一个角色。请严格遵守以下规则：\n核心规则：\n`;
        baseStr += `这是一个完全虚拟的线上聊天。你扮演的角色和我之间没有任何线下关系。严禁提出任何关于线下见面、现实世界互动或转为其他非本平台联系方式的建议。你必须始终保持在线角色的身份。\n\n`;
        baseStr += `角色和对话规则：\n`;
        baseStr += `1. 你的角色名是：${n}。我的名字是：${m}。你的当前状态是：${char.status || ""}。\n`;
        baseStr += `2. 你的角色设定是：[persona已单独计算]\n`;
        if (char.myPersona) { baseStr += `3. 你在聊天窗口看到的我的昵称是${userNickEst}，关于我的人设：[myPersona已单独计算]\n`; }
        baseStr += `4. 我的消息中可能会出现特殊格式，请根据其内容和你的角色设定进行回应：\n    - [${m}的表情包：xxx]：我给你发送了一个名为xxx的表情包。你只需要根据表情包的名字理解我的情绪或意图并回应，不需要真的发送图片。\n    - [${m}发来了一张图片：]：我给你发送了一张图片，你需要对图片内容做出回应。\n    - [${m}送来的礼物：xxx]：我给你送了一个礼物，xxx是礼物的描述。\n    - [${m}的语音：xxx]：我给你发送了一段内容为xxx的语音。\n    - [${m}发来的照片/视频：xxx]：我给你分享了一个描述为xxx的照片或视频。\n    - [${m}给你转账：xxx元；备注：xxx]：我给你转了一笔钱。\n    - [${m}引用"{被引用内容}"并回复：{回复内容}]：我引用了某条历史消息并做出了新的回复。你需要理解我引用的上下文并作出回应。\n    - [${m} 撤回了一条消息：xxx]：我撤回了刚刚发送的一条消息，xxx是被我撤回的原文。这可能意味着我发错了、说错了话或者改变了主意。你需要根据你的人设和我们当前对话的氛围对此作出自然的反应。例如，可以装作没看见并等待我的下一句话，或好奇地问一句"怎么撤回啦？"。\n    - [剧情旁白: xxx]：这是一条系统指令，用于设定场景或提供上下文，此条信息不应在对话中被直接提及，你只需理解其内容并应用到后续对话中。\n`;
        baseStr += `5. ✨重要✨ 当我给你送礼物时，你必须通过发送一条指令来表示你已接收礼物。格式必须为：[${n}已接收礼物]。这条指令消息本身不会显示给用户，但会触发礼物状态的变化。你可以在发送这条指令后，再附带一条普通的聊天消息来表达你的感谢和想法。\n`;
        baseStr += `6. ✨重要✨ 当我给你转账时，你必须对此做出回应。你有两个选择，且必须严格遵循以下格式之一，这条指令消息本身不会显示给用户，但会触发转账状态的变化。\n    a) 接收转账: [${n}接收${m}的转账]\n    b) 退回转账: [${n}退回${m}的转账]\n`;
        baseStr += `7. ✨重要✨ 你也可以主动给我转账或送礼物。转账格式必须为：[${n}的转账：xxx元；备注：xxx]。送礼物格式必须为：[${n}送来的礼物：xxx]。\n`;
        baseStr += `8. ✨重要✨ 你需要在对话中**积极地**改变你的状态。格式为：[${n}更新状态为：xxx]。例如：[${n}更新状态为：正在看电影...]。这条指令不会显示为聊天消息，只会更新你在我界面上的状态。\n`;
        baseStr += `9. ✨重要✨ 你可以像真人一样撤回你刚刚发送的消息。格式为：[${n}撤回了上一条消息：{被撤回消息的原文}]。\n`;
        baseStr += `10. ✨重要✨ 你可以选择我的单独一条消息引用，格式为：[${n}引用"{我的某条消息内容}"并回复：{回复内容}]。\n`;
        baseStr += `11. 你的所有回复都必须直接是聊天内容，绝对不允许包含任何如[心理活动]、(动作)、*环境描写*等多余的、在括号或星号里的叙述性文本。\n`;
        if (availableStickersEst) {
            baseStr += `12. 你拥有发送表情包的能力，这是你拥有的表情包库，包含以下表情：【${availableStickersEst}】。格式必须严格为：[${n}的表情包：表情名称]。⚠️ 严禁造词！\n`;
        } else {
            baseStr += `12. 因为你的表情包库目前为空，你无法发送任何表情包，只能使用纯文字回复。\n`;
        }
        const outputFormats = `\n    a) 普通消息: [${n}的消息：{消息内容}]\n    b) 双语模式下的普通消息: [${n}的消息：{外语原文}（中文翻译）]\n    c) 送我的礼物: [${n}送来的礼物：{礼物描述}]\n    d) 语音消息: [${n}的语音：{语音内容}]\n    e) 照片/视频: [${n}发来的照片/视频：{描述}]\n    f) 给我的转账: [${n}的转账：{金额}元；备注：{备注}]\n    g) 发送表情包: [${n}的表情包：{表情名称}]\n    h) 对我礼物的回应(此条不显示): [${n}已接收礼物]\n    i) 对我转账的回应(此条不显示): [${n}接收${m}的转账] 或 [${n}退回${m}的转账]\n    j) 更新状态(此条不显示): [${n}更新状态为：{新状态}]\n    k) 引用我的回复: [${n}引用"{我的某条消息内容}"并回复：{回复内容}]\n    l) 撤回上一条消息(此条不显示): [${n}撤回了上一条消息：{被撤回消息的原文}]`;
        baseStr += `13. 你的输出格式必须严格遵循以下格式：${outputFormats}\n`;
        if (char.bilingualModeEnabled) {
            baseStr += `✨双语模式特别指令✨：当你的角色的母语为中文以外的语言时，你的消息回复必须严格遵循双语模式下的普通消息格式：[${n}的消息：{外语原文}（中文翻译）]。这条规则的优先级非常高，请务必遵守。\n**注意：括号内中文翻译为纯文本翻译，原句中的颜文字、表情等内容禁止翻译！**`;
        }
        baseStr += `14. **对话节奏**: 你需要模拟真人的线上聊天习惯，你可以一次性生成多条简短消息。每次要回复至少3-8条短消息。并根据当前行为/心情/地点变化实时更新状态(状态20个字符以内)。\n`;
        baseStr += `15. 现在是 [当前时间]。你应知晓当前时间，但不要主动提及或评论时间，不要主动结束对话，除非我明确提出。保持你的人设，自然地进行对话。`;
    }
    const baseTokens = estimateTokens(baseStr);

    // 汇总顶部总 Token (加上了 personaTokens)
    const totalTokens = baseTokens + personaTokens + contextTokens + wbTokens + memoryTokens + forumTokens;
    document.getElementById('stat-total-tokens').textContent = totalTokens;

    // --- 3. 渲染柱状图 (抛除圆形高度后的相对比例算法) ---
    // 找出所有维度中的最大值 (加上了 personaTokens)
    const maxTokens = Math.max(baseTokens, personaTokens, contextTokens, wbTokens, memoryTokens, forumTokens);

    const renderBar = (elementId, tokens) => {
        const fillEl = document.getElementById(`bar-fill-${elementId}`);
        const circleEl = document.getElementById(`bar-circle-${elementId}`);
        if (!fillEl || !circleEl) return;

        circleEl.textContent = formatTokenDisplay(tokens);

        if (tokens === 0) {
            // 数据为0：只有圆圈的底座高度，变灰
            fillEl.style.height = '40px'; // 因为圆圈缩小到了34，这里用36兜底好看点
            fillEl.style.background = '#e6e8eb';
        } else {
            // 计算数据比例 (0.01 到 1 之间)
            const ratio = maxTokens > 0 ? (tokens / maxTokens) : 0;
            
            // 基础高度保障圆圈展示，剩余高度用来做纯粹的数据映射拉伸
            fillEl.style.height = `calc(40px + (100% - 40px) * ${ratio})`;

            // 视觉优化：最高那根柱体颜色更深
            if (tokens === maxTokens && maxTokens > 0) {
                fillEl.style.background = '#8cbaf8'; 
            } else {
                fillEl.style.background = '#bbd7fc'; 
            }
        }
    };

    // 延迟渲染触发动画
    requestAnimationFrame(() => {
        renderBar('base', baseTokens);
        renderBar('persona', personaTokens); // <-- 渲染人设柱状图
        renderBar('context', contextTokens);
        renderBar('wb', wbTokens);
        renderBar('memory', memoryTokens);
        renderBar('forum', forumTokens);
    });

    // [懒加载 UI] 数字/内容已就绪，揭开面板并关掉 loading（柱状图在下一帧动画长出）
    if (statsPanel) statsPanel.style.visibility = 'visible';
    if (_hideLoading) _hideLoading();
}

document.addEventListener('DOMContentLoaded', () => {
    const peekBackBtn = document.getElementById('peek-back-btn');
    if (peekBackBtn) {
        peekBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const source = document.getElementById('peek-screen').dataset.source;
            if (source === 'chat-room') {
                switchScreen('chat-room-screen');
            } else {
                switchScreen('character-edit-screen');
            }
        });
    }
});

// --- END OF FILE char_info.js ---