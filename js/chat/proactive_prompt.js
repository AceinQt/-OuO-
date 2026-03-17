// --- proactive_prompt.js ---

/**
 * 私聊主动消息专用 Prompt
 */
function generateProactivePrivatePrompt(character) {
    const worldBooksBefore = (character.worldBookIds ||[]).map(id => typeof db !== 'undefined' && db.worldBooks ? db.worldBooks.find(wb => wb.id === id && wb.position === 'before') : null).filter(Boolean).map(wb => wb.content).join('\n');
    const worldBooksAfter = (character.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'after')).filter(Boolean).map(wb => wb.content).join('\n');
    const worldBooksWriting = (character.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'writing')).filter(Boolean).map(wb => wb.content).join('\n');
    
    const now = new Date();
    const pad = (n) => n < 10 ? '0' + n : n;
    const weekDays =['日', '一', '二', '三', '四', '五', '六'];
    const currentWeekDay = weekDays[now.getDay()];
    const currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 星期${currentWeekDay} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    
    let availableStickers = "";
    if (character.stickerIds && character.stickerIds.length > 0 && typeof db !== 'undefined' && db.myStickers) {
        availableStickers = character.stickerIds
            .map(id => db.myStickers.find(s => s.id === id))
            .filter(Boolean)
            .map(s => s.name)
            .join('、');
    }

    const userNick = character.myNickname || character.myName;
    
    // 注入回忆
    let allFavs = "";
    if (character.memorySummaries || character.longTermSummaries) {
        const shortFavs = (character.memorySummaries ||[]).filter(s => s.isFavorited).map(s => `[回忆] ${s.title}\n${s.content}`);
        const longFavs = (character.longTermSummaries || []).filter(s => s.isFavorited).map(s => `[长期历史] ${s.title}\n${s.content}`);
        allFavs =[...longFavs, ...shortFavs].join('\n\n');
    }

    // 🌟 线下模式（面对面互动）
    if (character.offlineModeEnabled) {
        let prompt = `你正在扮演角色“${character.realName}”。\n`;
        prompt += `背景：你和“${character.myName}”现在处于同一个物理空间，现在你需要根据上下文主动发起互动。\n\n`;
        
        prompt += `## 👤 角色档案\n**主角**：${character.realName}\n**人设**：${character.persona}\n**当前状态**：${character.status}\n\n`;
        if (worldBooksBefore) prompt += `**世界观**：\n${worldBooksBefore}\n\n`;
        if (allFavs) prompt += `**重要记忆**：\n${allFavs}\n\n`;
        prompt += `**互动对象**：${character.myName}\n`;
        if (character.myPersona) prompt += `**对方背景**：${character.myPersona}\n\n`;
        
        if (worldBooksAfter) prompt += `**重要事项**：\n${worldBooksAfter}\n\n`;
        
        prompt += `## 💡 线下模式专用格式（必须严格遵循前缀）：\n`;
        prompt += `线下互动直接描写物理动作和说话内容，不再使用手机聊天的格式。为了让系统能切割并按顺序发送，你的每一条行为都必须使用以下分类前缀包裹：\n`;
        prompt += `1. 旁白描写:[HH:MM|${character.realName}的动作: 描写角色的物理动作或神态，例如“他凑近看了看你，伸手敲了敲桌子”]\n`;
        prompt += `2. 角色说话:[HH:MM|${character.realName}的语言: 说出口的具体台词，例如“你在发呆吗？”]\n`; 
        if (worldBooksWriting) prompt += `3. 写作指导：\n${worldBooksWriting}\n\n`;       
        return prompt;
    }

    // 📱 线上正常模式
    let prompt = `你正在一个名为“404”的线上聊天软件中扮演一个角色“${character.realName}”。\n`;
    prompt += `请你根据当前时间和情境，主动给我（${character.myName}）发消息。\n`;
    prompt += `当前时间是：${currentTime}\n\n`;
    
    prompt += `## 👤 角色档案\n**你的名字**：${character.realName}\n**人设**：${character.persona}\n**当前状态**：${character.status}\n\n`;
    if (worldBooksBefore) prompt += `${worldBooksBefore}\n\n`;
    if (allFavs) prompt += `**重要记忆**：\n${allFavs}\n\n`;
    prompt += `**我的名字**：${character.myName} (你看到的昵称是${userNick})\n`;
    if (character.myPersona) prompt += `**我的人设**：${character.myPersona}\n\n`;
    
    if (worldBooksAfter) prompt += `**重要事项**：\n${worldBooksAfter}\n\n`;

    prompt += `## 💡 支持的主动消息格式 (必须严格使用对应前缀):\n`;
    prompt += `请结合情境，使用文本、照片、语音甚至表情包来丰富你的主动互动。这很重要，为了让系统识别，每条消息必须包含对应格式的前缀：\n`;
    prompt += `a) 普通文字:[HH:MM|${character.realName}的消息: 文字内容]\n`;
    if (availableStickers) {
        prompt += `b) 发送表情包:[HH:MM|${character.realName}的表情包: 表情名称] (⚠️ 严禁造词，仅限使用：【${availableStickers}】)\n`;
    } else {
        prompt += `b) (当前你没有可用表情包，请勿发送表情包)\n`;
    }
    prompt += `c) 发送照片/视频:[HH:MM|${character.realName}发来的照片/视频:照片画面的详细描述]\n`;
    prompt += `d) 发送语音:[HH:MM|${character.realName}的语音:语音转述的文字内容]\n`;
    prompt += `e) 你可以撤回刚刚发送的消息。当你觉得说错了话、感到尴尬、或者只是改变了主意时，都可以这样做。这是一个体现你角色性格的机会。格式为：[HH:MM|${character.realName}撤回了上一条消息:被撤回消息的原文]。\n`;   
    prompt += `f) 你也可以主动给我转账或送礼物。转账格式必须为：[HH:MM|${character.realName}的转账:xxx元；备注：xxx]。送礼物格式必须为：[HH:MM|${character.realName}送来的礼物:xxx]。\n\n`;
    
    prompt += `你可以只发消息给我，也可以根据上下文情况混合使用这些格式，比如先发一张照片，再发几条文字消息，或者中途发一个表情包戳我。\n`;
    return prompt;
}

/**
 * 群聊主动消息专用 Prompt
 */
function generateProactiveGroupPrompt(group) {
    const worldBooksBefore = (group.worldBookIds ||[]).map(id => typeof db !== 'undefined' && db.worldBooks ? db.worldBooks.find(wb => wb.id === id && wb.position === 'before') : null).filter(Boolean).map(wb => wb.content).join('\n');
    const worldBooksAfter = (group.worldBookIds ||[]).map(id => typeof db !== 'undefined' && db.worldBooks ? db.worldBooks.find(wb => wb.id === id && wb.position === 'after') : null).filter(Boolean).map(wb => wb.content).join('\n');
    
    let myRealName = group.me.realName || group.me.nickname;
    let myPersona = group.me.persona;
    if (group.boundPersonaId && typeof db !== 'undefined' && db.userPersonas) {
        const p = db.userPersonas.find(up => up.id === group.boundPersonaId);
        if (p) { myRealName = p.realName; myPersona = p.persona; }
    }

    let prompt = `你正在一个名为“404”的聊天软件中运行【群聊主动触发机制】。\n`;
    prompt += `背景：你正在同时扮演群聊“${group.name}”中的【所有 AI 成员】。你需要模拟群成员们在群内自发聊天、水群的场景。\n\n`;
    
    if (worldBooksBefore) prompt += `群聊世界观：${worldBooksBefore}\n\n`;

    prompt += `## 👥 群成员列表及设定：\n`;
    if (group.members) {
        group.members.forEach(member => {
            let realName = member.realName;
            let persona = member.persona;
            let availableStickers = "";
            if (member.originalCharId && typeof db !== 'undefined' && db.characters) {
                const originalChar = db.characters.find(c => c.id === member.originalCharId);
                if (originalChar) {
                    realName = originalChar.realName;
                    persona = originalChar.persona;
                    if (originalChar.stickerIds && originalChar.stickerIds.length > 0 && typeof db !== 'undefined' && db.myStickers) {
                        availableStickers = originalChar.stickerIds.map(id => db.myStickers.find(s => s.id === id)).filter(Boolean).map(s => s.name).join('、');
                    }
                }
            }
            prompt += `- **${realName}**: ${persona || '无特定人设'}\n`;
            if (availableStickers) prompt += `[该成员可用表情包]: ${availableStickers}\n`;
        });
    }

    if (worldBooksAfter) prompt += `重要事项说明：${worldBooksAfter}\n\n`;
    
    prompt += `\n## 💡 支持的主动消息格式 (必须严格遵守):\n`;
    prompt += `你需要模拟不同成员之间的对话和互动，每条消息必须标明是谁发出的以及消息类型：\n`;
    prompt += `a) 普通文字: [HH:MM|{成员真名}的消息: 文字内容]\n`;
    prompt += `b) 发送表情包:[HH:MM|{成员真名}的表情包: 表情名称] (⚠️ 该成员只能使用其上方列表对应的可用表情包，严禁造词)\n`;
    prompt += `c) 照片/视频:[HH:MM|{成员真名}发来的照片/视频: 画面描述]\n`;
    prompt += `d) 语音:[HH:MM|{成员真名}的语音: 语音文字]\n`;
    prompt += `e) 群成员可以撤回刚刚发送的消息。当觉得说错了话、感到尴尬、或者只是改变了主意时，都可以这样做。这是一个体现角色性格的机会。格式为：[HH:MM|{成员真名}撤回了上一条消息:被撤回消息的原文]。\n`;   
    prompt += `f) 群成员可以主动给我转账或送礼物。转账格式必须为：[HH:MM|{成员真名}的转账:xxx元；备注：xxx]。送礼物格式必须为：[HH:MM|{成员真名}送来的礼物:xxx]。\n\n`;    
    prompt += `在同一个时段组内，你可以让一个成员先抛出话题或图片，其他成员自然接话，呈现出自然的群聊氛围！\n`;
    
    return prompt;
}