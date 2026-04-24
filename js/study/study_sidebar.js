// study_sidebar.js — 学习模块：设置侧边栏
// 上半部分：绑定用户人设（菜单按钮式，点击弹出选择弹窗）
// 下半部分：文字 API 预设选择 / 向量 API 预设选择
// 依赖：study_core.js / study_db.js
// =====================================================

function studyInitSidebar() {
  const btn     = document.getElementById('study-profile-btn');
  const sidebar = document.getElementById('study-profile-sidebar');
  const closeBtn = document.getElementById('study-profile-close');
  if (!btn || !sidebar) return;

  btn.addEventListener('click', () => {
    _studySidebarRefresh();
    sidebar.classList.add('active');
  });

  closeBtn?.addEventListener('click', () => sidebar.classList.remove('active'));
  sidebar.addEventListener('click', e => {
    if (e.target === sidebar) sidebar.classList.remove('active');
  });
}

// 每次打开侧边栏时刷新内容
function _studySidebarRefresh() {
  _renderPersonaSection();
  _renderApiPresetSection();
}

// ── 上半部分：人设绑定（菜单按钮） ─────────────────

function _renderPersonaSection() {
  const container = document.getElementById('st-sidebar-persona-section');
  if (!container) return;

  const { h } = window._study;
  const settings  = getStudySettings();
  const bound     = settings.boundPersonaId;
  const personas  = db.userPersonas || [];
  const boundPersona = personas.find(p => p.id === bound);

  // 显示当前绑定的人设名字（或提示未绑定）
  const currentName = boundPersona
    ? (boundPersona.nickname || boundPersona.name || '未命名')
    : '未绑定';

  container.innerHTML = `
    <div class="st-sidebar-section-title">用户人设</div>
    <div class="settings-card menu-list-style st-sidebar-api-card">
      <div class="settings-item" id="st-bind-persona-btn" style="cursor:pointer;">
        <div class="setting-icon-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <div class="item-details"><span class="item-name">绑定用户</span></div>
        <span class="item-value st-persona-bound-name">${h(currentName)}</span>
        <svg class="chevron-icon" style="margin-left:5px;" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>`;

  document.getElementById('st-bind-persona-btn')?.addEventListener('click', () => {
    _openStudyPersonaModal();
  });
}

// 打开人设选择弹窗（复用全局 openSelectPersonaModal，或自建）
function _openStudyPersonaModal() {
  if (typeof window.openSelectPersonaModal === 'function') {
    // 复用聊天侧边栏的弹窗
    window.openSelectPersonaModal(async (selectedPersona) => {
      if (selectedPersona) {
        await updateStudySettings({ boundPersonaId: selectedPersona.id });
        _renderPersonaSection();
        studyRenderHome();
        showToast('已绑定：' + (selectedPersona.nickname || selectedPersona.name));
      }
    }, /* allowUnbind */ true);
    return;
  }

  // ── 降级：自建弹窗（复用 select-persona-modal 的 HTML） ──
  const modal   = document.getElementById('select-persona-modal');
  const listEl  = document.getElementById('select-persona-list');
  const closeBtn = document.getElementById('close-select-persona-btn');
  if (!modal || !listEl) { showToast('弹窗未就绪，请刷新页面'); return; }

  const { h } = window._study;
  const settings = getStudySettings();
  const bound    = settings.boundPersonaId;
  const personas = db.userPersonas || [];

  listEl.innerHTML = [
    // 取消绑定选项
    `<li class="list-item" data-id="" style="cursor:pointer;padding:12px 10px;display:flex;align-items:center;gap:10px;">
       <div style="width:36px;height:36px;border-radius:50%;background:#f2f2f7;display:flex;align-items:center;justify-content:center;font-size:18px;">✕</div>
       <span style="font-weight:500;color:#888;">不绑定</span>
     </li>`,
    ...personas.map(p => {
      const isActive = p.id === bound;
      const avatar   = p.avatar
        ? `<img src="${h(p.avatar)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`
        : `<div style="width:36px;height:36px;border-radius:50%;background:var(--accent-color,#0099FF);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">${h((p.nickname||p.name||'?').charAt(0))}</div>`;
      return `<li class="list-item" data-id="${h(p.id)}" style="cursor:pointer;padding:12px 10px;display:flex;align-items:center;gap:10px;${isActive?'background:#e8f4ff;border-radius:10px;':''}">
        ${avatar}
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:14px;">${h(p.nickname||p.name||'未命名')}</div>
          ${p.role?`<div style="font-size:12px;color:#888;">${h(p.role)}</div>`:''}
        </div>
        ${isActive?'<span style="color:var(--accent-color,#0099FF);font-size:18px;">✓</span>':''}
      </li>`;
    })
  ].join('');

  // 点击选项
  const handleSelect = async (e) => {
    const item = e.target.closest('[data-id]');
    if (!item) return;
    const pid = item.dataset.id || null;
    await updateStudySettings({ boundPersonaId: pid });
    _renderPersonaSection();
    studyRenderHome();
    modal.classList.remove('active');
    if (typeof modal.close === 'function') modal.close();
    else modal.style.display = 'none';
    listEl.removeEventListener('click', handleSelect);
    showToast(pid ? '绑定成功' : '已取消绑定');
  };
  listEl.addEventListener('click', handleSelect);

  // 关闭
  const handleClose = () => {
    modal.classList.remove('active');
    if (typeof modal.close === 'function') modal.close();
    else modal.style.display = 'none';
    listEl.removeEventListener('click', handleSelect);
    closeBtn?.removeEventListener('click', handleClose);
  };
  closeBtn?.addEventListener('click', handleClose);

  // 打开弹窗
  modal.classList.add('active');
  if (typeof modal.showModal === 'function') modal.showModal();
  else modal.style.display = 'flex';
}

// ── 下半部分：API 预设选择 ───────────────────────────

function _renderApiPresetSection() {
  const container = document.getElementById('st-sidebar-api-section');
  if (!container) return;

  const { h } = window._study;
  const allPresets = db.apiPresets || [];
  const settings   = getStudySettings();

  // 按类型过滤，用 name 作为 value（与 api.js 保持一致）
  function buildOptions(currentName, type) {
    const list = allPresets.filter(p =>
      type === 'chat' ? (!p.type || p.type === 'chat') : p.type === type
    );
    const defaultOpt = `<option value="" ${!currentName ? 'selected' : ''}>使用全局默认</option>`;
    const opts = list.map(p =>
      `<option value="${h(p.name)}" ${p.name === currentName ? 'selected' : ''}>${h(p.name)}</option>`
    ).join('');
    return defaultOpt + opts;
  }

  container.innerHTML = `
    <div class="st-sidebar-section-title">API 设置</div>
    <div class="settings-card menu-list-style st-sidebar-api-card">

      <!-- 文字 API 预设 -->
      <div class="settings-item">
        <div class="setting-icon-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
        </div>
        <div class="item-details"><span class="item-name">文字</span></div>
        <select id="st-api-text-select" class="inline-select">
          ${buildOptions(settings.textApiPresetName, 'chat')}
        </select>
        <svg class="chevron-icon" style="margin-left:5px;" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>

      <!-- 向量 API 预设 -->
      <div class="settings-item">
        <div class="setting-icon-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="12" cy="12" r="3"/>
            <circle cx="12" cy="12" r="9"/>
            <line x1="12" y1="3" x2="12" y2="6"/>
            <line x1="12" y1="18" x2="12" y2="21"/>
            <line x1="3" y1="12" x2="6" y2="12"/>
            <line x1="18" y1="12" x2="21" y2="12"/>
          </svg>
        </div>
        <div class="item-details"><span class="item-name">向量</span></div>
        <select id="st-api-embedding-select" class="inline-select">
          ${buildOptions(settings.embeddingApiPresetName, 'embedding')}
        </select>
        <svg class="chevron-icon" style="margin-left:5px;" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>

    </div>`;

  // 变更时自动保存（存 name，空字符串存为 null）
  document.getElementById('st-api-text-select')?.addEventListener('change', async e => {
    await updateStudySettings({ textApiPresetName: e.target.value || null });
  });
  document.getElementById('st-api-embedding-select')?.addEventListener('change', async e => {
    await updateStudySettings({ embeddingApiPresetName: e.target.value || null });
  });
}
