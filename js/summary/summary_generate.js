// ============================================================
//  summary_generate.js
//
//  【职责】所有 AI 生成逻辑的核心模块。
//  负责构建 Prompt、调用 API、解析结果、存储数据。
//
//  包含：
//  - _buildSummaryChunks()：按30分钟间隔 + 字数上限 + 条数上限切块
//  - _parseChunkBlocks()：解析 AI 输出的 #CHUNK_BLOCK_N# 标签
//  - performGeneration()：核心生成函数
//    · 过滤聊天记录（剔除系统消息、线下消息等）
//    · [v1.6] type=summary 时先切块，AI 输出含块详细内容/摘要/情绪标签
//    · 构建世界书上下文（before / after / writing 三段式）
//    · 构建人物设定（私聊 / 群聊两套逻辑）
//    · 注入已收藏的长期/短期总结作为历史背景
//    · 短期总结 Prompt（第三人称客观记录）
//    · 日记 Prompt（第一人称沉浸，含 Step1 思考骨架）
//    · 顺风车主动消息生成（SECRET_CHAT 标签解析 + pushProactiveMessage）
//    · 解析 AI 输出的【标题】【内容】格式
//    · 将结果存入 chat.memorySummaries 或 chat.memoryJournals
//    · [v1.6] 解析片段块并存入 chat.memoryChunks（无 rawText，仅指针）
//
//  - generateMemoryContent()：短期总结/日记的生成入口
//  - generateLongTermSummaryContent()：长期总结生成入口
//
//  依赖：summary_core.js
// ============================================================

/**
 * 根据功能类型（'summary'/'journal'）获取对应API配置。
 * 优先读取角色/群组绑定的预设，fallback到全局默认 db.apiSettings。
 */
function _getMemoryApiConfig(type, chatObj) {
    const presetField = type === 'summary' ? 'summaryApiPreset' : 'journalApiPreset';
    const presetName  = chatObj && chatObj[presetField];
    if (presetName) {
        const preset = (db.apiPresets || []).find(
            p => p.name === presetName && (!p.type || p.type === 'chat')
        );
        if (preset && preset.data) return preset.data;
    }
    return db.apiSettings || {};
}


/**
 * 统一 fetch wrapper，支持流式和非流式。
 * 流式时读完所有 chunk 后返回完整文本，行为对上层透明。
 */
async function _fetchCompletion(url, key, body) {
    const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);

    if (body.stream) {
        // SSE 流式读取，拼接完整内容后返回
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const lines = decoder.decode(value, { stream: true }).split('\n');
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;
                try {
                    const delta = JSON.parse(data).choices?.[0]?.delta?.content;
                    if (delta) fullText += delta;
                } catch {}
            }
        }
        return fullText;
    } else {
        const result = await response.json();
        return result.choices[0].message.content;
    }
}

// ============================================================
//  [v1.6] 切块与块解析辅助
// ============================================================

/**
 * 按30分钟时间间隔 + 字数上限 + 条数上限，将消息对象数组切分为若干块。
 * 每块不超过 MAX_MSGS 条（约10轮对话），保证片段粒度合理。
 * @param {Array} rawMsgs  原始消息对象数组（需含 timestamp、_globalIdx 字段）
 * @returns {Array<{msgs, startTime, endTime, startMsgIdx, endMsgIdx}>}
 */
 /**
 * 判断一条消息是否为纯图片消息（base64 或 url 格式）。
 * 图片消息不应参与字数统计，否则会因 base64 超长而单独成块。
 */
function _isImageOnlyMsg(m) {
    const c = m.content;
    if (!c) return false;
    // base64 图片
    if (typeof c === 'string' && c.startsWith('data:image/')) return true;
    // array-format content（Gemini 多模态格式），仅含 image 部分
    if (Array.isArray(c) && c.every(part => part.type === 'image_url' || part.type === 'image')) return true;
    return false;
}

/**
 * 取消息用于字数统计和 AI 输入的"展示文本"。
 * 图片统一替换为占位符，避免 base64 撑爆字数限制。
 */
function _getMsgDisplayText(m, getName) {
    if (_isImageOnlyMsg(m)) return `${getName(m)}: [发送了一张图片]`;
    // array-format 含图含文：只取文字部分
    if (Array.isArray(m.content)) {
        const text = m.content.filter(p => p.type === 'text').map(p => p.text).join('');
        return `${getName(m)}: ${text || '[图片]'}`;
    }
    return `${getName(m)}: ${m.content}`;
}
 
 
function _buildSummaryChunks(rawMsgs, maxTurns = 10) {
    if (!rawMsgs.length) return [];
    const MAX_TURNS = maxTurns;

    const result = [];
    let current    = [rawMsgs[0]];
    let groupCount = 1;

    for (let i = 1; i < rawMsgs.length; i++) {
        const msg  = rawMsgs[i];
        const prev = rawMsgs[i - 1];

        if (msg.role !== prev.role) groupCount++;
        const turns = Math.floor(groupCount / 2);

        if (msg._hasDividerBefore || turns >= MAX_TURNS) {
            result.push({
                msgs:        current,
                startTime:   current[0].timestamp || 0,
                endTime:     current[current.length - 1].timestamp || 0,
                startMsgIdx: current[0]._globalIdx || 0,
                endMsgIdx:   current[current.length - 1]._globalIdx || 0
            });
            current    = [msg];
            groupCount = 1;
        } else {
            current.push(msg);
        }
    }

    if (current.length > 0) {
        result.push({
            msgs:        current,
            startTime:   current[0].timestamp || 0,
            endTime:     current[current.length - 1].timestamp || 0,
            startMsgIdx: current[0]._globalIdx || 0,
            endMsgIdx:   current[current.length - 1]._globalIdx || 0
        });
    }
    return result;
}

/**
 * 从 AI 输出中解析 #CHUNK_BLOCK_N# 标签，构建 memoryChunks 入库记录列表。
 * [v1.6] 不存储 rawText，通过父 summary 的 range 指针实时重建原文。
 * [v1.6+] 新增 detailedContent（详细总结正文）、startMsgIndex/endMsgIndex（精确消息范围）
 *
 * @param {string} rawContent  AI 原始输出（SECRET_CHAT 已剥离）
 * @param {Array<{msgs,startTime,endTime,startMsgIdx,endMsgIdx}>} chunkObjs  切块信息
 * @param {string} chatId
 * @param {string} summaryId  父短期总结 ID（共用预生成值）
 * @returns {Array}  待存入 memoryChunks 的 block 对象数组
 */
function _parseChunkBlocks(rawContent, chunkObjs, chatId, summaryId) {
    return chunkObjs.map((chunkInfo, i) => {
        const tagRx = new RegExp(
            `#CHUNK_BLOCK_${i}#\\s*([\\s\\S]*?)(?=#CHUNK_BLOCK_\\d+#|$)`, 'i'
        );
        const match = rawContent.match(tagRx);

        let detailedContent = null, summary = null, emotion = null,
            emotionScore = 0.5, isRoutine = null, parseSuccess = false;

        if (match) {
            const body = match[1].trim();
            // 内容：多行，截到"摘要:"前
            const contentM = body.match(/内容[:：]\s*([\s\S]*?)(?=\n摘要[:：]|$)/);
            const summaryM = body.match(/摘要[:：]\s*(.+)/);
            const emotionM = body.match(/情绪[:：]\s*(\S+)/);
            const scoreM   = body.match(/强度[:：]\s*([\d.]+)/);
            const routineM = body.match(/日常[:：]\s*(是|否)/);  // [v1.6+]
            if (contentM) { detailedContent = contentM[1].trim(); parseSuccess = true; }
            if (summaryM) { summary = summaryM[1].trim(); parseSuccess = true; }
            if (emotionM)   emotion      = emotionM[1].trim();
            if (scoreM)     emotionScore = Math.min(1, Math.max(0, parseFloat(scoreM[1]) || 0.5));
            if (routineM)   isRoutine    = routineM[1] === '是';  // [v1.6+]
        }

return {
    id:      `block_${summaryId}_${i}`,   // ← 新增，Dexie 主键
    blockId: `block_${summaryId}_${i}`,   // ← 保留（兼容其他引用）
    chatId,
    summaryId,
    chunkIndex:     i,
    detailedContent,
    summary,
    emotion,
    emotionScore,
    isRoutine,                             // [v1.6+] true=日常/false=非日常/null=待分类
    timestamp:      chunkInfo.startTime || chunkInfo.endTime || Date.now(),
    startTime:      chunkInfo.startTime,
    endTime:        chunkInfo.endTime,
    startMsgIndex:  chunkInfo.startMsgIdx,
    endMsgIndex:    chunkInfo.endMsgIdx,
    messageCount:   chunkInfo.msgs.length,
    parseSuccess,
    embedding:      null,
    accessCount:    0,
    lastAccessTime: 0
};
    });
}

// ============================================================
//  核心生成函数
// ============================================================

async function performGeneration(chat, start, end, type, occurredAtOverride = null) {
    const startIndex = start - 1;
    const endIndex   = end;
    const now        = new Date(); // ← 提到这里

    // ─── 消息过滤函数（summary / journal 公用）────────────────
    const _filterMsg = m => {
        if (m.isAiIgnore) return false;
        if (m.role === 'system') return false;
        if (m.id && m.id.includes('msg_context_timesense')) return false;
        if (m.content && m.content.includes('[system-display:')) return false;
        return true;
    };

    const _getName = m => {
        if (m.role === 'user') return currentChatType === 'private' ? '我' : (chat.me?.realName || '我');
        if (currentChatType === 'private') return chat.realName;
        const sender = chat.members?.find(mem => mem.id === m.senderId);
        return sender ? sender.realName : '未知成员';
    };

    // ─── [v1.6] summary：先切块，再拼接带标签全文 ────────────
    // journal 走原有逻辑，不切块
    let messageChunks = null;
    let messagesToSummarize;

    if (type === 'summary') {
        // [v1.6+] 先附全局序号（1-based），供切块后记录精确消息范围
 const rawWithIndex = chat.history.slice(startIndex, endIndex)
    .map((m, i) => ({ ...m, _globalIdx: startIndex + i + 1 }));

// ★ 收集所有 visual timesense 的位置
const dividerIdxs = rawWithIndex
    .filter(m => m.id && m.id.includes('msg_visual_timesense'))
    .map(m => m._globalIdx);

// 先过滤（spread 避免污染原始对象）
const rawFiltered = rawWithIndex.filter(_filterMsg).map(m => ({ ...m }));

// ★ 对每个 divider 位置，给过滤后数组里第一条 _globalIdx 更大的消息打标记
for (const dividerIdx of dividerIdxs) {
    const target = rawFiltered.find(m => m._globalIdx > dividerIdx && !m._hasDividerBefore);
    if (target) target._hasDividerBefore = true;
}

const rawChunks = _buildSummaryChunks(rawFiltered, chat.chunkGranularity || 10);
        // _text 仅用于本次拼接给 AI，不持久化
        messageChunks = rawChunks.map(chunk => ({
    ...chunk,
    _text: chunk.msgs.map(m => _getMsgDisplayText(m, _getName)).join('\n')
}));
        messagesToSummarize = messageChunks
            .map((c, i) => `=== 片段${i}（共${c.msgs.length}条消息）===\n${c._text}`)
            .join('\n\n');
    } else {
        messagesToSummarize = chat.history.slice(startIndex, endIndex)
            .filter(_filterMsg)
            .map(m => `${_getName(m)}: ${m.content}`)
            .join('\n');
    }

    // === 1. 获取并拆分世界书 ===
    const boundIds    = type === 'summary' ? (chat.summaryWorldBookIds || []) : (chat.journalWorldBookIds || []);
    const allBoundWbs = boundIds.map(id => db.worldBooks.find(w => w.id === id)).filter(Boolean);

    const wbBefore  = allBoundWbs.filter(wb => wb.position === 'before').map(wb => wb.content).join('\n');
    const wbAfter   = allBoundWbs.filter(wb => wb.position === 'after').map(wb => wb.content).join('\n');
    const wbWriting = allBoundWbs.filter(wb => wb.position === 'writing').map(wb => wb.content).join('\n');

    // === 2. 提取人物设定 (区分群聊/私聊) ===
    let charName, charPersona, userName, userPersona;
    
    if (currentChatType === 'private') {
        charName    = chat.realName  || '未知角色';
        charPersona = chat.persona   || '无特定人设';
        userName    = chat.myName    || '用户';
        userPersona = chat.myPersona || '无特定人设';
    } else {
        charName    = chat.name || '群聊';
        userName    = chat.me.realName  || '用户';
        userPersona = chat.me.persona   || '无特定人设';
        const membersInfo = chat.members.map(m => `- ${m.realName} (昵称: ${m.groupNickname}): ${m.persona || '无'}`).join('\n');
        charPersona = `这是一个名为"${charName}"的群聊。\n成员列表：\n${membersInfo}`;
    }
    
    // === 3. 构建【已总结剧情】上下文 ===
    const longFavs = (chat.longTermSummaries || [])
        .filter(s => s.isFavorited)
        .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
        .map(s => `[长期回顾 ${s.startDate}~${s.endDate}] ${s.title}\n${s.content}`)
        .join('\n\n');

    const shortFavs = (chat.memorySummaries || [])
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
        
    let summaryContext = "";
    if (longFavs || shortFavs) {
        summaryContext  = `【已总结剧情】\n这是过去发生的重要事件回顾，请基于这些背景来理解当前的对话：\n`;
        if (longFavs)  summaryContext += `${longFavs}\n\n`;
        if (shortFavs) summaryContext += `${shortFavs}\n`;
        summaryContext  += `----------------\n`;
    }

    let systemPrompt = "";
    
    const outputInstruction = `
请严格遵守以下输出格式（不要使用Markdown代码块，不要加粗）：
【标题】这里写标题
【内容】这里写正文内容

要求：
1. **标题**：根据对话内容起一个有具体意义的标题。
2. **格式**：必须包含【标题】和【内容】这两个标记，否则无法识别。
`;

    // [v1.6] summary 专属：在【内容】之后追加逐片段详细总结输出指令
    let chunkOutputInstruction = '';
    if (type === 'summary' && messageChunks?.length > 0) {
const chunkFmt = messageChunks.map((_, i) =>
            `#CHUNK_BLOCK_${i}#\n内容: <对此片段的详细总结，保留关键人物/事件经过/情感变化/重要约定与伏笔，供长期总结使用>\n摘要: <50字以内核心摘要，用于向量检索，不需要完整包含片段内的所有情节，舍去片段内日常(如“两人互道晚安”等每天必定会发生的行为)，只摘录片段最特别的情节，保留具体人名、地名、物品名称和精确数字(如小明突发奇想给宠物猫小咪称体重，体重6kg)，便于后续向量精准定位。>\n情绪: <主要情绪词，如melancholy/warm/tense/playful/anxious/calm>\n强度: <0.0到1.0的小数。极严标准：0.1-0.3平静/毫无波澜，0.4-0.6微小起伏/正常交流，0.7-0.8明显波动，0.9-1.0极端爆发或深刻浪漫。日常绝大多数应在0.5以下，切勿滥用高分>\n日常: <是/否，"是"=日常闲聊或例行打招呼，"否"=有明显情节推进/冲突/重要表白或约定/新事件>`
        ).join('\n\n');
        chunkOutputInstruction = `\n\n【片段详细总结（必须全部输出，共${messageChunks.length}个片段，一个都不能省略）】\n完成【内容】概括后，立即逐片段按以下格式输出，不添加额外说明：\n\n${chunkFmt}`;
    }
    
    // 判断是否在总结"最新记录"
    const isLatest  = (end === chat.history.length);
    let nextSlots   = [];
    
    if (type === 'summary') {
        systemPrompt = `你是一个专业的剧情记录员。

【世界观/背景设定】
${wbBefore}

【人物档案】
- 主角名：${charName}
- 主角人设：${charPersona}
- 用户名：${userName}
- 用户人设：${userPersona}

【重要事项】
${wbAfter}

【写作要求】
请以**第三人称上帝视角**，客观、精准地总结以下对话内容。
请保留关键事件、关键人物姓名、关键道具、约定、角色情感变化以及重要的伏笔。
${wbWriting ? `特别指导：\n${wbWriting}\n` : ''}

【对话内容】
${summaryContext}

${outputInstruction + chunkOutputInstruction}`;

        // --- 顺风车：预测下两个时间段的主动消息 ---
        function getNextTwoSlots(hour) {
            const slots = [
                { id: 'night',     name: '深夜(22:00-次日6:00)' },
                { id: 'morning',   name: '早晨(6:00-10:00)'     },
                { id: 'noon',      name: '中午(10:00-14:00)'    },
                { id: 'afternoon', name: '下午(14:00-18:00)'    },
                { id: 'evening',   name: '晚上(18:00-22:00)'    }
            ];
            let currIdx = 0;
            if      (hour >= 22 || hour < 6)  currIdx = 0;
            else if (hour >= 6  && hour < 10) currIdx = 1;
            else if (hour >= 10 && hour < 14) currIdx = 2;
            else if (hour >= 14 && hour < 18) currIdx = 3;
            else currIdx = 4;
            return [slots[currIdx], slots[(currIdx + 1) % 5]];
        }

        if (isLatest) {
            nextSlots = getNextTwoSlots(new Date().getHours());
            
            const isOffline        = (currentChatType === 'private' && chat.offlineModeEnabled);
            const actionPromptText = isOffline ? "做什么事" : "主动发消息";
            const now              = new Date();
            const weekDays         = ['日', '一', '二', '三', '四', '五', '六'];
            const currentWeekDay   = weekDays[now.getDay()];
            const currentTime      = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 星期${currentWeekDay} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
                
            let senderInstruction = '';
            let exampleFormat     = '';
            
            if (currentChatType === 'private') {
                senderInstruction = `私聊必须是你自己的名字（${charName}）`;
                if (isOffline) {
                    exampleFormat = `#SECRET_CHAT_${nextSlots[0].id.toUpperCase()}_5%#\n[02:15|${charName}的动作:他在床上翻来覆去睡不着。]\n\n#SECRET_CHAT_${nextSlots[1].id.toUpperCase()}_80%#\n[07:30|${charName}的动作:他在餐厅看到你，走上前拍了拍你。]\n[07:31|${charName}的语言:居然扔下我，一个人跑出来吃早餐……！]`;
                } else {
                    exampleFormat = `#SECRET_CHAT_${nextSlots[0].id.toUpperCase()}_5%#\n[02:15|${charName}的消息:睡不着，你在干嘛……]\n\n#SECRET_CHAT_${nextSlots[1].id.toUpperCase()}_80%#\n[08:20|${charName}的消息:起床了吗？]\n[08:21|${charName}的语音:大懒虫快起来！]`;
                }
            } else {
                const m1 = (chat.members && chat.members.length > 0) ? chat.members[0].realName : '群成员A';
                const m2 = (chat.members && chat.members.length > 1) ? chat.members[1].realName : m1;
                senderInstruction = `群聊必须严格使用群成员的真名（当前成员名单：${(chat.members || []).map(m => m.realName).join('、')}）`;
                exampleFormat = `#SECRET_CHAT_${nextSlots[0].id.toUpperCase()}_5%#\n[02:15|${m1}的消息:大半夜的有人没睡吗？]\n\n#SECRET_CHAT_${nextSlots[1].id.toUpperCase()}_80%#\n[07:30|${m2}的消息:早安！今天天气真好！]\n[07:32|${m1}的语音:早上好！]`;
            }

            systemPrompt += `\n\n【最后的一项绝对指令】：
在完成上面的总结任务后，请你立刻脱离"总结员"身份，切换回情境中。现在是 ${currentTime}，你们刚聊完，请你预先想好在接下来的两个时间段（${nextSlots[0].name} 和 ${nextSlots[1].name}），你可能会${actionPromptText}。
要求：
1. 每个时段支持生成 1~3 条连贯的互动。
2. 根据你们刚才聊天的氛围和人设，评估在这两个时间段主动发起的**概率（0到100的整数）**。
3. 每条消息必须独占一行，严格使用格式：[HH:MM|发送者名字的动作或消息:具体内容]
   - HH:MM 是你根据情境决定的合理时间（例如睡不着可能是 23:30，吃午饭可能是 12:15）。
   - 发送者：${senderInstruction}。
   - 动作支持：${isOffline ? "的动作、的语言" : "的消息、发来的照片/视频、的语音、的转账:xx元；备注、送来的礼物"}。
4. 严格使用以下标签独占一行包裹这些消息：
#SECRET_CHAT_${nextSlots[0].id.toUpperCase()}_概率%#[HH:MM|发送者名字的...:内容1]
[HH:MM|发送者名字的...:内容2]
#SECRET_CHAT_${nextSlots[1].id.toUpperCase()}_概率%#[HH:MM|发送者名字的...:内容1]

例如：
${exampleFormat}`;
        }
    } else {
        if (currentChatType === 'group') throw new Error("群聊不支持生成日记");

        const journalDate = occurredAtOverride
    ? occurredAtOverride
    : `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;

systemPrompt = `你正在扮演角色"${chat.realName}"。

【世界观/背景设定】
${wbBefore}

【你的人设】
${charPersona}

【互动对象（${userName}）的人设】
${userPersona}

${summaryContext}

【重要事项】
${wbAfter}

今天是 ${journalDate} ，请你根据以上经历写一篇**私密日记**。

为了拒绝流水账，请在**正式动笔前**，先进行【Step 1 深度思考】，构建日记骨架，然后再进行【Step 2 正文撰写】。

## Step 1: 写作前思考 (Pre-writing Reflection)
1. **【定调】**：今天的时间、地点、天气是怎样的？当下你的能量状态（疲惫、兴奋、平静）如何？
2. **【选材】**：如果把这一天剪辑成电影，你觉得哪几个"镜头"或瞬间最值得被保留？
3. **【捕捉】**：在这个瞬间里，有哪些特殊的感官细节（气味、光影、声音、触感）可以强化画面感？
4. **【深挖】**：表层情绪之下，你内心真实的渴望、恐惧或价值观是什么？
5. **【收尾】**：基于今日感悟，哪怕再糟糕，有什么值得感恩的小事？或者想对自己说的一句结束语是什么？

## Step 2: 撰写日记 (Drafting)
基于 Step 1 的思考，按照以下要求进行撰写：
1. **第一人称沉浸**：必须完全遵循你的【人设】语气，感情细腻真实，注重剖析内心世界。
2. **删除线**：使用**删除线**来表现你突然改变了主意。
3. **强调重点**：对于你特别在意的事情，使用Markdown的**加粗**（格式：**这个很重要**）来标记。
4. **拒绝平铺直叙**：不要从起床写到睡觉，直接切入重点瞬间。行文结构可以看起来略微凌乱，但不要流水账。
5. **颜文字**：使用颜文词表达心情。
${wbWriting ? `6. **文风指导**：\n${wbWriting}\n` : ''}
7. **格式严格执行**：
   - 你可以先输出思考过程（可选）。
   - **必须**使用【标题】标记包裹标题。
   - **必须**使用【内容】标记包裹正文。
   - 正文内容不要包含"Step 1"等字样，只保留日记本体。

${outputInstruction}
(提示：你可以先输出一段 "### 🧠 思考脉络" 用于热身，但在那之后必须严格输出 【标题】 和 【内容】)`;
    }

const { url, key, model, temperature: presetTemp, streamEnabled } = _getMemoryApiConfig(type, chat);
const rawContent = await _fetchCompletion(url, key, {
    model,
    messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `请根据以下对话生成内容：\n\n${messagesToSummarize}` }
    ],
    temperature: presetTemp ?? (type === 'summary' ? 0.3 : 0.9),
    ...(streamEnabled ? { stream: true } : {})
});

    let processedContent = rawContent;
    
    // ★ 顺风车解析
    if (type === 'summary' && isLatest) {
        let proactiveOptions = {};
        const isOffline      = (currentChatType === 'private' && chat.offlineModeEnabled);
        const slotsToMatch   = [nextSlots[0].id, nextSlots[1].id];

        slotsToMatch.forEach(slotId => {
            const tagRegex = new RegExp(`#SECRET_CHAT_${slotId.toUpperCase()}(?:_(\\d+)%?)?#\\s*([\\s\\S]*?)(?=#SECRET_CHAT_|$)`, 'i');
            const match    = processedContent.match(tagRegex);
            
            if (match) {
                let prob      = match[1] ? parseInt(match[1], 10) : null;
                let textBlock = match[2].trim();                
                let messages  = [];
                const lineRegex = /\[(\d{1,2}:\d{2})\|([^:：]+)[:：](.*?)\]/g;
                let lineMatch;
                
                while ((lineMatch = lineRegex.exec(textBlock)) !== null) {
                    let prefix     = lineMatch[2].trim();
                    let senderName = prefix;
                    let actionType = "的消息";

                    const actionKeywords = [
                        "的消息", "的表情包", 
                        "发来的照片/视频", "的照片/视频", "发来的照片", "的照片", 
                        "的语音", "发来的语音", "撤回了一条消息", "撤回了上一条消息",
                        "的转账", "发来的转账", 
                        "送来的礼物", "的礼物", 
                        "的动作", "的语言"
                    ];
                    for (const kw of actionKeywords) {
                        if (prefix.endsWith(kw)) {
                            senderName = prefix.slice(0, -kw.length);
                            actionType = kw;
                            break;
                        }
                    }

                    messages.push({
                        time:   lineMatch[1],
                        sender: senderName,
                        action: actionType,
                        text:   lineMatch[3].trim()
                    });
                }
                
                // 兜底：AI 没按格式输出时整体抓取
                if (messages.length === 0 && textBlock.length > 0) {
                    let defaultSender = currentChatType === 'private'
                        ? charName
                        : ((chat.members && chat.members.length > 0) ? chat.members[0].realName : '系统');
                    messages.push({
                        time:   null,
                        sender: defaultSender,
                        action: isOffline ? "的动作" : "的消息",
                        text:   textBlock.replace(/^[（(]|[）)]$/g, '').trim()
                    });
                }

                if (messages.length > 0) {
                    proactiveOptions[slotId] = {
                        probability: prob !== null ? prob : 100,
                        messages
                    };
                }
            }
        });

        // 切割：砍掉正文中所有顺风车标签
        processedContent = processedContent.replace(/#SECRET_CHAT_[A-Z]+(?:_\d+%?)?#[\s\S]*/gi, "").trim();

        if (Object.keys(proactiveOptions).length > 0 && typeof pushProactiveMessage === 'function') {
            pushProactiveMessage(chat.id, 'time_window_summary', proactiveOptions, 24);
            console.log("[赠品] 已将赠品放入奖池，等待开奖！");
        }
    }

    // === [v1.6] 预生成 summaryId，供块解析和 newItem 共用 ===
    const preGeneratedId = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    // === [v1.6] 解析片段块摘要，写入 memoryChunks ===
    // 执行顺序：SECRET_CHAT 已剥离 → 解析 CHUNK_BLOCK → 再剥离 CHUNK_BLOCK → 解析【标题】【内容】
    let blockIds = [];
    let parsedBlocks = [];  // [v1.6+] 提升作用域，供后续聚合 content 使用
    if (type === 'summary' && messageChunks?.length > 0) {
        parsedBlocks = _parseChunkBlocks(processedContent, messageChunks, chat.id, preGeneratedId);

        // 从正文中剥离块标签（截断第一个 #CHUNK_BLOCK_0# 之后的所有内容）
        const firstChunkIdx = processedContent.indexOf('#CHUNK_BLOCK_0#');
        if (firstChunkIdx !== -1) {
            processedContent = processedContent.substring(0, firstChunkIdx).trim();
        }

        // 同步到 chat.memoryChunks，覆盖同 summaryId 旧块（重新生成时）
        if (!chat.memoryChunks) chat.memoryChunks = [];
        chat.memoryChunks = chat.memoryChunks.filter(c => c.summaryId !== preGeneratedId);
        chat.memoryChunks.push(...parsedBlocks);
        await saveChunksToDB(parsedBlocks);

        blockIds = parsedBlocks.map(b => b.blockId);

        const failCount = parsedBlocks.filter(b => !b.parseSuccess).length;
        if (failCount > 0) {
            console.warn(`[Summary] ${failCount}/${parsedBlocks.length} 个片段块摘要解析失败，可在详情页二次调用`);
        }
    }
    
    // === 解析【标题】【内容】===
    let title   = "无题";
    let content = processedContent;

    const titleIndex   = processedContent.indexOf('【标题】');
    const contentIndex = processedContent.indexOf('【内容】');

    if (titleIndex !== -1 && contentIndex !== -1 && contentIndex > titleIndex) {
        const rawTitle = processedContent.substring(titleIndex + 4, contentIndex).trim();
        title   = rawTitle.replace(/\*\*/g, '').replace(/^#+\s*/, '').replace(/[:：]/g, '').trim();
        content = processedContent.substring(contentIndex + 4).trim();
    } else {
        // 兜底：尝试去除思考脉络
        let cleanContent = processedContent;
        if (cleanContent.includes('### 📖') || cleanContent.includes('### 🧠')) {
            cleanContent = cleanContent.split(/###[📖🧠]/)[1];
        } else if (cleanContent.includes('【内容】')) {
            cleanContent = cleanContent.split('【内容】')[1];
        }
        
        const lines = cleanContent.split('\n').filter(l => l.trim() !== '');
        if (lines.length > 0) {
            const firstLine = lines[0].replace(/^(标题|Title)[:：]?\s*/i, '').replace(/\*\*/g, '');
            if (firstLine.length < 50) {
                title   = firstLine;
                content = lines.slice(1).join('\n').trim();
            }
        }
    }
    
    // 兜底中的兜底
    if (!title || title === "无题") {
        const d = new Date();
        title = `${d.getMonth() + 1}月${d.getDate()}日的记录`;
    }

    // [v1.6+] 用各块 detailedContent 聚合覆盖 content（供长期总结生成器读取详细素材）
    if (parsedBlocks.length > 0) {
        const detailedParts = parsedBlocks
            .filter(b => b.detailedContent)
            .sort((a, b) => a.chunkIndex - b.chunkIndex)
            .map(b => {
                const rangeStr = (b.startMsgIndex && b.endMsgIndex)
                    ? `（消息${b.startMsgIndex}–${b.endMsgIndex}）`
                    : `（片段${b.chunkIndex + 1}）`;
                return `${rangeStr}\n${b.detailedContent}`;
            });
        if (detailedParts.length > 0) {
            content = detailedParts.join('\n\n');
        }
    }

    // === 组装新条目 ===    
    const formattedNow = occurredAtOverride
        || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const newItem = {
        id:          preGeneratedId,   // [v1.6] 使用预生成 ID
        range:       { start, end },
        title,
        content,
        blockIds,                       // [v1.6] 关联的片段块 ID 列表（空数组=无块）
        createdAt:   Date.now(),
        occurredAt:  formattedNow,
        isFavorited: false
    };

    if (currentChatType === 'group') {
        if (type === 'summary') {
            if (!chat.memorySummaries) chat.memorySummaries = [];
            chat.memorySummaries.push(newItem);
        }
    } else {
        if (type === 'summary') {
            if (!chat.memorySummaries) chat.memorySummaries = [];
            chat.memorySummaries.push(newItem);
        } else {
            if (!chat.memoryJournals) chat.memoryJournals = [];
            chat.memoryJournals.push(newItem);
        }
    }

    // ★ V6：精准保存到 memories 独立表（不再依赖 saveSingleChat）
    const memType = type === 'summary' ? 'short' : 'journal';
    await saveMemoryItem(newItem, chat.id, memType);
}


// ============================================================
//  短期总结 / 日记 生成入口
// ============================================================

async function generateMemoryContent(start, end, generateBoth, occurredAtOverride = null) {
    const generateBtn = document.getElementById('generate-new-journal-btn');
    generateBtn.disabled    = true;
    generateBtn.style.opacity = '0.5';
    isGenerating = true;
    let toastMsg = currentMemoryTab === 'summary' ? '正在生成剧情总结...' : '正在生成角色日记...';
    if (generateBoth) toastMsg = '正在同时生成总结和日记...';
    const hideLoading = showLoadingToast(toastMsg);

    try {
        const chat = getCurrentChatObject();
        if (!chat) throw new Error("未找到聊天对象");
        const startIndex = start - 1;
        const endIndex   = end;
        if (startIndex < 0 || endIndex > chat.history.length || startIndex >= endIndex) {
            throw new Error("无效的消息范围");
        }

        if (currentMemoryTab === 'summary') {
            await performGeneration(chat, start, end, 'summary', occurredAtOverride);
            if (generateBoth) {
                await performGeneration(chat, start, end, 'journal', occurredAtOverride);
            }
        } else {
            if (currentChatType === 'group') throw new Error("群聊不支持日记");
            await performGeneration(chat, start, end, 'journal', occurredAtOverride);
        }
        // ★ V6：performGeneration 内部已精准保存到 memories 表，无需 saveSingleChat
        renderMemoryScreen();
        showToast('生成完成！');
    } catch (error) {
        console.error(error);
        showToast('生成失败: ' + error.message);
    } finally {
        hideLoading();
        isGenerating          = false;
        generateBtn.disabled  = false;
        generateBtn.style.opacity = '1';
    }
}


// ============================================================
//  长期总结生成入口
// ============================================================

async function generateLongTermSummaryContent(startDateStr, endDateStr) {
    const generateBtn = document.getElementById('generate-new-journal-btn');
    generateBtn.disabled    = true;
    generateBtn.style.opacity = '0.5';
    isGenerating = true;
    
    const hideLoading = showLoadingToast('正在精炼长期总结...');

    try {
        const chat = getCurrentChatObject();
        if (!chat) throw new Error("未找到聊天对象");

        // 1. 筛选当前时间范围内的短期总结（素材）
        const shortSummaries = (chat.memorySummaries || []).filter(item => {
            if (!item.occurredAt) return false;
            const itemDate = item.occurredAt.split(' ')[0];
            return itemDate >= startDateStr && itemDate <= endDateStr;
        });

        if (shortSummaries.length === 0) {
            throw new Error(`在 ${startDateStr} 至 ${endDateStr} 期间没有找到可用的短期总结。`);
        }

        const contextText = shortSummaries.map(s => {
            // [v1.6+] 找出该短期总结下的非日常块，附亮点注解供 LLM 聚焦
            const nonRoutineChunks = (chat.memoryChunks || [])
                .filter(c => c.summaryId === s.id && c.isRoutine === false);
            let annotation = '';
            if (nonRoutineChunks.length > 0) {
                const highlights = nonRoutineChunks
                    .map(c => c.summary || c.detailedContent)
                    .filter(Boolean)
                    .slice(0, 3)
                    .map(t => t.length > 60 ? t.slice(0, 60) + '…' : t)
                    .join('；');
                if (highlights) annotation = `\n⚑ 非日常亮点：${highlights}`;
            }
            return `[日期: ${s.occurredAt.split(' ')[0]}] ${s.title}\n${s.content}${annotation}`;
        }).join('\n\n----------------\n\n');

        // 2. 获取此日期之前的长期总结（历史背景）
        const previousLongTermContext = (chat.longTermSummaries || [])
            .filter(s => s.isFavorited && s.endDate < startDateStr) 
            .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
            .map(s => `[历史阶段 ${s.startDate}~${s.endDate}] ${s.title}\n${s.content}`)
            .join('\n\n');

        let historyPromptPart = "";
        if (previousLongTermContext) {
            historyPromptPart = `【前情提要 / 历史阶段总结】\n以下是本次总结之前发生过的长期剧情，请基于这些历史脉络进行续写和总结：\n${previousLongTermContext}\n`;
        }

        // 3. 获取并拆分世界书
        const boundIds    = chat.summaryWorldBookIds || [];
        const allBoundWbs = boundIds.map(id => db.worldBooks.find(w => w.id === id)).filter(Boolean);

        const wbBefore  = allBoundWbs.filter(wb => wb.position === 'before').map(wb => wb.content).join('\n');
        const wbAfter   = allBoundWbs.filter(wb => wb.position === 'after').map(wb => wb.content).join('\n');
        const wbWriting = allBoundWbs.filter(wb => wb.position === 'writing').map(wb => wb.content).join('\n');

        // 4. 提取人物设定
        const charName    = chat.realName  || '未知角色';
        const charPersona = chat.persona   || '无特定人设';
        const userName    = chat.myName    || '用户';
        const userPersona = chat.myPersona || '无特定人设';

        // 5. 构建 Prompt
        const systemPrompt = `你是一个专业的传记作家和剧情记录官。
任务：将用户提供的多段"短期剧情总结"合并并精炼成一份"长期总结"。
时间范围：${startDateStr} 至 ${endDateStr}。

【世界观/背景设定】
${wbBefore}

【人物关系背景】
- 主角（${charName}）：${charPersona}
- 互动对象（${userName}）：${userPersona}

${historyPromptPart}

【重要事项】
${wbAfter}

【写作核心指令 - 请严格遵守】
1. **精准的因果叙事**：
   - **拒绝模糊概括**：严禁使用"通过了考验"、"解决了问题"这种笼统描述。必须写出**具体的考验内容**（如：岳父的学术盘问）和**具体的解决手段**（如：承诺去收集魔法材料）。
   - **保留关键背景**：重要事件发生时，必须交代**时间节点与特殊场合**（例如：不能只写"见家长"，要写明是"在魔界入冬节的家庭聚会上"）。

2. **伏笔与任务线（极重要）**：
   - 必须单独关注并记录**未完结的剧情**、**新开启的任务**以及**遗留的代价**。
   - **特别是**：若有宠物/人员被迫滞留、或者为了达成未来目标需要进行特定的行动（如收集材料、打工等），这是推动后续剧情的核心动力，**绝不可省略**。

3. **去重与精炼逻辑**：
   - 仅合并重复的日常打情骂俏（如反复的早安吻）。
   - **保留**所有推动剧情向前发展的具体事件、冲突、新道具获得、新地图开启。

4. **日常与非日常的权重**：
   - 素材段落中标有「⚑ 非日常亮点」的部分，代表情节明显推进或情感高潮，**优先详述**。
   - 纯日常闲聊片段经合并后可一句话带过（如"两人保持着日常的温馨互动"），不必逐一展开。

${wbWriting ? `\n【特别文风/内容指导】：\n${wbWriting}\n` : ''}

请严格遵守以下输出格式：
【标题】(概括这段时期的核心转折或大事件，富有文学性)
【内容】(按时间发展脉络撰写，保留上述要求的关键细节和伏笔)
`;

const { url, key, model, temperature: presetTemp, streamEnabled } = _getMemoryApiConfig('summary', chat);
const rawContent = await _fetchCompletion(url, key, {
    model,
    messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: `以下是本阶段(${startDateStr}至${endDateStr})的详细记录，请进行精炼：\n\n${contextText}` }
    ],
    temperature: presetTemp ?? 0.5,
    ...(streamEnabled ? { stream: true } : {})
});

        // === 解析逻辑 ===
        let title   = "长期阶段总结";
        let content = rawContent;

        const titleIndex   = rawContent.indexOf('【标题】');
        const contentIndex = rawContent.indexOf('【内容】');

        if (titleIndex !== -1 && contentIndex !== -1 && contentIndex > titleIndex) {
            const rawTitle = rawContent.substring(titleIndex + 4, contentIndex).trim();
            title   = rawTitle.replace(/\*\*/g, '').replace(/^#+\s*/, '').replace(/[:：]/g, '').trim();
            content = rawContent.substring(contentIndex + 4).trim();
        } else {
            const lines = rawContent.split('\n').filter(l => l.trim() !== '');
            if (lines.length > 0) {
                const firstLine = lines[0].replace(/^(标题|Title)[:：]?\s*/i, '').replace(/\*\*/g, '');
                if (firstLine.length < 50) {
                    title   = firstLine;
                    content = lines.slice(1).join('\n').trim();
                }
            }
        }

        const newItem = {
            id:          `long_mem_${Date.now()}`,
            startDate:   startDateStr,
            endDate:     endDateStr,
            title,
            content,
            createdAt:   Date.now(),
            isFavorited: false 
        };

        if (!chat.longTermSummaries) chat.longTermSummaries = [];
        chat.longTermSummaries.push(newItem);

        // 自动取消短期总结收藏
        let cancelCount = 0;
        shortSummaries.forEach(s => {
            if (s.isFavorited) {
                s.isFavorited = false;
                cancelCount++;
                // ★ V6：精准更新已改动的短期总结条目
                saveMemoryItem(s, currentChatId, 'short');
            }
        });

        // ★ V6：精准保存新生成的长期总结
        await saveMemoryItem(newItem, currentChatId, 'long');
        renderMemoryScreen();
        showToast(`长期总结已生成！已取消 ${cancelCount} 条短期总结的收藏。`);

    } catch (error) {
        console.error(error);
        showToast('生成失败: ' + error.message);
    } finally {
        hideLoading();
        isGenerating          = false;
        generateBtn.disabled  = false;
        generateBtn.style.opacity = '1';
    }
}
