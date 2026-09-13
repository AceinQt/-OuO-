// chat_feature_share.js — 万能分享卡片：格式定义 / 发送弹窗 / 详情弹窗
//
// 一条分享消息长这样（方括号包到底，和语音/位置/礼物那些消息一个形状 ——
// 形状不一致，Gemini 照抄上下文时会自己发明格式）：
//
//   [小明的分享：
//   标题：煲仔饭
//   类别：美团外卖链接
//   内容：腊味双拼煲仔饭 ¥38，30分钟送达
//   附加信息：想着你昨天说想吃]
//
// 为什么不用分号分隔四个字段：正文里出现分号就切错了（转账那条正则至今还在
// 跟中英文分号搏斗）。这里按**行首关键字**定边界，所以正文里的分号、冒号、
// 方括号全都无所谓，唯一的约束是别在行首顶格写「类别：」这种字样。
//
// 三个来源共用这一份格式：用户从 + 号面板手动发、AI 角色自己发（提示词里
// 教了）、喵坛帖子分享过来（forum_share.js）。渲染和详情弹窗因此也只有一套。

// 用户填的类别是自由文本，这几个只是弹窗里的快捷标签。
// 「来自喵坛的分享」不在这里：那是论坛分享按钮的专用类别，手填没意义。
const SHARE_CATEGORY_PRESETS = ['网站链接', '文件', '快递物流'];

// 喵坛分享固定用这个类别，卡片顶部就显示它（和旧版 [喵坛分享] 的页头文案一致）
const SHARE_FORUM_CATEGORY = '来自喵坛的分享';

// 整体先抓出 [xxx的分享：...] 的 body，字段再交给 parseShareMessage 按行拆。
// 发送者名里禁掉方括号和冒号，免得正文里提到「的分享：」的普通消息被抢走。
// 锚在开头和结尾：一条分享消息整条就是这张卡片，不会前面还有别的话。
// 不锚的话，正文里引用了别人的分享就会把整条消息劫持成卡片。
//
// body 用懒惰量词 + 结尾锚，把**最后**那个 ] 留给格式收尾、其余全归正文 ——
// 所以正文自己可以以 ] 结尾（"原价[59元]"）。别在事后 replace(/\]$/) 去括号，
// 那样会把正文的括号一起削掉。
const SHARE_MESSAGE_REGEX = /^\s*\[([^\[\]：:\n]+?)的分享[:：]\s*([\s\S]+?)\][ \t]*$/;

/**
 * 把四个字段拼成消息正文。附加信息可留空 —— 留空时整行不写，
 * 免得 AI 学到「附加信息：」后面可以什么都没有。
 */
function buildShareMessageContent(senderName, share) {
    const title = (share.title || '').trim();
    const category = (share.category || '').trim();
    const body = (share.body || '').trim();
    const extra = (share.extra || '').trim();

    let content = `[${senderName}的分享：\n标题：${title}\n类别：${category}\n内容：${body}`;
    if (extra) content += `\n附加信息：${extra}`;
    content += ']';
    return content;
}

// 四个字段的行首关键字。既是解析边界，也是「AI 补全」时要提防模型写出来的字样
// （见 sanitizeShareFieldText）。
const SHARE_FIELD_KEYS = [
    { key: 'title', label: '标题' },
    { key: 'category', label: '类别' },
    { key: 'body', label: '内容' },
    { key: 'extra', label: '附加信息' },
];

/**
 * 按行首关键字把一段文本拆成 { title, category, body, extra }。
 * 先记下每个字段起始行，再按行区间取值 —— 这样最后一个字段（通常是内容或
 * 附加信息）可以随便换行。一个字段都没认出来返回 null。
 *
 * 这份行边界规则全项目只此一份。别在别处再写一遍：两份规则迟早分叉。
 */
function parseShareFields(text) {
    const lines = String(text == null ? '' : text).split('\n');
    const marks = [];
    lines.forEach((line, index) => {
        for (const field of SHARE_FIELD_KEYS) {
            // 顶格（允许前导空格）写「标题：」才算字段头
            const re = new RegExp(`^\\s*${field.label}[:：]\\s*`);
            const m = line.match(re);
            if (m) {
                marks.push({ key: field.key, line: index, valueStart: m[0].length });
                break;
            }
        }
    });

    if (!marks.length) return null;

    const result = { title: '', category: '', body: '', extra: '' };
    marks.forEach((mark, i) => {
        const endLine = i + 1 < marks.length ? marks[i + 1].line : lines.length;
        const chunk = [];
        for (let ln = mark.line; ln < endLine; ln++) {
            chunk.push(ln === mark.line ? lines[ln].slice(mark.valueStart) : lines[ln]);
        }
        result[mark.key] = chunk.join('\n').trim();
    });
    return result;
}

/**
 * 解析一条分享消息。认不出来返回 null（调用方据此回退到别的气泡分支）。
 * 返回 { senderName, title, category, body, extra }，extra 可能是空串。
 */
function parseShareMessage(content) {
    if (typeof content !== 'string') return null;
    const match = content.match(SHARE_MESSAGE_REGEX);
    if (!match) return null;

    const senderName = match[1].trim();
    // 收尾的 ] 由正则本身排除（见 SHARE_MESSAGE_REGEX），不能在这里用
    // replace(/\]$/) 去掉 —— 正文自己以 ] 结尾时（"原价[59元]"）会被削掉一个。
    const fields = parseShareFields(match[2]);
    if (!fields) return null;

    // 标题和内容全空的，当不是分享（比如正文里恰好写了「附加信息：」）
    if (!fields.title && !fields.body) return null;
    return { senderName, ...fields };
}

// 一条方括号消息的开头，形如 [小猫的消息： / [小猫的语音： / [小猫的分享：
// 用来判断"下一条消息开始了"，从而给多行分享卡片定尾。
const SHARE_NEXT_MESSAGE_HEAD = /^\s*\[[^\[\]\n：:]{1,24}(?:的|发|已|接收|退回|引用|更新|撤回)[^\[\]\n]{0,12}[:：]/;

/**
 * 从 AI 回复里把多行分享卡片整块抠出来。
 *
 * 为什么不能用一条正则：卡片的「内容」是大段自由文本，里面很可能出现 ]
 * （"第[三]章"、"价格[特价]39元"）。非贪婪 [\s\S]*?\] 会停在**第一个**
 * 行尾 ]，把卡片截半截；贪婪又会一路吞掉后面别的消息。
 *
 * 所以按行扫：从卡片头那行开始，一直吃到"下一条方括号消息"或文本结束，
 * 期间记住**最后一个**以 ] 收尾的行 —— 那才是卡片真正的收尾。
 *
 * 返回 [{ start, end, text }]（end 为不含端点的下标，按 lines 索引）。
 */
function extractShareBlocks(text) {
    if (typeof text !== 'string') return [];
    const lines = text.split('\n');
    const blocks = [];
    let i = 0;

    while (i < lines.length) {
        const head = lines[i].match(/^\s*\[[^\[\]：:\n]+?的分享[:：]/);
        if (!head) { i++; continue; }

        // 卡片头这行本身就以 ] 收尾（单行写法）也算合法
        let lastCloser = /\][ \t]*$/.test(lines[i]) ? i : -1;
        let j = i + 1;
        for (; j < lines.length; j++) {
            // 下一条消息开始了 —— 卡片到此为止（不含这行）
            if (SHARE_NEXT_MESSAGE_HEAD.test(lines[j])) break;
            if (/\][ \t]*$/.test(lines[j])) lastCloser = j;
        }

        if (lastCloser >= i) {
            blocks.push({
                start: i,
                end: lastCloser + 1,
                text: lines.slice(i, lastCloser + 1).join('\n'),
            });
            i = lastCloser + 1;
        } else {
            // 没有收尾的 ]（AI 写漏了），别吞掉后面的内容
            i++;
        }
    }
    return blocks;
}

// 占位符的前后缀。写成两个显式常量而不是模板字符串里打空格：
// 那两个"空格"曾经被误写成 NUL 字节，肉眼和 grep 都看不出来，restore 时
// split 匹配不上，整张卡片会塌成一条 [unknown的消息：SHARE0 …] 气泡。
// 用 @@ 这种不会出现在正文里的记号，比空格更不容易被"顺手 trim 掉"。
const SHARE_PH_OPEN = '@@SHARE';
const SHARE_PH_CLOSE = '@@';

/**
 * 把回复里的分享卡片换成占位符，交出 { masked, blocks }。
 * 调用方跑完"见括号就断行"那几条规则后，用 restoreShareBlocks 填回去。
 */
function maskShareBlocks(text) {
    const blocks = extractShareBlocks(text);
    if (!blocks.length) return { masked: text, blocks: [] };

    const lines = text.split('\n');
    const out = [];
    let cursor = 0;
    blocks.forEach((block, n) => {
        out.push(...lines.slice(cursor, block.start));
        out.push(SHARE_PH_OPEN + n + SHARE_PH_CLOSE);
        cursor = block.end;
    });
    out.push(...lines.slice(cursor));
    return { masked: out.join('\n'), blocks: blocks.map(b => b.text) };
}

/** 与 maskShareBlocks 配对：把占位符换回卡片原文，并让每张卡独占一行。 */
function restoreShareBlocks(text, blocks) {
    let result = text;
    blocks.forEach((block, n) => {
        result = result.split(SHARE_PH_OPEN + n + SHARE_PH_CLOSE).join(`\n${block}\n`);
    });
    return result;
}

/**
 * 兼容旧格式：[喵坛分享]标题：X\n内容：Y<span style="display:none;">富上下文</span>
 * 旧消息已经在用户库里了，得继续认。正文当年被截成 50 字存下来了，拿不回全文，
 * 富上下文里那段散文塞进「附加信息」聊胜于无。
 */
function parseLegacyForumShare(content) {
    if (typeof content !== 'string' || !content.startsWith('[喵坛分享]')) return null;
    const match = content.match(/\[喵坛分享\]标题：([\s\S]+?)\n内容：([\s\S]+)/);
    if (!match) return null;

    const title = match[1].trim();
    let rest = match[2];
    let extra = '';
    // 富上下文藏在 display:none 的 span 里
    const hiddenMatch = rest.match(/<span style="display:none;">([\s\S]*?)<\/span>/);
    if (hiddenMatch) {
        extra = hiddenMatch[1].trim();
        rest = rest.replace(hiddenMatch[0], '');
    }
    return {
        senderName: '',
        title,
        category: SHARE_FORUM_CATEGORY,
        body: rest.trim(),
        extra,
    };
}

// --- 发送弹窗 ---

function setupShareFeature() {
    const modal = document.getElementById('send-share-modal');
    const form = document.getElementById('send-share-form');
    const tagBar = document.getElementById('share-category-presets');
    const categoryInput = document.getElementById('share-category-input');
    const detailModal = document.getElementById('share-detail-modal');

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('visible');
        });
    }

    // 类别快捷标签：点一下填进输入框，仍可自由改写
    if (tagBar && categoryInput) {
        tagBar.innerHTML = '';
        SHARE_CATEGORY_PRESETS.forEach(name => {
            const tag = document.createElement('button');
            tag.type = 'button';
            tag.className = 'share-category-tag';
            tag.textContent = name;
            tag.addEventListener('click', () => {
                categoryInput.value = name;
                categoryInput.focus();
            });
            tagBar.appendChild(tag);
        });
    }

    const aiBtn = document.getElementById('share-ai-complete-btn');
    if (aiBtn) {
        // 文案在这里填，不写死在 HTML 里：补全时要换成"补全中…"，只留一处来源
        aiBtn.textContent = SHARE_AI_BTN_LABEL;
        aiBtn.addEventListener('click', completeShareContent);
    }

    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const title = document.getElementById('share-title-input').value.trim();
            const category = categoryInput.value.trim();
            const body = document.getElementById('share-body-input').value.trim();
            const extra = document.getElementById('share-extra-input').value.trim();

            if (!title || !category || !body) {
                showToast('标题、类别、内容都要填哦。');
                return;
            }
            sendShareMessage({ title, category, body, extra });
        });
    }

    if (detailModal) {
        detailModal.addEventListener('click', (e) => {
            if (e.target === detailModal) detailModal.classList.remove('visible');
        });
        const closeBtn = document.getElementById('share-detail-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => detailModal.classList.remove('visible'));
        }
    }
}

function openShareModal() {
    const modal = document.getElementById('send-share-modal');
    const form = document.getElementById('send-share-form');
    if (!modal) return;
    if (form) form.reset();

    // 上一轮补全可能还飞在路上（按钮停在"补全中…"、请求回来会写表单）。
    // 换个 session 号把它作废，再把按钮恢复成可点。
    _shareModalSession++;
    const aiBtn = document.getElementById('share-ai-complete-btn');
    if (aiBtn) {
        aiBtn.disabled = false;
        aiBtn.textContent = SHARE_AI_BTN_LABEL;
    }

    modal.classList.add('visible');
}

/**
 * 发到当前会话。流程照 sendMyLocation 那套：
 * 先关弹窗 → 时间感知 → push history → 立刻上气泡 → 落盘 → 刷列表。
 */
async function sendShareMessage(share) {
    const modal = document.getElementById('send-share-modal');
    if (modal) modal.classList.remove('visible');
    await new Promise(resolve => setTimeout(resolve, 100));

    const chat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);
    if (!chat) return;

    if (typeof processTimePerception === 'function') {
        await processTimePerception(chat, currentChatId, currentChatType);
    }

    const myName = (currentChatType === 'private') ? chat.myName : chat.me.realName;
    const content = buildShareMessageContent(myName, share);

    const message = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        role: 'user',
        content: content,
        parts: [{ type: 'text', text: content }],
        timestamp: Date.now()
    };
    if (currentChatType === 'group') message.senderId = 'user_me';

    chat.history.push(message);
    addMessageBubble(message, currentChatId, currentChatType);
    await saveMessageToDB(message, currentChatId, currentChatType);
    await saveSingleChat(currentChatId, currentChatType);
    renderChatList();
}

/**
 * 把一张分享卡片投到若干个**别的**聊天里。两个来源共用：喵坛分享帖
 * （forum_share.js）、转发聊天记录（本文件下面那一节）。
 *
 * 为什么要抽出来：这段循环原先只在 forum_share.js 里有一份，转发功能又要
 * 一模一样的东西。抄第二份就意味着以后"发送者昵称取哪个字段""群聊要不要
 * 补 senderId"这类口径会分叉 —— 卡片格式已经强调过只留一份，投递也一样。
 *
 * 卡片正文按**每个目标聊天自己的** myName 拼，不是发起方的昵称：同一个人在
 * 不同角色那儿可能用不同名字，写死一个名字会让卡片署名张冠李戴。
 *
 * 只管数据落盘，不碰 UI（不上气泡、不刷列表）—— 调用方比这里更清楚当前
 * 停在哪个页面。投到当前会话时要不要立刻上气泡，由调用方决定。
 *
 * @param {{charIds?: string[], groupIds?: string[]}} targets
 * @param {{title:string, category:string, body:string, extra?:string}} share
 * @returns {Promise<Array<{chatId:string, chatType:string, message:object}>>} 实际投出去的
 */
async function deliverShareToChats(targets, share) {
    const delivered = [];

    const push = async (chat, chatId, chatType, senderName) => {
        const content = buildShareMessageContent(senderName, share);
        const message = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            role: 'user',
            content: content,
            parts: [{ type: 'text', text: content }],
            timestamp: Date.now()
        };
        // 群聊消息不带 senderId 的话，渲染层认不出是"我"发的，会当成未知成员
        if (chatType === 'group') message.senderId = 'user_me';

        if (!chat.history) chat.history = [];
        chat.history.push(message);
        await saveMessageToDB(message, chatId, chatType);
        await saveSingleChat(chatId, chatType);
        delivered.push({ chatId, chatType, message });
    };

    for (const charId of (targets.charIds || [])) {
        const character = db.characters.find(c => c.id === charId);
        if (character) await push(character, charId, 'private', character.myName);
    }

    for (const groupId of (targets.groupIds || [])) {
        const group = (db.groups || []).find(g => g.id === groupId);
        if (group) await push(group, groupId, 'group', (group.me && group.me.realName) || '我');
    }

    return delivered;
}

// --- AI 补全 ---
//
// 用户填标题+类别，点一下让模型把「内容」和「附加信息」补出来。
//
// 输出用 #CONTENT# / #EXTRA# 标签，不用卡片自己的「内容：」行首关键字 ——
// 后者会和 parseShareFields 的字段边界打架：模型在正文里顺手写一句
// 「附加信息：满50减5」，那行之后的内容就被切给别的字段了。标签格式下模型
// 压根不写那些字样，冲突从源头消失。（但正文里仍可能自发出现，
// 所以回填前还要过一道 sanitizeShareFieldText。）

// 上文口径：至少覆盖这么多个「轮次」，条数再封一次顶。
//
// 为什么不按固定条数：AI 的一次回复会被"见括号就断行"拆成好几条气泡，
// 按条数取 30 条经常只有五六个来回，模型看不出正在聊什么。轮次才是
// "最近发生了什么"的真实口径 —— 一条 user 消息起一个轮次（群聊里我发的
// 消息 role 同样是 'user'，所以两种会话共用这一条规则）。
//
// 条数上限仍然留着：一轮里 AI 连发二十条的情况是有的，纯按轮次会把 token 打爆。
const SHARE_CONTEXT_ROUND_TARGET = 10;
const SHARE_CONTEXT_MESSAGE_CAP = 100;

/**
 * 从末尾往回取上文：凑够 SHARE_CONTEXT_ROUND_TARGET 个轮次就停，
 * 但最多 SHARE_CONTEXT_MESSAGE_CAP 条。
 *
 * 切口落在 user 消息上（而不是它后面那条），这样上文是从"我说了什么"开始的，
 * 不会以半截 AI 回复开头。
 */
function sliceShareContextHistory(history) {
    const all = Array.isArray(history) ? history : [];
    let rounds = 0;
    let start = all.length;
    for (let i = all.length - 1; i >= 0; i--) {
        if (all.length - i > SHARE_CONTEXT_MESSAGE_CAP) break;
        start = i;
        if (all[i] && all[i].role === 'user') {
            rounds++;
            if (rounds >= SHARE_CONTEXT_ROUND_TARGET) break;
        }
    }
    return all.slice(start);
}

// 按钮文案的唯一来源（index.html 里那个按钮是空的，由 setupShareFeature 填）
const SHARE_AI_BTN_LABEL = '帮我补全';
const SHARE_AI_BTN_BUSY_LABEL = '补全中…';

const SHARE_COMPLETE_SYSTEM_PROMPT = `你在帮我填一张要发到聊天里的「分享卡片」。我已经写好标题和类别，你只负责补出「内容」和「附加信息」两栏。

CONTENT：卡片的主体信息，2-4 行，一行一件事，像是从对应 App 里复制出来的客观信息。按类别决定写什么——
  外卖/商品：规格、价格、配送或发货说明
  链接/网站：这个页面是什么、有什么值得看
  文件：格式、大小、用途
  快递物流：单号、当前状态、预计送达
EXTRA：次要补充，一般是客观的（配送费、有效期、备注）。

硬性要求：
- 优先中文，如果上下文主要是别的语言，才使用上下文中的语言。
- 价格、大小、时长这类数字可以合理编造，但要符合常识。
- 参考资料只是帮你把细节对上。不要在卡片里复述聊天记录，也不要写成角色扮演的旁白——这张卡片是我发出去的，不是谁在说话。
- 参考资料里的人设和世界观是**背景知识**，用来把设定对上。不要用对方的口吻写卡片，也不要替我说话。

严格按下面的标签格式输出。标签逐字照抄、全大写、前后各一个半角 #、单独占一行。除标签和正文外不要有任何解释：

#CONTENT#
（内容正文，可多行）
#EXTRA#
（附加信息；没有就留空）`;

// 模型写标签的花样：全角＃、**加粗**、漏掉收尾的 #、后面跟个冒号、把标签
// 翻译成中文。喵坛那份归一化（forum_generation.js 里，嵌在函数里够不着）
// 踩过这些坑，这里按只有两个标签的规模抄一份精简的。
const SHARE_TAG_VOCAB = {
    CONTENT: '#CONTENT#', BODY: '#CONTENT#', TEXT: '#CONTENT#', MAIN: '#CONTENT#',
    内容: '#CONTENT#', 正文: '#CONTENT#', 主体: '#CONTENT#',
    EXTRA: '#EXTRA#', NOTE: '#EXTRA#', NOTES: '#EXTRA#', REMARK: '#EXTRA#',
    ADDITIONAL: '#EXTRA#', 附加: '#EXTRA#', 附加信息: '#EXTRA#', 备注: '#EXTRA#', 补充: '#EXTRA#',
};

// 首字母兜底。喵坛那份在词表和首字母之间还夹了一层编辑距离，这里省掉了：
// 只有两个标签且首字母不撞（C / E），拼错的 CONTNET、EXRTA 全都会落到首字母
// 这一层，编辑距离那层再拦一遍是纯冗余。以后加第三个 C 开头的标签就得补回来。
const SHARE_TAG_INITIALS = { C: '#CONTENT#', E: '#EXTRA#' };

function _matchShareTag(word) {
    if (!word) return null;
    const upper = word.toUpperCase();
    if (SHARE_TAG_VOCAB[upper]) return SHARE_TAG_VOCAB[upper];
    if (SHARE_TAG_VOCAB[word]) return SHARE_TAG_VOCAB[word];
    // 太短的词不敢猜（"C"、"CN" 可能是正文里的普通字母）
    if (upper.length >= 3 && SHARE_TAG_INITIALS[upper[0]]) return SHARE_TAG_INITIALS[upper[0]];
    return null;
}

/** 把各种变体写法的标签归一成 #CONTENT# / #EXTRA#，好让后面用最朴素的 indexOf 定位。 */
function normalizeShareTags(text) {
    if (!text) return '';
    // P1：整行只有一个标签（最常见）
    let out = String(text).replace(
        /^[ \t]*\*{0,2}[#＃]{1,3}[ \t]*([A-Za-z一-龥]{2,12})[ \t]*[:：]?[#＃]{0,3}\*{0,2}[ \t\r]*$/gm,
        (full, word) => _matchShareTag(word) || full
    );
    // P2：标签后面还跟着正文。这里必须要求完整的收尾 #，
    // 否则正文里的「#限时」这类话题词会被误判成标签。
    out = out.replace(
        /^[ \t]*\*{0,2}[#＃]{1,3}[ \t]*([A-Za-z一-龥]{2,12})[ \t]*[#＃]{1,3}\*{0,2}/gm,
        (full, word) => _matchShareTag(word) || full
    );
    return out;
}

/**
 * 洗掉模型爱裹在外面的思考块和代码围栏。喵坛那边（forum_generation.js:352）
 * 也做同样的事，原因一样：不洗的话，整段被 ``` 包起来时收尾那行 ``` 会跟在
 * 最后一个标签后面，被 seg() 一起吃进「附加信息」，用户看到一栏莫名其妙的反引号。
 */
function cleanShareCompletionReply(raw) {
    let text = String(raw == null ? '' : raw)
        .replace(/<(think|thought|thinking)>[\s\S]*?<\/\1>/gi, '')
        .trim();
    // 只削首尾那一对围栏，正文里自己的反引号不动
    if (text.startsWith('```')) {
        text = text.replace(/^```[a-zA-Z]*[ \t]*\r?\n?/, '').replace(/\r?\n?```[ \t]*$/, '');
    }
    return text.trim();
}

/**
 * 从模型回复里取出 { body, extra }。两个标签都没有返回 null。
 *
 * 按"下一个标签的位置"切段，不用前瞻正则：某个标签缺失时只影响它自己那一段，
 * 不会整条失配把附加信息全吞进正文（peek 那套前瞻正则就有这个毛病）。
 */
function parseShareCompletion(text) {
    const src = normalizeShareTags(cleanShareCompletionReply(text));
    const iC = src.indexOf('#CONTENT#');
    const iE = src.indexOf('#EXTRA#');
    if (iC === -1 && iE === -1) return null;

    const allIdx = [iC, iE].filter(i => i !== -1);
    const seg = (start, tag) => {
        if (start === -1) return '';
        const nexts = allIdx.filter(i => i > start);
        const end = nexts.length ? Math.min(...nexts) : src.length;
        return src.substring(start + tag.length, end).trim();
    };
    return { body: seg(iC, '#CONTENT#'), extra: seg(iE, '#EXTRA#') };
}

/**
 * 打散正文里顶格写的字段名。
 *
 * 标签格式让模型不拿「内容：」当分隔符了，但它照样可能在正文里顶格写出
 * 「类别：美团外卖」这种话。这段文字最后要拼进 [xxx的分享：…]，再被
 * parseShareMessage 按行首关键字切一次 —— 那时候整张卡片就错位了。
 *
 * 前缀补的是「· 」而不是空格：字段头正则是 ^\s*标签[:：]，而 \s 连全角空格
 * U+3000 都吃，补空格等于没补。必须是个非空白字符。
 */
function sanitizeShareFieldText(text) {
    if (!text) return '';
    return String(text).split('\n').map(line => {
        for (const field of SHARE_FIELD_KEYS) {
            if (new RegExp(`^\\s*${field.label}[:：]`).test(line)) return `· ${line.trim()}`;
        }
        return line;
    }).join('\n');
}

/**
 * 这次补全用哪套凭据：跟着聊天走 —— 当前会话绑的预设优先，没绑回落全局默认。
 *
 * 合并而不是二选一（`preset.data || db.apiSettings`）：预设里没填的字段
 * ——尤其是温度和流式开关——要能落到全局默认上。口径和 chat_ai_service.js
 * 解析 chatApiPreset 时的 `{ ...db.apiSettings, ...preset.data }` 一致。
 *
 * 整份 preset.data 原样透传，别只挑 url/key/model 三个字段：
 * vertexExpress 还要 projectId，挑字段会漏掉；温度和流式也会一起丢。
 */
function _getShareApiConfig(chat) {
    const presetName = chat && chat.chatApiPreset;
    const preset = presetName && (db.apiPresets || [])
        .find(p => p.name === presetName && (!p.type || p.type === 'chat'));
    return { ...(db.apiSettings || {}), ...((preset && preset.data) || {}) };
}

/**
 * 取某个 position 的世界书正文。私聊存在 character.worldBookIds、群聊存在
 * group.worldBookIds，字段同名，所以一份实现够用。
 *
 * 只认 before / after 两种位置，跟 peek 一致：position 为 'writing' 的那批是
 * 「写作风格」世界书，写给聊天回复用的，注进来只会把模型推向角色扮演散文。
 */
function _shareWorldBookText(chat, position) {
    const books = (typeof db !== 'undefined' && db.worldBooks) ? db.worldBooks : [];
    return (chat.worldBookIds || [])
        .map(id => books.find(wb => wb.id === id && wb.position === position))
        .filter(Boolean)
        .map(wb => wb.content)
        .join('\n');
}

/**
 * 攒参考材料。顺序照搬 peek 的 getPeekBasePromptContext：
 *   世界书before → 角色档案 → 我是谁 → 世界书after → 收藏的记忆 → 向量记忆 → 最近上文
 *
 * 世界书当初是**故意不注入**的，理由是"会影响用户视角"。那条理由站不住：
 * 世界书里装的是客观设定（有哪些 NPC、我养了什么、这个世界什么规矩），
 * 缺了它，标题写「猫粮」模型都不知道家里有猫。真正会串视角的是**角色人设**
 * ——它会让模型用角色口吻写卡片——所以人设虽然也注入了（补全质量确实更好），
 * 系统提示词里对应加了一条硬规则压住："不要用对方的口吻写卡片"。
 * 这两件事别再混成一件，也别再以"影响视角"为由把世界书摘出去。
 */
async function _buildShareCompletionContext(chat) {
    const parts = [];

    const wbBefore = _shareWorldBookText(chat, 'before');
    const wbAfter = _shareWorldBookText(chat, 'after');
    if (wbBefore) parts.push(`**世界观/背景**：\n${wbBefore}`);

    if (currentChatType === 'private') {
        const profile = [`## 👤 角色档案`, `**角色姓名**：${chat.realName || chat.name || '对方'}`];
        if (chat.persona) profile.push(`**人设**：${chat.persona}`);
        profile.push(`**当前状态**：${chat.status || '日常'}`);
        parts.push(profile.join('\n'));

        // peek 那边写的是"你看到的昵称"，因为那时模型在扮演角色。这里模型是在
        // 替我填表，"你"指的是模型自己 —— 照抄会把视角说反，所以改成"对方看到的"。
        const myNick = chat.myNickname || chat.myName;
        const me = [`**我的名字**：${chat.myName || '我'}` +
            (myNick && myNick !== chat.myName ? `（对方看到的昵称是${myNick}）` : '')];
        if (chat.myPersona) me.push(`**我的人设**：${chat.myPersona}`);
        me.push(`这张卡片要发给「${chat.realName || chat.name || '对方'}」。`);
        parts.push(me.join('\n'));
    } else {
        // 群聊没有"一个角色档案"，对应位置换成成员名单。成员的真名/人设优先读
        // 原角色卡（群成员那份副本会过时），口径和 group_prompt.js 一致。
        const roster = (chat.members || []).map(member => {
            const origin = member.originalCharId
                ? (db.characters || []).find(c => c.id === member.originalCharId) : null;
            const realName = (origin && origin.realName) || member.realName || member.groupNickname || '成员';
            const persona = (origin && origin.persona) || member.persona;
            return `- ${realName}：${persona || '无特定人设'}`;
        });
        const profile = [`## 👥 群聊档案`, `**群名**：${chat.name || '群聊'}`];
        if (roster.length) profile.push(`**群成员**：\n${roster.join('\n')}`);
        parts.push(profile.join('\n'));

        // 绑了用户档案时以档案为准（群成员表里那份可能过时），同 group_prompt.js
        const me = (chat.me || {});
        let myRealName = me.realName || me.nickname || '我';
        let myPersona = me.persona;
        if (me.boundPersonaId) {
            const p = (db.userPersonas || []).find(up => up.id === me.boundPersonaId);
            if (p) { myRealName = p.realName; myPersona = p.persona; }
        }
        const mine = [`**我的名字**：${myRealName}` +
            (me.nickname && me.nickname !== myRealName ? `（群里的昵称是${me.nickname}）` : '')];
        if (myPersona) mine.push(`**我的人设**：${myPersona}`);
        mine.push(`这张卡片要发到群聊「${chat.name || '群聊'}」里。`);
        parts.push(mine.join('\n'));
    }

    if (wbAfter) parts.push(`**其他重要事项**：\n${wbAfter}`);

    // 收藏的记忆：照 peek 的口径，只取 isFavorited 的，长期在前
    const longFavs = (chat.longTermSummaries || []).filter(s => s.isFavorited)
        .map(s => `[长期历史] ${s.title}\n${s.content}`);
    const shortFavs = (chat.memorySummaries || []).filter(s => s.isFavorited)
        .map(s => `[回忆] ${s.title}\n${typeof getShortSummaryContent === 'function'
            ? getShortSummaryContent(s, chat) : (s.content || '')}`);
    const favs = [...longFavs, ...shortFavs].join('\n\n');
    if (favs) parts.push(`之前发生的事（仅供你了解背景）：\n${favs}`);

    // 向量记忆。peek 的基础提要里没有这一段，是这边多加的，摆在"记忆"和
    // "最近上文"中间——它本来就是按当前话题捞回来的旧片段，归在记忆一类。
    // 没开开关、或 embedding 没配，它内部自己 catch 成空串，
    // 不会把补全整个带崩 —— 所以这里不用再包一层 try。
    if (chat.vectorMemoryEnabled && typeof buildRetrievedMemoryContext === 'function') {
        const retrieved = await buildRetrievedMemoryContext(chat.history || [], chat);
        if (retrieved) parts.push(`可能相关的历史片段：\n${retrieved}`);
    }

    // 最近上文。history 里的消息本身就是 [谁的消息：…] 形状，
    // 拍平后仍看得出谁说的，所以不需要再拼一遍发言人名字。
    const recent = typeof historyToPlainText === 'function'
        ? historyToPlainText(sliceShareContextHistory(chat.history))
        : '';
    if (recent) parts.push(`**最近聊天上下文**：\n---\n${recent}\n---`);

    return parts.join('\n\n');
}

// 每次打开发送弹窗自增。补全结果回来时对不上，说明弹窗中间关过一轮，
// 这份结果属于上一张卡片 —— 直接丢弃，否则会写进刚打开的空表单里。
let _shareModalSession = 0;

/** 「帮我补全」按钮：拿标题+类别（和已写的草稿）去换一段内容 + 附加信息。 */
async function completeShareContent() {
    const btn = document.getElementById('share-ai-complete-btn');
    const modal = document.getElementById('send-share-modal');
    const titleInput = document.getElementById('share-title-input');
    const categoryInput = document.getElementById('share-category-input');
    const bodyInput = document.getElementById('share-body-input');
    const extraInput = document.getElementById('share-extra-input');
    if (!btn || btn.disabled || !titleInput || !categoryInput || !bodyInput) return;

    const title = titleInput.value.trim();
    const category = categoryInput.value.trim();
    if (!title) {
        showToast('先写个标题，我才知道要补什么。');
        titleInput.focus();
        return;
    }
    if (!category) {
        // 类别决定内容长什么样（外卖给价格、文件给大小），空着补出来的必然跑偏
        showToast('再写个类别，补出来的内容才对路。');
        categoryInput.focus();
        return;
    }

    const chat = (currentChatType === 'private')
        ? (db.characters || []).find(c => c.id === currentChatId)
        : (db.groups || []).find(g => g.id === currentChatId);
    if (!chat) return;

    // 已写的当草稿喂进去，让模型在此基础上扩写，别把用户打的字丢了
    const draftBody = bodyInput.value.trim();
    const draftExtra = extraInput ? extraInput.value.trim() : '';

    const session = _shareModalSession;
    btn.disabled = true;
    btn.textContent = SHARE_AI_BTN_BUSY_LABEL;

    try {
        const context = await _buildShareCompletionContext(chat);
        let userMsg = `【参考资料】\n${context}\n\n【我已经填好的】\n标题：${title}\n类别：${category}`;
        if (draftBody || draftExtra) {
            userMsg += `\n\n【我起了个头，在此基础上补，别丢掉已有的信息】`;
            if (draftBody) userMsg += `\n（内容草稿）${draftBody}`;
            if (draftExtra) userMsg += `\n（附加信息草稿）${draftExtra}`;
        }

        const raw = await callLLM({
            cfg: _getShareApiConfig(chat),
            messages: [
                { role: 'system', content: SHARE_COMPLETE_SYSTEM_PROMPT },
                { role: 'user', content: userMsg }
            ],
            // 温度和流式都**不在这里写死**：callLLM 没收到这两项就回落 cfg 里的值，
            // 也就是用户在 API 预设里自己设的那份。原先钉的是 temperature: 0.9 +
            // stream: false —— 前者盖掉用户的温度偏好，后者在只支持流式的中转站上
            // 直接报错。代价是"重复点按钮再摇一个"的多样性现在取决于预设温度，
            // 用户把温度调到 0.3 就会每次吐得差不多，那是他自己的选择。
            //
            // 流式不影响按标签解析：callLLM 不给 onChunk 时会把整段读完再返回
            // 一个完整字符串（peek 的 callPeekApi 也是靠这一点）。
            timeout: 60000
        });

        // 请求飞在路上时用户可能已经关掉弹窗、甚至又开了一次
        if (session !== _shareModalSession) return;
        if (modal && !modal.classList.contains('visible')) return;

        const parsed = parseShareCompletion(raw);
        // 标签一个都没认出来时，把整段回复当内容塞进去：用户看得见也改得动，
        // 比弹一句"格式有误"然后什么都不给强。这条路也要洗一遍，
        // 不然思考块和围栏会原样进输入框。
        const body = sanitizeShareFieldText(parsed ? parsed.body : cleanShareCompletionReply(raw));
        const extra = sanitizeShareFieldText(parsed ? parsed.extra : '');

        if (!body && !extra) {
            showToast('AI 没给出能用的内容，再点一次试试。');
            return;
        }
        // 覆盖，但"没给"不等于"清空"：模型省略了附加信息时保留用户原来写的
        if (body) bodyInput.value = body;
        if (extra && extraInput) extraInput.value = extra;
    } catch (e) {
        // showApiError 会把 401/429/504 这些翻译成人话，别自己拼错误文案
        if (typeof showApiError === 'function') showApiError(e);
        else showToast('补全失败：' + (e && e.message ? e.message : e));
    } finally {
        // 放 finally：showToast 是脚本级 const，它自己抛错会跳过 catch 里的收尾，
        // 按钮就永久卡在"补全中…"了
        btn.disabled = false;
        btn.textContent = SHARE_AI_BTN_LABEL;
    }
}

// --- 详情弹窗 ---

/**
 * 点卡片弹出来的完整四项。share 由 parseShareMessage / parseLegacyForumShare 产出。
 */
function openShareDetailModal(share) {
    const modal = document.getElementById('share-detail-modal');
    if (!modal || !share) return;

    const setField = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        // textContent：分享内容是用户/AI 的自由文本，绝不能当 HTML 塞进去
        el.textContent = value || '';
    };

    // 正文/附注按行拆成段落。Gemini 分段没谱：有时单换行有时双换行，
    // pre-wrap 原样显示就忽紧忽松。空行丢掉、每行一个 <p>，
    // 段距交给 CSS，怎么换行渲染都统一。
    const setParagraphs = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = '';
        (value || '').replace(/\r\n?/g, '\n').split('\n').forEach(line => {
            const text = line.trim();
            if (!text) return;
            const p = document.createElement('p');
            p.textContent = text;
            el.appendChild(p);
        });
    };

    setField('share-detail-category', share.category);
    setField('share-detail-title', share.title);
    setParagraphs('share-detail-body', share.body);

    // 附加信息可以留空 —— 空的时候整块藏掉，别留个空标题
    const extraBlock = document.getElementById('share-detail-extra-block');
    if (extraBlock) {
        if (share.extra) {
            extraBlock.style.display = '';
            setParagraphs('share-detail-extra', share.extra);
        } else {
            extraBlock.style.display = 'none';
        }
    }

    modal.classList.add('visible');
}

// ============================================================
// === 转发聊天记录 ===========================================
// ============================================================
//
// 长按消息 →「多选」→ 勾几条 →「转发」→ 选目标聊天 → 在那边生成一张
// 类别为「聊天记录」的分享卡片，正文是「昵称：内容」逐行的可读文本。
//
// ★ 为什么不能把原始消息整条搬过去：
//   历史消息长的是 `[小猫的语音：喂]` 这种给渲染层和 AI 看的方括号格式。
//   原样塞进卡片正文，目标聊天的气泡工厂会把它认成一条**真的语音消息**，
//   模型也会以为那是它自己刚收到的东西。转发要的是"引述"，不是"重放"，
//   所以这里统一压成纯文本，特殊消息只留 [语音] [图片] 这种方括号标签。

// 系统生成的类别，和 SHARE_FORUM_CATEGORY 一样不进 SHARE_CATEGORY_PRESETS ——
// 手动发卡片时选「聊天记录」没有意义（正文得是转发来的才对得上）。
const SHARE_CHATLOG_CATEGORY = '聊天记录';

// 转发时整条丢掉的消息。口径照 chat_bubble_factory.js 的 invisibleRegex ——
// 这些在原聊天里本来就不显示（转账回执、人设状态更新、[system:] 簿记），
// 搬进卡片只会变成看不懂的噪音。外加 [time-divider]（日期分隔线，不是消息）。
const FORWARD_SKIP_REGEX = /^\[time-divider\]$|\[.*?(?:接收|退回).*?的转账\]|\[.*?更新状态为[:：].*?\]|\[.*?已接收礼物\]|\[system:[\s\S]*?\]|\[系统情景通知[:：].*?\]/;

// 群务系统消息：原文本身就是一句完整的话，去掉外层方括号直接用
const FORWARD_GROUP_NOTICE_REGEX = /^\[[^\]]*?(?:邀请.*?加入了群聊|将.*?移出了群聊|修改群名为[:：].*?|修改.*?的群昵称为[:：].*?|将自己的群昵称修改为[:：].*?)\]$/;

// 认出"这个值是张图/一段 base64"，用来防止把 data URI 抄进卡片正文 ——
// 旧版表情包消息的值就是 URL 甚至 base64，几十 KB 抄进去卡片就废了。
const FORWARD_URLISH_REGEX = /^(?:https?:\/\/|data:)/i;

/**
 * 这条消息在转发卡片里署谁的名。
 *
 * 口径贴 chat_search.js 那套（搜索结果也是"引述别处的消息"，同一类场景），
 * 但用户这边用真昵称而不是「我」—— 卡片是给第三个聊天看的，那边的角色
 * 不知道「我」是谁。
 *
 * ★ 两边一律取**真名**，不取昵称。转发出去是给第三个聊天（多半是群）看的，
 *   昵称是"在某个具体聊天里才成立"的称呼：角色的 remarkName 是用户给他起的
 *   备注，群成员的 groupNickname 是那个群内部的叫法，搬到别处就对不上号了
 *   （群里叫「阿花」的人，转发到另一个群里没人知道是谁）。真名的对应关系是：
 *     用户  私聊 chat.myName          群聊 chat.me.realName
 *     对方  私聊 char.realName        群聊 member.realName
 *   兜底顺序里 `remarkName` / `chat.name` / `groupNickname` 只是老数据的退路
 *   （characters 表历史上只存过 remarkName），不是首选。
 */
function _forwardSenderName(message, chat, chatType) {
    if (message.role === 'user') {
        return (chatType === 'private')
            ? (chat.myName || '我')
            : ((chat.me && chat.me.realName) || '我');
    }
    if (chatType === 'private') return chat.realName || chat.remarkName || chat.name || '对方';
    const member = (typeof findGroupMemberById === 'function')
        ? findGroupMemberById(chat, message.senderId) : null;
    return (member && (member.realName || member.groupNickname)) || '群成员';
}

/**
 * 一条消息在转发卡片里显示成什么。返回 { name, text }；返回 null = 不收录。
 *
 * 为什么不复用 chat_list.js 那套预览逻辑：那边要的是列表里一行摘要，语音和
 * 照片一律压成 [语音] [照片/视频] 就完事了，**正文全丢**。转发要的恰恰是
 * 正文本身，标签只是补个类型说明。两者目标不同，共用会两头不讨好。
 */
function describeForwardedMessage(message, chat, chatType) {
    if (!message || message.isHidden) return null;
    const raw = (typeof message.content === 'string') ? message.content : '';
    if (FORWARD_SKIP_REGEX.test(raw)) return null;

    // --- 没有发言人的几种：旁白 / 系统通知 ---
    const narration = raw.match(/^\[system-narration:([\s\S]+?)\]$/)
        || raw.match(/^\[剧情旁白[:：]([\s\S]+?)\]$/);
    if (narration) {
        // *斜体* 是渲染用的标记，纯文本里留着反而碍眼
        return { name: '旁白', text: narration[1].replace(/\*([^*]+)\*/g, '$1').trim() };
    }

    const display = raw.match(/^\[system-display:([\s\S]+?)\]$/);
    if (display) return { name: '系统', text: display[1].trim() };

    if (FORWARD_GROUP_NOTICE_REGEX.test(raw)) {
        return { name: '系统', text: raw.slice(1, -1).trim() };
    }

    // --- 以下都是某个人说的话 ---
    const name = _forwardSenderName(message, chat, chatType);

    if (message.isWithdrawn) return { name, text: '[已撤回]' };

    // 图片识别消息的 content **本身就是 base64**（parts 里才有那句提示语），
    // 所以必须先按 parts 判掉，不然几十 KB 的 data URI 会被当正文抄进卡片。
    const parts = Array.isArray(message.parts) ? message.parts : [];
    if (parts.some(p => p && p.type === 'image')) return { name, text: '[图片]' };
    if (parts.some(p => p && p.type === 'html')) return { name, text: '[互动内容]' };
    if (FORWARD_URLISH_REGEX.test(raw.trim())) return { name, text: '[图片]' };
    if (/^\[.*?发来了一张图片[:：]\s*\]$/.test(raw)) return { name, text: '[图片]' };

    // 嵌套的分享卡片：只留标题。
    // ★ 绝对不能把原文那几行搬进来 —— `标题：` `类别：` `内容：` 是顶格写的，
    //   parseShareFields 会把它们当成**外层**卡片的字段头，从那行起后面的
    //   内容全被切给别的字段。症状是外层卡片静默少半截，不报错不变形。
    const nested = parseShareMessage(raw) || parseLegacyForumShare(raw);
    if (nested) return { name, text: `[分享：${nested.title || '无标题'}]` };

    // 带类型的方括号消息：留标签 + 原文
    const typed = [
        [/^\[.*?的语音[:：]\s*([\s\S]*)\]$/, '语音'],
        [/^\[.*?发来的照片\/视频[:：]\s*([\s\S]*)\]$/, '照片/视频'],
        [/^\[.*?(?:的|发送的)表情包[:：]\s*([\s\S]*)\]$/, '表情包'],
        [/^\[.*?发送了位置[:：]\s*([\s\S]*)\]$/, '位置'],
        [/^\[.*?(?:给你转账|的转账|向.*?转账)[:：]\s*([\s\S]*)\]$/, '转账'],
        [/^\[.*?(?:送来的礼物|向.*?送来了礼物)[:：]\s*([\s\S]*)\]$/, '礼物'],
    ];
    for (const [re, label] of typed) {
        const m = raw.match(re);
        if (!m) continue;
        const inner = (m[1] || '').trim();
        // 旧版表情包的值是 URL/base64，那种只留标签
        const usable = inner && !FORWARD_URLISH_REGEX.test(inner);
        return { name, text: usable ? `[${label}]${inner}` : `[${label}]` };
    }

    // 普通消息，以及所有 [前缀：正文] 形状的兜底（引用回复、专注记录等）
    const plain = raw.match(/^\[.*?的消息[:：]\s*([\s\S]*)\]$/);
    let text = plain ? plain[1] : raw.replace(/^\[.*?[:：]([\s\S]*)\]$/, '$1');
    text = text.replace(/\[发送时间:.*?\]/g, '').trim();
    return text ? { name, text } : null;
}

/**
 * 把选中的消息拼成卡片正文，每条一行「昵称：内容」。
 *
 * ★ 结果**必须**过 sanitizeShareFieldText，这不是可选的洁癖：
 *   正文里任何顶格的「标题：」「类别：」「内容：」「附加信息：」都会被
 *   parseShareFields 当成字段头。而这里每一行都以昵称开头 —— 用户把角色
 *   备注名改成「标题」就正好踩上；多行 AI 回复里顶格写「附加信息：」也够常见。
 *   不过这道的话，卡片会从那行起被截掉，且**静默**发生。
 */
function buildForwardTranscript(messages, chat, chatType) {
    const lines = [];
    (messages || []).forEach(m => {
        const item = describeForwardedMessage(m, chat, chatType);
        if (item) lines.push(`${item.name}：${item.text}`);
    });
    return sanitizeShareFieldText(lines.join('\n'));
}

/**
 * 卡片标题：「我和小猫的聊天记录」。
 * 群聊没有"角色昵称"，用群名顶上（「我和摸鱼小队的聊天记录」）。
 * 昵称里的换行要抹掉 —— 标题在消息里只占一行，带换行会把「类别：」挤下去。
 *
 * ★ 对方的名字取真名，跟正文里的署名（_forwardSenderName）保持一致 ——
 *   不然标题写「小明和猫猫的聊天记录」、底下每行却署「小猫」，自相矛盾。
 *   群名不是昵称（它是那个群自己的名字），照旧。
 */
function buildForwardTitle(chat, chatType) {
    const me = (chatType === 'private')
        ? (chat.myName || '我')
        : ((chat.me && chat.me.realName) || '我');
    const other = (chatType === 'private')
        ? (chat.realName || chat.remarkName || chat.name || '对方')
        : (chat.name || '群聊');
    return `${me}和${other}的聊天记录`.replace(/\s*[\r\n]+\s*/g, ' ');
}

// --- 转发弹窗 ---

function setupForwardMessagesModal() {
    const modal = document.getElementById('forward-messages-modal');
    if (!modal) return;

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('visible');
    });

    // 私聊 / 群聊 tab（和喵坛分享弹窗同一套 class，行为照抄）
    const tabBar = document.getElementById('forward-target-tab-bar');
    const charList = document.getElementById('forward-char-list');
    const groupList = document.getElementById('forward-group-list');
    if (tabBar) {
        tabBar.querySelectorAll('.char-info-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                tabBar.querySelectorAll('.char-info-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const isPrivate = btn.dataset.forwardTab === 'private';
                if (charList) charList.style.display = isPrivate ? '' : 'none';
                if (groupList) groupList.style.display = isPrivate ? 'none' : '';
            });
        });
    }

    const confirmBtn = document.getElementById('confirm-forward-btn');
    if (confirmBtn) confirmBtn.addEventListener('click', sendForwardedMessages);
}

/** 渲染一个「头像 + 昵称 + 复选框」清单。idPrefix 要和别的弹窗错开（label for） */
function _renderForwardTargetList(listEl, items, idPrefix, emptyText) {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!items.length) {
        listEl.innerHTML = `<li class="forward-target-empty">${emptyText}</li>`;
        return;
    }
    items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'binding-list-item';
        const inputId = `${idPrefix}${item.id}`;
        // 昵称走 textContent 而不是拼进 innerHTML —— 角色备注名是用户自由输入的
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = inputId;
        input.value = item.id;
        const label = document.createElement('label');
        label.className = 'forward-target-label';
        label.setAttribute('for', inputId);
        const img = document.createElement('img');
        img.src = item.avatar || '';
        img.alt = '';
        const span = document.createElement('span');
        span.textContent = item.name || '未命名';
        label.appendChild(img);
        label.appendChild(span);
        li.appendChild(input);
        li.appendChild(label);
        listEl.appendChild(li);
    });
}

/**
 * 打开转发弹窗。目标清单里**不排除当前聊天** —— 把几条话转发给同一个角色
 * 当作引述是合理用法，没理由拦。
 */
function openForwardMessagesModal() {
    if (typeof selectedMessageIds === 'undefined' || selectedMessageIds.size === 0) {
        showToast('先选中要转发的消息。');
        return;
    }
    const modal = document.getElementById('forward-messages-modal');
    if (!modal) return;

    const noteInput = document.getElementById('forward-note-input');
    if (noteInput) noteInput.value = '';

    _renderForwardTargetList(
        document.getElementById('forward-char-list'),
        (db.characters || []).map(c => ({ id: c.id, name: c.remarkName || c.name, avatar: c.avatar })),
        'forward-to-', '暂无可以转发的角色。'
    );
    _renderForwardTargetList(
        document.getElementById('forward-group-list'),
        (db.groups || []).map(g => ({ id: g.id, name: g.name, avatar: g.avatar })),
        'forward-to-group-', '暂无可以转发的群聊。'
    );

    // 每次打开都回到「私聊」那一页，免得上次切到群聊后这次以为没角色可选
    const tabBar = document.getElementById('forward-target-tab-bar');
    if (tabBar) {
        tabBar.querySelectorAll('.char-info-tab-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.forwardTab === 'private');
        });
    }
    const charList = document.getElementById('forward-char-list');
    const groupList = document.getElementById('forward-group-list');
    if (charList) charList.style.display = '';
    if (groupList) groupList.style.display = 'none';

    modal.classList.add('visible');
}

async function sendForwardedMessages() {
    const modal = document.getElementById('forward-messages-modal');
    const charList = document.getElementById('forward-char-list');
    const groupList = document.getElementById('forward-group-list');

    const charIds = charList
        ? Array.from(charList.querySelectorAll('input:checked')).map(i => i.value) : [];
    const groupIds = groupList
        ? Array.from(groupList.querySelectorAll('input:checked')).map(i => i.value) : [];

    if (!charIds.length && !groupIds.length) {
        showToast('请至少选择一个转发对象。');
        return;
    }

    const sourceChat = (currentChatType === 'private')
        ? db.characters.find(c => c.id === currentChatId)
        : db.groups.find(g => g.id === currentChatId);
    if (!sourceChat) return;

    // 按 history 过滤而不是遍历 selectedMessageIds：那是个 Set，装的是**点击
    // 顺序**（用户完全可以先点新的再点旧的）。history 本身保证按时间升序，
    // 顺着它筛就白拿了时间顺序，不用另外排序。
    const picked = (sourceChat.history || []).filter(m => selectedMessageIds.has(m.id));
    const body = buildForwardTranscript(picked, sourceChat, currentChatType);
    if (!body.trim()) {
        showToast('选中的消息没有可转发的内容。');
        return;
    }

    const noteInput = document.getElementById('forward-note-input');
    // 备注同样要过一道 —— 用户在这儿顶格打「附加信息：」就会切坏字段边界
    const extra = sanitizeShareFieldText((noteInput ? noteInput.value : '').trim());

    if (modal) modal.classList.remove('visible');

    const delivered = await deliverShareToChats({ charIds, groupIds }, {
        title: buildForwardTitle(sourceChat, currentChatType),
        category: SHARE_CHATLOG_CATEGORY,
        body,
        extra,
    });

    // 先退出多选（把输入栏放回来），再补气泡 —— 转发给自己这个会话时，
    // 卡片得当场看得见，否则用户以为没发出去。
    if (typeof exitMultiSelectMode === 'function') exitMultiSelectMode();

    delivered.forEach(({ chatId, chatType, message }) => {
        if (chatId === currentChatId && chatType === currentChatType) {
            addMessageBubble(message, currentChatId, currentChatType);
        }
    });

    if (typeof renderChatList === 'function') renderChatList();
    showToast(delivered.length
        ? `已转发 ${picked.length} 条消息给 ${delivered.length} 个聊天`
        : '转发失败，没找到目标聊天。');
}

// 供 node 测试 require（浏览器里这行不执行）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SHARE_MESSAGE_REGEX,
        SHARE_CATEGORY_PRESETS,
        SHARE_FORUM_CATEGORY,
        SHARE_FIELD_KEYS,
        SHARE_COMPLETE_SYSTEM_PROMPT,
        buildShareMessageContent,
        parseShareFields,
        parseShareMessage,
        parseLegacyForumShare,
        extractShareBlocks,
        maskShareBlocks,
        restoreShareBlocks,
        normalizeShareTags,
        cleanShareCompletionReply,
        parseShareCompletion,
        sanitizeShareFieldText,
        sliceShareContextHistory,
        SHARE_CONTEXT_ROUND_TARGET,
        SHARE_CONTEXT_MESSAGE_CAP,
        SHARE_CHATLOG_CATEGORY,
        describeForwardedMessage,
        buildForwardTranscript,
        buildForwardTitle,
    };
}
