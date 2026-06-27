// study_bookshelf.js — 学习模块：书架渲染 + 阅读器 + 目录/书签
// 依赖：study_core.js / study_db.js / study_ai.js
// =====================================================

// ── 封面图片压缩（最长边≤300px，JPEG 0.82）────────────────────
/**
 * 压缩图片到指定最长边，输出 JPEG base64 dataURL
 * @param {File} file        - 原始图片文件
 * @param {number} maxSide   - 最长边像素上限（默认300）
 * @param {number} quality   - JPEG质量 0~1（默认0.82）
 * @returns {Promise<string>} dataURL
 */
function _compressCoverImage(file, maxSide = 300, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxSide || height > maxSide) {
        if (width >= height) {
          height = Math.round((height / width) * maxSide);
          width  = maxSide;
        } else {
          width  = Math.round((width / height) * maxSide);
          height = maxSide;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ── 书名自适应字号（最多两行，超出缩小字体）─────────────────────
function _autoSizeBiTitle() {
  const el = document.getElementById('st-bi-title');
  if (!el) return;

  el.removeAttribute('data-size');
  el.style.height = 'auto';

  const sizes = [
    { attr: null,  lineH: 28 * 1.3 },
    { attr: 'md',  lineH: 22 * 1.3 },
    { attr: 'sm',  lineH: 17 * 1.3 },
  ];

  for (const { attr, lineH } of sizes) {
    if (attr) el.setAttribute('data-size', attr);
    else el.removeAttribute('data-size');
    el.style.height = 'auto';
    if (el.scrollHeight <= lineH * 2 + 4) break;
  }

  el.style.height = el.scrollHeight + 'px';
}

// ── 章节识别正则 ─────────────────────────────────────────
const _HEADING_RE = /^第[〇零一二三四五六七八九十百千万\d]{1,8}[章节回部卷篇幕序]/;
// 纯数字/汉字数字/英文单行标题补充正则
const _HEADING_RE2 = /^(?:\d{1,4}|[一二三四五六七八九十百千]{1,6}|Chapter\s*\d{1,4}|CHAPTER\s*\d{1,4}|第\s*\d{1,4}\s*[话篇])$/i;

function _isHeadingLine(lines, i) {
  const t = lines[i].trim();
  if (!t) return false;
  if (_HEADING_RE.test(t)) return true;
  if (/^\d{1,4}$/.test(t)) return true;  // 纯数字独占一行
  return false;
}

// ── 封面主题色（全局共享）──────────────────────────────
const _COVER_COLORS = [
  { bg: '#92BADE' },
  { bg: '#CADFF2' },
  { bg: '#D6E7EF' },
];

function _hashCoverColor(id) {
  const n = String(id).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
  return _COVER_COLORS[Math.abs(n) % _COVER_COLORS.length];
}

// ── 续阅读卡片渲染 ──────────────────────────────────────
function _renderResumeCard() {
  const books = getAllStudyBooks();
  const resumed = books
    .filter(b => typeof b.lastPage === 'number' && b.lastPage > 0)
    .sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0))[0];

  const section = document.getElementById('st-resume-section');
  if (!section) return;

  if (!resumed) { section.style.display = 'none'; return; }
  section.style.display = '';

  const { bg } = _hashCoverColor(resumed.id);
  const { h } = window._study;

  const totalPages = resumed._totalPages || 1;
  const pct = Math.min(100, Math.round((resumed.lastPage / totalPages) * 100));

  const coverStyle = resumed.cover
    ? `background-image:url(${resumed.cover}); --cover-bg:${bg};`
    : `--cover-bg:${bg};`;

  const coverTitle = resumed.cover ? '' : `<span class="st-book-cover-title" style="color:#333">${h(resumed.title)}</span>`;

  section.innerHTML = `
    <div class="st-resume-hero" data-book-id="${h(resumed.id)}">
      <div class="st-resume-left">
        <div class="st-resume-label">继续阅读</div>
        <div class="st-resume-title-hero" data-len="${resumed.title.length}">${h(resumed.title)}</div>
        <div class="st-resume-action-row">
          <div class="st-resume-progress-line">
            <div class="st-resume-progress-fill" style="width:${pct}%"></div>
          </div>
          <span class="st-resume-pct-label">${pct}%</span>
          <button class="st-resume-play-btn" title="继续阅读">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"></polygon>
            </svg>
          </button>
        </div>
      </div>
      <div class="st-resume-right">
        <div class="st-resume-cover-decor"></div>
        <div class="st-resume-cover-img" style="${coverStyle}">${coverTitle}</div>
      </div>
    </div>`;

  const hero = section.querySelector('.st-resume-hero');
  if (hero) {
    hero.addEventListener('click', (e) => {
      const book = getAllStudyBooks().find(b => String(b.id) === String(resumed.id));
      if (!book) return;
      if (e.target.closest('.st-resume-play-btn')) {
        e.stopPropagation();
        if (typeof studyOpenReader === 'function') studyOpenReader(book);
      } else {
        if (typeof studyOpenBookInfo === 'function') studyOpenBookInfo(book);
      }
    });
  }
}

// ── 书架渲染（tab + 书本网格）─────────────────────────────

function studyRenderBookshelf() {
  const { state, h, icons } = window._study;
  const tabsEl = document.getElementById('st-shelf-tabs');
  const gridEl = document.getElementById('st-bookshelf-grid');
  if (!tabsEl || !gridEl) return;

  _renderResumeCard();

  const books = getAllStudyBooks();
  const cats  = [...new Set(books.map(b => b.category || '默认分类'))];
  const sel   = state.bookshelf.selectedCategory || 'all';

  const tabs = [{ key: 'all', label: '全部' }, ...cats.map(c => ({ key: c, label: c }))];
  tabsEl.innerHTML = tabs.map(t =>
    `<button class="st-cat-tab${t.key === sel ? ' active' : ''}" data-cat="${h(t.key)}">${h(t.label)}</button>`
  ).join('');

  tabsEl.querySelectorAll('.st-cat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.bookshelf.selectedCategory = btn.dataset.cat;
      studyRenderBookshelf();
      btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  });

  const filtered = sel === 'all'
    ? books
    : books.filter(b => (b.category || '默认分类') === sel);

  if (filtered.length === 0) {
    gridEl.innerHTML = `
      <div class="st-card st-empty-lg" style="margin-top:20px;">
        <div class="st-empty-icon">${icons.book()}</div>
        <p>${books.length === 0 ? '书架空空如也<br>点击右上角导入书籍' : '该分类下没有书籍'}</p>
      </div>`;
    return;
  }

  gridEl.innerHTML = `<div class="st-book-grid">${filtered.map(book => {
    const { bg } = _hashCoverColor(book.id);
    const qc = getQuestionsByBook(book.id).length;

    const coverStyle = book.cover
      ? `--cover-bg:${bg};background-image:url(${book.cover});background-size:cover;background-position:center;`
      : `--cover-bg:${bg};`;
    const coverTitleHtml = book.cover ? '' : `<span class="st-book-cover-title">${h(book.title)}</span>`;

    const hasProg = typeof book.lastPage === 'number' && book.lastPage > 0;
    const totalP  = book._totalPages || 1;
    const pct     = hasProg ? Math.min(100, Math.round((book.lastPage / totalP) * 100)) : 0;
    const progBadge = hasProg
      ? `<span class="st-book-prog-badge">${pct}%</span>`
      : '';

    return `
      <div class="st-book-cover-wrap" data-book-id="${h(book.id)}" title="${h(book.title)}">
        <div class="st-book-cover" style="${coverStyle}">
          ${coverTitleHtml}
          ${progBadge}
        </div>
        <div class="st-book-cover-footer">
          <span class="st-book-cover-name">${h(book.title)}</span>
          ${qc > 0 ? `<span class="st-book-cover-badge">${qc}题</span>` : ''}
        </div>
      </div>`;
  }).join('')}</div>`;

  gridEl.querySelectorAll('.st-book-cover-wrap').forEach(wrap => {
    let pressTimer = null;
    let isDragging = false;
    let startX = 0, startY = 0;

    wrap.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      startY = e.clientY;
      isDragging = false;

      pressTimer = setTimeout(async () => {
        pressTimer = null;
        isDragging = true;
        const ok = typeof AppUI !== 'undefined'
          ? await AppUI.confirm('确定要删除这本书及相关题目吗？', '删除提示', '删除', '取消')
          : confirm('确定要删除这本书及相关题目吗？');
        if (!ok) return;
        await deleteStudyBook(wrap.dataset.bookId);
        studyRenderBookshelf();
        studyRenderHome?.();
      }, 600);
    });

    wrap.addEventListener('pointermove', (e) => {
      if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) {
        isDragging = true;
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    });

    wrap.addEventListener('pointerup',    () => { clearTimeout(pressTimer); pressTimer = null; });
    wrap.addEventListener('pointerleave', () => { clearTimeout(pressTimer); pressTimer = null; });
    wrap.addEventListener('pointercancel',() => { clearTimeout(pressTimer); pressTimer = null; });

    wrap.addEventListener('click', () => {
      if (isDragging) return;
      const book = getAllStudyBooks().find(b => String(b.id) === String(wrap.dataset.bookId));
      if (book) studyOpenBookInfo(book);
    });
  });
}

// ── 书籍信息页 ────────────────────────────────────────────

function studyOpenBookInfo(book) {
  if (typeof switchScreen === 'function') switchScreen('study-book-info-screen');
  requestAnimationFrame(() => _renderBookInfo(book));
}

function _renderBookInfo(book) {
  const { h } = window._study;
  const { bg } = _hashCoverColor(book.id);
  const screen = document.getElementById('study-book-info-screen');

  // —— hero 背景（有封面时模糊封面，无封面时保持 CSS 默认灰色）——
  const heroBg = document.getElementById('st-bi-hero-bg');
  if (heroBg) {
    if (book.cover) {
      heroBg.style.backgroundImage = `url(${book.cover})`;
      heroBg.style.background = '';
    } else {
      heroBg.style.backgroundImage = '';
      heroBg.style.background = '';   // 无封面：不染色，保持 CSS 默认灰色
    }
  }
  screen?.classList.toggle('no-cover', !book.cover);

  // —— 封面 ——
  const coverEl      = document.getElementById('st-bi-cover');
  const coverTitleEl = document.getElementById('st-bi-cover-title');
  if (coverEl) {
    coverEl.style.setProperty('--cover-bg', bg);
    // --cover-spine 已废弃，无书脊，不再设置
    if (book.cover) {
      coverEl.style.backgroundImage    = `url(${book.cover})`;
      coverEl.style.backgroundSize     = 'cover';
      coverEl.style.backgroundPosition = 'center';
    } else {
      coverEl.style.backgroundImage = '';
    }
  }
  if (coverTitleEl) coverTitleEl.textContent = book.cover ? '' : (book.title || '');

  // —— 书名 ——
  const titleInputEl = document.getElementById('st-bi-title');
  if (titleInputEl) {
    titleInputEl.value = book.title || '';
    requestAnimationFrame(_autoSizeBiTitle);
  }

  // —— 分类 & 简介 ——
  const categoryEl = document.getElementById('st-bi-category');
  const descEl     = document.getElementById('st-bi-desc');
  if (categoryEl) categoryEl.value = book.category    || '';
  if (descEl)     descEl.value     = book.description || '';

  // —— 开始/继续阅读按钮文字 ——
  const labelEl = document.getElementById('st-bi-read-label');
  if (labelEl) {
    const hasProgress = typeof book.lastPage === 'number' && book.lastPage > 0;
    labelEl.textContent = hasProgress ? '继续阅读' : '开始阅读';
  }

  _setBiSaveDirty(false);

  if (screen && !screen._biBound) {
    screen._biBound = true;
    _initBookInfoListeners();
  }

  if (screen) screen._biBook = book;

  _renderBiTab('info', book);
}

function _setBiSaveDirty(dirty) {
  const btn = document.getElementById('st-bi-save-btn');
  if (!btn) return;
  btn.style.opacity       = dirty ? '1'    : '.35';
  btn.style.pointerEvents = dirty ? 'auto' : 'none';
}

// ── 书籍信息页 Tab 内容渲染 ──────────────────────────────

async function _renderBiTab(tab, book) {
  const { h } = window._study;

  document.querySelectorAll('#study-book-info-screen .char-info-tab-panel').forEach(p => {
    p.classList.toggle('active', p.dataset.panel === tab);
  });
  document.querySelectorAll('#st-bi-tabs .char-info-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  if (tab === 'toc') {
    const contentEl = document.getElementById('st-bi-tab-content-toc');
    if (!contentEl) return;

    contentEl.innerHTML = `<div class="st-bi-empty">目录加载中…</div>`;

    // ★ V8：从独立表按需读取正文，不再从 book.content 读
    let rawContent = '';
    if (typeof getStudyBookContentFromDB === 'function') {
      rawContent = await getStudyBookContentFromDB(book.id);
    }

    const toc = _scanRawToc(rawContent);
    if (!toc.length) {
      contentEl.innerHTML = `<div class="st-bi-empty">
        未识别到章节目录<br><small>支持「第X章/节/回/部/卷」格式</small>
      </div>`;
      return;
    }
    contentEl.innerHTML = toc.map((title, i) => `
      <button class="st-bi-list-item" data-chapter="${h(title)}">
        <span class="st-bi-list-idx">${i + 1}</span>
        <span class="st-bi-list-label">${h(title)}</span>
        <svg class="st-bi-list-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="9 18 15 12 9 6" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>`
    ).join('');

    contentEl.querySelectorAll('.st-bi-list-item').forEach(btn => {
      btn.addEventListener('click', () => {
        window._study.state._pendingChapter = btn.dataset.chapter;
        studyOpenReader(book); // async，fire-and-forget 即可
      });
    });

  } else if (tab === 'bookmarks') {
    const contentEl = document.getElementById('st-bi-tab-content-bm');
    if (!contentEl) return;
    const bms = book.bookmarks || [];
    if (!bms.length) {
      contentEl.innerHTML = `<div class="st-bi-empty">
        暂无书签<br><small>进入阅读后点底部菜单「书签」添加</small>
      </div>`;
      return;
    }
    contentEl.innerHTML = bms.map((bm, i) => `
      <button class="st-bi-list-item" data-page="${bm.page}">
        <span class="st-bi-list-idx">🔖</span>
        <span class="st-bi-list-label">
          ${h(bm.name)}<br>
          <small class="st-bi-list-hint">第 ${bm.page + 1} 页</small>
        </span>
        <svg class="st-bi-list-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
          <polyline points="9 18 15 12 9 6" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>`
    ).join('');

    contentEl.querySelectorAll('.st-bi-list-item').forEach(btn => {
      btn.addEventListener('click', () => {
        window._study.state.reader.page = parseInt(btn.dataset.page, 10);
        studyOpenReader(book); // async，fire-and-forget 即可
      });
    });
  }
  // 'info' tab 无需改动，原渲染逻辑不涉及正文
}

// ── 原 _splitPages 保留为备用（字符估算法，不再主动调用）──
// 如果 DOM 测量失败时可作为降级方案

function _splitPages(text, size) {
  if (!text) return ['（内容为空）'];

  const lines = text.split('\n');
  const segments = [];
  let buf = [];

  for (const line of lines) {
    const t = line.trim();
    if (t && _HEADING_RE.test(t) && buf.join('\n').trim().length > 0) {
      segments.push(buf.join('\n'));
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  if (buf.length) segments.push(buf.join('\n'));

  const pages = [];
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    if (trimmed.length <= size) {
      pages.push(trimmed);
    } else {
      let start = 0;
      while (start < trimmed.length) {
        let end = start + size;
        if (end < trimmed.length) {
          const sub       = trimmed.slice(start, end);
          const lastBreak = Math.max(
            sub.lastIndexOf('\n'),
            sub.lastIndexOf('。'),
            sub.lastIndexOf('！'),
            sub.lastIndexOf('？'),
            sub.lastIndexOf('…'),
          );
          if (lastBreak > size * 0.5) end = start + lastBreak + 1;
        }
        pages.push(trimmed.slice(start, end).trim());
        start = end;
      }
    }
  }
  return pages.filter(p => p.length > 0);
}

// ── 扫描原文目录 ────────────────────────────────────────
function _scanRawToc(content) {
  const lines = (content || '').split('\n');
  const toc   = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t && _isHeadingLine(lines, i)) {
      toc.push(t.length > 60 ? t.slice(0, 60) + '…' : t);
    }
  }
  return toc;
}

// ── 书籍信息页事件绑定（只执行一次）────────────────────────────
function _initBookInfoListeners() {
  const screen = document.getElementById('study-book-info-screen');

  document.getElementById('st-bi-back-btn')?.addEventListener('click', () => {
    if (typeof switchScreen === 'function') switchScreen('study-bookshelf-screen');
  });

  document.getElementById('st-bi-cover-wrap')?.addEventListener('click', () => {
    document.getElementById('st-bi-cover-input')?.click();
  });

  document.getElementById('st-bi-cover-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    let dataUrl;
    try {
      dataUrl = await _compressCoverImage(file, 300, 0.82);
    } catch {
      dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = ev => res(ev.target.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
    }

    const book = screen?._biBook;
    if (!book) return;
    book.cover = dataUrl;
    const coverEl      = document.getElementById('st-bi-cover');
    const coverTitleEl = document.getElementById('st-bi-cover-title');
    const heroBg       = document.getElementById('st-bi-hero-bg');
    if (coverEl) {
      coverEl.style.backgroundImage    = `url(${dataUrl})`;
      coverEl.style.backgroundSize     = 'cover';
      coverEl.style.backgroundPosition = 'center';
    }
    if (coverTitleEl) coverTitleEl.textContent = '';
    if (heroBg) {
      heroBg.style.backgroundImage = `url(${dataUrl})`;
      heroBg.style.background = '';
    }
    screen?.classList.remove('no-cover');
    await updateStudyBook(book.id, { cover: dataUrl });
    if (typeof showToast === 'function') showToast('封面已更新');
    studyRenderBookshelf();
    e.target.value = '';
  });

  document.getElementById('st-bi-title')?.addEventListener('input', () => {
    _setBiSaveDirty(true);
    _autoSizeBiTitle();
  });
  document.getElementById('st-bi-category')?.addEventListener('input', () => _setBiSaveDirty(true));
  document.getElementById('st-bi-desc')    ?.addEventListener('input', () => _setBiSaveDirty(true));

  document.getElementById('st-bi-save-btn')?.addEventListener('click', async () => {
    const book = screen?._biBook;
    if (!book) return;
    const title    = document.getElementById('st-bi-title')   ?.value.replace(/\n/g, '').trim() || book.title;
    const category = document.getElementById('st-bi-category')?.value.trim() || '';
    const desc     = document.getElementById('st-bi-desc')    ?.value.trim() || '';

    await updateStudyBook(book.id, { title, category, description: desc });
    book.title       = title;
    book.category    = category;
    book.description = desc;

    if (!book.cover) {
      const coverTitleEl = document.getElementById('st-bi-cover-title');
      if (coverTitleEl) coverTitleEl.textContent = title;
    }
    _setBiSaveDirty(false);
    if (typeof showToast === 'function') showToast('✅ 已保存');
  });

  document.getElementById('st-bi-read-btn')?.addEventListener('click', () => {
    const book = screen?._biBook;
    if (book) studyOpenReader(book);
  });

  document.querySelectorAll('#st-bi-tabs .char-info-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const book = screen?._biBook;
      if (book) _renderBiTab(btn.dataset.tab, book);
    });
  });
}

// ── 打开阅读器 ────────────────────────────────────────────

async function studyOpenReader(book) {
  // ★ 切书时立即重置共读状态，防止旧消息残留到新书
  if (typeof _resetCoread === 'function') _resetCoread();
  // 切书：收起气泡/输入栏，悬浮球本身保持可见（切换到占位状态）
  document.getElementById('reader-bubble-wrap')?.style.setProperty('display', 'none');
  document.getElementById('reader-coread-input-bar')?.style.setProperty('display', 'none');
  document.getElementById('reader-float-ball')?.classList.remove('expanded');
  // 立即切换为无角色占位（切书动画期间不闪烁）
  document.getElementById('reader-float-ball')?.style.setProperty('display', 'flex');
  if (typeof _updateFloatBallAvatar === 'function') _updateFloatBallAvatar();

  const s = window._study.state.reader;
  s.bookId    = book.id;
  s.content   = ''; // 先置空，等异步读取完再赋值
  if (typeof s._skipPageReset !== 'undefined' && s._skipPageReset) {
    delete s._skipPageReset;
  } else {
    s.page = typeof book.lastPage === 'number' ? book.lastPage : 0;
  }
  s.bookmarks = book.bookmarks ? [...book.bookmarks] : [];
  s.toc       = [];
  s.pages     = [];

  const titleEl = document.getElementById('reader-book-title');
  if (titleEl) titleEl.textContent = book.title;

  document.getElementById('reader-app-header')?.classList.remove('reader-header-visible');
  document.getElementById('reader-bottom-menu')?.classList.remove('visible');

  if (typeof switchScreen === 'function') {
    switchScreen('study-book-reader-screen');
  }

  // 显示加载中占位，避免白屏
  const contentEl = document.getElementById('reader-content');
  if (contentEl) contentEl.innerHTML = `<p class="st-reader-text" style="color:#aaa;text-align:center;padding-top:40px;">加载中…</p>`;

  // ★ V8：异步读取正文（不再从 book.content 读）
  let content = '';
  if (typeof getStudyBookContentFromDB === 'function') {
    content = await getStudyBookContentFromDB(book.id);
  }
  s.content = content || '';

  // 等待下一帧确保 DOM 已完成布局（switchScreen 后容器尺寸才稳定）
  await new Promise(r => requestAnimationFrame(r));

  // ★ 尝试命中分页缓存（用内容的简单 hash 做校验）
  const contentHash = _simpleHash(s.content);
  let cachedPages = null;
  if (typeof getStudyPageCacheFromDB === 'function') {
    cachedPages = await getStudyPageCacheFromDB(book.id, contentHash);
  }

  if (cachedPages && cachedPages.length > 0) {
    // 命中缓存，直接用
    s.pages = cachedPages;
    console.log(`✅ [Reader] 分页缓存命中：${s.pages.length} 页`);
  } else {
    // 未命中，执行 DOM 测量分页
    s.pages = await _domSplitPages(s.content, contentEl);
    // 异步写入缓存（不阻塞渲染）
    if (typeof saveStudyPageCacheToDB === 'function') {
      saveStudyPageCacheToDB(book.id, s.pages, contentHash).catch(() => {});
    }
    console.log(`✅ [Reader] DOM分页完成：${s.pages.length} 页`);
  }

  s.toc = _buildToc(s.pages);

  // 同步 _totalPages 到书籍元数据
  const _bookForPages = getAllStudyBooks().find(b => b.id === s.bookId);
  if (_bookForPages && _bookForPages._totalPages !== s.pages.length) {
    _bookForPages._totalPages = s.pages.length;
    updateStudyBook(s.bookId, { _totalPages: s.pages.length });
  }

  // 处理从目录跳转
  const pending = window._study.state._pendingChapter;
  if (pending) {
    delete window._study.state._pendingChapter;
    const match = s.toc.find(item => item.title === pending);
    if (match) s.page = match.page;
  }

  studyRenderReader();
  _initReaderInteraction();
  _initFloatBallDrag();
  _initTocSidebar();
  // ★ 进入阅读器后自动启动共读（有角色则加载历史，无角色则占位显示）
  if (typeof studyEnterCoread === 'function') studyEnterCoread();
}

// ── 简单内容 hash（用于校验分页缓存是否仍有效）─────────────
function _simpleHash(str) {
  // 把尾号从 c5 改为 c6，强制清空上一次错版的缓存
  const _V = 2; // 分页规则版本，改规则时+1
  str = _V + '|' + str;
  let h = 0x811c9dc6; 
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16);
}

// ── DOM 测量分页（完整版：解决留白 + 保证章节独立开页）────────────────────
async function _domSplitPages(text, refEl) {
  if (!text) return ['（内容为空）'];

  // —— 1. 获取页面可用高度与容器宽度 ——
  const cs = refEl ? getComputedStyle(refEl) : null;
  
  // 精确计算可用高度（扣除上下 padding）
  const pageH = (() => {
    if (!refEl) return Math.max(window.innerHeight - 56, 200);
    const rect = refEl.getBoundingClientRect();
    const vPad = cs ? (parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)) : 0;
    return Math.max((rect.height || refEl.clientHeight) - vPad, 200);
  })();
  const pageW = refEl ? (refEl.clientWidth || 320) : 320;

  // —— 2. 创建离屏测量容器（样式必须与实际阅读器 100% 相同） ——
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = [
    `position:fixed`,
    `left:-9999px`,
    `top:0`,
    `width:${pageW}px`,
    `visibility:hidden`,
    `pointer-events:none`,
    cs ? `padding-left:${cs.paddingLeft}` : 'padding-left:22px',
    cs ? `padding-right:${cs.paddingRight}` : 'padding-right:22px',
    `box-sizing:border-box`,
    `overflow:hidden` // 防止 heading 的 margin 穿透容器导致测量偏小
  ].join(';');
  document.body.appendChild(probe);

// —— 3. 把全文解析为段落对象数组（修复合并 bug） ——
  const lines = text.split('\n');
  const paras = [];

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    if (_isHeadingLine(lines, i)) {
      paras.push({ type: 'heading', text: t });
    } else {
      paras.push({ type: 'text', text: t });
    }
  }

  if (!paras.length) {
    document.body.removeChild(probe);
    return ['（内容为空）'];
  }

  const { h } = window._study;

// —— 4. 测量方法（让测算环境也支持续接标记检测） ——
  const measureCombined = (texts, types) => {
    const parts = [];
    for (let i = 0; i < texts.length; i++) {
      if (types[i] === 'heading') {
        parts.push(`<p class="st-reader-heading">${h(texts[i])}</p>`);
      } else {
        const isCont = texts[i].startsWith('__CONT__');
        const cleanText = isCont ? texts[i].substring(8) : texts[i];
        parts.push(`<p class="st-reader-text ${isCont ? 'no-indent' : ''}">${h(cleanText)}</p>`);
      }
    }
    probe.innerHTML = parts.join('');
    return probe.offsetHeight;
  };

  // —— 5. 贪心分页 + 二分查找极限切割点 ——
  const pages = [];
  let curLines = [];
  let curTypes = [];

  const flushPage = () => {
    if (curLines.length) {
      pages.push(curLines.join('\n'));
      curLines = [];
      curTypes = [];
    }
  };

  for (const unit of paras) {
    if (unit.type === 'heading') {
      if (curLines.length > 0) flushPage();
      curLines.push(unit.text);
      curTypes.push('heading');
      continue;
    }

    // 追踪当前处理的段落是否是“被打断的后半截”
    let isContinued = false;
    let remainingText = unit.text;

    while (remainingText.length > 0) {
      const testStrFull = (isContinued ? '__CONT__' : '') + remainingText;
      const testH = measureCombined([...curLines, testStrFull], [...curTypes, 'text']);
      
      // 如果剩下的一整段都能塞进当前页
      if (testH <= pageH) {
        curLines.push(testStrFull);
        curTypes.push('text');
        break;
      }

      // 如果塞不下，用二分法寻找极限切割点
      let low = 1;
      let high = remainingText.length;
      let bestSplit = 0;

      while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        let testPart = remainingText.substring(0, mid);
        let testStr = (isContinued ? '__CONT__' : '') + testPart;
        let th = measureCombined([...curLines, testStr], [...curTypes, 'text']);
        
        if (th <= pageH) {
          bestSplit = mid; 
          low = mid + 1;   
        } else {
          high = mid - 1;  
        }
      }

      if (bestSplit === 0) {
        if (curLines.length === 0) {
          // 连一个字都塞不下（比如字体极大），强行塞一个字避免死循环
          curLines.push((isContinued ? '__CONT__' : '') + remainingText.substring(0, 1));
          curTypes.push('text');
          remainingText = remainingText.substring(1);
          isContinued = true; // 剩下的肯定是续接段落
          flushPage();
        } else {
          flushPage(); // 当前页满了，翻页后再试
        }
      } else {
        curLines.push((isContinued ? '__CONT__' : '') + remainingText.substring(0, bestSplit));
        curTypes.push('text');
        remainingText = remainingText.substring(bestSplit);
        isContinued = true; // 剩下的肯定是续接段落
        flushPage(); 
      }
    }
  }
  
  flushPage();

  // —— 6. 清理离屏容器 ——
  document.body.removeChild(probe);
  return pages.filter(p => p.trim().length > 0);
}

// ── 目录构建 ────────────────────────────────────────────

function _buildToc(pages) {
  const toc = [];
  pages.forEach((page, idx) => {
    const lines = page.split('\n').slice(0, 12);
    for (let li = 0; li < lines.length; li++) {
      const t = lines[li].trim();
      if (t && _isHeadingLine(lines, li)) {
        toc.push({ title: t.length > 50 ? t.substring(0, 50) + '…' : t, page: idx });
        break;
      }
    }
  });
  return toc;
}

// ── 渲染阅读器 ──────────────────────────────────────────

// ── 渲染阅读器 ──────────────────────────────────────────

function studyRenderReader() {
  const { h } = window._study;
  const s = window._study.state.reader;
  const contentEl  = document.getElementById('reader-content');
  const pageInfoEl = document.getElementById('reader-page-info');
  if (!contentEl) return;

  const pages   = s.pages || [''];
  const total   = pages.length;
  const current = Math.max(0, Math.min(s.page, total - 1));
  s.page = current;

  const pageText = pages[current] || '';
  const lines    = pageText.split('\n');
  const parts    = [];

// 渲染正文：检测隐藏的续接标记 __CONT__
for (let idx = 0; idx < lines.length; idx++) {
    let t = lines[idx].trim();
    if (!t) continue;
    if (_isHeadingLine(lines, idx)) {
      parts.push(`<p class="st-reader-heading">${h(t)}</p>`);
    } else {
      // 如果发现续接标记，说明是跨页段落的后半截，去掉标记并应用无缩进样式
      const isCont = t.startsWith('__CONT__');
      if (isCont) t = t.substring(8); 
      parts.push(`<p class="st-reader-text ${isCont ? 'no-indent' : ''}">${h(t)}</p>`);
    }
  }

  contentEl.innerHTML = parts.join('');
  if (pageInfoEl) pageInfoEl.textContent = `${current + 1} / ${total}`;
  _syncProgressRange(current, total);
}

// ================================================================
// 新增：_syncProgressRange — 让 range 滑块与当前页保持同步
// ================================================================
function _syncProgressRange(current, total) {
  const range = document.getElementById('reader-progress-range');
  if (!range) return;
  const max = Math.max(1, total - 1);
  range.max   = max;
  range.value = current;
  // 更新已读进度渐变色
  const pct = (current / max * 100).toFixed(1) + '%';
  range.style.setProperty('--prog', pct);
}


// ================================================================
// 新增：进度条 & 章节跳转事件绑定
// 将这段插入 _initReaderInteraction() 函数内（现有事件绑定的末尾，return 之前）
// ================================================================

  // ── 进度条滑动跳页 ──
  const progressRange = document.getElementById('reader-progress-range');
  if (progressRange) {
    // input：拖动时实时跳页
    progressRange.addEventListener('input', () => {
      const s = window._study.state.reader;
      s.page = parseInt(progressRange.value, 10);
      studyRenderReader();
    });
    // change：松手后确保同步（兼容部分浏览器）
    progressRange.addEventListener('change', () => {
      const s = window._study.state.reader;
      s.page = parseInt(progressRange.value, 10);
      studyRenderReader();
    });
  }

  // ── 上一段（章节）──
  document.getElementById('reader-prev-chapter-btn')?.addEventListener('click', () => {
    const s   = window._study.state.reader;
    const toc = s.toc || [];
    if (!toc.length) {
      // 无目录：回到第一页
      if (s.page > 0) { s.page = 0; studyRenderReader(); }
      return;
    }
    // 找当前页所属章节，然后跳到上一章节首页
    // 找最后一个 page < s.page 的 toc 条目
    let target = -1;
    for (let i = toc.length - 1; i >= 0; i--) {
      if (toc[i].page < s.page) {
        // 如果当前页已经在某章开头，则再往上一章
        if (toc[i].page === s.page - 1 || s.page === toc[i].page) continue;
        target = toc[i].page;
        break;
      }
    }
    // 如果已在第一章或目录中找不到更早的，跳第一章首页
    if (target < 0) {
      target = toc[0].page;
    }
    if (target !== s.page) {
      s.page = target;
      studyRenderReader();
    }
  });

  // ── 下一段（章节）──
  document.getElementById('reader-next-chapter-btn')?.addEventListener('click', () => {
    const s   = window._study.state.reader;
    const toc = s.toc || [];
    const total = (s.pages || []).length;
    if (!toc.length) {
      // 无目录：跳到最后一页
      if (s.page < total - 1) { s.page = total - 1; studyRenderReader(); }
      return;
    }
    // 找第一个 page > s.page 的 toc 条目
    const next = toc.find(item => item.page > s.page);
    if (next) {
      s.page = next.page;
      studyRenderReader();
    }
  });

// ── 沉浸式翻页交互 ──────────────────────────────────────

function _initReaderInteraction() {
  const screen = document.getElementById('study-book-reader-screen');
  if (!screen || screen._readerInteractionBound) return;
  screen._readerInteractionBound = true;

  document.getElementById('reader-back-btn')?.addEventListener('click', async () => {
    const s = window._study.state.reader;
    if (s.bookId) {
      const totalPages = (s.pages || []).length;
      const now = Date.now();
      await updateStudyBook(s.bookId, {
        lastPage: s.page,
        lastReadAt: now,
        _totalPages: totalPages,
      });
      const book = getAllStudyBooks().find(b => b.id === s.bookId);
      if (book) {
        book.lastPage    = s.page;
        book.lastReadAt  = now;
        book._totalPages = totalPages;
        requestAnimationFrame(() => _renderBookInfo(book));
      }
    }
  });

const CENTER_X     = 0.25;
  const CENTER_Y_TOP = 0.25;
  const CENTER_Y_BOT = 0.25;

  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoved  = false;

  // ★ 提取公共逻辑，touch 和 click 共用
  function _handleReaderTap(x, y, target) {
    const tag = target.tagName;
    if (['BUTTON', 'INPUT', 'A', 'SELECT'].includes(tag)) return;
    if (target.closest(
      '.app-header, .reader-float-ball, .reader-bubble-wrap, ' +
      '.reader-coread-input-bar, .settings-sidebar, .action-sheet-overlay, ' +
      '.reader-toc-sidebar, .reader-toc-overlay, .reader-bottom-menu'
    )) return;

    const W = screen.clientWidth;
    const H = screen.clientHeight;

    const inCenterX = x > W * CENTER_X && x < W * (1 - CENTER_X);
    const inCenterY = y > H * CENTER_Y_TOP && y < H * (1 - CENTER_Y_BOT);

    if (inCenterX && inCenterY) {
      const header  = document.getElementById('reader-app-header');
      const menu    = document.getElementById('reader-bottom-menu');
      const visible = menu?.classList.contains('visible');
      if (!visible) {
        _closeAllReaderPanels('menu');
      }
      header?.classList.toggle('reader-header-visible', !visible);
      menu?.classList.toggle('visible', !visible);
      return;
    }

    _closeReaderMenu();
    const s     = window._study.state.reader;
    const total = (s.pages || []).length;
    if (x < W / 2) {
      if (s.page > 0) { s.page--; studyRenderReader(); }
    } else {
      if (s.page < total - 1) { s.page++; studyRenderReader(); }
    }
  }

  screen.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchMoved  = false;
  }, { passive: true });

  screen.addEventListener('touchmove', () => {
    touchMoved = true;
  }, { passive: true });

  screen.addEventListener('touchend', (e) => {
    if (touchMoved) return;
    _handleReaderTap(touchStartX, touchStartY, e.target);
  });

  // ★ PC 鼠标点击支持
  screen.addEventListener('click', (e) => {
    // touch 设备上 touchend 已处理，click 会重复触发，跳过
    if (e.sourceCapabilities && !e.sourceCapabilities.firesTouchEvents) {
      _handleReaderTap(e.clientX, e.clientY, e.target);
    }
  });

  document.getElementById('reader-menu-toc-btn')?.addEventListener('click', () => {
    _closeReaderMenu();
    _openTocSidebar('toc');
  });
  
  document.getElementById('reader-summary-btn')?.addEventListener('click', () => {
         const book = getAllStudyBooks().find(b => b.id === window._study.state.reader.bookId);
         if (book) studyOpenBookSummary(book);
     });

  document.getElementById('reader-menu-search-btn')?.addEventListener('click', () => {
    _closeReaderMenu();
    _openReaderSearch();
  });

  document.getElementById('reader-menu-bookmark-btn')?.addEventListener('click', () => {
    _closeReaderMenu();
    studyAddBookmark();
  });

  document.getElementById('reader-menu-history-btn')?.addEventListener('click', () => {
    _closeReaderMenu();
    if (typeof _openCoreadHistorySheet === 'function') _openCoreadHistorySheet();
  });
}

function _closeReaderMenu() {
  _closeAllReaderPanels('menu');
}

/**
 * 关闭阅读器所有面板，except 参数排除不关的那组：
 *   'menu'     — 顶部栏 + 底部菜单
 *   'settings' — 右侧阅读设置侧边栏
 *   'toc'      — 左侧目录/书签侧边栏
 *   'coread'   — 共读对话框 + 输入栏（不含悬浮球本身）
 */
function _closeAllReaderPanels(except) {
  if (except !== 'menu') {
    document.getElementById('reader-app-header')?.classList.remove('reader-header-visible');
    document.getElementById('reader-bottom-menu')?.classList.remove('visible');
  }
  if (except !== 'settings') {
    document.getElementById('reader-coread-sidebar')?.classList.remove('open');
  }
  if (except !== 'toc') {
    document.getElementById('reader-toc-sidebar')?.classList.remove('open');
    document.getElementById('reader-toc-overlay')?.classList.remove('visible');
  }
  if (except !== 'coread') {
    // 通过 DOM 状态判断共读是否展开，避免跨文件访问 _coread 内部状态
    const ball = document.getElementById('reader-float-ball');
    if (ball?.classList.contains('expanded')) {
      if (typeof _collapseCoread === 'function') _collapseCoread();
    }
  }
}

// ── 悬浮球拖动 ──────────────────────────────────────────

function _initFloatBallDrag() {
  const ball = document.getElementById('reader-float-ball');
  if (!ball || ball._dragBound) return;
  ball._dragBound = true;

  let isDragging = false;
  let moved      = false;
  let startX, startY, startLeft, startTop;

  ball.addEventListener('pointerdown', (e) => {
    isDragging = true;
    moved      = false;
    startX     = e.clientX;
    startY     = e.clientY;
    const rect = ball.getBoundingClientRect();
    startLeft  = rect.left;
    startTop   = rect.top;
    ball.setPointerCapture(e.pointerId);
  });

  ball.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    const newLeft = Math.max(0, Math.min(window.innerWidth  - ball.offsetWidth,  startLeft + dx));
    const newTop  = Math.max(0, Math.min(window.innerHeight - ball.offsetHeight, startTop  + dy));
    ball.style.left = `${newLeft}px`;
    ball.style.top  = `${newTop}px`;
    // 拖动中：若气泡展开，实时跟随
    if (typeof _syncBubblePosition === 'function' && ball.classList.contains('expanded')) {
      _syncBubblePosition();
    }
  });

  ball.addEventListener('pointerup', (e) => {
    isDragging = false;
    if (!moved) {
      // 未拖动，视为点击，统一交给 _toggleFloatBall 处理
      if (typeof _toggleFloatBall === 'function') _toggleFloatBall();
    } else {
      // 拖动结束，同步气泡到新位置
      if (typeof _syncBubblePosition === 'function' && ball.classList.contains('expanded')) {
        _syncBubblePosition();
      }
    }
  });
}

// ── 目录侧边栏 ──────────────────────────────────────────

function _initTocSidebar() {
  const sidebar  = document.getElementById('reader-toc-sidebar');
  const overlay  = document.getElementById('reader-toc-overlay');
  const closeBtn = document.getElementById('reader-toc-close-btn');
  if (!sidebar || sidebar._tocBound) return;
  sidebar._tocBound = true;

  const closeSidebar = () => {
    sidebar.classList.remove('open');
    overlay?.classList.remove('visible');
  };

  closeBtn?.addEventListener('click', closeSidebar);
  overlay?.addEventListener('click', closeSidebar);

  sidebar.querySelectorAll('.reader-toc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      sidebar.querySelectorAll('.reader-toc-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      _renderTocContent(tab.dataset.tab);
    });
  });
}

function _openTocSidebar(tab = 'toc') {
  const sidebar = document.getElementById('reader-toc-sidebar');
  const overlay = document.getElementById('reader-toc-overlay');
  if (!sidebar) return;

  _closeAllReaderPanels('toc');

  sidebar.querySelectorAll('.reader-toc-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  _renderTocContent(tab);
  sidebar.classList.add('open');
  overlay?.classList.add('visible');
}

function _renderTocContent(tab) {
  const el = document.getElementById('reader-toc-content');
  const s  = window._study.state.reader;
  const { h } = window._study;
  if (!el) return;

  const closeSidebar = () => {
    document.getElementById('reader-toc-sidebar')?.classList.remove('open');
    document.getElementById('reader-toc-overlay')?.classList.remove('visible');
  };

  if (tab === 'toc') {
    const toc = s.toc || [];
    if (!toc.length) {
      el.innerHTML = `<div class="reader-toc-empty">
        未识别到章节目录
        <br><small>支持「第X章/节/回/部/卷」格式</small>
      </div>`;
      return;
    }
    el.innerHTML = toc.map((item, i) =>
      `<button class="reader-toc-item${s.page === item.page ? ' cur' : ''}" data-page="${item.page}">
        <span class="reader-toc-idx">${i + 1}</span>
        <span class="reader-toc-label">${h(item.title)}</span>
      </button>`
    ).join('');

    el.querySelectorAll('.reader-toc-item').forEach(btn => {
      btn.addEventListener('click', () => {
        s.page = parseInt(btn.dataset.page, 10);
        studyRenderReader();
        closeSidebar();
      });
    });

  } else {
    const bms = s.bookmarks || [];
    if (!bms.length) {
      el.innerHTML = `<div class="reader-toc-empty">
        暂无书签
        <br><small>点底部菜单「书签」添加</small>
      </div>`;
      return;
    }
    el.innerHTML = bms.map((bm, i) =>
      `<div class="reader-toc-bm-row">
        <button class="reader-toc-item" data-page="${bm.page}">
          <span class="reader-toc-idx">🔖</span>
          <span class="reader-toc-label">
            ${h(bm.name)}
            <br><small class="reader-toc-hint">第 ${bm.page + 1} 页</small>
          </span>
        </button>
        <button class="reader-toc-del" data-idx="${i}" title="删除书签">✕</button>
      </div>`
    ).join('');

    el.querySelectorAll('.reader-toc-item').forEach(btn => {
      btn.addEventListener('click', () => {
        s.page = parseInt(btn.dataset.page, 10);
        studyRenderReader();
        closeSidebar();
      });
    });

    el.querySelectorAll('.reader-toc-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        s.bookmarks.splice(parseInt(btn.dataset.idx, 10), 1);
        _saveBookBookmarks();
        _renderTocContent('bookmarks');
        if (typeof showToast === 'function') showToast('书签已删除');
      });
    });
  }
}

// ── 书签保存 ─────────────────────────────────────────────

async function _saveBookBookmarks() {
  const s    = window._study.state.reader;
  const book = getAllStudyBooks().find(b => b.id === s.bookId);
  if (book) {
    book.bookmarks = s.bookmarks;
    if (typeof saveStudyBookToDB === 'function') await saveStudyBookToDB(book);
  }
}

async function studyAddBookmark() {
  const s = window._study.state.reader;
  const defaultName = `第 ${s.page + 1} 页`;
  let name;
  if (typeof AppUI !== 'undefined' && typeof AppUI.prompt === 'function') {
    name = await AppUI.prompt('书签名称', '新建书签', defaultName);
  } else {
    name = window.prompt('书签名称', defaultName);
  }
  if (name === null) return;

  const finalName = (name || defaultName).trim() || defaultName;
  if (!s.bookmarks) s.bookmarks = [];

  const existing = s.bookmarks.findIndex(bm => bm.page === s.page);
  if (existing >= 0) {
    s.bookmarks[existing].name = finalName;
    if (typeof showToast === 'function') showToast(`📖 书签已更新为「${finalName}」`);
  } else {
    s.bookmarks.push({ name: finalName, page: s.page });
    s.bookmarks.sort((a, b) => a.page - b.page);
    if (typeof showToast === 'function') showToast(`📖 书签「${finalName}」已保存`);
  }
  await _saveBookBookmarks();
}

// ── 搜索 ────────────────────────────────────────────────

async function _openReaderSearch() {
  const s = window._study.state.reader;
  let keyword;
  if (typeof AppUI !== 'undefined' && typeof AppUI.prompt === 'function') {
    keyword = await AppUI.prompt('搜索关键词', '全书搜索');
  } else {
    keyword = window.prompt('搜索关键词');
  }
  if (!keyword?.trim()) return;

  const kw    = keyword.trim();
  const pages = s.pages || [];
  const found = pages.reduce((acc, page, i) => { if (page.includes(kw)) acc.push(i); return acc; }, []);

  if (!found.length) {
    if (typeof showToast === 'function') showToast('未找到匹配内容');
    return;
  }
  const nextPage = found.find(p => p > s.page) ?? found[0];
  s.page = nextPage;
  studyRenderReader();
  if (typeof showToast === 'function') {
    showToast(`找到 ${found.length} 处结果，已跳至第 ${nextPage + 1} 页`);
  }
}

// ── 导入弹窗 ─────────────────────────────────────────────

let _studyImportFile = null;

function studyInitImportModal() {
  const fileInput = document.getElementById('imp-file');
  if (!fileInput) return;

  document.getElementById('btn-pick')?.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', e => {
    _studyImportFile = e.target.files[0];
    if (_studyImportFile) {
      document.getElementById('fname').textContent = _studyImportFile.name;
      const ti = document.getElementById('imp-title');
      if (!ti.value) ti.value = _studyImportFile.name.replace(/\.[^/.]+$/, '');
    }
  });

  document.getElementById('btn-cancel-import')?.addEventListener('click', studyCloseImportModal);

  document.getElementById('btn-ok-import')?.addEventListener('click', async () => {
    if (!_studyImportFile) {
      if (typeof AppUI !== 'undefined') AppUI.alert('请选择文件'); else alert('请选择文件');
      return;
    }
    const title = document.getElementById('imp-title').value.trim();
    if (!title) {
      if (typeof AppUI !== 'undefined') AppUI.alert('请输入书籍名称'); else alert('请输入书籍名称');
      return;
    }
    const category = document.getElementById('imp-cat').value.trim() || '默认分类';
    const okBtn = document.getElementById('btn-ok-import');
    okBtn.disabled    = true;
    okBtn.textContent = '导入中…';

    try {
      let content = '';
if (_studyImportFile.name.endsWith('.txt')) {
  const encoding = document.getElementById('imp-encoding')?.value || 'utf-8';
  const ab = await _studyImportFile.arrayBuffer();
  content = new TextDecoder(encoding).decode(ab);
} else if (_studyImportFile.name.endsWith('.docx') && typeof mammoth !== 'undefined') {
        const ab  = await _studyImportFile.arrayBuffer();
        const res = await mammoth.extractRawText({ arrayBuffer: ab });
        content   = res.value;
      } else {
        throw new Error('仅支持 .txt 和 .docx 格式，或未加载 docx 解析库');
      }

      await saveStudyBook({ title, category, content });
      studyCloseImportModal();
      studyRenderBookshelf();
      studyRenderHome?.();
      if (typeof AppUI !== 'undefined') AppUI.alert('导入成功！'); else alert('导入成功！');
    } catch (e) {
      console.error(e);
      if (typeof AppUI !== 'undefined') AppUI.alert('导入失败：' + e.message); else alert('导入失败：' + e.message);
    } finally {
      okBtn.disabled    = false;
      okBtn.textContent = '确定导入';
    }
  });
}

function studyOpenImportModal() {
  _studyImportFile = null;
  document.getElementById('imp-title').value    = '';
  document.getElementById('imp-cat').value      = '';
  document.getElementById('imp-encoding').value = 'utf-8'; // ← 加这行
  document.getElementById('fname').textContent  = '未选择文件';
  document.getElementById('imp-file').value     = '';
  document.getElementById('study-import-modal')?.classList.add('visible');
}

function studyCloseImportModal() {
  document.getElementById('study-import-modal')?.classList.remove('visible');
}