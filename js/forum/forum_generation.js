// forum_generation.js - AI生成：刷新新帖 handleForumRefresh、生成楼层评论 handleGenerateComments、解析与随机网名

            // --- 标签容错：AI（尤其 Gemini）经常把标签拼错/加粗/用全角#/漏掉尾部# ---
            // 思路：解析前先把所有"形似标签"的行归一化回标准写法，后面的解析逻辑就能保持严格。
            const FORUM_TAG_VOCAB = [
                { word: 'AUTHOR',   canon: '#AUTHOR#'  },
                { word: 'TITLE',    canon: '#TITLE#'   },
                { word: 'CONTENT',  canon: '#CONTENT#' },
                { word: 'BODY',     canon: '#CONTENT#' },
                { word: 'REPLY',    canon: '#REPLY#'   },
                { word: 'REPLIES',  canon: '#REPLY#'   },
                // 旧标签 / 常见同义词，一律归到 #REPLY#（务必排在 CONTENT 之后靠编辑距离区分）
                { word: 'COMMENT',  canon: '#REPLY#'   },
                { word: 'COMMENTS', canon: '#REPLY#'   },
                { word: '作者',     canon: '#AUTHOR#'  },
                { word: '标题',     canon: '#TITLE#'   },
                { word: '正文',     canon: '#CONTENT#' },
                { word: '内容',     canon: '#CONTENT#' },
                { word: '评论',     canon: '#REPLY#'   },
                { word: '回复',     canon: '#REPLY#'   }
            ];

            // 首字母兜底表：4 个标准标签首字母互不冲突（A/T/C/R），这是 #C、#R 这类残缺写法的最后一道防线
            const FORUM_TAG_INITIALS = { A: '#AUTHOR#', T: '#TITLE#', C: '#CONTENT#', R: '#REPLY#' };

            function _editDistance(a, b) {
                const m = a.length, n = b.length;
                let prev = Array.from({ length: n + 1 }, (_, j) => j);
                for (let i = 1; i <= m; i++) {
                    const cur = [i];
                    for (let j = 1; j <= n; j++) {
                        cur[j] = Math.min(
                            prev[j] + 1,
                            cur[j - 1] + 1,
                            prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                        );
                    }
                    prev = cur;
                }
                return prev[n];
            }

            // 把一个疑似标签词映射到标准标签；映射不出来返回 null（调用方保持原文不动）
            function _matchForumTag(word) {
                const w = word.toUpperCase();

                // 1. 精确命中（含中文标签）
                const exact = FORUM_TAG_VOCAB.find(t => t.word === w || t.word === word);
                if (exact) return exact.canon;

                // 2. 拼写错误：按编辑距离取最近的词。
                //    这一步能正确区分 COMENTS(距 COMMENTS=1，距 CONTENT=3) 和 CONTNET(距 CONTENT=2)，
                //    比单纯看首字母可靠得多——两者首字母都是 C。
                if (/^[A-Z]+$/.test(w)) {
                    const limit = w.length <= 5 ? 1 : 2;
                    let best = null, bestDist = Infinity;
                    FORUM_TAG_VOCAB.forEach(t => {
                        if (!/^[A-Z]+$/.test(t.word)) return;
                        const d = _editDistance(w, t.word);
                        if (d < bestDist) { bestDist = d; best = t; }
                    });
                    if (best && bestDist <= limit) return best.canon;

                    // 3. 彻底拼烂了，只认首字母
                    if (w.length >= 3 && FORUM_TAG_INITIALS[w[0]]) return FORUM_TAG_INITIALS[w[0]];
                }

                return null;
            }

            function normalizeForumTags(text) {
                if (!text) return '';

                // P1: 整行只有一个标签（最常见）。容忍 全角＃、**加粗**、漏掉尾部#、结尾冒号
                let out = text.replace(
                    /^[ \t]*\*{0,2}[#＃]{1,3}[ \t]*([A-Za-z一-龥]{2,12})[ \t]*[:：]?[#＃]{0,3}\*{0,2}[ \t\r]*$/gm,
                    (full, word) => _matchForumTag(word) || full
                );

                // P2: 标签后面还跟着正文（此时必须有完整的收尾 #，避免误伤正文里的话题词）
                out = out.replace(
                    /^[ \t]*\*{0,2}[#＃]{1,3}[ \t]*([A-Za-z一-龥]{2,12})[ \t]*[#＃]{1,3}\*{0,2}/gm,
                    (full, word) => _matchForumTag(word) || full
                );

                return out;
            }

            // 判断一行是不是 "网名:评论内容" 的形状（用于标签整个丢失时的结构兜底）
            function _looksLikeCommentLine(line) {
                const m = line.match(/^([^\s:：]{1,20})[:：]\s*(\S.*)$/);
                if (!m) return null;

                const name = m[1];
                const body = m[2].trim();
                if (/[。！？，、；“”‘’…—]/.test(name)) return null;   // 名字里带句读，多半是正文
                if (/^[#*\->\[（(]/.test(name)) return null;            // markdown / 括号说明
                if (/^\/\//.test(body)) return null;                    // http:// 这类链接
                return { username: name, content: body };
            }

            // 从正文末尾往上剥离连续的评论行。这是与标签无关的最后一层保险：
            // 哪怕 #REPLY# 整个丢了，评论也不会烂在正文里。
            function _stripTrailingComments(contentText) {
                const lines = contentText.split('\n');
                const picked = [];
                let cut = lines.length;

                for (let i = lines.length - 1; i >= 0; i--) {
                    const raw = lines[i].trim();
                    if (!raw) {
                        if (picked.length === 0) { cut = i; continue; }   // 结尾空行，跳过
                        break;                                            // 正文与评论块的分界
                    }
                    if (raw.includes('===SEP===')) break;

                    const c = _looksLikeCommentLine(raw);
                    if (!c) break;
                    picked.unshift(c);
                    cut = i;
                }

                if (picked.length < 2) return null;                       // 至少连续 2 行才敢认定是评论区

                const rest = lines.slice(0, cut).join('\n').trim();
                if (!rest) return null;                                   // 剥完没正文了，说明判断错了，放弃
                return { content: rest, comments: picked };
            }

            // 将连续超过 10 个“哈”的片段压缩到 10 个，其他内容保持不变。
            function limitRepeatedHa(text) {
                if (typeof text !== 'string') return text;
                return text.replace(/哈{11,}/g, '哈哈哈哈哈哈哈哈哈哈');
            }

            // --- 文本解析工具函数 ---
            function parseAIResponseToPost(text) {
                // 先归一化标签，后面就可以用最朴素的 indexOf 定位
                const src = normalizeForumTags(text || '');

                const iA = src.indexOf('#AUTHOR#');
                const iT = src.indexOf('#TITLE#');
                const iC = src.indexOf('#CONTENT#');
                const iR = src.indexOf('#REPLY#');
                const allIdx = [iA, iT, iC, iR].filter(i => i !== -1);

                // 按"下一个标签的位置"切段：某个标签缺失时只会影响它自己那一段，
                // 不会像原来那样整条正则失配、把评论全吞进正文。
                const seg = (start, tag) => {
                    if (start === -1) return '';
                    const nexts = allIdx.filter(i => i > start);
                    const end = nexts.length ? Math.min(...nexts) : src.length;
                    return src.substring(start + tag.length, end).trim();
                };

                const author = seg(iA, '#AUTHOR#') || null;
                let title = seg(iT, '#TITLE#') || '无标题';
                let content = seg(iC, '#CONTENT#');

                // #CONTENT# 整个丢了：标题段里其实混着正文，第一行当标题，剩下当正文
                if (iC === -1 && iT !== -1 && title !== '无标题') {
                    const nl = title.indexOf('\n');
                    if (nl > -1) {
                        content = title.substring(nl + 1).trim();
                        title = title.substring(0, nl).trim();
                    }
                }
                if (!content) content = '内容解析失败';

                // 解析评论区。这里保持宽松（只要有冒号就收），因为已经确定是评论区域了。
                const comments = [];
                if (iR !== -1) {
                    seg(iR, '#REPLY#').split('\n').forEach(line => {
                        line = line.trim();
                        if (!line) return;
                        if (line.includes('===SEP===')) return;

                        let colonIndex = line.indexOf(':');
                        if (colonIndex === -1) colonIndex = line.indexOf('：');

                        if (colonIndex > 0) {
                            comments.push({
                                username: line.substring(0, colonIndex).trim(),
                                content: limitRepeatedHa(line.substring(colonIndex + 1).trim()),
                                timestamp: "刚刚"
                            });
                        }
                    });
                }

                // 结构兜底：一条评论都没解析出来，就从正文尾巴上把评论捞回来
                if (comments.length === 0 && content !== '内容解析失败') {
                    const salvaged = _stripTrailingComments(content);
                    if (salvaged) {
                        content = salvaged.content;
                        salvaged.comments.forEach(c => comments.push({
                            ...c,
                            content: limitRepeatedHa(c.content),
                            timestamp: "刚刚"
                        }));
                        console.warn('[forum] #REPLY# 标签缺失，已从正文尾部回收', comments.length, '条评论');
                    }
                }

                return { author, title, content, comments };
            }

            // --- 新增：随机趣味网名生成器 ---
            function getRandomNetName() {
                const prefixes = ["迷路", "点心", "木偶", "毛线", "呢喃", "S", "摸鱼", "我才不是", "嘎嘎", "你是", "啊哦", "Q", "机械"];
                const nouns = ["路人", "毛绒绒", "呆呆", "Cat", "喵叽", "星夜", "铲屎官", "咸鱼", "橘子精", "潜水艇", "球球", "宠物", "魔法师"];

                const randomPrefix = prefixes[Math.floor(Math.random() * prefixes.length)];
                const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];

                return randomPrefix + randomNoun;
            }

            async function handleForumRefresh() {
savedForumScrollY = 0;
                const { url, key, model, stream, temperature } = _getForumApiConfig();
                if (!url || !key || !model) {
                    showToast('请先配置API');
                    return;
                }

                const refreshBtn = document.getElementById('forum-refresh-btn');
                const postsContainer = document.getElementById('forum-posts-container');
                const searchInput = document.getElementById('forum-search-input');

                refreshBtn.disabled = true;
                refreshBtn.style.opacity = "0.5";
                refreshBtn.style.cursor = "not-allowed";

                // --- 强制生效版：创建加载容器 ---
                const loadingDiv = document.createElement('div');
                loadingDiv.className = 'temp-loading';

                // 1. 直接设置容器样式：强制 Flex 布局，横向排列，居中，垂直留白
                loadingDiv.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 20px 10px 0 10px;
        color: #666;
        font-size: 14px;
        width: 100%;
        box-sizing: border-box;
    `;

                // 2. 插入 HTML (包含内联样式的 spinner)
                // 注意：animation 必须依赖上面 CSS 中的 @keyframes spin
                loadingDiv.innerHTML = `
        <div class="spinner" style="
            width: 20px; 
            height: 20px; 
            border: 3px solid rgba(0, 0, 0, 0.1); 
            border-left-color: var(--primary-color); 
            border-radius: 50%; 
            animation: spin 0.8s linear infinite;
            flex-shrink: 0;
        "></div>
        <span>正在刷新最新发帖内容...</span>
    `;

                if (postsContainer.firstChild) {
                    postsContainer.insertBefore(loadingDiv, postsContainer.firstChild);
                } else {
                    postsContainer.appendChild(loadingDiv);
                }

                try {
                    const context = getForumGenerationContext();
                    const keywords = searchInput.value.trim();
// --- 新增：专门获取“写作专用”的世界书 ---
        // 目的：为了强调文风，将其单独提取出来，放在 Prompt 的醒目位置
        const bindings = db.forumBindings || { worldBookIds: [] };
        const worldBooksWriting = (bindings.worldBookIds || [])
            .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === 'writing'))
            .filter(Boolean)
            .map(wb => wb.content)
            .join('\n');
                    const myIdentity = db.forumUserIdentity || { nickname: '我' };
                    const myNickname = myIdentity.nickname || '我';

                    let systemPrompt = `你的角色是“社区模拟器”。请根据背景创作【4-8条】风格各异的新帖子。
背景资料：${context}

【绝对禁止】:AUTHOR和COMMENTS评论者**绝对不能**是【${myNickname}】（user）。

【格式要求】：
严格按照以下格式返回，**每两个帖子之间使用 "===SEP===" 进行分隔**。直接返回文本：

#AUTHOR#
发帖人网名
#TITLE#
帖子1标题
#CONTENT#
帖子1正文内容...
#REPLY#
网名A:评论内容
网名B:评论内容
===SEP===
#AUTHOR#
发帖人网名2
#TITLE#
帖子2标题
#CONTENT#
帖子2正文...
#REPLY#
网名C:评论内容

其他要求：
1. 随机生成 4 到 8 个AUTHOR不同的帖子。帖子主体语言为CHINESE。每个帖子下生成5-7条评论。
2.发帖人、评论者网名由你编撰。极少数发帖人或评论者想要隐藏身份时，可以选择匿名评论，匿名评论用户名为“喵叽”+论坛随机生成的四位数字。
3. 格式必须包含 #AUTHOR#,#TITLE#, #CONTENT#, #REPLY# 这4个标签。
4. **#REPLY# 下方直接列出评论**，每行一条，格式为 "网名:评论内容"。不要再加其他标签。
5.直接输出符合格式的最终结果，无需思考过程、思维链或生成内容说明。
6. **标签必须逐字照抄**：只能是 #AUTHOR#、#TITLE#、#CONTENT#、#REPLY# 这四个英文标签，全大写、前后各一个半角 #、单独占一行。禁止翻译成中文、禁止改写、禁止加粗或加序号。正文和评论中一律不得出现这四个标签。

`;


                    if (keywords) {
                        systemPrompt += `\n\n这些帖子必须与关键词【${keywords}】相关。`;
                    }
                    
                    if (worldBooksWriting) {
            systemPrompt += `\n\n【重要：文风与写作指导】\n请严格遵守以下写作风格或格式要求：\n${worldBooksWriting}\n`;
        }

                    const requestBody = {
    model: model,
    messages: [{ role: "user", content: systemPrompt }],
    temperature: temperature,
};

let contentStr;
if (stream) {
    const streamSpan = loadingDiv.querySelector('span');
    let charCount = 0;
    contentStr = await _forumStreamFetch(url, key, requestBody, (delta) => {
        charCount += delta.length;
        if (streamSpan) streamSpan.textContent = `正在生成帖子内容... (${charCount} 字)`;
    });
} else {
    const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(requestBody)
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const result = await response.json();
    contentStr = result.choices[0].message.content;
}
 // --- 强力清理：兼容 <think> <thought> thinking 等所有思考标签 ---
let cleanContent = contentStr;

// 1. 自动删除所有成对的思考标签 (如 <think>...</think>, <thought>...</thought>)
cleanContent = cleanContent.replace(/<(think|thought|thinking)>[\s\S]*?<\/\1>/gi, '').trim();

// 2. 自动删除以 "Thinking:" 或 "思考：" 开头的一整段废话
cleanContent = cleanContent.replace(/^(Thinking|思考|thought|think)[:：][\s\S]*?\n\n/i, '').trim();

// 3. 先做标签归一化（修拼写/全角＃/加粗等变体），否则下面按 #AUTHOR# 截断会失手
cleanContent = normalizeForumTags(cleanContent);

// 4. 【最核心】直接定位到第一个 #AUTHOR# 标签
// 这样不管 AI 前面写了多少字思考，只要没带标签，我们直接从正文开始截取
const firstTag = cleanContent.indexOf('#AUTHOR#');
if (firstTag !== -1) {
    cleanContent = cleanContent.substring(firstTag);
}

// 5. 将清理后的内容交给原有的分割逻辑
const rawPosts = cleanContent.split('===SEP===');

                    const newPostsToAdd = [];

                    // 清除旧帖子的 [New!] 标记
                    if (db.forumPosts && db.forumPosts.length > 0) {
                        db.forumPosts.forEach(p => {
                            if (p.title) {
                                p.title = p.title.replace(/^\[New!\]\s*/, '').replace(/^【新】/, '');
                            }
                        });
                    }

                    rawPosts.forEach(rawText => {
                        if (!rawText.trim()) return;

                        const parsedData = parseAIResponseToPost(rawText);

                        if (parsedData.title && parsedData.title !== "无标题") {
                            const now = Date.now();

                            // 处理评论
                            if (parsedData.comments) {
                                parsedData.comments.forEach((c, idx) => {
                                    const timeOffset = idx * 3000 + Math.random() * 600;
                                    c.timestamp = new Date(now + timeOffset).toLocaleString();
                                    c.isNew = true;
                                    c.isUser = false;
                                    c.avatar = null;

                                    if (c.username === myNickname) c.username = getRandomNetName();
                                    // 过滤掉 AI 可能生成的“喵叽”

                                });
                            }

                            // --- 修改点：使用随机网名生成器作为兜底 ---
                            let authorName = parsedData.author;

                            if (authorName === myNickname) {
                                authorName = getRandomNetName();
                            }

                            const viewCount = Math.floor(Math.random() * 9000) + 50;

                            const newPost = {
                                id: `post_${Date.now()}_${Math.random()}`,
                                username: authorName,
                                title: '[New!] ' + parsedData.title,
                                content: parsedData.content,
                                likeCount: viewCount,
                                comments: parsedData.comments || [],
                                timestamp: Date.now(),
                                isUser: false,
                                avatar: null
                            };
                            newPostsToAdd.push(newPost);
                        }
                    });

                    if (newPostsToAdd.length > 0) {
                        if (!db.forumPosts) db.forumPosts = [];
                        db.forumPosts.unshift(...newPostsToAdd);
                        await dexieDB.forumPosts.bulkPut(newPostsToAdd);

                        if (loadingDiv && loadingDiv.parentNode) loadingDiv.remove();

                        renderForumPosts(db.forumPosts, false); 
                        renderHotPosts();
                        showToast(`成功刷新 ${newPostsToAdd.length} 条新帖子！`);
                    } else {
                        if (loadingDiv && loadingDiv.parentNode) loadingDiv.remove();
                        showToast('未生成有效内容，请重试');
                    }

                } catch (error) {
                    console.error(error);
                    if (loadingDiv && loadingDiv.parentNode) loadingDiv.remove();
                    showToast('生成失败: ' + error.message);
                } finally {
                    refreshBtn.disabled = false;
                    refreshBtn.style.opacity = "1";
                    refreshBtn.style.cursor = "pointer";
                }
            }

            async function handleGenerateComments(post) {
                const { url, key, model, stream, temperature } = _getForumApiConfig();
if (!url || !key || !model) {
    showToast('请先配置 API');
    return;
}

                const aiBtn = document.getElementById('detail-ai-btn');

                if (aiBtn) {
                    aiBtn.disabled = true;
                    aiBtn.style.opacity = "0.5";
                    aiBtn.style.cursor = "not-allowed";
                }

                const hideLoading = showLoadingToast('正在刷新最新评论...');

                try {
                    const context = getForumGenerationContext();

                    const recentComments = (post.comments || []).slice(-100);
                    const commentsHistoryStr = recentComments.map(c => `${c.username}: ${c.content}`).join('\n');

                    const myIdentity = db.forumUserIdentity || { nickname: '我' };
                    const myNickname = myIdentity.nickname || '我';

                    const systemPrompt = `你是一个论坛网友模拟器。
  论坛的背景世界观：${context}                  
  请为以下帖子追加【10-15条】新评论。
                    
帖子标题：${post.title}
发帖人：${post.username}
帖子完整内容：${post.content}


【已有的评论列表】：
${commentsHistoryStr}

【重要规则】：
1. **身份隔离**：你生成的评论，发表者不能是User（${myNickname}）。
2.评论者网名由你编撰。极少数评论者想要隐藏身份时，可以选择匿名评论，匿名评论的用户名为“喵叽”+论坛随机生成的四位数字。
3. 禁止刷屏：同一个用户名不要评论超过1次。同一个角色发表评论时，使用的网名应保持一致，上下文逻辑应连续。
4.如已有的评论列表存在User（${myNickname}）发表的评论，本次生成的评论中，char或者其他网友应至少发表1条评论回复${myNickname}的最新评论。
5. **直接返回文本**，每行一条，格式必须为 "用户名:评论内容"。`;

                    const requestBody = {
    model: model,
    messages: [{ role: "user", content: systemPrompt }],
    temperature: temperature
};

let contentStr;
let finishReason = null;   // 流式分支拿不到 result，单独记下来供下面判断内容审查
if (stream) {
    let charCount = 0;
    const hideLoadingRef = hideLoading; // 保留引用
    contentStr = await _forumStreamFetch(url, key, requestBody, (delta) => {
        charCount += delta.length;
        // 可选：通过 toast 文字反映进度（不强制）
    });
} else {
    const response = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(requestBody)
    });
    if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
    const result = await response.json();
    if (result.error) throw new Error('API 返回错误: ' + result.error.message);
    if (!result.choices?.[0]?.message) throw new Error('API 返回结构异常，未包含 choices');
    contentStr = result.choices[0].message.content;
    finishReason = result.choices[0].finish_reason || null;
}

                    // 检查是否被内容审查拦截 (返回空内容)
                    if (!contentStr || contentStr.trim() === "") {
                        // 检查结束原因（原代码在这里引用块级作用域的 result，流式下必然 ReferenceError）
                        const reason = finishReason;
                        if (reason === 'content_filter') {
                            throw new Error('生成失败：内容被AI模型的安全过滤器拦截（可能是由于关键词误判）。');
                        }
                        throw new Error('生成失败：AI 返回了空内容。');
                    }

                    // --- 新增：强制清理评论里的思考过程 ---
let cleanContentComments = contentStr;
// 1. 删掉思考标签
cleanContentComments = cleanContentComments.replace(/<(think|thought|thinking)>[\s\S]*?<\/\1>/gi, '').trim();
// 2. 评论格式通常是 "用户名:内容"，如果 AI 之前说了废话，尝试找到第一个冒号的位置
// 但为了保险，我们只清理明显的思考标记
cleanContentComments = cleanContentComments.replace(/###\s*(🧠|思考|Thinking)[\s\S]*?(?=[\w\u4e00-\u9fa5]+[:：])/i, '').trim();


const lines = cleanContentComments.split('\n');
                    const newComments = [];

                    let baseTime = Date.now();

                    lines.forEach((line, index) => {
                        line = line.trim();
                        if (!line) return;

                        let colonIndex = line.indexOf(':');
                        if (colonIndex === -1) colonIndex = line.indexOf('：');

                        if (colonIndex > 0) {
                            let name = line.substring(0, colonIndex).trim();
                            const text = limitRepeatedHa(line.substring(colonIndex + 1).trim());

                            if (name === myNickname) {
                                name = getRandomNetName();
                            }

                            if (name && text) {
                                newComments.push({
                                    username: name,
                                    content: text,
                                    timestamp: new Date(baseTime + index * 5000).toLocaleString(),
                                    isNew: true,
                                    avatar: null,
                                    isUser: false
                                });
                            }
                        }
                    });

                    if (newComments.length > 0) {
                        if (post.comments) {
                            post.comments.forEach(c => delete c.isNew);
                        } else {
                            post.comments = [];
                        }

                        post.comments = post.comments.concat(newComments);

                        const dbPostIndex = db.forumPosts.findIndex(p => p.id === post.id);
                        if (dbPostIndex !== -1) {
                            db.forumPosts[dbPostIndex] = post;
                            await saveSinglePost(post.id);

                            renderPostDetail(post);

                            // --- 核心修改：生成评论后立即刷新热帖 ---
                            renderHotPosts();
                            // ------------------------------------

                            const area = document.getElementById('detail-content-area');
                            if (area) area.scrollTop = area.scrollHeight;

                            showToast(`已更新 ${newComments.length} 条评论`);
                        }
                    } else {
                        showToast('AI 没有生成有效的评论格式，请重试');
                    }

                } catch (e) {
                    console.error("生成评论出错:", e);
                    showToast('生成失败: ' + e.message);
                } finally {
                    hideLoading();

                    if (aiBtn) {
                        aiBtn.disabled = false;
                        aiBtn.style.opacity = "1";
                        aiBtn.style.cursor = "pointer";
                    }
                }
            }

