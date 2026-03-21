// ==========================================
// peek_drafts.js
// 草稿箱渲染、草稿箱生成
// ==========================================

function renderPeekDrafts(draft) {
    const screen = document.getElementById('peek-drafts-screen');
    let draftTo = '...';
    let draftContent = '<p class="placeholder-text">正在生成草稿...</p>';

    if (draft) {
        draftTo = draft.to;
        draftContent = draft.content;
    }

    screen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-screen">‹</button>
            <div class="title-container"><h1 class="title">草稿箱</h1></div>
            <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
        </header>
        <main class="content">
            <div class="draft-paper">
                <div class="draft-to">To: ${draftTo}</div>
                <div class="draft-content">${draftContent}</div>
            </div>
        </main>
    `;

    screen.querySelector('.action-btn').addEventListener('click', () => generateAndRenderPeekDrafts({ forceRefresh: true }));
}

async function generateAndRenderPeekDrafts(options = {}) {
    const appType = 'drafts';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) { showToast('草稿箱内容正在生成中，请稍候...'); return; }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekDrafts(peekContentCache[appType].draft);
        switchScreen('peek-drafts-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    generatingPeekApps.add(appType);
    switchScreen('peek-drafts-screen');
    const hideLoading = showLoadingToast('正在生成草稿...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";

        const senderName = char.realName || char.name;
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

        const requestBody = { model: model, messages: [{ role: 'user', content: systemPrompt }], temperature: 0.85 };
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        const contentStr = result.choices[0].message.content.trim();

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const draftsRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const toMatch = draftsRawText.match(/#TO#\s*([\s\S]*?)(?=#CONTENT#|$)/i);
        const contentMatch = draftsRawText.match(/#CONTENT#\s*([\s\S]*?)$/i);

        if (toMatch && contentMatch) {
            const parsedDraft = {
                draft: {
                    to: toMatch[1].trim(),
                    content: contentMatch[1].trim()
                }
            };

            peekContentCache['drafts'] = parsedDraft;
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekDrafts(parsedDraft.draft);
        } else {
            throw new Error("解析草稿内容失败，未找到对应标签。");
        }

        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['drafts']?.draft) {
            renderPeekDrafts(peekContentCache['drafts'].draft);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            const screen = document.getElementById('peek-drafts-screen');
            if (screen) {
                const draftContentEl = screen.querySelector('.draft-content');
                if (draftContentEl) draftContentEl.innerHTML = `<p class="placeholder-text" style="color:#ff4d4f;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></p>`;
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading();
    }
}
