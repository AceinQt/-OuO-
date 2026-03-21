// ==========================================
// peek_steps.js
// 步数渲染、步数生成
// ==========================================

function renderPeekSteps(data) {
    const screen = document.getElementById('peek-steps-screen');
    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return;

    const avatarEl = screen.querySelector('#steps-char-avatar');
    const nameEl = screen.querySelector('#steps-char-name');
    const currentStepsEl = screen.querySelector('#steps-current-count');
    const goalStepsEl = screen.querySelector('.steps-label');
    const progressRingEl = screen.querySelector('#steps-progress-ring');
    const trackListEl = screen.querySelector('#activity-track-list');
    const annotationEl = screen.querySelector('#steps-annotation-content');

    avatarEl.src = char.avatar;
    nameEl.textContent = char.realName;
    goalStepsEl.textContent = '/ 6000 步';

    if (!data) {
        currentStepsEl.textContent = '----';
        trackListEl.innerHTML = '<li class="activity-track-item">正在生成活动轨迹...</li>';
        annotationEl.textContent = '正在生成角色批注...';
        progressRingEl.style.setProperty('--steps-percentage', 0);
        return;
    }

    currentStepsEl.textContent = data.currentSteps;
    const percentage = (data.currentSteps / 6000) * 100;
    progressRingEl.style.setProperty('--steps-percentage', percentage);
    trackListEl.innerHTML = data.trajectory.map(item => `<li class="activity-track-item">${item}</li>`).join('');
    annotationEl.textContent = data.annotation;
}

async function generateAndRenderPeekSteps(options = {}) {
    const appType = 'steps';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) { showToast('步数内容正在生成中，请稍候...'); return; }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekSteps(peekContentCache[appType]);
        switchScreen('peek-steps-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    generatingPeekApps.add(appType);
    switchScreen('peek-steps-screen');
    const hideLoading = showLoadingToast('正在生成步数记录...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";

        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机记步应用。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `
【任务1：步数与轨迹数据】
请为 ${char.realName} 生成今天的步数信息。你只需要生成Ta的当前步数(CURRENT_STEPS)，Ta的6条运动轨迹(TRAJECTORY)（禁止照搬示例）以及批注(ANNOTATION)。内容需要与${char.realName}的人设和最近聊天上下文高度相关。

【任务2：话题分享】
在步数信息生成完毕后，请结合这部分内容，预测一下，在未来的某个时间，${senderName}会主动把这个情况分享/发消息给${char.myName}，并开启话题。
`;
        systemPrompt += getPeekProactiveFormatPrompt(char);
        systemPrompt += `
请严格按照以下标签文本格式输出。在步数信息结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#CURRENT_STEPS#
8102
#TRAJECTORY#
08:30 AM - 公司楼下咖啡馆
10:00 AM - 宠物用品店
12:00 PM - 附近日料店
03:00 PM - 回家路上的甜品店
04:00 PM - 楼下的便利店
06:30 PM - 健身房
#ANNOTATION#
角色对自己今天运动情况的批注
===PROACTIVE_MESSAGES===
#SECRET_CHAT_EVENING_85%#[19:15|${senderName}的消息:最近一直在健身～][19:16|${senderName}的消息:感觉隐约有点儿肌肉了][19:16|${senderName}发来的照片/视频:手臂照片][19:16|${senderName}的消息:你看是不是？]
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
        const stepsRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const stepsMatch = stepsRawText.match(/#CURRENT_STEPS#\s*(\d+)/i);
        const trajMatch = stepsRawText.match(/#TRAJECTORY#\s*([\s\S]*?)(?=#ANNOTATION#|$)/i);
        const annoMatch = stepsRawText.match(/#ANNOTATION#\s*([\s\S]*?)$/i);

        if (stepsMatch && trajMatch) {
            const parsedSteps = {
                currentSteps: parseInt(stepsMatch[1].trim(), 10),
                trajectory: trajMatch[1].trim().split('\n').map(s => s.trim()).filter(Boolean),
                annotation: annoMatch ? annoMatch[1].trim() : '无批注'
            };

            peekContentCache['steps'] = parsedSteps;
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekSteps(parsedSteps);
        } else {
            throw new Error("解析步数内容失败，未找到对应标签。");
        }

        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['steps']) {
            renderPeekSteps(peekContentCache['steps']);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            const screen = document.getElementById('peek-steps-screen');
            if (screen) {
                const currentStepsEl = screen.querySelector('#steps-current-count');
                const trackListEl = screen.querySelector('#activity-track-list');
                const annotationEl = screen.querySelector('#steps-annotation-content');
                if (currentStepsEl) currentStepsEl.textContent = '错误';
                if (trackListEl) trackListEl.innerHTML = `<li class="activity-track-item" style="color:#ff4d4f;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></li>`;
                if (annotationEl) annotationEl.textContent = '生成失败';
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading();
    }
}
