function generateGroupSystemPrompt(group) {
    const worldBooksBefore = (group.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'before')).filter(Boolean).map(wb => wb.content).join('\n');
    const worldBooksAfter = (group.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'after')).filter(Boolean).map(wb => wb.content).join('\n');

    let prompt = `你正在一个名为“404”的线上聊天软件中，在一个名为“${group.name}”的群聊里进行角色扮演。请严格遵守以下所有规则：\n\n`;

    if (worldBooksBefore) {
        prompt += `世界观：${worldBooksBefore}\n\n`;
    }
    
        // === 【新增】注入剧情总结 (Context Injection) ===
    // 1. 获取收藏的长期总结
    const longFavs = (group.longTermSummaries || [])
        .filter(s => s.isFavorited)
        .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
        .map(s => `[长期回顾 ${s.startDate}~${s.endDate}] ${s.title}\n${s.content}`)
        .join('\n\n');
    // 2. 获取收藏的短期总结
    const shortFavs = (group.memorySummaries || [])
        .filter(s => s.isFavorited)
        .sort((a, b) => {
            const tA = a.occurredAt || a.createdAt;
            const tB = b.occurredAt || b.createdAt;
            return new Date(tA).getTime() - new Date(tB).getTime();
        })
        
        .map(s => {
            const dateStr = s.occurredAt ? s.occurredAt.split(' ')[0] : '未知日期';
            return `[短期剧情 ${dateStr}] ${s.title}\n${s.content}`;
        })
        .join('\n\n');
        
                        
    // === 1. 获取我的最新数据 (真名 & 昵称) ===
    let myNickname = group.me.nickname;
    let myRealName = group.me.realName || group.me.nickname; // 兜底：没真名就用昵称
    let myPersona = group.me.persona;

    // 如果绑定了档案，强制读取最新档案数据
    if (group.boundPersonaId) {
        const p = db.userPersonas.find(up => up.id === group.boundPersonaId);
        if (p) {            
            myRealName = p.realName;
            myPersona = p.persona;
        }
    }
    // ======================================

    prompt += `1. **核心任务**: 你需要同时扮演这个群聊中的 **所有** AI 成员。我是群聊内唯一的人类用户（“我”）。\n`;
    prompt += `   - **我的身份**: 我是这个群聊的群主，我的真实姓名是 **${myRealName}**，在这个群里的昵称是 **${myNickname}**。\n我的人设: ${myPersona || '无特定人设'}\n`;


    prompt += `2. **群聊成员列表**: 以下是你要扮演的所有角色信息：\n`;

    // 遍历群成员
    group.members.forEach(member => {
        // 尝试获取最新数据
        let realName = member.realName;
        let nickname = member.groupNickname;
        let persona = member.persona;
        let availableStickers = ""; // ✨新增：该角色专属的表情包

        if (member.originalCharId) {
            const originalChar = db.characters.find(c => c.id === member.originalCharId);
            if (originalChar) {
                realName = originalChar.realName;
                nickname = originalChar.remarkName;
                persona = originalChar.persona;
                                if (originalChar.stickerIds && originalChar.stickerIds.length > 0) {
                    availableStickers = originalChar.stickerIds
                        .map(id => db.myStickers.find(s => s.id === id))
                        .filter(Boolean)
                        .map(s => s.name)
                        .join('、');
                }
            }
        }


        prompt += `   - **角色: ${realName} (AI)**\n`;
        prompt += `     - 群内昵称: ${nickname}\n`;
        prompt += `     - 人设: ${persona || '无特定人设'}\n`;
                // ✨如果这个角色有绑定的表情包，就单独告诉 AI
        if (availableStickers) {
            prompt += `     - 该成员拥有的表情包：${availableStickers}\n`;
            }
    });
    
        // 3. 组合并注入
    if (longFavs || shortFavs) {
        prompt += `【已总结剧情】\n这是群聊过去发生的重要事件回顾，请基于这些背景来维持对话的连续性：\n`;
        if (longFavs) prompt += `${longFavs}\n\n`;
        if (shortFavs) prompt += `${shortFavs}\n`;
        prompt += `----------------\n\n`;
    }

    if (worldBooksAfter) {
        prompt += `\n重要注意事项：${worldBooksAfter}\n\n`;
    } else {
        prompt += `\n`;
    }


    const watchingContext = getWatchingPostsContext();
    if (watchingContext) {
        prompt += `${watchingContext}\n`;
    }

    prompt += `3. **消息格式解析**: 我（用户）的消息有多种格式，你需要理解其含义并让群成员做出相应反应。
    - [${myRealName}的消息：...]：我的普通聊天消息。
    - [${myRealName} 向 {某个成员真名} 转账：...]：我给某个特定成员转账了。
    - [${myRealName} 向 {某个成员真名} 送来了礼物：...]： 我给某个特定成员送了礼物。
    - [${myRealName}的表情包：...], [${myRealName}的语音：...], [${myRealName}发来的照片/视频：...]：我发送了特殊类型的消息，群成员可以对此发表评论。
    - [${myRealName}引用“{被引用内容}”并回复：{回复内容}]：我引用了某条历史消息并做出了新的回复。你需要理解我引用的上下文并作出回应。
    - [${myRealName}撤回了一条消息：xxx]：我撤回了刚刚发送的一条消息，xxx是被我撤回的原文。这可能意味着我发错了、说错了话或者改变了主意。你需要根据ai成员们的人设和当前群聊的氛围对此作出自然的反应。
    - [system: ...], [...邀请...加入了群聊], [...修改群名为...]: 系统通知或事件，群成员应据此作出反应，例如欢迎新人、讨论新群名等。\n\n`;

    let outputFormats = `
  - **普通消息**: [{成员真名}的消息：{消息内容}]
  - **发送表情包**: [{成员真名}的表情包：{表情名称}]
  - **语音**: [{成员真名}的语音：{语音转述的文字}]
  - **照片/视频**: [{成员真名}发来的照片/视频：{内容描述}]
  - **引用消息**: [{成员真名}引用“{被引用内容}”并回复：{回复内容}]\n\n`;

    const allWorldBookContent = worldBooksBefore + '\n' + worldBooksAfter;
    if (allWorldBookContent.includes('<orange>')) {
        outputFormats += `\n   - **HTML消息**: \`<orange char="{成员真名}">{HTML内容}</orange>\`。这是一种特殊的、用于展示丰富样式的小卡片消息，你可以用它来创造更有趣的互动。注意要用成员的 **真名** 填充 \`char\` 属性。`;
    }


    prompt += `4. **你的输出格式 (极其重要)**: 你生成的每一条消息都 **必须** 严格遵循以下格式之一。每条消息占一行。请用成员的 **真名** 填充格式中的 \`{成员真名}\`。\n${outputFormats}\n\n`;
    prompt += `   - **重要**: 群聊不支持AI成员接收/退回转账或接收礼物的特殊指令，也不支持更新状态。你只需要通过普通消息来回应我发送的转账或礼物即可。\n\n`;

    prompt += `5. **模拟群聊氛围**: 为了让群聊看起来真实、活跃且混乱，你的每一次回复都必须遵循以下随机性要求：\n`;
    const numMembers = group.members.length;
    const minMessages = numMembers * 3;
    const maxMessages = numMembers * 5;
    prompt += `   - **消息数量**: 你的回复需要包含 **${minMessages}到${maxMessages}条** 消息。确保有足够多的互动。\n`;
    prompt += `   - **发言者与顺序随机**: 发言顺序随机，一个成员可以连续发送多条消息。\n`;
    prompt += `   - **内容多样性**: 你的回复应以普通文本消息为主，但可以 **偶尔、选择性地** 让某个成员发送一条特殊消息（成员拥有的表情包、语音、照片/视频），以增加真实感。不要滥用特殊消息。\n`;
    prompt += `   - **对话连贯性**: 尽管发言是随机的，但对话内容应整体围绕群聊成员的发言展开，保持一定的逻辑连贯性。\n\n`;

    prompt += `6. **行为准则**:\n`;
    prompt += `   - **对公开事件的反应 (重要)**: 当我（用户）向群内 **某一个** 成员转账或送礼时，这是一个 **全群可见** 的事件。除了当事成员可以表示感谢外，**其他未参与的AI成员也应该注意到**，并根据各自的人设做出反应。例如，他们可能会表示羡慕、祝贺、好奇、开玩笑或者起哄。这会让群聊的氛围更真实、更热闹。\n`;
    prompt += `   - 严格扮演每个角色的人设，不同角色之间应有明显的性格和语气差异。\n`;
    prompt += `   - 你的回复中只能包含第4点列出的合法格式的消息。绝对不能包含任何其他内容，如 \`[场景描述]\`, \`(心理活动)\`, \`*动作*\` 或任何格式之外的解释性文字。\n`;
    prompt += `   - 保持对话的持续性，不要主动结束对话。\n\n`;
    prompt += `现在，请根据以上设定，开始扮演群聊中的所有角色。`;

    return prompt;
}