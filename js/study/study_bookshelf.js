// study_bookshelf.js — 学习模块：书架渲染 + 导入弹窗
// 依赖：study_core.js / study_db.js / study_ai.js
// =====================================================

// ── 书架渲染（tab + 书本网格）─────────────────────────

function studyRenderBookshelf() {
  const { state, h, icons } = window._study;
  const tabsEl = document.getElementById('st-shelf-tabs');
  const gridEl = document.getElementById('st-bookshelf-grid');
  if (!tabsEl || !gridEl) return;

  const books = getAllStudyBooks();
  const cats  = [...new Set(books.map(b => b.category || '默认分类'))];
  const sel   = state.bookshelf.selectedCategory || 'all';

  // ── Tab 渲染 ────────────────────────────────────
  const tabs = [{ key: 'all', label: '全部' }, ...cats.map(c => ({ key: c, label: c }))];
  tabsEl.innerHTML = tabs.map(t =>
    `<button class="st-cat-tab${t.key === sel ? ' active' : ''}" data-cat="${h(t.key)}">${h(t.label)}</button>`
  ).join('');

  tabsEl.querySelectorAll('.st-cat-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.bookshelf.selectedCategory = btn.dataset.cat;
      studyRenderBookshelf();
      // 平滑滚动被选中 tab 到视口内
      btn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  });

  // ── 过滤书本 ────────────────────────────────────
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

  // ── 封面主题色（按书 id hash 分配）──────────────
  const COVERS = [
    { bg: '#4a8de8', spine: '#3a6dbf' },
    { bg: '#e8834a', spine: '#c4622e' },
    { bg: '#9b6de8', spine: '#7a4dbf' },
    { bg: '#3cb87a', spine: '#2a8a58' },
    { bg: '#e85a6a', spine: '#bf3a4a' },
    { bg: '#5ab8c8', spine: '#3a8a9a' },
    { bg: '#c8a23a', spine: '#a07a20' },
    { bg: '#7a9de8', spine: '#5a7dbf' },
  ];

  function hashColor(id) {
    const n = String(id).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0);
    return COVERS[Math.abs(n) % COVERS.length];
  }

  gridEl.innerHTML = `<div class="st-book-grid">${filtered.map(book => {
    const { bg, spine } = hashColor(book.id);
    const qc = getQuestionsByBook(book.id).length;
    return `
      <div class="st-book-cover-wrap" data-book-id="${h(book.id)}" title="${h(book.title)}">
        <div class="st-book-cover" style="--cover-bg:${bg};--cover-spine:${spine};">
          <span class="st-book-cover-title">${h(book.title)}</span>
        </div>
        <div class="st-book-cover-footer">
          <span class="st-book-cover-name">${h(book.title)}</span>
          ${qc > 0 ? `<span class="st-book-cover-badge">${qc}题</span>` : ''}
        </div>
      </div>`;
  }).join('')}</div>`;

// ── 点击阅读 ─────────────────────────────────────
  gridEl.querySelectorAll('.st-book-cover-wrap').forEach(wrap => {
    let pressTimer = null;
    let isDragging = false;
    let startX = 0, startY = 0; // 记录按下的初始坐标

    wrap.addEventListener('pointerdown', (e) => {
      startX = e.clientX;
      startY = e.clientY;
      isDragging = false;
      
      pressTimer = setTimeout(async () => {
        pressTimer = null;
        isDragging = true; // 长按触发后，标记为拖拽状态，防止松手时触发点击阅读
        
        // 长按 → 删除确认
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
      // 容差：只有移动超过 10 像素才认为是滑动，避免手指微小抖动导致无法点击
      if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) {
        isDragging = true; 
        clearTimeout(pressTimer); 
        pressTimer = null; 
      }
    });
    
    wrap.addEventListener('pointerup',   () => { clearTimeout(pressTimer); pressTimer = null; });
    wrap.addEventListener('pointerleave',() => { clearTimeout(pressTimer); pressTimer = null; });
    wrap.addEventListener('pointercancel',() => { clearTimeout(pressTimer); pressTimer = null; });

    wrap.addEventListener('click', () => {
      // 如果被判定为拖动或长按，则不触发阅读
      if (isDragging) return;
      
      const book = getAllStudyBooks().find(b => String(b.id) === String(wrap.dataset.bookId));
      if (book) studyOpenReader(book);
    });
  });
}

// ── 打开阅读器 ────────────────────────────────────────

function studyOpenReader(book) {
  const s = window._study.state.reader;
  s.bookId  = book.id;
  s.content = book.content || '';
  s.page    = 0;

  const titleEl = document.getElementById('reader-book-title');
  if (titleEl) titleEl.textContent = book.title;

  if (typeof switchScreen === 'function') {
      switchScreen('study-book-reader-screen');
  }

  // 等 DOM 渲染完成后，根据内容区实际高度动态计算每页字数
  // 避免出现"一页内容超出屏幕高度需要滚动"的问题
  requestAnimationFrame(() => {
    const contentEl = document.getElementById('reader-content');
    if (contentEl) {
      const availH      = contentEl.clientHeight || 500;
      const availW      = contentEl.clientWidth  || 320;
      const fontSize    = 16;       // st-reader-text font-size
      const lineHeight  = fontSize * 2;             // line-height: 2
      // 中文字符宽度约等于字体大小；padding 各 22px → 内容宽
      const innerW      = Math.max(availW - 44, 200);
      const charsPerRow = Math.floor(innerW / fontSize);
      const rowsPerPage = Math.floor(availH / lineHeight);
      // 留约 10% 余量，避免刚好溢出
      s.pageSize = Math.max(100, Math.floor(charsPerRow * rowsPerPage * 0.88));
    }
    s.pages = _splitPages(s.content, s.pageSize);
    studyRenderReader();
  });
}

function _splitPages(text, size) {
  if (!text) return ['（内容为空）'];
  const pages = [];
  let start = 0;
  while (start < text.length) {
    let end = start + size;
    if (end < text.length) {
      // 往回找最近的换行或句号，避免切断句子
      const sub       = text.slice(start, end);
      const lastBreak = Math.max(
        sub.lastIndexOf('\n'),
        sub.lastIndexOf('。'),
        sub.lastIndexOf('！'),
        sub.lastIndexOf('？'),
        sub.lastIndexOf('…'),
      );
      if (lastBreak > size * 0.5) end = start + lastBreak + 1;
    }
    pages.push(text.slice(start, end).trim());
    start = end;
  }
  return pages.filter(p => p.length > 0);
}

function studyRenderReader() {
  const { h } = window._study;
  const s = window._study.state.reader;
  const contentEl  = document.getElementById('reader-content');
  const pageInfoEl = document.getElementById('reader-page-info');
  const prevBtn    = document.getElementById('reader-prev');
  const nextBtn    = document.getElementById('reader-next');
  if (!contentEl) return;

  const pages   = s.pages || [''];
  const total   = pages.length;
  const current = Math.max(0, Math.min(s.page, total - 1));
  s.page = current;

  contentEl.innerHTML = `<p class="st-reader-text">${h(pages[current] || '')}</p>`;
  if (pageInfoEl) pageInfoEl.textContent = `${current + 1} / ${total}`;

  if (prevBtn) {
    prevBtn.disabled = current === 0;
    prevBtn.onclick  = () => { s.page--; studyRenderReader(); };
  }
  if (nextBtn) {
    nextBtn.disabled = current >= total - 1;
    nextBtn.onclick  = () => { s.page++; studyRenderReader(); };
  }
}

// ── 导入弹窗 ─────────────────────────────────────────

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
        content = await _studyImportFile.text();
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
  document.getElementById('imp-title').value   = '';
  document.getElementById('imp-cat').value     = '';
  document.getElementById('fname').textContent = '未选择文件';
  document.getElementById('imp-file').value    = '';
  document.getElementById('study-import-modal')?.classList.add('visible');
}

function studyCloseImportModal() {
  document.getElementById('study-import-modal')?.classList.remove('visible');
}
