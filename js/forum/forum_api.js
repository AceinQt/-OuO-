// forum_api.js - AI上下文与API：在看帖上下文、生成上下文、API配置、流式fetch

            function getWatchingPostsContext() {
                if (!db.watchingPostIds || db.watchingPostIds.length === 0) return "";

                let context = "\n【角色正在浏览/关注的论坛帖子】\n(注意：这是当前打开的、角色正在手机屏幕上看到的帖子内容，角色可以对此发表看法)\n";

                // 遍历所有在看的帖子 ID
                db.watchingPostIds.forEach((id, index) => {
                    const post = db.forumPosts.find(p => p.id === id);
                    if (post) {
                        const timeStr = new Date(post.timestamp).toLocaleString();
                        context += `\n--- 帖子 ${index + 1} ---\n`;
                        context += `标题：${post.title.replace(/^\[New!\]\s*/, '')}\n`;
                        context += `作者：${post.username}\n`;
                        context += `发布时间：${timeStr}\n`;
                        context += `正文内容：${post.content}\n`;

                        if (post.comments && post.comments.length > 0) {
                            context += `\n评论区：\n`;
                            post.comments.forEach((c, cIdx) => {
                                context += `${cIdx + 1}. ${c.username}: ${c.content}\n`;
                            });
                        } else {
                            context += `\n评论区：暂无评论\n`;
                        }
                        context += `-------------------\n`;
                    }
                });

                return context;
            }

function getForumGenerationContext() {
    let context = "这是一个名叫“喵坛”的社区，以下是背景设定和主要角色信息（仅供你理解世界观和潜台词）。\n";

    // 获取绑定信息
    // 1. 读取 historyLimit，如果没有则默认为 50
    const bindings = db.forumBindings || { worldBookIds: [], charIds: [], groupIds: [], useChatHistory: false, historyLimit: 50 };
    
    // 确保它是数字，防止读取出错（兜底逻辑）
    const historyLimit = Number(bindings.historyLimit) || 50; // <--- 新增：获取保存的条数
    
    
    const now = new Date();
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const currentWeekDay = weekDays[now.getDay()]; 
    const currentTime = `${now.getFullYear()}年${pad(now.getMonth() + 1)}月${pad(now.getDate())}日 星期${currentWeekDay} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    // --- 1. 预处理：分别提取三种位置的世界书内容 ---
    let wbBefore = "";
    let wbAfter = "";

    if (bindings.worldBookIds && bindings.worldBookIds.length > 0) {
        // 提取 Before
        wbBefore = bindings.worldBookIds
            .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'before'))
            .filter(Boolean).map(wb => wb.content).join('\n');
        
        // 提取 After
        wbAfter = bindings.worldBookIds
            .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'after'))
            .filter(Boolean).map(wb => wb.content).join('\n');

    }

    // --- 2. 组装顺序：背景 -> 文风 -> 角色 -> After -> 用户 ---

    // (A) 背景设定 (Before)
    if (wbBefore) {
        context += "===== 世界观及背景设定 =====\n";
        context += `${wbBefore}\n\n`;
    }


    // (C) 角色人设 (Characters)
    // 记录已注入过人设的角色卡 id，群聊分支据此去重，避免同一个角色的人设进两遍浪费 token
    const injectedCharIds = new Set();

    if (bindings.charIds && bindings.charIds.length > 0) {
        context += "===== 主要角色人设 & 近期动态 =====\n";

        bindings.charIds.forEach(id => {
            const char = db.characters.find(c => c.id === id);
            if (char) {
                injectedCharIds.add(char.id);
                context += `--- 角色: ${char.realName} ---\n`;
                context += `人设描述: ${char.persona}\n`;

                if (bindings.useChatHistory) {
                    if (char.history && char.history.length > 0) {
                        const recentHistory = char.history.slice(-historyLimit);
                        const historyStr = recentHistory.map(msg => {
                            const roleLabel = msg.role === 'user' ? 'User' : 'Character';
                            let cleanContent = msg.content;
                            if (typeof cleanContent !== 'string') cleanContent = "[非文本消息]";
                            return `${roleLabel}: ${cleanContent}`;
                        }).join('\n');
                        context += `[近期私聊记录]:\n${historyStr}\n`;
                    } else {
                        context += `[近期私聊记录]: 暂无\n`;
                    }
                } else {
                    context += `[近期私聊记录]: (已关闭记忆关联)\n`;
                }
                context += "\n";
            }
        });
    }

    // (C2) 群聊人设 & 近期动态 (Groups)
    if (bindings.groupIds && bindings.groupIds.length > 0) {
        context += "===== 关联群聊 & 近期动态 =====\n";

        bindings.groupIds.forEach(id => {
            const group = (db.groups || []).find(g => g.id === id);
            if (group) {
                context += `--- 群聊: ${group.name} ---\n`;

                const memberLines = [];
                const memberDisplayNames = {}; // 成员id -> 显示名，供下面的聊天记录复用，避免用到过期快照名
                (group.members || []).forEach(m => {
                    // 优先回查原角色卡拿最新的真名/昵称/人设，与 group_prompt.js 的口径保持一致
                    const originalChar = m.originalCharId
                        ? (db.characters || []).find(c => c.id === m.originalCharId)
                        : null;
                    const realName = (originalChar && originalChar.realName)  || m.realName;
                    const nickname = (originalChar && originalChar.remarkName) || m.groupNickname;
                    const persona  = (originalChar && originalChar.persona)   || m.persona;

                    const displayName = realName || nickname;
                    if (!displayName) return;
                    memberDisplayNames[m.id] = displayName;
                    const nickPart = (nickname && nickname !== displayName) ? `（群昵称：${nickname}）` : '';

                    // 该角色的人设若上面已经注入过（单独绑定了它，或它同时在别的关联群里），这里只留个名字
                    if (originalChar && injectedCharIds.has(originalChar.id)) {
                        memberLines.push(`- ${displayName}${nickPart}：人设见上文，不再重复`);
                        return;
                    }
                    if (originalChar) injectedCharIds.add(originalChar.id);

                    memberLines.push(`- ${displayName}${nickPart}：${persona || '无特定人设'}`);
                });
                if (memberLines.length) context += `群成员及人设:\n${memberLines.join('\n')}\n`;

                if (bindings.useChatHistory) {
                    if (group.history && group.history.length > 0) {
                        const recentHistory = group.history.slice(-historyLimit);
                        const historyStr = recentHistory.map(msg => {
                            let name;
                            if (msg.role === 'user') {
                                name = group.me?.realName || 'User';
                            } else {
                                name = memberDisplayNames[msg.senderId] || '未知成员';
                            }
                            let cleanContent = msg.content;
                            if (typeof cleanContent !== 'string') cleanContent = "[非文本消息]";
                            return `${name}: ${cleanContent}`;
                        }).join('\n');
                        context += `[近期群聊记录]:\n${historyStr}\n`;
                    } else {
                        context += `[近期群聊记录]: 暂无\n`;
                    }
                } else {
                    context += `[近期群聊记录]: (已关闭记忆关联)\n`;
                }
                context += "\n";
            }
        });
    }



    // (E) 用户人设 (User)
    if (db.forumUserIdentity) {
        context += "===== (用户/User) 的人设 =====\n";
        context += `用户的昵称: ${db.forumUserIdentity.nickname || 'User'}\n`;
        // 如果有真名，加入真名
        if (db.forumUserIdentity.realName) {
            context += `用户的姓名: ${db.forumUserIdentity.realName}\n`;
        }
        if (db.forumUserIdentity.persona) {
            context += `用户的设定: ${db.forumUserIdentity.persona}\n`;
        }
        context += `注意：发帖人或者评论人绝对不是用户/user。\n\n`;
    }

    // (D) 其他事项 (After) - 移动到了角色人设后面
    if (wbAfter) {
        context += "===== 重要事项 =====\n";
        context += `${wbAfter}\n\n`;
    }

    context += `当前日期和时间是${currentTime}\n\n`;

    if (context.length < 50) {
        return `当前日期和时间是${currentTime}，没有提供任何特定的背景设定，请自由发挥。`;
    }

    return context;
}

/** 获取论坛功能的 API 配置（优先读 forumBindings.apiPresetName，fallback 全局默认） */
function _getForumApiConfig() {
    const presetName = (db.forumBindings || {}).apiPresetName || '';
    if (presetName) {
        const preset = (db.apiPresets || []).find(p => p.name === presetName && (!p.type || p.type === 'chat'));
        if (preset && preset.data) {
            const d = preset.data;
            return {
    url: d.url || d.apiUrl || '',
    key: d.key || d.apiKey || '',
    model: d.model || '',
    stream: d.streamEnabled !== false,
    temperature: d.temperature ?? 1.0   // ← 加这行
};
        }
    }
    const s = db.apiSettings || {};
    return {
        url: s.url || s.apiUrl || '',
        key: s.key || s.apiKey || '',
        model: s.model || '',
        stream: s.streamEnabled !== false,
    temperature: s.temperature
    };
}

/** 流式 fetch，返回完整文本；onChunk(delta, accumulated) 实时回调 */
async function _forumStreamFetch(url, key, requestBody, onChunk) {
    const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ ...requestBody, stream: true })
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;
            try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                    full += delta;
                    if (onChunk) onChunk(delta, full);
                }
            } catch { /* 忽略解析错误 */ }
        }
    }
    return full;
}

