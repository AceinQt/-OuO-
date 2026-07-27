// ==========================================
// peek_batch.js
// 批量生成：一次 API 调用生成所有应用的内容 + 一组顺风车消息
//
// 输出协议：AI 依次输出 ===APP:<ID>=== 段落，段落内沿用各应用原有的标签格式，
// 最后用 ===PROACTIVE_MESSAGES=== 分割出一组主动消息。
// 解析时逐段套用各应用原有的 parse/apply 函数：识别到几个就写入几个，
// 缺失或解析失败的应用直接跳过，不影响其它应用。
//
// 数量：批量生成时每个应用只出 1 条（追求覆盖面而非数量），与各应用单独生成的
// 3-4 条不同。parse 函数本身仍支持多条（===SEP===），只是提示词不再要求多条。
// ==========================================

// 批量生成正在进行中（防重复点击）
let _peekBatchRunning = false;

// ==========================================
// 应用清单：每项负责自己的任务说明、格式示例与落库
// tagId   —— ===APP:xxx=== 中的标识
// appType —— peekContentCache 的键，同时用于占用 generatingPeekApps
// handle  —— 解析该段并写入缓存，返回新增条目数（0 表示没识别到）
// ==========================================
const PEEK_BATCH_APPS = [
    {
        tagId: 'MESSAGES',
        appType: 'messages',
        name: '消息',
        task(char) {
            // 已有联系人（排除已屏蔽的）也告诉 AI，便于延续旧对话
            const existingNames = (peekContentCache['messages']?.conversations || [])
                .filter(c => !c.isHidden)
                .map(c => c.partnerName)
                .filter(Boolean);

            let t = `只生成 1 段最近的对话，对话内容需要强烈反映 ${char.realName} 的人设以及最近聊天上下文。\n`;
            if (existingNames.length > 0) {
                t += `当前手机里已有以下联系人：${existingNames.join('、')}。但联系人不仅仅局限于这些人，你应该根据聊天上下文情况，优先创造一个**新的联系人**来对话。\n`;
            }
            t += `需要提供对话对象的称呼(#PARTNER#)以及聊天记录(#HISTORY#)。在 #HISTORY# 中，${char.realName} 发送的消息以 "char: " 开头，对方发送的消息以 "partner: " 开头，一来一回 4-6 句即可。`;
            return t;
        },
        format(char) {
            return `#PARTNER#
与Ta对话的人的称呼
#HISTORY#
partner: 对方发送的消息内容
char: ${char.realName}发送的消息内容
partner: 对方发送的消息内容`;
        },
        handle(rawText) {
            return applyPeekMessagesContent(parsePeekMessagesContent(rawText));
        }
    },
    {
        tagId: 'MEMOS',
        appType: 'memos',
        name: '备忘录',
        task(char) {
            return `只生成 1 条备忘录，可以反映 ${char.realName} 的计划、灵感或者日常琐事。内容可以多行。`;
        },
        format() {
            return `#TITLE#
备忘录标题
#CONTENT#
备忘录内容...
可以包含多行...`;
        },
        handle(rawText) {
            return applyPeekMemosContent(parsePeekMemosContent(rawText));
        }
    },
    {
        tagId: 'CART',
        appType: 'cart',
        name: '购物车',
        task(char) {
            return `只生成 1 件购物车内的商品，要能反映 ${char.realName} 近期的兴趣、生活需求或最近聊到的话题。`;
        },
        format() {
            return `#TITLE#
某品牌无线降噪耳机
#SPEC#
星空黑 / 官方标配
#PRICE#
1299.00`;
        },
        handle(rawText) {
            return applyPeekCartContent(parsePeekCartContent(rawText));
        }
    },
    {
        tagId: 'TRANSFER',
        appType: 'transfer',
        name: '中转站',
        task(char) {
            return `只生成 1 条 ${char.realName} 发送给自己的、简短零碎的消息（文件传输助手）。内容像是临时备忘、灵感闪现或随手保存的链接，比"备忘录"更随意、更口语化。`;
        },
        format() {
            return `#ENTRY#
刚刚那个想法不错，可以深入一下...`;
        },
        handle(rawText) {
            return applyPeekTransferContent(parsePeekTransferContent(rawText));
        }
    },
    {
        tagId: 'BROWSER',
        appType: 'browser',
        name: '浏览器',
        task(char) {
            return `只生成 1 条浏览记录。记录本身要符合 ${char.realName} 的人设和最近聊天上下文，#ANNOTATION# 则要站在角色自己的视角，记录Ta对这条浏览记录的想法或批注。`;
        },
        format() {
            return `#TITLE#
超简单！10分钟搞定的快手早餐教程
#URL#
www.example.com/breakfast-tutorial
#ANNOTATION#
明早可以试试看，看起来很好吃。`;
        },
        handle(rawText) {
            return applyPeekBrowserContent(parsePeekBrowserContent(rawText));
        }
    },
    {
        tagId: 'DRAFTS',
        appType: 'drafts',
        name: '草稿箱',
        task(char) {
            return `请生成 1 份 ${char.realName} 写给${char.myName}、但犹豫未决未发送的消息草稿。内容要深刻、细腻，反映Ta的内心挣扎、真实情感和与${char.myName}的关系。可以使用HTML的<span class='strikethrough'></span>标签来表示写了又删掉（划掉）的文字。`;
        },
        format(char) {
            return `#TO#
${char.myName}
#CONTENT#
一封写给${char.myName}但未发送的草稿内容，可以使用HTML的<span class='strikethrough'></span>标签来表示划掉的文字。`;
        },
        handle(rawText) {
            return applyPeekDraftContent(parsePeekDraftContent(rawText));
        }
    },
    {
        tagId: 'ALBUM',
        appType: 'album',
        name: '相册',
        task(char) {
            return `只生成 1 个 ${char.realName} 拍摄的照片或视频。#TYPE# 只能是 photo 或 video；#IMAGE_DESC# 是对这张照片/视频的详细文字描述，它将代替真实的图片展示给用户；#ANNOTATION# 是 ${char.realName} 自己对这张照片/视频的批注。`;
        },
        format() {
            return `#TYPE#
photo
#IMAGE_DESC#
一张傍晚在海边的自拍，背景是橙色的晚霞和归来的渔船。
#ANNOTATION#
那天的风很舒服。`;
        },
        handle(rawText) {
            return applyPeekAlbumContent(parsePeekAlbumContent(rawText));
        }
    },
    {
        tagId: 'STEPS',
        appType: 'steps',
        name: '步数',
        task(char) {
            return `请为 ${char.realName} 生成今天的步数信息：当前步数(#CURRENT_STEPS#，纯数字)、6 条运动轨迹(#TRAJECTORY#，每行一条，禁止照搬示例)以及批注(#ANNOTATION#)。`;
        },
        format() {
            return `#CURRENT_STEPS#
8102
#TRAJECTORY#
08:30 AM - 公司楼下咖啡馆
10:00 AM - 宠物用品店
12:00 PM - 附近日料店
03:00 PM - 回家路上的甜品店
04:00 PM - 楼下的便利店
06:30 PM - 健身房
#ANNOTATION#
角色对自己今天运动情况的批注`;
        },
        handle(rawText) {
            const parsed = parsePeekStepsContent(rawText);
            if (!parsed) return 0;
            peekContentCache['steps'] = parsed;
            return 1;
        }
    },
    {
        tagId: 'UNLOCK',
        appType: 'unlock',
        name: 'unlock！',
        task(char) {
            const now = Date.now();
            const lastGenTime = getPeekUnlockLastGenTime(now);
            const hoursSinceLast = Math.max(1, Math.floor((now - lastGenTime) / 3600000));
            const timeText = hoursSinceLast > 72 ? '几天' : `约 ${hoursSinceLast} 小时`;

            return `请为 ${char.realName} 生成一个符合其人设的社交媒体（类似微博/X）私密小号：昵称(#NICKNAME#)、@开头的ID(#HANDLE#)、个性签名(#BIO#)，以及**只要 1 条**近期（距离上次更新已过去 ${timeText}）的新帖子(#POST#)。
帖子要求：
1. 第一行用方括号包含相对时间（例如[15分钟前]、[2小时前]、[昨天]），下方是正文（140字以内）。
2. 内容要生活化、碎片化，符合小号的私密风格。`;
        },
        format() {
            return `#NICKNAME#
角色的小号昵称
#HANDLE#
@角色的小号ID
#BIO#
角色的个性签名
#POST#
[15分钟前]
帖子正文内容`;
        },
        handle(rawText) {
            const now = Date.now();
            const parsed = parsePeekUnlockContent(rawText, getPeekUnlockLastGenTime(now), now);
            return applyPeekUnlockContent(parsed, now);
        }
    }
];

// ==========================================
// 拼装批量生成的提示词
// ==========================================
function buildPeekBatchPrompt(char, mainChatContext) {
    const senderName = char.realName || char.name;

    let prompt = `你正在模拟角色 ${char.realName} 的整部手机，需要一次性生成手机里各个应用的内容。\n`;
    prompt += getPeekBasePromptContext(char, mainChatContext);

    prompt += `
【总体要求】
1. 下面依次列出 ${PEEK_BATCH_APPS.length} 个应用，请为每一个应用都生成内容。
2. **每个应用只生成 1 条内容**（步数应用本身就是一份当日记录）。这次追求的是"覆盖面广、品种多"，而不是每个应用堆数量，所以每条都要挑最有代表性、最值得一看的那一条，不要凑数。
3. 因为每个应用只有 1 条，所以**不要输出 ===SEP=== 分隔符**（它只在同一应用有多条时才需要）。
4. 每个应用的内容必须以独占一行的 ===APP:标识=== 开头，紧接着按该应用要求的标签格式输出。
5. 所有内容都要与角色人设、最近聊天上下文高度相关；各应用之间的信息要彼此呼应、逻辑自洽，不要互相矛盾。
6. 不要输出任何额外的解释、说明或 Markdown 代码块，只输出规定的标签内容。
`;

    PEEK_BATCH_APPS.forEach((app, idx) => {
        prompt += `\n————— 应用 ${idx + 1}：${app.name}（===APP:${app.tagId}===）—————\n`;
        prompt += `${app.task(char)}\n`;
        prompt += `该应用的输出格式：\n${app.format(char)}\n`;
    });

    prompt += `
————— 最后：话题分享（顺风车消息）—————
在上面所有应用的内容都输出完毕后，请综合你刚刚生成的全部内容，挑选其中你认为最适合分享给${char.myName}的 1 个点。
预测一下，在未来的某个时间，${senderName}会围绕这个点主动发送消息给${char.myName}开启话题。
只需要生成 1 组主动消息。
`;
    prompt += getPeekProactiveFormatPrompt(char);

    prompt += `
【最终输出结构】必须严格如下（省略号处替换为真实内容）：
${PEEK_BATCH_APPS.map(app => `===APP:${app.tagId}===\n...`).join('\n')}
===PROACTIVE_MESSAGES===
#SECRET_CHAT_EVENING_85%#[19:15|${senderName}的消息:...][19:16|${senderName}的消息:...]
`;

    return prompt;
}

// ==========================================
// 切割 ===APP:xxx=== 段落 → [{ tagId, body }]
// ==========================================
function splitPeekBatchSections(appsRawText) {
    const sections = [];
    // 捕获分组保留标识，split 结果为 [前言, 标识1, 正文1, 标识2, 正文2, ...]
    const pieces = (appsRawText || '').split(/===\s*APP\s*[:：]\s*([A-Za-z_]+)\s*===/);

    for (let i = 1; i < pieces.length; i += 2) {
        const tagId = (pieces[i] || '').trim().toUpperCase();
        const body = pieces[i + 1] || '';
        if (tagId && body.trim()) sections.push({ tagId, body });
    }

    return sections;
}

// ==========================================
// 批量生成主流程
// ==========================================
async function generatePeekBatch() {
    if (_peekBatchRunning) { showToast('批量生成正在进行中，请稍候...'); return; }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model, streamEnabled, temperature } = getPeekApiConfig(window.activePeekCharId);
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    // 已有单个应用在生成时不允许批量，避免同一份缓存被两边同时写
    const busy = PEEK_BATCH_APPS.filter(app => generatingPeekApps.has(app.appType));
    if (busy.length > 0) {
        showToast(`${busy.map(a => a.name).join('、')} 正在生成中，请稍候...`);
        return;
    }

    const confirmed = typeof AppUI !== 'undefined' && AppUI.confirm
        ? await AppUI.confirm(
            `将一次性生成手机里全部 ${PEEK_BATCH_APPS.length} 个应用的内容和一组顺风车消息，消耗的 token 较多，且耗时较长。要继续吗？`,
            '批量生成'
        )
        : confirm('将一次性生成手机里全部应用的内容，要继续吗？');
    if (!confirmed) return;

    _peekBatchRunning = true;
    // 占用所有应用，屏蔽各应用自己的刷新按钮
    PEEK_BATCH_APPS.forEach(app => generatingPeekApps.add(app.appType));

    const hideLoading = showLoadingToast('正在批量生成手机内容...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? historyToPlainText(char.history.slice(-limitCount)) : "";

        const systemPrompt = buildPeekBatchPrompt(char, mainChatContext);

        const contentStr = await callPeekApi({
            url, key, model,
            messages: [{ role: 'user', content: systemPrompt }],
            temperature, streamEnabled
        });

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const appsRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts.slice(1).join('\n') : '';

        const sections = splitPeekBatchSections(appsRawText);
        const succeeded = [];
        const failed = [];

        sections.forEach(({ tagId, body }) => {
            const app = PEEK_BATCH_APPS.find(a => a.tagId === tagId);
            if (!app) {
                console.warn(`[批量生成] 未知的应用标识：${tagId}，已跳过`);
                return;
            }
            try {
                const count = app.handle(body) || 0;
                if (count > 0) succeeded.push({ name: app.name, count });
                else failed.push(app.name);
            } catch (e) {
                console.error(`[批量生成] ${app.name} 解析失败：`, e);
                failed.push(app.name);
            }
        });

        // 没识别到的应用（AI 整段没输出）也算失败，一并提示
        const missing = PEEK_BATCH_APPS
            .filter(app => !sections.some(s => s.tagId === app.tagId))
            .map(app => app.name);
        failed.push(...missing);

        if (succeeded.length === 0) {
            throw new Error('未识别到任何应用内容，请重试或更换模型。');
        }

        await savePeekData(char.id);

        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

        console.log('[批量生成] 成功:', succeeded, '未生成:', failed);

        let msg = `已生成 ${succeeded.length} 个应用：${succeeded.map(s => s.name).join('、')}`;
        if (failed.length > 0) msg += `\n未识别：${failed.join('、')}`;
        showToast(msg);

    } catch (error) {
        console.error(error);
        if (typeof showApiError === 'function') showApiError(error);
        showToast('批量生成失败: ' + error.message);
    } finally {
        PEEK_BATCH_APPS.forEach(app => generatingPeekApps.delete(app.appType));
        _peekBatchRunning = false;
        hideLoading();
    }
}
