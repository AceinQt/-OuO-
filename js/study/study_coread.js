// study_coread.js — 学习模块：共读功能 (仿通话版)
// 依赖：study_core.js / study_db.js / study_ai.js / study_bookshelf.js
// =====================================================

// ── 共读设置（嵌套在 db.studySettings.coread）────────

function _getCoreadSettings() {
  return getStudySettings().coread || { charId: '', personaId: '', worldbookIds: [] };
}

async function _updateCoreadSettings(patch) {
  const current = _getCoreadSettings();
  await updateStudySettings({ coread: { ...current, ...patch } });
}

// ── 运行时状态 ────────────────────────────────────────

const _coread = {
  active:       false,
  char:         null,
  persona:      null,
  messages:     [],     // 实时关联到本书的数据
  generating:   false,
};

// ── 辅助方法：获取当前书并存档 ───────────────────────

function _getCurrentBook() {
  const bookId = window._study.state.reader.bookId;
  return getAllStudyBooks().find(b => b.id === bookId);
}

async function _saveCoreadMessages() {
  const book = _getCurrentBook();
  if (book) {
    book.coreadMessages = _coread.messages;
    if (typeof saveStudyBookToDB === 'function') {
      await saveStudyBookToDB(book);
    }
  }
}

// ── 渲染 UI：区分AI顶部和用户底部 ────────────────────

function _renderCoreadMessages() {
  const charMsgs = _coread.messages.filter(m => m.role === 'char');
  const userMsgs = _coread.messages.filter(m => m.role === 'user');

  // 1. 顶部：AI仅展示最后一句
  const lastChar = charMsgs[charMsgs.length - 1];
  const textEl   = document.getElementById('coread-char-text');
  if (textEl) {
    textEl.textContent = lastChar ? (lastChar.content || '…') : '你好，发送消息和我交流吧～';
  }

  // 2. 底部：用户的气泡历史
  const userContainer = document.getElementById('coread-user-messages');
  if (userContainer) {
    const userAvatar = _coread.persona?.avatar || db.userAvatar || db.settings?.userAvatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg';
    const { h } = window._study;
    
    userContainer.innerHTML = userMsgs.map(m => `
      <div class="coread-user-row">
        <div class="coread-user-bubble">${h(m.content).replace(/\n/g, '<br>')}</div>
        <img class="coread-user-bubble-avatar" src="${h(userAvatar)}" alt="">
      </div>
    `).join('');
    
    // 滚动到底部
    requestAnimationFrame(() => {
      userContainer.scrollTop = userContainer.scrollHeight;
    });
  }
}

// ── 进入 / 退出(收起)共读 ───────────────────────────────────

function studyEnterCoread() {
  const cfg = _getCoreadSettings();
  if (!cfg.charId) {
    if (typeof showToast === 'function') showToast('请先点击右上角⚙设置绑定共读角色');
    return;
  }

  const char    = (db.characters || []).find(c => c.id === cfg.charId);
  const persona = cfg.personaId
    ? (db.userPersonas || []).find(p => (p.id || p.nickname) === cfg.personaId)
    : null;

  if (!char) {
    if (typeof showToast === 'function') showToast('绑定角色不存在，请重新设置');
    return;
  }

  _coread.active       = true;
  _coread.char         = char;
  _coread.persona      = persona;
  _coread.generating   = false;

  // 从书籍加载历史
  const book = _getCurrentBook();
  _coread.messages = book?.coreadMessages ? [...book.coreadMessages] : [];

  // 隐藏底层的 header 和翻页栏
  document.getElementById('reader-app-header')?.classList.add('coread-hidden');
  document.querySelector('.st-reader-nav')?.classList.add('coread-hidden');
  
  // 显示 Overlay
  const overlay = document.getElementById('reader-coread-overlay');
  if (overlay) overlay.style.display = 'flex';

  // 填充角色信息
  const charName = char.realName || char.remarkName || char.name || '';
  const avatarEl = document.getElementById('coread-char-avatar');
  const nameEl   = document.getElementById('coread-char-name');
  if (avatarEl) avatarEl.src = char.avatar || '';
  if (nameEl)   nameEl.textContent = charName;

  _renderCoreadMessages();
  
  // 如果空空如也，让AI主动说句话(不阻碍主线程)
  if (_coread.messages.length === 0) {
      _coreadEvalPage();
  }
}

function studyExitCoread() {
  _coread.active = false;
  // 恢复阅读正文的组件显示
  document.getElementById('reader-app-header')?.classList.remove('coread-hidden');
  document.querySelector('.st-reader-nav')?.classList.remove('coread-hidden');
  const overlay = document.getElementById('reader-coread-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ── 发送消息 & AI交互 ─────────────────────────────────────

async function studySendCoreadMessage() {
  const input = document.getElementById('coread-input');
  const text  = input?.value.trim();
  if (!text || _coread.generating) return;

  // 1. 本地展示
  _coread.messages.push({ role: 'user', content: text });
  if (input) input.value = '';
  _renderCoreadMessages();
  await _saveCoreadMessages();

  // 2. 调用AI回复
  await _coreadCharReply(text);
}

// 供"AI回复"按钮调用的手动方法
async function _manualAiReply() {
    if (_coread.generating) return;
    const lastMsg = _coread.messages[_coread.messages.length - 1];
    
    // 如果上一句是用户，继续对话；如果不是，点评当前页
    if (lastMsg && lastMsg.role === 'user') {
        await _coreadCharReply(""); 
    } else {
        await _coreadEvalPage();
    }
}

// ── AI Prompt 组装模块 (保留原装) ───────────────────────
function _buildCoreadSystemPrompt(mode = 'eval') {
  const char    = _coread.char;
  const persona = _coread.persona;
  const cfg     = _getCoreadSettings();

  const charName = char.realName || char.remarkName || char.name || '角色';
  const userName = persona?.nickname || char.myName || db.settings?.userNickname || '用户';
  const charPersona = char.persona || char.description || '';
  const charStatus  = char.status  || '';

  // 提取书与记忆...
  const allWbIds = [...new Set([...(char.worldBookIds || []), ...(cfg.worldbookIds || [])])];
  const allWbs   = db.worldBooks || [];
  const wbBefore = allWbs.filter(w => allWbIds.includes(w.id) && w.position === 'before').map(w => w.content).filter(Boolean).join('\n');
  const wbAfter  = allWbs.filter(w => allWbIds.includes(w.id) && w.position === 'after').map(w => w.content).filter(Boolean).join('\n');
  const wbOther  = allWbs.filter(w => allWbIds.includes(w.id) && !['before', 'after', 'writing'].includes(w.position)).map(w => w.content).filter(Boolean).join('\n');

  let prompt = '';
  if (wbBefore) prompt += `${wbBefore}\n\n`;
  prompt += `你扮演的角色是：${charName}。\n`;
  if (charStatus)  prompt += `当前状态：${charStatus}\n`;
  prompt += `\n【人物设定】\n${charPersona}\n\n`;
  if (wbAfter) prompt += `【世界设定】\n${wbAfter}\n\n`;
  if (wbOther) prompt += `${wbOther}\n\n`;

  const personaDesc = persona ? `用户人设（${userName}）：${persona.description || persona.nickname || ''}` : '';
  if (personaDesc) prompt += `${personaDesc}\n\n`;
  if (char.myPersona) prompt += `关于 ${userName} 的背景：${char.myPersona}\n\n`;

  prompt += `你正在和 ${userName} 一起共读一本书。\n`;

  if (mode === 'eval') {
    prompt += `请用完全符合你性格的方式，简短地点评用户当前正在阅读的这一页内容，可以表达感受、提问，或引导用户思考。回复不超过80字，直接说话，不要加任何格式标签。`;
  } else {
    prompt += `请以完全符合你性格的方式，简短地回复用户的发言（不超过120字），直接说话，不要加任何格式标签。`;
  }
  return prompt;
}

// ── API调用：点评 & 回复 ─────────────────────────

async function _coreadEvalPage() {
  if (_coread.generating) return;
  _coread.generating = true;

  const s        = window._study.state.reader;
  const pageText = (s.pages?.[s.page] || '').substring(0, 800);
  const systemPrompt = _buildCoreadSystemPrompt('eval');
  const userPrompt   = `【当前页内容节选】\n${pageText}`;

  _coread.messages.push({ role: 'char', content: '' });
  const msgIdx = _coread.messages.length - 1;

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
  } catch (e) {
    _coread.messages[msgIdx].content = '（AI 连接失败）';
    _renderCoreadMessages();
  } finally {
    _coread.generating = false;
    await _saveCoreadMessages();
  }
}

async function _coreadCharReply(userText) {
  if (_coread.generating) return false;
  _coread.generating = true;

  const s        = window._study.state.reader;
  const pageText = (s.pages?.[s.page] || '').substring(0, 600);
  const charName = _coread.char.realName || _coread.char.remarkName || _coread.char.name || '角色';
  const userName = _coread.persona?.nickname || _coread.char.myName || '用户';

  const history = _coread.messages.slice(-10).filter(m => m.content)
    .map(m => `${m.role === 'user' ? userName : charName}：${m.content}`).join('\n');

  const systemPrompt = _buildCoreadSystemPrompt('reply');
  const userPrompt   = `【当前页内容节选】\n${pageText}\n\n【对话历史】\n${history}\n\n${userName}：${userText}`;

  _coread.messages.push({ role: 'char', content: '' });
  const msgIdx = _coread.messages.length - 1;
  _renderCoreadMessages();

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
  } catch (e) {
    _coread.messages[msgIdx].content = '（AI 回复失败，请稍后重试）';
    _renderCoreadMessages();
  } finally {
    _coread.generating = false;
    await _saveCoreadMessages();
  }
  return success;
}

// ── 初始化：挂载DOM事件 ────────────────────────────────

function studyInitCoread() {
  document.getElementById('reader-coread-btn')?.addEventListener('click', studyEnterCoread);
  document.getElementById('coread-close-btn')?.addEventListener('click', studyExitCoread);
  document.getElementById('coread-middle-tap')?.addEventListener('click', studyExitCoread);

  // 发送及操作按键
  document.getElementById('coread-send-btn')?.addEventListener('click', studySendCoreadMessage);
  document.getElementById('coread-ai-reply-btn')?.addEventListener('click', _manualAiReply);

  // 回车键响应
  document.getElementById('coread-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      studySendCoreadMessage();
    }
  });

  studyInitCoreadSidebar();
}

// ── 侧边栏及其他附属组件 ────────────────────────────────

let _coreadPendingWbIds = [];
// 这里为了省略字数，_openCoreadWbModal、_openCoreadHistoryModal 等原有代码照常即可（它不会影响你的新核心体验）。

// 在 Sidebar 中新增“清空记录”按钮
function studyInitCoreadSidebar() {
  const sidebar     = document.getElementById('reader-coread-sidebar');
  const settingsBtn = document.getElementById('reader-coread-settings-btn');
  const form        = document.getElementById('reader-coread-settings-form');

  settingsBtn?.addEventListener('click', () => {
    _populateCoreadSidebar();
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
    sidebar?.classList.remove('open');
    if (typeof showToast === 'function') showToast('共读设置已保存');
  });

  // “查看对话记录”按钮
  if (sidebar && !document.getElementById('reader-coread-history-btn')) {
    const histBtn = document.createElement('button');
    histBtn.id        = 'reader-coread-history-btn';
    histBtn.type      = 'button';
    histBtn.className = 'coread-sidebar-history-btn';
    histBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> 查看对话记录`;
    sidebar.appendChild(histBtn);
    histBtn.addEventListener('click', _openCoreadHistoryModal);
  }

  // ★ 新增：“清空共读记录”按钮
  if (sidebar && !document.getElementById('reader-coread-clear-btn')) {
    const clearBtn = document.createElement('button');
    clearBtn.id = 'reader-coread-clear-btn';
    clearBtn.type = 'button';
    clearBtn.className = 'coread-sidebar-history-btn danger';
    clearBtn.style.color = '#e53935';
    clearBtn.style.background = '#ffebee';
    clearBtn.style.marginTop = '10px';
    clearBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
      </svg>
      清空本书共读记录`;
    sidebar.appendChild(clearBtn);

    clearBtn.addEventListener('click', async () => {
      const ok = typeof AppUI !== 'undefined' 
        ? await AppUI.confirm('确定要清空本书的共读对话记录吗？', '清空确认', '清空', '取消') 
        : confirm('确定要清空本书的共读对话记录吗？');
      if (!ok) return;

      _coread.messages = [];
      await _saveCoreadMessages();
      _renderCoreadMessages();

      // 同步更新已打开的对话记录弹框
      const listEl = document.getElementById('coread-history-list');
      if (listEl) {
         listEl.innerHTML = '<div class="coread-history-empty">暂无对话记录</div>';
      }
      if (typeof showToast === 'function') showToast('共读记录已清空');
    });
  }
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
}

function _updateCoreadWbLabel() {
  const label = document.getElementById('reader-coread-worldbook-label');
  if (!label) return;
  const count = _coreadPendingWbIds.length;
  label.textContent = count > 0 ? `已关联 ${count} 个世界书` : '未关联';
}

function _openCoreadHistoryModal() {
  document.getElementById('reader-coread-sidebar')?.classList.remove('open');
  let modal = document.getElementById('coread-history-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'coread-history-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-window coread-history-window">
        <div class="coread-history-header">
          <h3>对话记录</h3>
          <button id="coread-history-close-btn" class="coread-history-close-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div id="coread-history-list" class="coread-history-list"></div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('coread-history-close-btn')?.addEventListener('click', () => modal.style.display = 'none');
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  }

  const listEl = document.getElementById('coread-history-list');
  const { h } = window._study;
  const char     = _coread.char;
  const charName = char ? (char.realName || char.remarkName || char.name || '角色') : '角色';
  const userName = _coread.persona?.nickname || char?.myName || db.settings?.userNickname || '用户';

  if (!_coread.messages.length) {
    listEl.innerHTML = '<div class="coread-history-empty">暂无对话记录</div>';
  } else {
    listEl.innerHTML = _coread.messages.filter(m => m.content).map(m => {
        const isUser = m.role === 'user';
        const name   = isUser ? userName : charName;
        return `<div class="coread-history-row ${isUser ? 'user' : 'char'}">
            <span class="coread-history-name">${h(name)}</span>
            <div class="coread-history-bubble ${isUser ? 'user' : 'char'}">${h(m.content).replace(/\n/g, '<br>')}</div>
          </div>`;
      }).join('');
  }

  modal.style.display = 'flex';
  requestAnimationFrame(() => { listEl.scrollTop = listEl.scrollHeight; });
}
function _openCoreadWbModal() {
  const allWbs = db.worldBooks || [];
  if (!allWbs.length) {
    if (typeof showToast === 'function') showToast('暂无世界书，请先在世界书页面添加条目');
    return;
  }
  let modal = document.getElementById('coread-wb-select-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'coread-wb-select-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-window">
        <h3>关联世界书</h3>
        <ul id="coread-wb-list" class="list-container" style="max-height:40vh;overflow-y:auto;padding:0;margin:15px 0;"></ul>
        <button class="btn btn-primary" id="coread-wb-confirm-btn" style="margin-top:20px;">确认绑定</button>
      </div>`;
    document.body.appendChild(modal);
  }
  const listEl = document.getElementById('coread-wb-list');
  if (typeof renderCategorizedWorldBookList === 'function') {
    renderCategorizedWorldBookList(listEl, allWbs, _coreadPendingWbIds, 'coread-wb');
  } else {
    listEl.innerHTML = allWbs.map(w => `<li style="padding:8px 4px;display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="cwb-${w.id}" value="${w.id}" ${_coreadPendingWbIds.includes(w.id) ? 'checked' : ''}>
        <label for="cwb-${w.id}">${w.name || '未命名'}</label></li>`).join('');
  }
  modal.style.display = 'flex';
  const oldBtn = document.getElementById('coread-wb-confirm-btn');
  const newBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);
  newBtn.addEventListener('click', () => {
    const checked = listEl.querySelectorAll('input[type="checkbox"]:checked');
    _coreadPendingWbIds = Array.from(checked).map(cb => cb.value);
    _updateCoreadWbLabel();
    modal.style.display = 'none';
    if (typeof showToast === 'function') showToast(`已关联 ${_coreadPendingWbIds.length} 个世界书`);
  });
  modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
}