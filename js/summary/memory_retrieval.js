// memory_retrieval.js
// 【职责】向量检索 + 重排序，供 AI service 调用
//
// v1.6 变更：
// - rerankScore() 使用 chunk.emotionScore 替代文本长度粗估
// - retrieveTopChunks() 返回 [{chunk, score}] 以支持分级内容注入
// - formatRetrievedContext() 按分数分三级：高→原文 / 中→短期总结全文 / 低→块摘要
// - 新增 _reconstructRawText()：通过父总结 range 指针实时重建原文

const DEFAULT_TOP_K       = 2;
const DEFAULT_QUERY_TURNS = 1;
const DEFAULT_MIN_SCORE   = 0.30;

// 分级阈值
const MAX_RERANK_SCORE = 1.28;
const TIER_MID_RATIO   = 0.15;  // 摘要 → 总结
const TIER_HIGH_RATIO  = 0.55;  // 总结 → 原文
// ── [v1.6+] 负面情绪词集合（emotion 字段参与半衰期 & memorability 判断）────
const NEGATIVE_EMOTION_WORDS = new Set([
    // 英文
    'melancholy','sad','tense','anxious','anger','grief','despair',
    'fear','hurt','bitter','frustrated','lonely','regret','sorrow',
    'guilt','shame','betrayal','panic','jealous','envy','dread',
    // 中文
    '忧郁','悲伤','紧张','焦虑','愤怒','悲痛','绝望','恐惧',
    '痛苦','苦涩','沮丧','孤独','遗憾','悲哀','委屈','后悔','恐慌'
]);

// ── [新增] 强正面/浪漫情绪词集合 ────
const POSITIVE_EMOTION_WORDS = new Set([
    // 英文
    'romantic', 'touching', 'excited', 'love', 'sweet', 'affectionate', 'passionate', 'thrilled', 'moved',
    // 中文
    '浪漫', '感动', '心动', '甜蜜', '幸福',
    '兴奋', '激动', '喜悦', '深情', '温馨'
]);

/** emotion 字符串是否属于强烈情绪（正面或负面） */
function _isStrongEmotion(emotion) {
    if (!emotion) return false;
    const e = emotion.trim().toLowerCase();
    return NEGATIVE_EMOTION_WORDS.has(e) || POSITIVE_EMOTION_WORDS.has(e);
}

/**
 * 返回该 chunk 的时间衰减半衰期（天）。
 */
function _getHalfLifeDays(chunk) {
    if (chunk.isRoutine === true) return 30;         // 日常闲聊，1个月后淡忘
    if (_isStrongEmotion(chunk.emotion)) return 180; // 强情绪（大吵一架或极其浪漫），半年半衰期
    return 90;                                       // 普通非日常剧情，3个月半衰期
}

// 余弦相似度
function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}

// Bayesian 重排序分数 (乘法锚定优化版)
function rerankScore(cosine, chunk, now) {
    // 抹平负相关性，确保底数为正
    const baseCosine = Math.max(0, cosine);

    const daysDiff  = (now - (chunk.endTime || chunk.timestamp || 0)) / (1000 * 60 * 60 * 24);
    const halfLife  = _getHalfLifeDays(chunk);
    const timeDecay = Math.exp(-daysDiff / halfLife);

    const emotionBoost = chunk.emotionScore != null ? chunk.emotionScore : 0.5;
    const accessBoost  = Math.min(Math.log1p(chunk.accessCount || 0) * 0.1, 0.20);

    const isRoutine = chunk.isRoutine === true;
    const memorabilityFactor = 1.0
        + (!isRoutine ? 0.20 : 0)
        + (_isStrongEmotion(chunk.emotion) ? 0.20 : 0);

    // 【核心修复】：将原先的独立加分，改为以 baseCosine 为绝对基底。
    // 即：时间、情绪的加成，必须乘以向量相似度本身。如果相似度低，这些加成都将归零。
    const weightedScore = (baseCosine * 0.60)
                        + (baseCosine * timeDecay * 0.18)
                        + (baseCosine * emotionBoost * 0.12)
                        + (baseCosine * accessBoost * 0.10);

    return weightedScore * memorabilityFactor;
}

// 主检索函数
// [v1.6] 返回 [{chunk, score}] 以支持 formatRetrievedContext 分级渲染
async function retrieveTopChunks(queryVec, chunks, topK = DEFAULT_TOP_K, minScore = DEFAULT_MIN_SCORE) {
    const now        = Date.now();
    const withScore  = chunks
        .filter(c => c.embedding)
        .map(c => ({
            chunk: c,
            score: rerankScore(cosineSimilarity(queryVec, c.embedding), c, now)
        }))
        .filter(x => x.score >= minScore);

    withScore.sort((a, b) => b.score - a.score);
    const result = withScore.slice(0, topK);

    // 记忆强化：每次被检索到，累计计数 + 记录最后访问时间
    result.forEach(({ chunk }) => {
        chunk.accessCount    = (chunk.accessCount || 0) + 1;
        chunk.lastAccessTime = now;
    });
    if (result.length > 0) saveChunksToDB(result.map(x => x.chunk));

    return result;  // [{chunk, score}, ...]
}

// ── [v1.6] 通过父总结的 range 指针重建原始对话文本 ──────────
// 不依赖持久化的 rawText 字段，节省 IndexedDB 存储空间。
// [Step S3-S4] 异步化：懒加载后老范围不在内存窗口，走 DB。
//   item 可以是 summaryItem（有 .range）或 chunk（有 startTime/endTime + startMsgIndex/endMsgIndex）。
//   chunk 优先用 ts range（热路径 O(log n)），summaryItem 用全局序号 range。
async function _reconstructRawText(item, chat) {
    if (!item) return '';

    const _filterMsg = m => {
        if (m.isAiIgnore || m.isHidden) return false;
        if (m.role === 'system') return false;
        if (m.id && m.id.includes('msg_context_timesense')) return false;
        if (m.content && m.content.includes('[system-display:')) return false;
        if (m.content && m.content.trim().startsWith('[system:')) return false;
        return true;
    };

    const _getName = m => {
        if (m.role === 'user') {
            return (typeof currentChatType !== 'undefined' && currentChatType === 'private')
                ? '我'
                : (chat.me?.realName || '我');
        }
        if (typeof currentChatType !== 'undefined' && currentChatType === 'private') return chat.realName;
        const sender = chat.members?.find(mem => mem.id === m.senderId);
        return sender ? sender.realName : '未知成员';
    };

    let msgs;
    if (window.LAZY_LOAD) {
        if (item.startTime && item.endTime) {
            // chunk 路径：ts range，O(log n)，热路径友好
            msgs = await window.getMessagesByTsRange(chat.id, item.startTime, item.endTime);
        } else if (item.range && typeof item.range.start === 'number' && typeof item.range.end === 'number') {
            msgs = await window.getMessagesByGlobalRange(chat.id, item.range.start, item.range.end);
        } else if (typeof item.startMsgIndex === 'number' && typeof item.endMsgIndex === 'number') {
            msgs = await window.getMessagesByGlobalRange(chat.id, item.startMsgIndex, item.endMsgIndex);
        } else {
            return '';
        }
    } else {
        // 非懒加载：原 slice 路径
        let startIdx, endIdx;
        if (item.range && item.range.start != null) {
            if (typeof item.range.start !== 'number' || typeof item.range.end !== 'number') return '';
            startIdx = item.range.start - 1;
            endIdx   = item.range.end;
        } else if (typeof item.startMsgIndex === 'number' && typeof item.endMsgIndex === 'number') {
            startIdx = item.startMsgIndex - 1;
            endIdx   = item.endMsgIndex;
        } else {
            return '';
        }
        msgs = (chat.history || []).slice(startIdx, endIdx);
    }

    return msgs.filter(_filterMsg)
        .map(m => `${_getName(m)}: ${m.content}`)
        .join('\n');
}

// 把检索结果组装成可注入的文本
// [v1.6] 按分数分三级注入：
// [Step S3-S4] 异步化：高分原文注入走 _reconstructRawText（懒加载时 DB 取老消息）
async function formatRetrievedContext(scoredChunks, chat, minScore = DEFAULT_MIN_SCORE) {
    if (!scoredChunks.length) return '';

    const range     = MAX_RERANK_SCORE - minScore;
    const midThres  = minScore + range * TIER_MID_RATIO;
    const highThres = minScore + range * TIER_HIGH_RATIO;

    return (await Promise.all(scoredChunks.map(async ({ chunk, score }) => {
        const chunkDate = new Date(chunk.startTime || chunk.timestamp || 0);
const today     = new Date();
today.setHours(0, 0, 0, 0);
chunkDate.setHours(0, 0, 0, 0);
const diffDays  = Math.round((today - chunkDate) / (1000 * 60 * 60 * 24));

let dateStr;
if (diffDays === 0) {
    dateStr = '今天';
} else if (diffDays === 1) {
    dateStr = '昨天';
} else if (diffDays === 2) {
    dateStr = '前天';
} else if (diffDays <= 13) {
    // 近两周：相对天数，AI 能精准感知
    dateStr = `${diffDays}天前`;
} else if (diffDays <= 60) {
    // 两周到两个月：相对 + 绝对月份，兼顾感知和语义
    const month = chunkDate.getMonth() + 1;
    const weekStr = Math.round(diffDays / 7);
    dateStr = `约${weekStr}周前（${month}月）`;
} else {
    // 两个月以上：完整绝对日期，AI 能感知年份、季节、月份
    const y = chunkDate.getFullYear();
    const m = chunkDate.getMonth() + 1;
    const d = chunkDate.getDate();
    dateStr = `${y}年${m}月${d}日`;
}
        const emoTag  = chunk.emotion ? ` · ${chunk.emotion}` : '';

        let content;

        if (score >= highThres) {
            // [Step S4] 直接传 chunk（有 startTime/endTime），命中 ts range 快路径
            const raw = await _reconstructRawText(chunk, chat);
            content = raw || chunk.summary || '';
        } else if (score >= midThres) {
            const parentSummary = (chat?.memorySummaries || []).find(s => s.id === chunk.summaryId);
            content             = parentSummary?.content || chunk.summary || '';
        } else {
            content = chunk.summary || '';
        }

        return `[动态记忆 · ${dateStr}${emoTag}]\n${content}`;
    }))).join('\n\n---\n\n');
}

// 判断消息内容是否属于语义空内容（叹词/单字/纯表情）
function _isSemanticEmpty(content) {
    if (!content) return true;
    const c = content.trim();
    if (c.length <= 1) return true;
    if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(c)) return true;
    if (/^(嗯+|啊+|哦+|哈+|哎+|唉+|喔+|噢+|呃+|嗯嗯|好的?|嗯啊|哦哦|啊啊|哈哈+|呵+|哼+|嘿+|好吧|诶|欸|呀+|喂+|哟+|okay|ok|哈哈哈+)$/i.test(c)) return true;
    return false;
}

// 构建查询文本：优先取最新 user 消息；语义为空时 fallback 到最近 N 轮（user+AI）
// fallbackRounds 对应设置项 vectorQueryTurns，含义变为"短消息时兜底的轮数"
function _buildQueryText(history, fallbackRounds) {
    // ── 预过滤：去掉系统消息、time-divider、旁白包装 ──────────
    const filtered = [];
    for (const m of history) {
        let c = m.content || '';
        const nar = c.match(/^\[system-narration:([\s\S]+?)\]$/)
                 || c.match(/^\[剧情旁白：([\s\S]+?)\]$/);
        if (nar) c = nar[1].trim();
        if (!c
            || c === '[time-divider]'
            || /^\[system/.test(c)
            || /^\[系统情景通知：/.test(c)) continue;
        filtered.push({ role: m.role, content: c });
    }
    if (filtered.length === 0) return '';

    // ── 优先路径：取最新一条 user 消息，语义非空则直接返回 ──────
    for (let i = filtered.length - 1; i >= 0; i--) {
        if (filtered[i].role === 'user' && !_isSemanticEmpty(filtered[i].content)) {
            return `我：${filtered[i].content}`;
        }
    }

    // ── fallback：最新 user 消息语义为空（"嗯"/"哈哈"等），
    //    取最近 fallbackRounds 轮（user+AI）补充上下文 ────────────
    const nonEmpty = filtered.filter(m => !_isSemanticEmpty(m.content));
    if (nonEmpty.length === 0) return '';

    const groups = [];
    let gRole  = nonEmpty[nonEmpty.length - 1].role;
    let gStart = nonEmpty.length - 1;
    for (let j = nonEmpty.length - 1; j >= 0; j--) {
        if (nonEmpty[j].role !== gRole) {
            groups.push({ role: gRole, start: j + 1, end: gStart });
            gRole  = nonEmpty[j].role;
            gStart = j;
        }
    }
    groups.push({ role: gRole, start: 0, end: gStart });

    const groupsToTake = Math.min(fallbackRounds * 2, groups.length);
    const cutGroup     = groups[groupsToTake - 1];
    const startIdx     = cutGroup ? cutGroup.start : 0;

    return nonEmpty
        .slice(startIdx)
        .map(m => `${m.role === 'user' ? '我' : 'TA'}：${m.content}`)
        .join('\n');
}

// 对外暴露：给定当前历史消息，执行完整的检索流程
// 返回可直接注入 prompt 的字符串（失败时返回空串，静默降级）
async function buildRetrievedMemoryContext(recentHistory, chat) {
    try {
        const chunks     = chat.memoryChunks || [];
        const vectorized = chunks.filter(c => c.embedding);
        if (vectorized.length === 0) return '';

        const topK       = (chat.vectorTopK       > 0) ? chat.vectorTopK       : DEFAULT_TOP_K;
        const queryTurns = (chat.vectorQueryTurns > 0) ? chat.vectorQueryTurns : DEFAULT_QUERY_TURNS;
        const minScore = (chat.vectorMinScore != null && chat.vectorMinScore >= 0)
                 ? chat.vectorMinScore   // ← 去掉 Math.min(..., 0.45)
                 : DEFAULT_MIN_SCORE;


// 排除已在上下文窗口内的 chunk，避免重复注入
        const maxMemory   = (chat.maxMemory > 0) ? chat.maxMemory : Infinity;
        const ctxWindow   = (chat.history || []).slice(-maxMemory).filter(m => !m.isAiIgnore);
        const ctxStartTime = ctxWindow.length > 0 ? (ctxWindow[0].timestamp || 0) : 0;

        // [v1.6] 排除已收藏总结的 chunks（收藏内容已固定注入 allFavs，避免重复）
        const favoritedSummaryIds = new Set(
            (chat.memorySummaries || []).filter(s => s.isFavorited).map(s => s.id)
        );

        const candidates  = vectorized
            .filter(c => ctxStartTime === 0 || c.endTime < ctxStartTime)
            .filter(c => !favoritedSummaryIds.has(c.summaryId));
        if (candidates.length === 0) return '';

        const queryText = _buildQueryText(recentHistory, queryTurns);
        if (!queryText.trim()) return '';

        // 调 embedding API 获取查询向量
        const queryVec = await callEmbeddingApi(queryText, chat);

        // [v1.6] retrieveTopChunks 返回 [{chunk,score}]，传给 formatRetrievedContext 分级渲染
        const scoredChunks = await retrieveTopChunks(queryVec, candidates, topK, minScore);

        return await formatRetrievedContext(scoredChunks, chat);

    } catch (e) {
        console.warn('[Retrieval] 向量检索失败，降级为空：', e.message);
        return '';
    }
}
