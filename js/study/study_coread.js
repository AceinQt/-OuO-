// study_coread.js — 学习模块：共读功能（悬浮球版）
// 依赖：study_core.js / study_db.js / study_ai.js / study_bookshelf.js
// ★ V8：共读消息存入 studyCoreadMessages 独立表，不再依赖 book.coreadMessages 字段
// =====================================================

// ── 共读设置（按书存取：db.studySettings.coread[bookId]）────────────

const _COREAD_DEFAULTS = {
  charId: '', personaId: '', worldbookIds: [],
  historyCount: 20, prevPages: 1, nextPages: 0
};

function _getCoreadSettings() {
  const bookId = window._study.state.reader.bookId;
  const all = getStudySettings().coread || {};
  // 兼容旧全局格式：若 all 直接含 charId 字段说明是旧数据，忽略
  if (bookId && all[bookId]) return { ..._COREAD_DEFAULTS, ...all[bookId] };
  return { ..._COREAD_DEFAULTS };
}

async function _updateCoreadSettings(patch) {
  const bookId = window._study.state.reader.bookId;
  if (!bookId) return;
  const all     = getStudySettings().coread || {};
  const current = (all[bookId] && typeof all[bookId] === 'object') ? all[bookId] : {};
  await updateStudySettings({ coread: { ...all, [bookId]: { ...current, ...patch } } });
}

// ── 运行时状态 ───────────────────────────────────────────
// ★ _coread 是模块级变量，切书时必须通过 _resetCoread() 显式清空

const _coread = {
  active:     false,
  expanded:   false,
  char:       null,
  persona:    null,
  bookId:     null,   // ★ 新增：记录当前绑定的书，用于切书检测
  messages:   [],
  generating: false,
};

// ── 重置共读状态（切书 / 退出时调用）────────────────────

function _resetCoread() {
  _coread.active     = false;
  _coread.expanded   = false;
  _coread.char       = null;
  _coread.persona    = null;
  _coread.bookId     = null;
  _coread.messages   = [];
  _coread.generating = false;
  _coreadLastGenerating = false; 
}

// ── 辅助：获取当前书 ──────────────────────────────────────

function _getCurrentBook() {
  const bookId = window._study.state.reader.bookId;
  return getAllStudyBooks().find(b => b.id === bookId);
}

// ── 持久化：追加 / 更新 DB 中的共读消息 ─────────────────
// 不再整本 book.coreadMessages 全量写，而是单条精准操作

async function _appendCoreadMsg(msg) {
  const bookId = window._study.state.reader.bookId;
  if (!bookId) return;
  if (typeof appendCoreadMessageToDB === 'function') {
    await appendCoreadMessageToDB(bookId, msg);
  }
}

async function _updateLastCoreadMsg(content) {
  const bookId = window._study.state.reader.bookId;
  if (!bookId) return;
  if (typeof updateLastCoreadMessageInDB === 'function') {
    await updateLastCoreadMessageInDB(bookId, content);
  }
}

// ── 渲染：更新悬浮球旁气泡 ───────────────────────────────

// generating 状态上一帧的值，用于检测状态切换，避免流式中频繁触发 rAF
let _coreadLastGenerating = false;

function _renderCoreadMessages() {
  const charMsgs = _coread.messages.filter(m => m.role === 'char');
  const lastChar = charMsgs[charMsgs.length - 1];

  const bubbleEl = document.getElementById('reader-bubble-text');
  if (bubbleEl) {
    if (_coread.generating) {
      bubbleEl.innerHTML = `
        <span class="coread-typing-dot"></span>
        <span class="coread-typing-dot"></span>
        <span class="coread-typing-dot"></span>`;
      // 只在刚进入 generating 状态时定位一次（省略号气泡专用：左/右二选一）
      if (!_coreadLastGenerating) {
        requestAnimationFrame(() => _syncTypingBubblePosition());
      }
    } else {
      bubbleEl.textContent = lastChar?.content || (_coread.char ? '发送消息开始交流吧' : '和你一起读书的人');
  // 双 rAF：确保内容写入后浏览器完成 layout，再取 offsetWidth 定位
  if (_coreadLastGenerating) {
    requestAnimationFrame(() => requestAnimationFrame(() => _syncBubblePosition()));
  }
    }
  }

  _coreadLastGenerating = _coread.generating;

  const sendBtn = document.getElementById('coread-send-btn');
  if (sendBtn) {
    sendBtn.disabled = _coread.generating;
  }
}

// ── 更新悬浮球头像（有角色显示头像，无角色显示"无"占位）──────

function _updateFloatBallAvatar() {
  const avatarEl      = document.getElementById('reader-float-avatar');
  const placeholderEl = document.getElementById('reader-float-placeholder');
  if (_coread.char?.avatar) {
    if (avatarEl)      { avatarEl.src = _coread.char.avatar; avatarEl.style.display = ''; }
    if (placeholderEl) placeholderEl.style.display = 'none';
  } else {
    if (avatarEl)      { avatarEl.src = ''; avatarEl.style.display = 'none'; }
    if (placeholderEl) placeholderEl.style.display = '';
  }
}

// ── 进入共读（显示悬浮球） ───────────────────────────────

async function studyEnterCoread() {
  const cfg     = _getCoreadSettings();
  const char    = cfg.charId ? (db.characters || []).find(c => c.id === cfg.charId) : null;
  const persona = cfg.personaId
    ? (db.userPersonas || []).find(p => (p.id || p.nickname) === cfg.personaId)
    : null;

  const bookId = window._study.state.reader.bookId;

  _coread.active     = true;
  _coread.expanded   = false;
  _coread.char       = char || null;
  _coread.persona    = persona;
  _coread.bookId     = bookId;
  _coread.generating = false;

  // 有角色时从 DB 读取历史消息
  if (char && typeof getCoreadMessagesFromDB === 'function') {
    _coread.messages = await getCoreadMessagesFromDB(bookId);
  } else {
    _coread.messages = [];
  }

  // 更新悬浮球头像（有角色/无角色自动切换）
  _updateFloatBallAvatar();

  // 显示悬浮球
  const ball = document.getElementById('reader-float-ball');
  if (ball) ball.style.display = 'flex';

  // 关闭 header 和底部菜单（回到沉浸模式）
  document.getElementById('reader-app-header')?.classList.remove('reader-header-visible');
  document.getElementById('reader-bottom-menu')?.classList.remove('visible');

  _renderCoreadMessages();
}

// ── 退出共读 ─────────────────────────────────────────────

function studyExitCoread() {
  _resetCoread(); // ★ 完整重置，不留残留

  document.getElementById('reader-float-ball')?.style.setProperty('display', 'none');
  document.getElementById('reader-bubble-wrap')?.style.setProperty('display', 'none');
  document.getElementById('reader-coread-input-bar')?.style.setProperty('display', 'none');
  document.getElementById('reader-float-ball')?.classList.remove('expanded');
}

// ── 气泡位置同步（跟随悬浮球，自动判断左右上下）────────────
function _syncBubblePosition() {
  const ball = document.getElementById('reader-float-ball');
  const wrap = document.getElementById('reader-bubble-wrap');
  if (!ball || !wrap) return;

  const rect = ball.getBoundingClientRect();
  const W    = window.innerWidth;
  const H    = window.innerHeight;
  const gap  = 10;
  const INPUT_BAR_H = 80;

  const bw = Math.max(wrap.offsetWidth  || 0, 40);
  const bh = Math.max(wrap.offsetHeight || 0, 40);

  const spaceRight = W - rect.right  - gap;
  const spaceLeft  = rect.left       - gap;
  const spaceBelow = H - rect.bottom - gap - INPUT_BAR_H;

  let left, top;

  if (spaceRight >= bw) {
    left = rect.right + gap;
    top  = rect.top + rect.height / 2 - bh / 2;
  } else if (spaceLeft >= bw) {
    left = rect.left - bw - gap;
    top  = rect.top + rect.height / 2 - bh / 2;
  } else if (spaceBelow >= bh) {
    left = rect.left + rect.width / 2 - bw / 2;
    top  = rect.bottom + gap;
  } else {
    // 上方兜底
    left = rect.left + rect.width / 2 - bw / 2;
    top  = rect.top - bh - gap;
  }

  left = Math.max(8, Math.min(W - bw - 8, left));
  top  = Math.max(8, Math.min(H - INPUT_BAR_H - bh - 4, top));

  wrap.style.left   = left + 'px';
  wrap.style.top    = top  + 'px';
  wrap.style.right  = 'auto';
  wrap.style.bottom = 'auto';
}

// ── 自动监听气泡尺寸变化 ─────────────────────────────────
let _bubbleObserver = null;

function _initBubbleResizeObserver() {
  const wrap = document.getElementById('reader-bubble-wrap');
  if (!wrap || _bubbleObserver) return;
  
  _bubbleObserver = new ResizeObserver(() => {
    // 只有气泡可见且是展开状态时才自动纠偏
    if (wrap.style.display !== 'none' && _coread.expanded) {
      if (_coread.generating) {
        _syncTypingBubblePosition();
      } else {
        _syncBubblePosition();
      }
    }
  });
  
  _bubbleObserver.observe(wrap); // 监听容器的宽高变化
}

// ── 省略号气泡专用定位（生成中）────────────────────────────
// 省略号内容极小且固定，只判断左/右，垂直居中对齐头像
// 不用 offsetWidth 是因为三个点的气泡渲染尺寸不稳定

// ── 省略号气泡专用定位（只判断左右）────────────────────────
// 省略号尺寸小且稳定，rAF 后取值已够准

function _syncTypingBubblePosition() {
  const ball = document.getElementById('reader-float-ball');
  const wrap = document.getElementById('reader-bubble-wrap');
  if (!ball || !wrap) return;

  const rect = ball.getBoundingClientRect();
  const W    = window.innerWidth;
  const H    = window.innerHeight;
  const gap  = 10;
  const INPUT_BAR_H = 80;

  const bw = wrap.offsetWidth  || 64;
  const bh = wrap.offsetHeight || 44;

  const left = (W - rect.right - gap >= bw)
    ? rect.right + gap
    : rect.left - bw - gap;

  let top = rect.top + rect.height / 2 - bh / 2;

  wrap.style.left   = Math.max(8, Math.min(W - bw - 8, left)) + 'px';
  wrap.style.top    = Math.max(8, Math.min(H - INPUT_BAR_H - bh - 4, top)) + 'px';
  wrap.style.right  = 'auto';
  wrap.style.bottom = 'auto';
}

// ── 切换悬浮球展开/收起 ──────────────────────────────────

// 供 _closeAllReaderPanels 调用：收起共读对话框+输入栏
function _collapseCoread() {
  if (!_coread.active || !_coread.expanded) return;
  _coread.expanded = false;
  document.getElementById('reader-float-ball')?.classList.remove('expanded');
  document.getElementById('reader-bubble-wrap')?.style.setProperty('display', 'none');
  document.getElementById('reader-coread-input-bar')?.style.setProperty('display', 'none');
}

function _toggleFloatBall() {
  if (!_coread.active) return;
  _coread.expanded = !_coread.expanded;

  const ball       = document.getElementById('reader-float-ball');
  const bubbleWrap = document.getElementById('reader-bubble-wrap');
  const inputBar   = document.getElementById('reader-coread-input-bar');

  if (_coread.expanded) {
    ball?.classList.add('expanded');
    if (bubbleWrap) bubbleWrap.style.display = 'flex';
    if (inputBar)   inputBar.style.display   = 'flex';
    // 等气泡渲染完一帧再定位（display:none→flex 后 offsetWidth 需一帧才有值）
    requestAnimationFrame(() => _syncBubblePosition());
    // 关闭其他面板，避免干扰
    if (typeof _closeAllReaderPanels === 'function') {
      _closeAllReaderPanels('coread');
    } else {
      document.getElementById('reader-app-header')?.classList.remove('reader-header-visible');
      document.getElementById('reader-bottom-menu')?.classList.remove('visible');
    }
  } else {
    ball?.classList.remove('expanded');
    if (bubbleWrap) bubbleWrap.style.display = 'none';
    if (inputBar)   inputBar.style.display   = 'none';
  }
}

// ── 发送消息 ─────────────────────────────────────────────

async function studySendCoreadMessage() {
  const input = document.getElementById('coread-input');
  const text  = input?.value.trim();
  if (!text || _coread.generating) return;

  const userName = _coread.persona?.realName || _coread.persona?.nickname || _coread.char?.myName || db.settings?.userNickname || '读者';
const userMsg = { role: 'user', content: text, timestamp: Date.now(), userName };
  _coread.messages.push(userMsg);
  if (input) input.value = '';
  _renderCoreadMessages();

  // ★ V8：单条追加到 DB，不再整本写
  await _appendCoreadMsg(userMsg);
  await _coreadCharReply(text);
}

// ── 辅助：组装前后页内容 ──────────────────────────────────

function _buildPageContext() {
  const cfg       = _getCoreadSettings();
  const prevPages = cfg.prevPages ?? 1;
  const nextPages = cfg.nextPages ?? 0;
  const s         = window._study.state.reader;
  const pages     = s.pages || [];
  const cur       = s.page  || 0;

  const parts = [];

  // 前 N 页
  for (let i = Math.max(0, cur - prevPages); i < cur; i++) {
    if (pages[i]) parts.push(`【第${i + 1}页】\n${pages[i].substring(0, 600)}`);
  }

  // 当前页
  if (pages[cur]) parts.push(`【当前页（第${cur + 1}页）】\n${pages[cur].substring(0, 800)}`);

  // 后 N 页
  const maxPage = pages.length - 1;
  for (let i = cur + 1; i <= Math.min(maxPage, cur + nextPages); i++) {
    if (pages[i]) parts.push(`【第${i + 1}页】\n${pages[i].substring(0, 600)}`);
  }

  return parts.join('\n\n');
}

// ── 辅助：构建已读章节笔记上下文 ─────────────────────────
// 规则：当前页所在章节索引为 curChapterIdx，
//       注入所有 endChapterIdx < curChapterIdx 的笔记（按章节顺序）

function _buildSummaryContext() {
  const s    = window._study.state.reader;
  const toc  = s.toc  || [];
  const page = s.page ?? 0;
  const book = _getCurrentBook();
  if (!toc.length || !book?.memorySummaries?.length) return '';

  // 从后往前找：最后一个 page <= 当前页 的 toc 条目即为当前章节
  let curChapterIdx = -1;
  for (let i = toc.length - 1; i >= 0; i--) {
    if (toc[i].page <= page) { curChapterIdx = i; break; }
  }
  // curChapterIdx <= 0：第 0 章之前没有"更早"章节，无需注入
  if (curChapterIdx <= 0) return '';

  // 筛选严格在当前章节之前的笔记，按章节顺序排列
  const notes = (book.memorySummaries || [])
    .filter(n => (n.endChapterIdx ?? -1) < curChapterIdx)
    .sort((a, b) => (a.startChapterIdx ?? 0) - (b.startChapterIdx ?? 0));

  if (!notes.length) return '';

  const lines = notes.map(n =>
    `【${n.chapterRange || n.title}】\n${n.content}`
  ).join('\n\n');

  return `【已读章节笔记】\n以下是我们此前读过的章节笔记，供你参考：\n\n${lines}\n\n`;
}

// ── AI Prompt 组装 ────────────────────────────────────────

function _buildCoreadSystemPrompt() {
  const char    = _coread.char;
  const persona = _coread.persona;
  const cfg     = _getCoreadSettings();
  const book    = _getCurrentBook();

const charName  = char.realName || char.remarkName || char.name || '共读者';
  // 真名优先，昵称备选，再 fallback 到 char.myName
  const userName  = persona?.realName || persona?.nickname || char.myName || db.settings?.userNickname || '读者';
  // 读者描述：优先取实时 persona，没有再取 char.myPersona
  const userDesc  = persona?.persona || char.myPersona || '一个正在读书的人。';
  const charPersona = char.persona || char.description || '一个热心的陪读人。';
  const charStatus  = char.status  || '';
  const bookTitle   = book?.title       || '某本书';
  const bookDesc    = book?.description || '';

  const allWbIds = cfg.worldbookIds || [];
  const allWbs   = db.worldBooks || [];
  const wbBefore = allWbs.filter(w => allWbIds.includes(w.id) && w.position === 'before').map(w => w.content).filter(Boolean).join('\n');
  const wbAfter  = allWbs.filter(w => allWbIds.includes(w.id) && w.position === 'after').map(w => w.content).filter(Boolean).join('\n');

  let prompt = '';

  // ── 共读情境（置顶）──
  prompt += `你（${charName}）正在和我（ ${userName}） 一起读一本书。\n\n`;
  
    // ── 世界观 ──
  if (wbBefore) prompt += `【世界观】\n${wbBefore}\n\n`;
  
  prompt += `【我们正在阅读的书的信息】\n`;
  prompt += `书名：${bookTitle}\n`;
  if (bookDesc) prompt += `这本书的简介：${bookDesc}\n`;
  prompt += '\n';

  // ── 已读章节笔记（有则注入） ──
  const summaryCtx = _buildSummaryContext();
  if (summaryCtx) prompt += summaryCtx;

  // ── 共读者信息 ──
    prompt += `【人设信息】\n`;
  prompt += `你的姓名是：${charName}。\n`;
  prompt += `\n你的人设是：\n${charPersona}\n\n`;

  // ── 读者信息 ──
  prompt += `我的姓名是：${userName}。\n`;
 if (userDesc) prompt += `我的人设是：\n${userDesc}\n\n`;

  // ── 其他世界书 ──
  if (wbAfter) prompt += `【其他重要事项说明】\n${wbAfter}\n\n`;

  return prompt;
}

// ── API 调用（AI 点评当前页）─────────────────────────────

async function _coreadEvalPage() {
  if (_coread.generating) return;
  _coread.generating = true;
  _renderCoreadMessages(); // 立即显示省略号+禁用按钮

  const pageContext  = _buildPageContext();
  const systemPrompt = _buildCoreadSystemPrompt();
  const userPrompt   = pageContext;

  const charName = _coread.char?.realName || _coread.char?.remarkName || _coread.char?.name || '共读者';
const charMsg = { role: 'char', content: '', timestamp: Date.now(), charName };
  _coread.messages.push(charMsg);
  const msgIdx = _coread.messages.length - 1;

  // ★ 先追加一条空消息占位（流式结束后再更新 content）
  await _appendCoreadMsg(charMsg);

  try {
    let streamed = '';
    const reply = await callAI(userPrompt, {
      systemPrompt,
      onStream: (chunk) => {
        streamed += chunk;
        _coread.messages[msgIdx].content = streamed;
        _renderCoreadMessages();
      }
    });
    if (!streamed && reply) {
      _coread.messages[msgIdx].content = reply;
      _renderCoreadMessages();
    }
    // ★ 流式结束后把最终内容写回 DB
    await _updateLastCoreadMsg(_coread.messages[msgIdx].content);
  } catch (e) {
    _coread.messages[msgIdx].content = '（AI 连接失败）';
    _renderCoreadMessages();
    await _updateLastCoreadMsg('（AI 连接失败）');
  } finally {
    _coread.generating = false;
    _renderCoreadMessages(); // 恢复按钮
  }
}

async function _coreadCharReply(userText, fallbackMsg = null) {
  if (_coread.generating) return false;
  _coread.generating = true;
  _renderCoreadMessages();

  const cfg          = _getCoreadSettings();
  const historyCount = cfg.historyCount ?? 20;
  const charName = _coread.char.realName || _coread.char.remarkName || _coread.char.name || '共读者';
  const userName = _coread.persona?.realName || _coread.persona?.nickname || _coread.char.myName || '读者';

  const historyMsgs = _coread.messages.slice(-historyCount - 1, -1).filter(m => m.content);
  const history = historyMsgs
    .map(m => {
      const name = m.role === 'user'
        ? (m.userName || userName)
        : (m.charName || charName);
      return `${name}：${m.content}`;
    }).join('\n');
  const pageContext  = _buildPageContext();
  const systemPrompt = _buildCoreadSystemPrompt('reply');
  const instruction  = `请以完全符合你性格的方式，简短地回复我的发言。`;
  const userPrompt   = `${pageContext}\n\n【对话历史】\n${history}\n\n【我的最新发言】\n${userName}：${userText}\n\n${instruction}`;

  const charMsg = { role: 'char', content: '', timestamp: Date.now(), charName };
  _coread.messages.push(charMsg);
  const msgIdx = _coread.messages.length - 1;

  await _appendCoreadMsg(charMsg);

  let success = false;
  try {
    let streamed = '';
    const reply = await callAI(userPrompt, {
      systemPrompt,
      onStream: (chunk) => {
        streamed += chunk;
        _coread.messages[msgIdx].content = streamed;
        _renderCoreadMessages();
      }
    });
    if (!streamed && reply) {
      _coread.messages[msgIdx].content = reply;
      _renderCoreadMessages();
    }
    success = true;
    await _updateLastCoreadMsg(_coread.messages[msgIdx].content);
  } catch (e) {
    const bookId = window._study.state.reader.bookId;
    if (fallbackMsg) {
      // 重新生成失败：把占位消息内容还原为备份，保留这条记录
      _coread.messages[msgIdx] = { ...fallbackMsg };
      await _updateLastCoreadMsg(fallbackMsg.content);
      if (typeof showToast === 'function') showToast('重新生成失败，已保留原回复');
    } else {
      // 普通发送失败：回滚 userMsg + charMsg，填回输入框
      _coread.messages.splice(msgIdx - 1, 2);
      if (typeof deleteLastNCoreadMessagesFromDB === 'function')
        await deleteLastNCoreadMessagesFromDB(bookId, 2);
      const inputEl = document.getElementById('coread-input');
      if (inputEl) inputEl.value = userText;
      if (typeof showToast === 'function') showToast('AI 回复失败，已恢复输入内容');
    }
  } finally {
    _coread.generating = false;
    _renderCoreadMessages();
  }
  return success;
}

// ── 重新生成最后一条 AI 回复 ─────────────────────────────

async function _coreadRegenerateLastReply() {
  if (_coread.generating) return;

  const msgs = _coread.messages;
  // 最后一条必须是 char
  if (!msgs.length || msgs[msgs.length - 1].role !== 'char') {
    if (typeof showToast === 'function') showToast('没有可重新生成的回复');
    return;
  }

  const lastCharIdx = msgs.length - 1;
  const backupMsg   = { ...msgs[lastCharIdx] };

  // 找前面最近一条 user 消息
  let userText = '';
  for (let i = lastCharIdx - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') { userText = msgs[i].content; break; }
  }

  // 从内存 + DB 删掉最后一条 char
  msgs.splice(lastCharIdx, 1);
  const bookId = window._study.state.reader.bookId;
  if (typeof deleteLastCoreadMessageFromDB === 'function')
    await deleteLastCoreadMessageFromDB(bookId);

  // 关闭历史 sheet
  document.getElementById('coread-history-sheet')?.classList.remove('visible');

  // 重新调用，失败时传 backup 保留原内容
  await _coreadCharReply(userText, backupMsg);
}

// ── 初始化：挂载 DOM 事件 ─────────────────────────────────

function studyInitCoread() {
  // 发送按钮 & 回车
  document.getElementById('coread-send-btn')?.addEventListener('click', studySendCoreadMessage);
  document.getElementById('coread-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      studySendCoreadMessage();
    }
  });

  studyInitCoreadSidebar();
  _initBubbleResizeObserver();
}

// ── 历史记录底部 sheet ────────────────────────────────────

async function _openCoreadHistorySheet() {
  // ★ 如果共读未激活（读者直接点底部菜单"对话历史"），先从 DB 加载当前书的消息
  if (!_coread.active) {
  const bookId = window._study.state.reader.bookId;
  if (bookId && typeof getCoreadMessagesFromDB === 'function') {
    _coread.messages = await getCoreadMessagesFromDB(bookId);
  }
  // 补上：把 char/persona 也初始化
  const cfg = _getCoreadSettings();
  _coread.char    = (db.characters || []).find(c => c.id === cfg.charId) || null;
  _coread.persona = cfg.personaId
    ? (db.userPersonas || []).find(p => (p.id || p.nickname) === cfg.personaId)
    : null;
}

  let sheet = document.getElementById('coread-history-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'coread-history-sheet';
    sheet.className = 'action-sheet-overlay';
    sheet.innerHTML = `
      <div class="action-sheet coread-history-sheet-inner">
        <div class="coread-history-sheet-header">
          <span>对话记录</span>
          <button class="coread-history-sheet-close" id="coread-history-sheet-close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div id="coread-history-list" class="coread-history-list"></div>
      </div>`;
    document.body.appendChild(sheet);

    document.getElementById('coread-history-sheet-close')?.addEventListener('click', () => {
      sheet.classList.remove('visible');
    });
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet) sheet.classList.remove('visible');
    });
  }

  const listEl = document.getElementById('coread-history-list');
  const { h }  = window._study;
  const char     = _coread.char;
  const charName = char ? (char.realName || char.remarkName || char.name || '共读者') : '共读者';
  const userName = _coread.persona?.realName || _coread.persona?.nickname || char?.myName || db.settings?.userNickname || '读者';

const msgs = _coread.messages.filter(m => m.content);

  // 找最后一条 char 消息的索引（用于加重新生成按钮）
  let lastCharIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'char') { lastCharIdx = i; break; }
  }

  if (!msgs.length) {
    listEl.innerHTML = '<div class="coread-history-empty">暂无对话记录</div>';
  } else {
    listEl.innerHTML = msgs.map((m, i) => {
      const isUser    = m.role === 'user';
      const name      = isUser ? (m.userName || userName) : (m.charName || charName);
      const regenBtn  = (!isUser && i === lastCharIdx)
        ? `<button class="coread-regen-btn" onclick="_coreadRegenerateLastReply()" title="重新生成">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10"></polyline>
              <path d="M3.51 15a9 9 0 1 0 .49-3.17"></path>
            </svg>
           </button>`
        : '';
      return `<div class="coread-history-row ${isUser ? 'user' : 'char'}">
          <span class="coread-history-name">${h(name)}</span>
          <div class="coread-history-bubble ${isUser ? 'user' : 'char'}">${h(m.content).replace(/\n/g, '<br>')}</div>
          ${regenBtn}
        </div>`;
    }).join('');
  }

  sheet.classList.add('visible');
  requestAnimationFrame(() => { listEl.scrollTop = listEl.scrollHeight; });
}

// ── 侧边栏（共读设置）────────────────────────────────────

let _coreadPendingWbIds = [];

function studyInitCoreadSidebar() {
  const sidebar     = document.getElementById('reader-coread-sidebar');
  const settingsBtn = document.getElementById('reader-coread-settings-btn');
  const form        = document.getElementById('reader-coread-settings-form');

  settingsBtn?.addEventListener('click', () => {
    _populateCoreadSidebar();
    // 关闭其他面板，只保留设置侧边栏
    if (typeof _closeAllReaderPanels === 'function') _closeAllReaderPanels('settings');
    sidebar?.classList.add('open');
  });

  document.getElementById('reader-coread-worldbook-btn')?.addEventListener('click', () => {
    _openCoreadWbModal();
  });

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const charId    = document.getElementById('reader-coread-char-select')?.value || '';
  const personaId = document.getElementById('reader-coread-persona-select')?.value || '';
  await _updateCoreadSettings({ charId, personaId, worldbookIds: _coreadPendingWbIds });

  // 补上：同步刷新运行时快照
  if (_coread.active) {
    _coread.char    = (db.characters || []).find(c => c.id === charId) || null;
    _coread.persona = personaId
      ? (db.userPersonas || []).find(p => (p.id || p.nickname) === personaId)
      : null;
    // 同步更新悬浮球头像
    _updateFloatBallAvatar();
  }

  sidebar?.classList.remove('open');
  if (typeof showToast === 'function') showToast('共读设置已保存');
});

  // ── 上文条数 ──────────────────────────────────────────
  document.getElementById('reader-coread-history-count-btn')?.addEventListener('click', async () => {
    const cfg = _getCoreadSettings();
    const cur = cfg.historyCount ?? 20;
    const val = await AppUI.prompt(
      `当前：${cur} 条`,
      '输入条数（1-100）',
      '读取上文条数'
    );
    if (val === null) return;
    const num = Math.min(100, Math.max(1, parseInt(val) || cur));
    await _updateCoreadSettings({ historyCount: num });
    _updateCoreadHistoryCountLabel();
    if (typeof showToast === 'function') showToast(`上文条数已设为 ${num} 条`);
  });

  // ── 前置页数 ──────────────────────────────────────────
  document.getElementById('reader-coread-prev-pages-btn')?.addEventListener('click', async () => {
    const cfg = _getCoreadSettings();
    const cur = cfg.prevPages ?? 1;
    const val = await AppUI.prompt(
      `当前：${cur} 页`,
      '输入页数（0-10）',
      '注入前置页数'
    );
    if (val === null) return;
    const num = Math.min(10, Math.max(0, parseInt(val) || 0));
    await _updateCoreadSettings({ prevPages: num });
    _updateCoreadPrevPagesLabel();
    if (typeof showToast === 'function') showToast(`前置页数已设为 ${num} 页`);
  });

  // ── 后置页数 ──────────────────────────────────────────
  document.getElementById('reader-coread-next-pages-btn')?.addEventListener('click', async () => {
    const cfg = _getCoreadSettings();
    const cur = cfg.nextPages ?? 0;
    const val = await AppUI.prompt(
      `当前：${cur} 页`,
      '输入页数（0-10）',
      '注入后置页数'
    );
    if (val === null) return;
    const num = Math.min(10, Math.max(0, parseInt(val) || 0));
    await _updateCoreadSettings({ nextPages: num });
    _updateCoreadNextPagesLabel();
    if (typeof showToast === 'function') showToast(`后置页数已设为 ${num} 页`);
  });

  document.getElementById('reader-coread-history-btn')?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    _openCoreadHistorySheet();
  });

  document.getElementById('reader-coread-clear-btn')?.addEventListener('click', async () => {
    const ok = typeof AppUI !== 'undefined'
      ? await AppUI.confirm('确定要清空本书的共读对话记录吗？', '清空确认', '清空', '取消')
      : confirm('确定要清空本书的共读对话记录吗？');
    if (!ok) return;

    const bookId = window._study.state.reader.bookId;
    _coread.messages = [];
    if (bookId && typeof clearCoreadMessagesInDB === 'function') {
      await clearCoreadMessagesInDB(bookId);
    }
    _renderCoreadMessages();

    const listEl = document.getElementById('coread-history-list');
    if (listEl) listEl.innerHTML = '<div class="coread-history-empty">暂无对话记录</div>';
    if (typeof showToast === 'function') showToast('共读记录已清空');
  });
// ── 重新分页 ──────────────────────────────────────────
  document.getElementById('reader-repaginate-btn')?.addEventListener('click', async () => {
    const ok = typeof AppUI !== 'undefined'
      ? await AppUI.confirm('将根据当前屏幕重新计算分页，书签将被清除。是否继续？', '重新分页', '继续', '取消')
      : confirm('将根据当前屏幕重新计算分页，书签将被清除。是否继续？');
    if (!ok) return;

    sidebar?.classList.remove('open');

    const bookId = window._study.state.reader.bookId;
    const book   = getAllStudyBooks().find(b => b.id === bookId);
    if (!book) return;

    // 清除书签
    book.bookmarks = [];
    if (typeof saveStudyBookToDB === 'function') await saveStudyBookToDB(book);

    // 清除分页缓存，强制重算
    if (typeof dexieDB !== 'undefined') await dexieDB.studyPageCache.delete(bookId);

    if (typeof showToast === 'function') showToast('正在重新分页…');

    // 重新打开阅读器（会触发完整的分页流程）
    if (typeof studyOpenReader === 'function') await studyOpenReader(book);
  });  
}

function _populateCoreadSidebar() {
  const cfg = _getCoreadSettings();
  _coreadPendingWbIds = [...(cfg.worldbookIds || [])];

  const charSel = document.getElementById('reader-coread-char-select');
  if (charSel) {
    charSel.innerHTML = '<option value="">不绑定</option>';
    (db.characters || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.remarkName || c.name || c.id;
      if (c.id === cfg.charId) opt.selected = true;
      charSel.appendChild(opt);
    });
  }

  const personaSel = document.getElementById('reader-coread-persona-select');
  if (personaSel) {
    personaSel.innerHTML = '<option value="">默认</option>';
    (db.userPersonas || []).forEach(p => {
      const id = p.id || p.nickname;
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = p.nickname;
      if (id === cfg.personaId) opt.selected = true;
      personaSel.appendChild(opt);
    });
  }

  _updateCoreadWbLabel();
  _updateCoreadHistoryCountLabel();
  _updateCoreadPrevPagesLabel();
  _updateCoreadNextPagesLabel();
}

// ── label 更新辅助 ────────────────────────────────────────

function _updateCoreadWbLabel() {
  const label = document.getElementById('reader-coread-worldbook-label');
  if (!label) return;
  const count = _coreadPendingWbIds.length;
  label.textContent = count > 0 ? `关联 ${count} 本` : '未关联';
}

function _updateCoreadHistoryCountLabel() {
  const el = document.getElementById('reader-coread-history-count-label');
  if (el) el.textContent = `${_getCoreadSettings().historyCount ?? 20} 条`;
}

function _updateCoreadPrevPagesLabel() {
  const el = document.getElementById('reader-coread-prev-pages-label');
  if (el) el.textContent = `${_getCoreadSettings().prevPages ?? 1} 页`;
}

function _updateCoreadNextPagesLabel() {
  const el = document.getElementById('reader-coread-next-pages-label');
  if (el) el.textContent = `${_getCoreadSettings().nextPages ?? 0} 页`;
}

function _openCoreadWbModal() {
  _openWbSelectModal(_coreadPendingWbIds, 'coread-wb', selectedIds => {
    _coreadPendingWbIds = selectedIds;
    _updateCoreadWbLabel();
    showToast?.(`已关联 ${_coreadPendingWbIds.length} 个世界书`);
  });
}
