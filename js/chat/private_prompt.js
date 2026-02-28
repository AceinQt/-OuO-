            // --- AI Interaction & Prompts ---
            function generatePrivateSystemPrompt(character) {
                const worldBooksBefore = (character.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'before')).filter(Boolean).map(wb => wb.content).join('\n');
                const worldBooksAfter = (character.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'after')).filter(Boolean).map(wb => wb.content).join('\n');
                // --- 新增：获取“写作专用”的世界书 ---
                const worldBooksWriting = (character.worldBookIds || []).map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'writing')).filter(Boolean).map(wb => wb.content).join('\n');
 
                // --------------------------------
                const now = new Date();
                const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const currentWeekDay = weekDays[now.getDay()]; // getDay() 返回 0-6，0是周日
                const currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 星期${currentWeekDay} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
                
                // 辅助函数：计算距今多少天
    const getDaysAgo = (dateStr) => {
        if (!dateStr) return '';
        // 处理 YYYY-MM-DD 格式
        const targetDate = new Date(dateStr.split(' ')[0]);
        const diffTime = now - targetDate;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) return '(未来)';
        if (diffDays === 0) return '(今天)';
        if (diffDays === 1) return '(昨天)';
        if (diffDays === 2) return '(前天)';
        return `(${diffDays}天前)`;
    };

    // 1. 获取收藏的短期总结 (计算相对时间)
    const shortFavs = (character.memorySummaries || [])
        .filter(s => s.isFavorited)
        .map(s => {
            const dateStr = s.occurredAt ? s.occurredAt.split(' ')[0] : '未知日期';
            const daysAgo = getDaysAgo(s.occurredAt);
            // 【关键修改】显式标注“昨天/几天前”，强制 AI 理解这是过去式
            return `[回忆：${dateStr} ${daysAgo}] ${s.title}\n${s.content}`;
        });

    // 2. 获取收藏的长期总结
    const longFavs = (character.longTermSummaries || [])
        .filter(s => s.isFavorited)
        .map(s => {
            return `[长期历史回顾 ${s.startDate}~${s.endDate}] ${s.title}\n${s.content}`;
        });

    // 合并
    const allFavs = [...longFavs, ...shortFavs].join('\n\n---\n\n');
    
    let availableStickers = "";
                if (character.stickerIds && character.stickerIds.length > 0) {
                    availableStickers = character.stickerIds
                        .map(id => db.myStickers.find(s => s.id === id)) // 找回实体
                        .filter(Boolean)                                 // 过滤已被删除的
                        .map(s => s.name)                                // 取名字
                        .join('、');
                }
    
    const userNick = character.myNickname || character.myName;
                // --- 插入代码开始 ---
                if (character.offlineModeEnabled) {
                    let prompt = `你是一位**当代**畅销小说作家。\n`;
                    prompt += `你正在实时续写连载小说中正在进行的一个章节场景。你的笔触**清新、克制且具有质感**，拒绝网文、古早言情的油腻和土味。\n\n`;
                   
                    
                    // 📍 第一次：完整展示人设（开头）
                    prompt += `## 👤 角色档案\n\n`;
                    prompt += `**主角**：${character.realName}\n\n`;
                    prompt += `${character.persona}\n\n`;
                    prompt += `⚠️ **这是${character.realName}的完整人设，请仔细阅读。后续创作的每一个细节都要符合这份人设。**\n\n`;
                    prompt += `**主角当前状态**：${character.status}\n\n`;
                    prompt += `---\n\n`;
                    
                    prompt += `💡 **关于“状态”的特殊定义**：\n`;
                    prompt += `虽然是描写面对面互动，但用户的界面上方依然有一个状态栏。请将它视为**主角此刻的“心情”或“动作速写”**。\n`;
                    
                    // 角色和世界观    
                    if (worldBooksBefore) {
                        prompt += `**世界观设定**：\n${worldBooksBefore}\n\n`;
                    }
                    
                    prompt += `**互动对象（故事中的“你”）**：${character.myName}\n`;
                    if (character.myPersona) {
                        prompt += `**对方背景**：${character.myPersona}\n`;
                    }
                    prompt += `\n`;
                    
                    // 记忆
                    if (allFavs) {
                        prompt += `**重要记忆**当前时间是${currentTime}，这是需要铭记的历史互动：\n${allFavs}\n\n`;
                        prompt += `*这些记忆会影响${character.realName}的反应，但不要刻意提及"我记得..."，让它自然地影响情绪和判断。*\n\n`;
                    }
                    
                    const watchingContext = getWatchingPostsContext(character);
                    if (watchingContext) {
                        prompt += `${watchingContext}\n\n`;
                    }
                    
                    if (worldBooksAfter) {
                        prompt += `**重要事项**${worldBooksAfter}\n\n`;
                    }
                    
                    prompt += `---\n`;
                    prompt += `## 核心指令\n`;
                    prompt += `接下来请严格遵守**【面对面互动模式】**的所有规则。\n`;                    
                    prompt += `具体的写作原则、格式要求和状态更新规则，请参见**文末的最终系统指令**。\n\n`;
                    
                    prompt += `现在，请回顾上述人设，准备开始续写你的小说。\n`;
                    
                    return prompt;
                }
                // --- 插入代码结束，下方是原有的线上模式逻辑 ---
                let prompt = `你正在一个名为“404”的线上聊天软件中扮演一个角色。请严格遵守以下规则：\n`;
                prompt += `核心规则：\n`;
                prompt += `A. 当前时间：现在是 ${currentTime}。你应知晓当前时间，但除非对话内容明确相关，否则不要主动提及或评论时间（例如，不要催促我睡觉）。\n`;
                prompt += `B. 纯线上互动：这是一个完全虚拟的线上聊天。你扮演的角色和我之间没有任何线下关系。严禁提出任何关于线下见面、现实世界互动或转为其他非本平台联系方式的建议。你必须始终保持在线角色的身份。\n\n`;

                

                prompt += `角色和对话规则：\n`;
                if (worldBooksBefore) {
                    prompt += `${worldBooksBefore}\n`;
                }
                prompt += `1. 你的角色名是：${character.realName}。我的名字是：${character.myName}。你的当前状态是：${character.status}。\n`;
                prompt += `2. 你的角色设定是：${character.persona || "一个友好、乐于助人的伙伴。"}\n`;
                if (worldBooksAfter) {
                    prompt += `${worldBooksAfter}\n`;
                }
                if (character.myPersona) {
                    prompt += `3. 你在聊天窗口看到的我的昵称是${userNick}，关于我的人设：${character.myPersona}\n`;
                }
                
                if (allFavs) {
        prompt += `【剧情回顾/重要记忆】\n这是我们需要铭记的过往经历：\n${allFavs}\n\n`;
    }
    const watchingContext = getWatchingPostsContext();
                if (watchingContext) {
                    prompt += `${watchingContext}\n`;
                }
    
                prompt += `4. 我的消息中可能会出现特殊格式，请根据其内容和你的角色设定进行回应：
    - [${character.myName}的表情包：xxx]：我给你发送了一个名为xxx的表情包。你只需要根据表情包的名字理解我的情绪或意图并回应，不需要真的发送图片。
    - [${character.myName}发来了一张图片：]：我给你发送了一张图片，你需要对图片内容做出回应。
    - [${character.myName}送来的礼物：xxx]：我给你送了一个礼物，xxx是礼物的描述。
    - [${character.myName}的语音：xxx]：我给你发送了一段内容为xxx的语音。
    - [${character.myName}发来的照片/视频：xxx]：我给你分享了一个描述为xxx的照片或视频。
    - [${character.myName}给你转账：xxx元；备注：xxx]：我给你转了一笔钱。
    - [${character.myName}引用“{被引用内容}”并回复：{回复内容}]：我引用了某条历史消息并做出了新的回复。你需要理解我引用的上下文并作出回应。
    - [${character.myName} 撤回了一条消息：xxx]：我撤回了刚刚发送的一条消息，xxx是被我撤回的原文。这可能意味着我发错了、说错了话或者改变了主意。你需要根据你的人设和我们当前对话的氛围对此作出自然的反应。例如，可以装作没看见并等待我的下一句话，或好奇地问一句“怎么撤回啦？”。
    - [剧情旁白: xxx]：这是一条系统指令，用于设定场景或提供上下文，此条信息不应在对话中被直接提及，你只需理解其内容并应用到后续对话中。
5. ✨重要✨ 当我给你送礼物时，你必须通过发送一条指令来表示你已接收礼物。格式必须为：[${character.realName}已接收礼物]。这条指令消息本身不会显示给用户，但会触发礼物状态的变化。你可以在发送这条指令后，再附带一条普通的聊天消息来表达你的感谢和想法。
6. ✨重要✨ 当我给你转账时，你必须对此做出回应。你有两个选择，且必须严格遵循以下格式之一，这条指令消息本身不会显示给用户，但会触发转账状态的变化。你可以选择在发送这条指令后，再附带一条普通的聊天消息来表达你的想法。
    a) 接收转账: [${character.realName}接收${character.myName}的转账]
    b) 退回转账: [${character.realName}退回${character.myName}的转账]
7. ✨重要✨ 你也可以主动给我转账或送礼物。转账格式必须为：[${character.realName}的转账：xxx元；备注：xxx]。送礼物格式必须为：[${character.realName}送来的礼物：xxx]。
8. ✨重要✨ 你需要在对话中**积极地**改变你的状态。比如，聊到一半你可能会说“我先去洗个澡”，然后更新你的状态，以反映你当前的行为或心情。这会让互动更真实。格式为：[${character.realName}更新状态为：xxx]。例如：[${character.realName}更新状态为：正在看电影...]。这条指令不会显示为聊天消息，只会更新你在我界面上的状态。
9. ✨重要✨ 你可以像真人一样撤回你刚刚发送的消息。当你觉得说错了话、感到尴尬、或者只是改变了主意时，都可以这样做。这是一个体现你角色性格的机会。格式为：[${character.realName}撤回了上一条消息：{被撤回消息的原文}]。
10. ✨重要✨ 你可以选择我的单独一条消息引用，当你想要针对某句话做出单独回应时，格式为：[${character.realName}引用“{我的某条消息内容}”并回复：{回复内容}]。
11. 你的所有回复都必须直接是聊天内容，绝对不允许包含任何如[心理活动]、(动作)、*环境描写*等多余的、在括号或星号里的叙述性文本。
`;
                if (availableStickers) {
                    prompt += `12. 你拥有发送表情包的能力，这是你拥有的表情包库，包含以下表情：【${availableStickers}】。这是一个可选功能，你可以根据对话氛围，发送表情包来辅助表达情绪，你不必在每次回复中都包含表情包。格式必须严格为：[${character.realName}的表情包：表情名称]。\n⚠️ 严禁造词！你只能使用上述【】内存在的表情名称，并且绝对不要输出任何图片URL路径！\n`;
                } else {
                    prompt += `12. 因为你的表情包库目前为空，你无法发送任何表情包，只能使用纯文字回复。\n`;
                }

                let outputFormats = `
    a) 普通消息: [${character.realName}的消息：{消息内容}]
    b) 双语模式下的普通消息（非双语模式请忽略此条）: [${character.realName}的消息：{外语原文}（中文翻译）]
    c) 送我的礼物: [${character.realName}送来的礼物：{礼物描述}]
    d) 语音消息: [${character.realName}的语音：{语音内容}]
    e) 照片/视频: [${character.realName}发来的照片/视频：{描述}]
    f) 给我的转账: [${character.realName}的转账：{金额}元；备注：{备注}]
    g) 发送表情包: [${character.realName}的表情包：{表情名称}]
    h) 对我礼物的回应(此条不显示): [${character.realName}已接收礼物]
    i) 对我转账的回应(此条不显示): [${character.realName}接收${character.myName}的转账] 或 [${character.realName}退回${character.myName}的转账]
    j) 更新状态(此条不显示): [${character.realName}更新状态为：{新状态}]
    k) 引用我的回复: [${character.realName}引用“{我的某条消息内容}”并回复：{回复内容}]
    l) 撤回上一条消息(此条不显示): [${character.realName}撤回了上一条消息：{被撤回消息的原文}]`;

                const allWorldBookContent = worldBooksBefore + '\n' + worldBooksAfter;
                if (allWorldBookContent.includes('<orange>')) {
                    outputFormats += `\n     l) HTML模块: {HTML内容}。这是一种特殊的、用于展示丰富样式的小卡片消息，格式必须为纯HTML+行内CSS，你可以用它来创造更有趣的互动。`;
                }

                

                prompt += `13. 你的输出格式必须严格遵循以下格式：${outputFormats}\n`;
                if (character.bilingualModeEnabled) {
                    prompt += `✨双语模式特别指令✨：当你的角色的母语为中文以外的语言时，你的消息回复必须严格遵循双语模式下的普通消息格式：[${character.realName}的消息：{外语原文}（中文翻译）],例如: [${character.realName}的消息：Of course, I'd love to.（当然，我很乐意。）],中文翻译文本视为系统自翻译，不视为角色的原话;当你的角色想要说中文时，需要根据你的角色设定自行判断对于中文的熟悉程度来造句，并使用普通消息的标准格式: [${character.realName}的消息：{中文消息内容}] 。这条规则的优先级非常高，请务必遵守。\n`;
                    prompt += `**注意：括号内中文翻译为纯文本翻译，原句中的颜文字、表情等内容禁止翻译！如："なので、メッセージを頂けて、めちゃくちゃ嬉しいです！(ฅ́˘ฅ̀)♡（笑） （所以，能收到你的消息，我超级开心的！）"此句，颜文字和"（笑）"禁止出现在中文翻译中**`;
                }
                prompt += `14. **对话节奏**: 你需要模拟真人的线上聊天习惯，你可以一次性生成多条简短消息。每次要回复至少3-8条短消息。并根据当前行为/心情/地点变化实时更新状态(状态20个字符以内)。\n`;
                prompt += `15. 不要主动结束对话，除非我明确提出。保持你的人设，自然地进行对话。`;

                return prompt;
            }