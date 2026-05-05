
// ==========================================
// peek_drafts.js
// 草稿箱：多条增量存储、列表页、详情页
//
// 数据结构（peekContentCache['drafts']）：
//   {
//     items: [
//       { id, to, content, createdAt, isNew }  // createdAt: ISO 字符串, isNew: 是否为新生成
//     ]
//   }
//
// 向后兼容：检测到旧格式 .draft（单条对象）时自动迁移为 items 数组。
// ==========================================


// ==========================================
//  迁移工具：旧格式 → 新格式（只执行一次）
// ==========================================
function _migrateDraftsCacheIfNeeded() {
    const cache = peekContentCache['drafts'];
    if (!cache) {
        // 初始化空缓存
        peekContentCache['drafts'] = { items: [] };
        return;
    }
    // 旧格式：有 .draft 字段而无 .items
    if (cache.draft && !cache.items) {
        const oldDraft = cache.draft;
        cache.items = [{
            id: 'draft_migrated_' + Date.now(),
            to: oldDraft.to || '',
            content: oldDraft.content || '',
            createdAt: new Date().toISOString()
        }];
        delete cache.draft;
    }
    // 兜底：确保 items 始终是数组
    if (!Array.isArray(cache.items)) {
        cache.items = [];
    }
}


// ==========================================
//  列表页渲染 (替换原函数)
// ==========================================
function renderPeekDraftsList() {
    _migrateDraftsCacheIfNeeded();

    const items       = peekContentCache['drafts'].items;
    const list        = document.getElementById('peek-drafts-list');
    const placeholder = document.getElementById('peek-drafts-placeholder');
    if (!list) return;

    // 获取当前是否处于删除多选模式
    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'drafts';

    if (!items || items.length === 0) {
        placeholder.classList.add('visible');
        list.style.display = 'none';
        return;
    }

    placeholder.classList.remove('visible');
    list.style.display = 'flex';
    list.innerHTML = '';

    const iconSvg = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M8.96173 18.9109L9.42605 18.3219L8.96173 18.9109ZM12 5.50063L11.4596 6.02073C11.601 6.16763 11.7961 6.25063 12 6.25063C12.2039 6.25063 12.399 6.16763 12.5404 6.02073L12 5.50063ZM15.0383 18.9109L15.5026 19.4999L15.0383 18.9109ZM9.42605 18.3219C7.91039 17.1271 6.25307 15.9603 4.93829 14.4798C3.64922 13.0282 2.75 11.3345 2.75 9.1371H1.25C1.25 11.8026 2.3605 13.8361 3.81672 15.4758C5.24723 17.0866 7.07077 18.3752 8.49742 19.4999L9.42605 18.3219ZM2.75 9.1371C2.75 6.98623 3.96537 5.18252 5.62436 4.42419C7.23607 3.68748 9.40166 3.88258 11.4596 6.02073L12.5404 4.98053C10.0985 2.44352 7.26409 2.02539 5.00076 3.05996C2.78471 4.07292 1.25 6.42503 1.25 9.1371H2.75ZM8.49742 19.4999C9.00965 19.9037 9.55954 20.3343 10.1168 20.6599C10.6739 20.9854 11.3096 21.25 12 21.25V19.75C11.6904 19.75 11.3261 19.6293 10.8736 19.3648C10.4213 19.1005 9.95208 18.7366 9.42605 18.3219L8.49742 19.4999ZM15.5026 19.4999C16.9292 18.3752 18.7528 17.0866 20.1833 15.4758C21.6395 13.8361 22.75 11.8026 22.75 9.1371H21.25C21.25 11.3345 20.3508 13.0282 19.0617 14.4798C17.7469 15.9603 16.0896 17.1271 14.574 18.3219L15.5026 19.4999ZM22.75 9.1371C22.75 6.42503 21.2153 4.07292 18.9992 3.05996C16.7359 2.02539 13.9015 2.44352 11.4596 4.98053L12.5404 6.02073C14.5983 3.88258 16.7639 3.68748 18.3756 4.42419C20.0346 5.18252 21.25 6.98623 21.25 9.1371H22.75ZM14.574 18.3219C14.0479 18.7366 13.5787 19.1005 13.1264 19.3648C12.6739 19.6293 12.3096 19.75 12 19.75V21.25C12.6904 21.25 13.3261 20.9854 13.8832 20.6599C14.4405 20.3343 14.9903 19.9037 15.5026 19.4999L14.574 18.3219Z" fill="currentColor"/>
</svg>`;

    // 倒序：最新草稿排在最前
    [...items].reverse().forEach(draft => {
        const li = document.createElement('li');
        
        // 动态添加编辑模式和选中状态的 class
        const isSelected = isEdit && PeekDeleteManager.selectedIds.has(draft.id);
        li.className  = `draft-card-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}`;
        li.dataset.id = draft.id;

        // 处理标题: 未命名_YYYY_MM_DD
        const d = new Date(draft.createdAt);
        const yyyy = d.getFullYear();
        const mm   = _pad2(d.getMonth() + 1);
        const dd   = _pad2(d.getDate());
        const titleStr = `未命名_${yyyy}_${mm}_${dd}`;
        
        // 检测 new 标记
        const newBadgeStr = draft.isNew ? '<span class="peek-new-badge">new!</span>' : '';

        // 处理副标题: 去掉 HTML 标签后截取前10个字
        const plainText   = draft.content.replace(/<[^>]*>/g, '').trim();
        const previewText = plainText.slice(0, 10);
        const previewStr  = previewText + (plainText.length > 10 ? '…' : '');

        li.innerHTML = `
            <div class="draft-card-icon-wrapper">
                <div class="draft-card-paper">${iconSvg}</div>
            </div>
            <div class="draft-card-content">
                <div class="draft-card-title">${_escHtml(titleStr)} ${newBadgeStr}</div>
                <div class="draft-card-subtitle">Draft · ${_escHtml(previewStr)}</div>
            </div>
        `;
        list.appendChild(li);
    });

    // 绑定长按删除（注意第二个参数修改为新的卡片类名）
    PeekDeleteManager.attachLongPress(
        list,
        '.draft-card-item',
        'drafts',
        'items',
        renderPeekDraftsList
    );
}

// ==========================================
//  点击列表项：找到对应草稿 → 打开详情 (替换原函数)
// ==========================================
function _onDraftItemClick(e) {
    if (PeekDeleteManager.isEditMode) return;
    // 将原先的 .chat-item 改为新的 .draft-card-item
    const li = e.target.closest('.draft-card-item');
    if (!li) return;
    const draftId = li.dataset.id;
    const draft = (peekContentCache['drafts']?.items || []).find(d => d.id === draftId);
    if (draft) {
        // 处理查阅消除 new! 标记
        if (draft.isNew) {
            draft.isNew = false;
            savePeekData(window.activePeekCharId);
            const badge = li.querySelector('.peek-new-badge');
            if (badge) badge.remove();
        }
        renderPeekDraftDetail(draft);
    }
}

// ==========================================
//  详情页渲染
// ==========================================
function renderPeekDraftDetail(draft) {
    const dateEl    = document.getElementById('draft-detail-date');
    const toEl      = document.getElementById('draft-detail-to');
    const contentEl = document.getElementById('draft-detail-content');
    if (!dateEl || !toEl || !contentEl) return;

    // header 标题显示日期
    const d = new Date(draft.createdAt);
    dateEl.textContent = `${d.getMonth() + 1}/${d.getDate()} 的草稿`;

    toEl.textContent  = `To: ${draft.to}`;
    contentEl.innerHTML = draft.content;   // content 含 <span class="strikethrough"> 等标签，需 innerHTML

    switchScreen('peek-draft-detail-screen');
}


// ==========================================
//  生成新草稿（点击 + 按钮）
// ==========================================
async function generateAndRenderPeekDrafts() {
    const appType = 'drafts';

    if (generatingPeekApps.has(appType)) {
        showToast('草稿箱内容正在生成中，请稍候...');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model, streamEnabled, temperature } = getPeekApiConfig(char.id);
    if (!url || !key || !model) {
        showToast('请先配置 API！');
        return switchScreen('api-settings-screen');
    }

    generatingPeekApps.add(appType);

    // 先切到列表页（让用户看到 loading），不需要跳到详情
    switchScreen('peek-drafts-screen');
    const hideLoading = showLoadingToast('正在生成草稿...');

    try {
        _migrateDraftsCacheIfNeeded();

        const peekSettings  = char.peekScreenSettings || {};
        const limitCount    = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0
            ? historyToPlainText(char.history.slice(-limitCount))
            : '';

        const senderName       = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机草稿箱。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `
【任务1：草稿内容】
请结合最近的聊天上下文，生成一份 ${char.realName} 写给${char.myName}，但犹豫未决、未发送的消息草稿。内容要深刻、细腻，反映${char.realName}的内心挣扎、真实情感和与${char.myName}的关系。
可以使用HTML的<span class='strikethrough'></span>标签来表示写了又删掉（划掉）的文字。
你需要生成收件人(#TO#)和草稿正文(#CONTENT#)。

【任务2：话题分享】
在草稿生成完毕后，请结合草稿中的情绪或未说出口的话，预测一下，在未来的某个时间，${senderName}最终鼓起勇气，或者换了一种相对轻松/隐晦的方式，把相关的心意或话题发给${char.myName}开启对话。
`;
        systemPrompt += getPeekProactiveFormatPrompt(char);
        systemPrompt += `
请严格按照以下标签文本格式输出。在草稿内容结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#TO#
${char.myName}
#CONTENT#
一封写给${char.myName}但未发送的草稿内容，可以使用HTML的<span class='strikethrough'></span>标签来表示划掉的文字。
===PROACTIVE_MESSAGES===
#SECRET_CHAT_NIGHT_85%#[23:15|${senderName}的消息:睡了吗？][23:16|${senderName}的消息:今天又路过那家店，突然有点想你。]
`;

        const contentStr = await callPeekApi({ url, key, model, messages: [{ role: 'user', content: systemPrompt }], temperature, streamEnabled });

        const parts          = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const draftsRawText  = parts[0] || '';
        const hitchhikerRaw  = parts.length > 1 ? parts[1] : '';

        const toMatch      = draftsRawText.match(/#TO#\s*([\s\S]*?)(?=#CONTENT#|$)/i);
        const contentMatch = draftsRawText.match(/#CONTENT#\s*([\s\S]*?)$/i);

        if (toMatch && contentMatch) {
            const newDraft = {
                id:        'draft_' + Date.now(),
                to:        toMatch[1].trim(),
                content:   contentMatch[1].trim(),
                createdAt: new Date().toISOString(),
                isNew:     true  // <- 赋予新生成草稿标签
            };

            // 追加到数组（增量，不覆盖旧条目）
            peekContentCache['drafts'].items.push(newDraft);

            await savePeekData(char.id);

            // 刷新列表
            renderPeekDraftsList();
            showToast('新草稿已生成！');
        } else {
            throw new Error('解析草稿内容失败，未找到对应标签。');
        }

        if (hitchhikerRaw.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRaw);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        showToast('生成失败: ' + error.message);
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading();
    }
}


// ==========================================
//  初始化草稿箱事件（在 initPeekEventListeners 末尾调用）
// ==========================================
function initPeekDraftsEvents() {
    // 生成按钮
    document.getElementById('refresh-drafts-btn')
        ?.addEventListener('click', generateAndRenderPeekDrafts);

    // 列表点击 → 详情
    document.getElementById('peek-drafts-list')
        ?.addEventListener('click', _onDraftItemClick);
}


// ==========================================
//  进入草稿箱的入口（供 peek_core.js 调用，替换原 generateAndRenderPeekDrafts）
// ==========================================
function openPeekDraftsScreen() {
    _migrateDraftsCacheIfNeeded();
    renderPeekDraftsList();
    switchScreen('peek-drafts-screen');
}


// ==========================================
//  工具函数（模块内私有）
// ==========================================
function _pad2(n) { return String(n).padStart(2, '0'); }

function _escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
