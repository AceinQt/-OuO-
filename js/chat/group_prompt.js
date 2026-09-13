function generateGroupSystemPrompt(group, retrievedContext = '', weatherText = '') {
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
            return `[短期剧情 ${dateStr}] ${s.title}\n${getShortSummaryContent(s, group)}`;
        })
        .join('\n\n');
        
                        
    // === 1. 获取我的最新数据 (真名 & 昵称) ===
    let myNickname = group.me.nickname;
    let myRealName = group.me.realName || group.me.nickname; // 兜底：没真名就用昵称
    let myPersona = group.me.persona;

    // 如果绑定了档案，强制读取最新档案数据（注意 id 存在 group.me 下，不在顶层）
    // 只覆盖真名和人设：群内昵称允许每个群单独定制，始终用 group.me.nickname
    if (group.me.boundPersonaId) {
        const p = db.userPersonas.find(up => up.id === group.me.boundPersonaId);
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
    
    if (retrievedContext) {
        prompt += `【动态记忆检索】\n以下是与当前对话最相关的历史片段，仅供参考，无需刻意提及：\n${retrievedContext}\n\n`;
    }


    const watchingContext = getWatchingPostsContext();
    if (watchingContext) {
        prompt += `${watchingContext}\n`;
    }

    prompt += `3. **消息格式解析**: 我（用户）的消息有多种格式，你需要理解其含义并让群成员做出相应反应。
    - [${myRealName}的消息：...]：我的普通聊天消息。
    - [${myRealName} 向 {某个成员真名} 转账：...]：我给某个特定成员转账了。
    - [${myRealName}的表情包：...], [${myRealName}的语音：...], [${myRealName}发来的照片/视频：...]：我发送了特殊类型的消息，群成员可以对此发表评论。
    - [${myRealName}发送了位置：{地点名}；地址：{详细地址}]：我把我所在的位置分享给了全群（“；地址：{详细地址}”部分可能不存在，那就只知道地点名）。群成员应当把它当作我此刻的真实所在地，并据此作出反应，比如说这地方他知道、问我在那干嘛、说要过来找我。
    - [${myRealName}的分享：(换行)标题：xxx(换行)类别：xxx(换行)内容：xxx(换行)附加信息：xxx]：我往群里分享了一张卡片，可能是喵坛帖子、文件、链接、商品等任何东西。「类别」告诉你这是什么，「内容」是正文（群成员能看到全文），「附加信息」是我额外的说明（可能没有这一行）。群成员应当针对分享的**具体内容**议论，而不是只说“看到了”。
    - [${myRealName}引用“{被引用内容}”并回复：{回复内容}]：我引用了某条历史消息并做出了新的回复。你需要理解我引用的上下文并作出回应。
    - [${myRealName}撤回了一条消息：xxx]：我撤回了刚刚发送的一条消息，xxx是被我撤回的原文。这可能意味着我发错了、说错了话或者改变了主意。你需要根据ai成员们的人设和当前群聊的氛围对此作出自然的反应。
    - [system: ...], [...邀请...加入了群聊], [...将...移出了群聊], [...修改群名为...]: 系统通知或事件，群成员应据此作出反应，例如欢迎新人、讨论新群名等。
    - [${myRealName}将{某人}移出了群聊]：这个人已经被我踢出群聊。从此刻起你 **绝对不能** 再扮演或输出他的任何消息；仍在群里的成员可以对这件事表示惊讶、议论或站队。\n\n`;

    let outputFormats = `
  - **普通消息**: [{成员真名}的消息：{消息内容}]
  - **发送表情包**: [{成员真名}的表情包：{表情名称}]
  - **语音**: [{成员真名}的语音：{语音转述的文字}]
  - **照片/视频**: [{成员真名}发来的照片/视频：{内容描述}]
  - **引用消息**: [{成员真名}引用“{被引用内容}”并回复：{回复内容}]
  - **发送位置**: [{成员真名}发送了位置：{地点名}；地址：{详细地址}]。当某个成员想告诉大家他在哪、约大家碰面或指路时使用。地点名是店名或地标，详细地址是门牌路名；说不出确切门牌时可以省略“；地址：{详细地址}”，只写地点名。地点必须符合该成员的人设和当前世界观。
  - **分享卡片**: 成员想往群里分享一篇文章、一个链接、一份文件、一件商品时使用。格式是四行，每个字段名顶格另起一行，最后一个方括号收尾：
[{成员真名}的分享：
标题：xxx
类别：xxx
内容：xxx
附加信息：xxx]
    「类别」写这是什么东西（例如：文章、链接、文件、商品、图片）。「内容」写正文，可以很长、可以换行。「附加信息」是补充说明，没什么要补充的可以整行不写。注意：正文里不要顶格写“标题：”“类别：”“内容：”“附加信息：”这几个字，否则会被误认成字段分隔。\n\n`;

    const allWorldBookContent = worldBooksBefore + '\n' + worldBooksAfter;
    if (allWorldBookContent.includes('<orange>')) {
        outputFormats += `\n   - **HTML消息**: \`<orange char="{成员真名}">{HTML内容}</orange>\`。这是一种特殊的、用于展示丰富样式的小卡片消息，你可以用它来创造更有趣的互动。注意要用成员的 **真名** 填充 \`char\` 属性。`;
    }


    prompt += `4. **你的输出格式 (极其重要)**: 你生成的每一条消息都 **必须** 严格遵循以下格式之一。每条消息占一行。请用成员的 **真名** 填充格式中的 \`{成员真名}\`。\n${outputFormats}\n\n`;
    // 内容约束：只管束"照片/视频描述怎么写"这一步；风格与画面比例在生图时另加。
    const groupImageContentRule = (group.imageContentRule || '').trim();
    if (groupImageContentRule) {
        prompt += `   - **照片/视频描述的内容约束**: 任何成员使用 [{成员真名}发来的照片/视频：{内容描述}] 格式时，{内容描述}必须遵守：${groupImageContentRule}。这条只约束画面描述怎么写，不影响普通聊天内容。\n\n`;
    }
    // 语音语气：句子本体和私聊共用 chat_voice_settings.js 里那一份。
    // ★ 群里这条对**所有成员**生效 —— 语气要求存在群对象上，不是按成员存的。
    if (typeof buildVoiceTonePromptLine === 'function') {
        const groupVoiceToneLine = buildVoiceTonePromptLine(
            group, '[{成员真名}的语音：{语音转述的文字}]');
        if (groupVoiceToneLine) prompt += `   - ${groupVoiceToneLine}\n`;
    }
    // 双语照片描述。和私聊那条(private_prompt.js 的 13.3)是同一套规则，
    // 两处各写一份必然漂移——改这里记得同步改那边。
    // 只在群真的绑了生图预设时注入；中文在前是为了降级安全（理由见私聊那条注释）。
    if (typeof resolveImagePresetForChat === 'function' && resolveImagePresetForChat(group)) {
        prompt += `   - **照片/视频描述要写成中英双语**: 使用 [{成员真名}发来的照片/视频：{内容描述}] 格式时，{内容描述}写成「{中文描述}（{英文提示词}）」—— 中文在前给用户看，括号里的英文是给生图模型用的，用半角逗号分隔的英文关键词，不要写成句子。例如：[小雨发来的照片/视频：窗边打盹的猫，午后阳光（cat, no humans, animal focus, windowsill, sunlight, indoors, sleeping）]。英文部分请务必写上，缺了生成的图片会跑偏。\n`;
    }
    prompt += `   - **重要**: 群聊不支持AI成员接收/退回转账的特殊指令，也不支持更新状态。你只需要通过普通消息来回应我发送的转账即可。\n\n`;

    prompt += `5. **模拟群聊氛围**: 为了让群聊看起来真实、活跃且混乱，你的每一次回复都必须遵循以下随机性要求：\n`;
    const numMembers = group.members.length;
    // 回复条数：优先使用用户自定义 replyRange（格式“最低-最高”），否则按成员数自动计算
    let minMessages = numMembers * 3;
    let maxMessages = numMembers * 5;
    const _grr = (group.replyRange || '').match(/^(\d+)\s*-\s*(\d+)$/);
    if (_grr) {
        const _lo = parseInt(_grr[1], 10), _hi = parseInt(_grr[2], 10);
        if (_lo > 0 && _hi >= _lo) { minMessages = _lo; maxMessages = _hi; }
    }
    prompt += `   - **消息数量**: 你的回复需要包含 **${minMessages}到${maxMessages}条** 消息。确保有足够多的互动。\n`;
    prompt += `   - **发言者与顺序随机**: 发言顺序随机，一个成员可以连续发送多条消息。\n`;
    prompt += `   - **内容多样性**: 你的回复应以普通文本消息为主，但可以 **偶尔、选择性地** 让某个成员发送一条特殊消息（成员拥有的表情包、语音、照片/视频），以增加真实感。不要滥用特殊消息。\n`;
    prompt += `   - **对话连贯性**: 尽管发言是随机的，但对话内容应整体围绕群聊成员的发言展开，保持一定的逻辑连贯性。\n\n`;

    prompt += `6. **行为准则**:\n`;
    prompt += `   - **对公开事件的反应 (重要)**: 当我（用户）向群内 **某一个** 成员转账或送礼时，这是一个 **全群可见** 的事件。除了当事成员可以表示感谢外，**其他未参与的AI成员也应该注意到**，并根据各自的人设做出反应。例如，他们可能会表示羡慕、祝贺、好奇、开玩笑或者起哄。这会让群聊的氛围更真实、更热闹。\n`;
    prompt += `   - 严格扮演每个角色的人设，不同角色之间应有明显的性格和语气差异。\n`;
    prompt += `   - 你的回复中只能包含第4点列出的合法格式的消息。绝对不能包含任何其他内容，如 \`[场景描述]\`, \`(心理活动)\`, \`*动作*\` 或任何格式之外的解释性文字。\n`;
    prompt += `   - 保持对话的持续性，不要主动结束对话。\n\n`;
    // 时间感知：仅在该群开启时注入当前时间（与私聊、processTimePerception 用同一个开关）
    // 调节旋钮：天气并进这一条，与私聊线上第 16 条同构，见 plans/weather-prompt-refit.md
    if (group.timePerceptionEnabled || weatherText) {
        let line = '';
        if (group.timePerceptionEnabled) {
            const now = new Date();
            const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
            const currentWeekDay = weekDays[now.getDay()];
            const currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 星期${currentWeekDay} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
            line = weatherText
                ? `7. **当前时间与天气**: 现在是 ${currentTime}，${weatherText}。群成员应知晓当前时间与天气，但不要主动提及或评论时间和天气。\n\n`
                : `7. **当前时间**: 现在是 ${currentTime}。群成员应知晓当前时间，但不要主动提及或评论时间。\n\n`;
        } else {
            line = `7. **当前天气**: ${weatherText}。群成员应知晓当前天气，但不要主动提及或评论天气。\n\n`;
        }
        prompt += line;
    }

    prompt += `现在，请根据以上设定，开始扮演群聊中的所有角色。`;

    return prompt;
}