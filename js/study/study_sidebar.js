// study_sidebar.js — 学习模块：主页设置侧边栏
// 设置项：主页昵称 / 主页问候语 / 文字API预设 / 向量API预设
// 依赖：study_core.js / study_db.js / AppUI（utils.js）
// HTML 结构为静态骨架，本文件只负责填值与事件绑定
// =====================================================

// 截断到前 4 个字符，超出则追加省略号
function _truncate4(str) {
  if (!str) return '';
  return str.length > 4 ? str.slice(0, 4) + '…' : str;
}

function studyInitSidebar() {
  const btn     = document.getElementById('study-profile-btn');
  const sidebar = document.getElementById('study-profile-sidebar');
  const overlay = document.getElementById('study-profile-overlay');
  if (!btn || !sidebar) return;

  // ── 一次性事件绑定 ────────────────────────────────

  // 打开侧边栏
  btn.addEventListener('click', () => {
    _studySidebarRefresh();
    sidebar.classList.add('active');
    overlay?.classList.add('visible');
  });

  // 遮罩收起
  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('active');
    overlay.classList.remove('visible');
  });

  // 昵称按钮
  document.getElementById('st-home-name-btn')?.addEventListener('click', async () => {
    const cur = getStudySettings().homeName || '';
    const val = await AppUI.prompt('请输入主页昵称', cur, '主页昵称');
    if (val === null) return;
    const trimmed = val.trim() || 'User';
    await updateStudySettings({ homeName: trimmed });
    studyRenderHome();
    _updateHomeMetaValues();
  });

  // 问候语按钮
  document.getElementById('st-home-greeting-btn')?.addEventListener('click', async () => {
    const cur = getStudySettings().homeGreeting || '';
    const val = await AppUI.prompt('请输入主页问候语', cur, '主页问候语');
    if (val === null) return;
    const trimmed = val.trim() || '今天要做什么呢？';
    await updateStudySettings({ homeGreeting: trimmed });
    studyRenderHome();
    _updateHomeMetaValues();
  });

  // API 预设 select
  document.getElementById('st-api-text-select')?.addEventListener('change', async e => {
    await updateStudySettings({ textApiPresetName: e.target.value || null });
  });
  document.getElementById('st-api-embedding-select')?.addEventListener('change', async e => {
    await updateStudySettings({ embeddingApiPresetName: e.target.value || null });
  });
}

// 每次打开侧边栏时刷新显示值
function _studySidebarRefresh() {
  _updateHomeMetaValues();
  _updateApiPresetOptions();
}

// ── 更新昵称 / 问候语预览值 ──────────────────────────

function _updateHomeMetaValues() {
  const settings = getStudySettings();
  const name     = settings.homeName     || 'User';
  const greeting = settings.homeGreeting || '今天要做什么呢？';

  const nameEl     = document.getElementById('st-home-name-val');
  const greetingEl = document.getElementById('st-home-greeting-val');
  if (nameEl)     nameEl.textContent     = _truncate4(name);
  if (greetingEl) greetingEl.textContent = _truncate4(greeting);
}

// ── 更新 API 预设下拉选项 ────────────────────────────

function _updateApiPresetOptions() {
  const { h }       = window._study;
  const allPresets  = db.apiPresets || [];
  const settings    = getStudySettings();

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

  const textSel      = document.getElementById('st-api-text-select');
  const embeddingSel = document.getElementById('st-api-embedding-select');
  if (textSel)      textSel.innerHTML      = buildOptions(settings.textApiPresetName, 'chat');
  if (embeddingSel) embeddingSel.innerHTML = buildOptions(settings.embeddingApiPresetName, 'embedding');
}
