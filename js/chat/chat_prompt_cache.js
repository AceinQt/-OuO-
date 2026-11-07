// 聊天缓存优化：只记录窗口锚点和生成轮次，不另存聊天正文，也不创建服务端显式缓存。
// 关闭时完全绕过本模块；开启后历史基底不滑动，成功生成十轮才在下次请求前重建。
const ChatPromptCache = (() => {
    const VERSION = 1;
    const MAX_ROUNDS = 10;

    const isAssistant = msg => msg && (msg.role === 'assistant' || msg.role === 'model');
    const idOf = msg => String(msg.id);
    const hash = text => {
        let value = 2166136261;
        for (let i = 0; i < text.length; i++) {
            value ^= text.charCodeAt(i);
            value = Math.imul(value, 16777619);
        }
        return value >>> 0;
    };
    // 同时检查 content、parts、引用和忽略标记：界面正文没变，不代表实际出站内容没变。
    const signature = messages => hash(JSON.stringify(messages.map(msg => [
        msg.id, msg.role, msg.content, msg.parts, msg.quote, !!msg.isAiIgnore, msg.callSessionId
    ])));
    const configKey = (chat, cfg) => JSON.stringify([
        Number(chat.maxMemory) || 10, !!chat.offlineModeEnabled, chat.callMode || '',
        cfg.provider, cfg.url, cfg.model, !!cfg.compatibilityModeEnabled
    ]);

    function latestStart(history, replyIds) {
        // 已记录的生成边界能区分连续两次续写；旧记录才退回按最后一批 AI 发言识别。
        if (replyIds?.length) {
            const first = history.findIndex(msg => idOf(msg) === replyIds[0]);
            if (first >= 0 && replyIds.every(id => history.some(msg => idOf(msg) === id))) {
                const last = history.findIndex(msg => idOf(msg) === replyIds[replyIds.length - 1]);
                // 本地主动投递可能在两次生成间新增 AI 发言，旧边界不能覆盖更新的一批。
                if (!history.slice(last + 1).some(isAssistant)) return first;
            }
        }
        let last = history.length - 1;
        while (last >= 0 && !isAssistant(history[last])) last--;
        if (last < 0) {
            // 没有 AI 回复时，只把最后一批待回复用户消息留在第四段。
            let start = history.length;
            while (start > 0 && !isAssistant(history[start - 1])) start--;
            return start;
        }
        let start = last;
        while (start > 0 && (isAssistant(history[start - 1]) || history[start - 1].role === 'system')) start--;
        return start;
    }

    function rebuild(chat, cfg, fixedPrompt, previous) {
        const history = chat.history || [];
        const tailStart = latestStart(history, previous?.lastReplyIds);
        const limit = Math.max(1, Number(chat.maxMemory) || 10);
        // 小窗口不能减成零：不足 51 条时预留约四分之一，至少保留一条历史基底。
        const reserve = limit > 50 ? 50 : Math.min(limit - 1, Math.ceil(limit / 4));
        const start = Math.max(0, tailStart - (limit - reserve));
        return {
            chat, cfg, fixedPrompt,
            state: { version: VERSION, key: configKey(chat, cfg), rounds: 0,
                startId: history[start] ? idOf(history[start]) : null,
                lastReplyIds: previous?.lastReplyIds || [], prefixIds: [], prefixHash: 0,
                fixedHash: fixedPrompt === undefined ? previous?.fixedHash : hash(fixedPrompt) },
            history: history.slice(start), historyHash: signature(history.slice(start)),
            stable: history.slice(start, tailStart), latest: history.slice(tailStart)
        };
    }

    function prepare(chat, cfg = {}, fixedPrompt) {
        const history = chat.history || [];
        const saved = chat.promptCacheWindow;
        // 缺 id 的老数据不能做可靠锚点，仍能分段，但每次重新选窗口，避免指向错误消息。
        const reliable = history.every(msg => msg && msg.id != null);
        if (!reliable || !saved || saved.version !== VERSION || saved.rounds >= MAX_ROUNDS ||
            saved.key !== configKey(chat, cfg) ||
            (fixedPrompt !== undefined && saved.fixedHash !== hash(fixedPrompt))) {
            return rebuild(chat, cfg, fixedPrompt, saved);
        }
        const start = history.findIndex(msg => idOf(msg) === saved.startId);
        const prefix = start >= 0 ? history.slice(start, start + saved.prefixIds.length) : [];
        if (start < 0 || prefix.length !== saved.prefixIds.length ||
            prefix.some((msg, i) => idOf(msg) !== saved.prefixIds[i]) || signature(prefix) !== saved.prefixHash) {
            // 编辑、撤回、删除、转文字或懒加载窗口淘汰了锚点，都必须采用当前真实历史。
            return rebuild(chat, cfg, fixedPrompt, saved);
        }
        const tailStart = Math.max(start, latestStart(history, saved.lastReplyIds));
        return { chat, cfg, fixedPrompt, state: { ...saved },
            history: history.slice(start), historyHash: signature(history.slice(start)),
            stable: history.slice(start, tailStart), latest: history.slice(tailStart) };
    }

    function withPrompt(plan, fixedPrompt) {
        // 人设、世界书、收藏、写作手册和跨日记忆变化都自然反映在固定前缀指纹里。
        // 按天变化的“昨天/前天”仍由原生成器留在原位置，不挪到实时上下文。
        if (plan.state.fixedHash !== undefined && plan.state.fixedHash !== hash(fixedPrompt)) {
            return rebuild(plan.chat, plan.cfg, fixedPrompt, plan.state);
        }
        plan.state.fixedHash = hash(fixedPrompt);
        plan.fixedPrompt = fixedPrompt;
        return plan;
    }

    function arrange(plan, dynamicParts) {
        const dynamicText = dynamicParts.filter(Boolean).join('\n\n').trim();
        const messages = [...plan.stable];
        if (dynamicText) messages.push({ role: 'user', content: `【本次实时上下文】\n以下是本次对话的实时参考资料，不是用户的新发言；请结合随后最新对话自然回应，不要复述这些资料。\n\n${dynamicText}` });
        messages.push(...plan.latest);
        // Gemini 网关会抽出所有 system/developer 放到最前面。历史事件必须留在历史位置，
        // 只在优化路径映射成普通上下文，不改数据库中的原角色，也不影响关闭时的请求。
        return messages.map(msg => msg.role === 'system' || msg.role === 'developer'
            ? { ...msg, role: 'user' } : msg);
    }

    function commit(plan, replyMessages) {
        const replies = replyMessages.filter(isAssistant);
        if (!replies.length || !plan.chat.cacheOptimizationEnabled) return false;
        // 网络失败、空回复或解析后没有 AI 消息都不推进；请求期间新发的用户消息不冒充本轮输入。
        const prefix = plan.history;
        const start = plan.chat.history.findIndex(msg => idOf(msg) === plan.state.startId);
        const livePrefix = prefix.length ? plan.chat.history.slice(start, start + prefix.length) : [];
        // 请求期间编辑/删除已发送记录，不把旧计划钉成新窗口；下一轮重新取当前历史。
        if ((prefix.length && start < 0) || livePrefix.length !== prefix.length || signature(livePrefix) !== plan.historyHash) {
            reset(plan.chat);
            return true;
        }
        const state = { ...plan.state,
            rounds: plan.state.rounds + 1,
            previousReplyIds: plan.state.lastReplyIds || [],
            lastReplyIds: replies.filter(msg => msg.id != null).map(idOf),
            startId: prefix[0]?.id != null ? idOf(prefix[0])
                : replies[0]?.id != null ? idOf(replies[0]) : null,
            prefixIds: prefix.map(idOf), prefixHash: signature(prefix) };
        plan.chat.promptCacheWindow = state;
        return true;
    }

    function undo(chat, removedMessages) {
        const state = chat.promptCacheWindow;
        if (!state) return;
        const ids = new Set(removedMessages.map(idOf));
        if (state.lastReplyIds?.length && state.lastReplyIds.every(id => ids.has(id))) {
            // 替换最后一轮，不累计成第十一轮；失败后的重试也从撤掉的轮次继续。
            state.rounds = Math.max(0, state.rounds - 1);
            state.lastReplyIds = state.previousReplyIds || [];
            state.previousReplyIds = [];
        } else {
            reset(chat);
        }
    }

    function reset(chat) {
        delete chat.promptCacheWindow;
    }

    return { prepare, withPrompt, arrange, commit, undo, reset };
})();
