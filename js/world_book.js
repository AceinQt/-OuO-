// 世界书管理使用「类别目录 → 类别内条目 → 编辑」三级页面。
// 关联选择器仍保留原接口；管理页不再为了折叠分类而创建所有正文节点。
const worldBookListContainer = document.getElementById('world-book-list-container');
const editWorldBookForm = document.getElementById('edit-world-book-form');
const worldBookIdInput = document.getElementById('world-book-id');
const worldBookNameInput = document.getElementById('world-book-name');
const worldBookContentInput = document.getElementById('world-book-content');
const linkWorldBookBtn = document.getElementById('link-world-book-btn');
const worldBookSelectionModal = document.getElementById('world-book-selection-modal');
const worldBookSelectionList = document.getElementById('world-book-selection-list');
const saveWorldBookSelectionBtn = document.getElementById('save-world-book-selection-btn');

const worldBookViewState = {
    initialized: false,
    featureTab: 'world-book',
    category: null,
    editingCategory: null,
    busy: false,
    dialogPending: false,
    writeQueue: Promise.resolve(),
    directoryScroll: 0,
    categoryScrolls: new Map(),
    views: {
        'world-book-screen': { prefix: 'wb-directory', listId: 'world-book-list-container', selecting: false, selected: new Set(), cancelPress: null },
        'world-book-category-screen': { prefix: 'wb-category', listId: 'world-book-entry-list', selecting: false, selected: new Set(), cancelPress: null }
    }
};

// 目录补登记与增删改共用队列，防止旧类别快照晚落盘，把刚新增/删除的目录覆盖回去。
function queueWorldBookWrite(action) {
    const result = worldBookViewState.writeQueue.then(action);
    worldBookViewState.writeQueue = result.catch(() => {});
    return result;
}

function registerWorldBookCategories() {
    return queueWorldBookWrite(async () => {
        const categories = collectWorldBookCategories(db.worldBookCategories, db.worldBooks);
        if (JSON.stringify(categories) === JSON.stringify(db.worldBookCategories)) return;
        await dexieDB.globalSettings.put({ key: 'worldBookCategories', value: categories });
        db.worldBookCategories = categories;
    });
}

function createWorldBookCategory(name) {
    return queueWorldBookWrite(async () => {
        const category = String(name || '').trim();
        if (!category) throw new Error('类别名称不能为空');
        const categories = collectWorldBookCategories(db.worldBookCategories, db.worldBooks);
        if (categories.includes(category)) throw new Error('这个类别已经存在');
        categories.push(category);
        await dexieDB.globalSettings.put({ key: 'worldBookCategories', value: categories });
        db.worldBookCategories = categories;
        return category;
    });
}

// 类别以名称定位，改名必须同时更新登记与条目的 category；只改登记会被旧条目补回旧目录。
// 关联依靠条目 ID，事务内只更新 category，不动条目正文、类型或角色/群聊的绑定。
function renameWorldBookCategory(previousName, name) {
    return queueWorldBookWrite(async () => {
        const previous = getWorldBookCategoryKey(previousName);
        const category = String(name || '').trim();
        if (!category) throw new Error('类别名称不能为空');
        const categories = collectWorldBookCategories(db.worldBookCategories, db.worldBooks);
        if (!categories.includes(previous)) throw new Error('这个类别已被删除，请返回目录');
        if (category === previous) return category;
        if (categories.includes(category)) throw new Error('这个类别已经存在');
        const books = db.worldBooks.filter(book => getWorldBookCategoryKey(book.category) === previous);
        const renamedCategories = categories.map(value => value === previous ? category : value);
        await dexieDB.transaction('rw', dexieDB.worldBooks, dexieDB.globalSettings, async () => {
            for (const book of books) {
                const updated = await dexieDB.worldBooks.update(book.id, { category });
                if (!updated) throw new Error('类别内容已变化，请重新打开后重试');
            }
            await dexieDB.globalSettings.put({ key: 'worldBookCategories', value: renamedCategories });
        });
        books.forEach(book => { book.category = category; });
        db.worldBookCategories = renamedCategories;
        // 成功落盘才迁移页面状态与滚动键；改名后新增条目、编辑返回都继续留在新类别。
        if (worldBookViewState.category === previous) {
            const scroll = document.querySelector('#world-book-category-screen .content').scrollTop;
            worldBookViewState.categoryScrolls.set(category, scroll);
            worldBookViewState.category = category;
        } else if (worldBookViewState.categoryScrolls.has(previous)) {
            worldBookViewState.categoryScrolls.set(category, worldBookViewState.categoryScrolls.get(previous));
        }
        worldBookViewState.categoryScrolls.delete(previous);
        if (worldBookViewState.editingCategory === previous) worldBookViewState.editingCategory = category;
        return category;
    });
}

function saveWorldBookEntry(values, editingId = null) {
    return queueWorldBookWrite(async () => {
        const name = String(values.name || '').trim();
        const content = String(values.content || '').trim();
        if (!name || !content) throw new Error('名称和内容不能为空');
        const previous = editingId ? db.worldBooks.find(book => book.id === editingId) : null;
        if (editingId && !previous) throw new Error('这个条目已被删除，请返回列表');
        const category = getWorldBookCategoryKey(values.category);
        const book = {
            ...previous,
            id: previous ? previous.id : `wb_${crypto.randomUUID()}`,
            name,
            content,
            category,
            position: ['before', 'after', 'writing'].includes(values.position) ? values.position : 'before'
        };
        // 在替换条目前收集类别，原类别的最后一条被移走后也仍是一个空目录。
        const categories = collectWorldBookCategories(db.worldBookCategories, [...db.worldBooks, book]);
        await dexieDB.transaction('rw', dexieDB.worldBooks, dexieDB.globalSettings, async () => {
            await dexieDB.worldBooks.put(book);
            await dexieDB.globalSettings.put({ key: 'worldBookCategories', value: categories });
        });
        if (previous) Object.assign(previous, book);
        else db.worldBooks.push(book);
        db.worldBookCategories = categories;
        return book;
    });
}

// 仅延续管理页原有的角色/群 worldBookIds 级联语义，不重写聊天正文或记忆字段。
// 先提交同一事务，再更新内存；任何一步失败都不能出现条目已删、引用却没落盘的半成品。
function deleteWorldBookData(bookIds, categoryNames = []) {
    const ids = new Set(bookIds);
    const removedCategories = new Set(categoryNames);
    return queueWorldBookWrite(async () => {
        if (db.worldBooks.some(book => removedCategories.has(getWorldBookCategoryKey(book.category)) && !ids.has(book.id))) {
            throw new Error('类别内容已变化，请重新选择并确认删除');
        }
        const categories = collectWorldBookCategories(db.worldBookCategories, db.worldBooks)
            .filter(category => !removedCategories.has(category));
        const affected = [];
        for (const tableName of ['characters', 'groups']) {
            for (const chat of db[tableName] || []) {
                if (!Array.isArray(chat.worldBookIds) || !chat.worldBookIds.some(id => ids.has(id))) continue;
                affected.push({ tableName, chat, worldBookIds: chat.worldBookIds.filter(id => !ids.has(id)) });
            }
        }
        await dexieDB.transaction('rw', dexieDB.worldBooks, dexieDB.globalSettings, dexieDB.characters, dexieDB.groups, async () => {
            if (ids.size) await dexieDB.worldBooks.bulkDelete([...ids]);
            await dexieDB.globalSettings.put({ key: 'worldBookCategories', value: categories });
            for (const item of affected) {
                await dexieDB[item.tableName].update(item.chat.id, { worldBookIds: item.worldBookIds });
            }
        });
        db.worldBooks = db.worldBooks.filter(book => !ids.has(book.id));
        db.worldBookCategories = categories;
        affected.forEach(item => { item.chat.worldBookIds = item.worldBookIds; });
    });
}

function worldBookElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

// 左栏是真正的功能切换：只保存可见面板的位置，切换先退出两种功能的多选与长按计时器。
function setWorldBookFeatureTab(tab) {
    if (!['world-book', 'regex'].includes(tab) || worldBookViewState.busy || window.RegexManager?.busy) return;
    if (worldBookViewState.featureTab === 'world-book') {
        worldBookViewState.directoryScroll = document.getElementById('wb-world-book-panel').scrollTop;
    } else if (typeof saveRegexDirectoryScroll === 'function') saveRegexDirectoryScroll();
    exitWorldBookMultiSelectMode('world-book-screen');
    if (typeof exitRegexMultiSelectMode === 'function') exitRegexMultiSelectMode('world-book-screen');
    worldBookViewState.featureTab = tab;
    renderWorldBookFeatureDirectory();
}

function renderWorldBookFeatureDirectory() {
    const regex = worldBookViewState.featureTab === 'regex';
    for (const [id, active] of [['wb-world-book-tab', !regex], ['wb-regex-tab', regex]]) {
        const button = document.getElementById(id);
        if (!button) continue;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
    }
    for (const id of ['wb-world-book-panel', 'wb-directory-header', 'wb-directory-select-header']) document.getElementById(id).hidden = regex;
    for (const id of ['wb-regex-panel', 'regex-directory-header', 'regex-directory-select-header']) {
        const element = document.getElementById(id);
        if (element) element.hidden = !regex;
    }
    if (regex && typeof renderRegexCategoryList === 'function') renderRegexCategoryList();
    else renderWorldBookList();
}

function renderWorldBookList() {
    const counts = new Map();
    for (const book of db.worldBooks) {
        const category = getWorldBookCategoryKey(book.category);
        counts.set(category, (counts.get(category) || 0) + 1);
    }
    const categories = collectWorldBookCategories(db.worldBookCategories, db.worldBooks).sort((a, b) => {
        if (a === b) return 0;
        if (a === '未分类') return 1;
        if (b === '未分类') return -1;
        return a.localeCompare(b);
    });
    const fragment = document.createDocumentFragment();
    for (const category of categories) {
        const item = worldBookElement('li', 'draft-card-item wb-category-card');
        item.dataset.category = category;
        const icon = worldBookElement('div', 'draft-card-icon-wrapper');
        // 最左一本底部向左分开、顶部向右倾靠在相邻书脊上，其余直立；外观参数在世界书 CSS 中调整。
        icon.innerHTML = '<svg class="wb-bookshelf-icon" width="48" height="48" viewBox="0 0 48 48" aria-hidden="true"><rect class="wb-book-tilted" x="1" y="16" width="8" height="26" rx="1.5"/><rect x="14" y="8" width="8" height="34" rx="1.5"/><rect x="24" y="20" width="8" height="22" rx="1.5"/><rect x="34" y="12" width="8" height="30" rx="1.5"/></svg>';
        const details = worldBookElement('div', 'draft-card-content');
        details.append(worldBookElement('div', 'draft-card-title', category), worldBookElement('div', 'draft-card-subtitle', `包含 ${counts.get(category) || 0} 个世界书`));
        item.append(icon, details);
        fragment.appendChild(item);
    }
    worldBookListContainer.replaceChildren(fragment);
    document.getElementById('no-world-books-placeholder').style.display = categories.length ? 'none' : 'block';
    refreshWorldBookSelectUI('world-book-screen');
    document.getElementById('wb-world-book-panel').scrollTop = worldBookViewState.directoryScroll;
    // 角色卡导入也会新增条目，入口补登记其类别，不依赖“编辑页保存”是唯一写入来源。
    registerWorldBookCategories().catch(error => console.error('世界书类别登记失败:', error));
}

function renderWorldBookCategoryList() {
    const category = worldBookViewState.category;
    const list = document.getElementById('world-book-entry-list');
    document.getElementById('world-book-category-title').textContent = category || '世界书类别';
    const books = category === null ? [] : db.worldBooks.filter(book => getWorldBookCategoryKey(book.category) === category);
    const fragment = document.createDocumentFragment();
    for (const book of books) {
        const row = worldBookElement('li', 'list-item world-book-item');
        row.dataset.id = book.id;
        const icon = worldBookElement('div', 'wb-entry-icon');
        // 类别内条目使用 Lucide 单本书，与目录的四本书区分层级；占位和配色由共用 CSS 保持一致。
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-book preview-icon" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>';
        const details = worldBookElement('div', 'item-details');
        // 先截断再处理空白，不为一行预览扫描/解析全文，更不让正文中的 HTML 变成资源节点。
        const raw = String(book.content || '');
        const preview = raw.slice(0, 120).replace(/\s+/g, ' ').trim() + (raw.length > 120 ? '…' : '');
        details.append(worldBookElement('div', 'item-name', book.name), worldBookElement('div', 'item-preview', preview));
        row.append(worldBookElement('span', 'wb-row-check'), icon, details, worldBookElement('span', 'wb-row-arrow', '›'));
        fragment.appendChild(row);
    }
    list.replaceChildren(fragment);
    document.getElementById('no-world-book-entries').style.display = books.length ? 'none' : 'block';
    refreshWorldBookSelectUI('world-book-category-screen');
    document.querySelector('#world-book-category-screen .content').scrollTop = worldBookViewState.categoryScrolls.get(category) || 0;
}

function openWorldBookCategory(category) {
    worldBookViewState.featureTab = 'world-book';
    worldBookViewState.category = getWorldBookCategoryKey(category);
    navigateTo('world-book-category-screen');
}

function openWorldBookEditor(bookId = null) {
    const book = bookId ? db.worldBooks.find(item => item.id === bookId) : null;
    if (bookId && !book) return;
    currentEditingWorldBookId = book ? book.id : null;
    worldBookViewState.editingCategory = worldBookViewState.category;
    editWorldBookForm.reset();
    worldBookIdInput.value = book ? book.id : '';
    worldBookNameInput.value = book ? book.name : '';
    worldBookContentInput.value = book ? book.content : '';
    document.getElementById('world-book-category').value = book ? book.category || '' : worldBookViewState.category || '';
    const position = book && ['before', 'after', 'writing'].includes(book.position) ? book.position : 'before';
    editWorldBookForm.querySelector(`input[name="world-book-position"][value="${position}"]`).checked = true;
    document.getElementById('edit-world-book-title').textContent = book ? '编辑条目' : '创建条目';
    navigateTo('edit-world-book-screen');
}

function isWorldBookMultiSelectActive() {
    const active = document.querySelector('.screen.active');
    return !!(active && (active.id !== 'world-book-screen' || worldBookViewState.featureTab === 'world-book') && worldBookViewState.views[active.id]?.selecting);
}

function enterWorldBookMultiSelectMode(screenId, key) {
    const view = worldBookViewState.views[screenId];
    if (!view || view.selecting || worldBookViewState.busy || (screenId === 'world-book-screen' && worldBookViewState.featureTab !== 'world-book')) return;
    view.selecting = true;
    view.selected.clear();
    view.selected.add(key);
    refreshWorldBookSelectUI(screenId);
}

function exitWorldBookMultiSelectMode(screenId) {
    const id = typeof screenId === 'string' ? screenId : document.querySelector('.screen.active')?.id;
    const view = worldBookViewState.views[id];
    if (!view) return;
    view.selecting = false;
    view.selected.clear();
    view.cancelPress?.();
    refreshWorldBookSelectUI(id);
}

function refreshWorldBookSelectUI(screenId) {
    const view = worldBookViewState.views[screenId];
    const screen = document.getElementById(screenId);
    const list = document.getElementById(view.listId);
    const isDirectory = screenId === 'world-book-screen';
    const rows = Array.from(list.children);
    const valid = new Set(rows.map(row => isDirectory ? row.dataset.category : row.dataset.id));
    for (const key of view.selected) if (!valid.has(key)) view.selected.delete(key);
    // 两个功能共用左栏，隐藏的世界书状态清理不能覆盖正则的选择样式或取消按钮。
    const activeTab = !isDirectory || worldBookViewState.featureTab === 'world-book';
    if (activeTab) screen.classList.toggle('wb-selecting', view.selecting);
    document.getElementById(`${view.prefix}-header`).style.display = view.selecting ? 'none' : '';
    const header = document.getElementById(`${view.prefix}-select-header`);
    header.style.display = view.selecting ? '' : 'none';
    header.querySelector('.wb-select-count').textContent = `选择 ${view.selected.size} ${isDirectory ? '个类别' : '本'}`;
    header.querySelector('.wb-select-delete').disabled = worldBookViewState.busy || view.selected.size === 0;
    // 目录的取消按钮在左栏，条目页的仍在顶栏；按页面查找才能同时照顾两种布局。
    if (activeTab) screen.querySelector('.wb-select-cancel').disabled = worldBookViewState.busy;
    rows.forEach(row => {
        const selected = view.selected.has(isDirectory ? row.dataset.category : row.dataset.id);
        row.classList.toggle('is-selecting', view.selecting);
        row.classList.toggle('selected', selected);
        row.setAttribute('aria-selected', String(selected));
    });
}

// 页面返回也必须结束弹窗等待，不能只隐藏。与遮罩、系统返回共用 AppUI 取消入口。
function cancelWorldBookDialog(overlay) {
    if (!worldBookViewState.dialogPending || !overlay || overlay.id !== 'app-global-dialog') return false;
    if (typeof AppUI.dismiss === 'function') return AppUI.dismiss(overlay);
    const cancel = overlay.querySelector('.btn-neutral');
    if (!cancel) return false;
    cancel.click();
    return true;
}

async function awaitWorldBookDialog(openDialog) {
    worldBookViewState.dialogPending = true;
    try {
        return await openDialog();
    } finally {
        worldBookViewState.dialogPending = false;
    }
}

// 三种返回入口在页面切换/侧滑动画之前询问；写入期间也阻止离页，避免成功回调把用户拉回旧页。
function consumeWorldBookBack() {
    if (typeof consumeRegexBack === 'function' && consumeRegexBack()) return true;
    const active = document.querySelector('.screen.active');
    if (!active || !['world-book-screen', 'world-book-category-screen', 'edit-world-book-screen'].includes(active.id)) return false;
    if (cancelWorldBookDialog(document.getElementById('app-global-dialog'))) return true;
    if (worldBookViewState.busy) return true;
    if (!isWorldBookMultiSelectActive()) return false;
    exitWorldBookMultiSelectMode(active.id);
    return true;
}

function setWorldBookBusy(busy) {
    worldBookViewState.busy = busy;
    for (const id of ['add-world-book-category-btn', 'add-world-book-btn', 'rename-world-book-category-btn']) document.getElementById(id).disabled = busy;
    editWorldBookForm.querySelector('button[type="submit"]').disabled = busy;
    Object.keys(worldBookViewState.views).forEach(refreshWorldBookSelectUI);
}

async function promptWorldBookCategory() {
    if (worldBookViewState.busy) return;
    setWorldBookBusy(true);
    try {
        const name = await awaitWorldBookDialog(() => AppUI.prompt('输入新的类别名称', '', '新增类别'));
        if (name === null) return;
        await createWorldBookCategory(name);
        renderWorldBookList();
        showToast('类别已创建');
    } catch (error) {
        console.error('创建世界书类别失败:', error);
        showToast(error.message || '创建失败，请重试');
    } finally {
        setWorldBookBusy(false);
    }
}

async function promptRenameWorldBookCategory() {
    const previous = worldBookViewState.category;
    if (worldBookViewState.busy || previous === null) return;
    setWorldBookBusy(true);
    try {
        const name = await awaitWorldBookDialog(() => AppUI.prompt('输入新的类别名称', previous, '重命名类别'));
        if (name === null) return;
        await renameWorldBookCategory(previous, name);
        renderWorldBookCategoryList();
        showToast('类别已重命名');
    } catch (error) {
        console.error('重命名世界书类别失败:', error);
        showToast(error.message || '重命名失败，请重试');
    } finally {
        setWorldBookBusy(false);
    }
}

async function deleteSelectedWorldBooks(screenId) {
    const id = typeof screenId === 'string' ? screenId : document.querySelector('.screen.active')?.id;
    const view = worldBookViewState.views[id];
    if (!view || !view.selected.size || worldBookViewState.busy) return;
    const isDirectory = id === 'world-book-screen';
    const selected = [...view.selected];
    const categories = isDirectory ? selected : [];
    const categorySet = new Set(categories);
    const bookIds = isDirectory
        ? db.worldBooks.filter(book => categorySet.has(getWorldBookCategoryKey(book.category))).map(book => book.id)
        : selected;
    const message = isDirectory
        ? `确定删除选中的 ${categories.length} 个类别及其中的 ${bookIds.length} 个世界书条目？此操作不可撤销。`
        : `确定删除选中的 ${bookIds.length} 个世界书条目？此操作不可撤销。`;
    setWorldBookBusy(true);
    try {
        if (!await awaitWorldBookDialog(() => AppUI.confirm(message, isDirectory ? '删除类别' : '删除条目', '删除', '取消'))) return;
        await deleteWorldBookData(bookIds, categories);
        exitWorldBookMultiSelectMode(id);
        if (isDirectory) renderWorldBookList();
        else renderWorldBookCategoryList();
        showToast(isDirectory ? '类别及其中条目已删除' : '所选条目已删除');
    } catch (error) {
        console.error('删除世界书失败:', error);
        showToast(error.message || '删除失败，请重试');
    } finally {
        setWorldBookBusy(false);
    }
}

function bindWorldBookListEvents(screenId) {
    const view = worldBookViewState.views[screenId];
    const list = document.getElementById(view.listId);
    const isDirectory = screenId === 'world-book-screen';
    const selector = isDirectory ? '.wb-category-card' : '.world-book-item';
    const keyOf = row => isDirectory ? row.dataset.category : row.dataset.id;
    let timer = null;
    let start = null;
    let pressedRow = null;
    let suppressClick = false;
    const clearPress = () => { clearTimeout(timer); timer = null; start = null; pressedRow = null; };
    view.cancelPress = () => { clearPress(); suppressClick = false; };
    list.addEventListener('pointerdown', event => {
        clearPress();
        suppressClick = false;
        if (worldBookViewState.busy || event.button !== 0 || event.isPrimary === false) return;
        const row = event.target.closest(selector);
        if (!row || view.selecting) return;
        pressedRow = row;
        start = { x: event.clientX, y: event.clientY };
        timer = setTimeout(() => {
            suppressClick = true;
            enterWorldBookMultiSelectMode(screenId, keyOf(row));
        }, 500);
    });
    list.addEventListener('pointermove', event => {
        if (start && (Math.abs(event.clientX - start.x) > 10 || Math.abs(event.clientY - start.y) > 10)) clearPress();
    });
    list.addEventListener('pointerup', clearPress);
    list.addEventListener('pointercancel', clearPress);
    list.addEventListener('pointerleave', clearPress);
    list.addEventListener('contextmenu', event => {
        const row = event.target.closest(selector);
        if (!row) return;
        event.preventDefault();
        // 移动端原生长按菜单可能在计时器后才送达，不能再次切换选中态。
        suppressClick = true;
        clearPress();
        enterWorldBookMultiSelectMode(screenId, keyOf(row));
    });
    list.addEventListener('click', event => {
        const row = event.target.closest(selector);
        if (!row) return;
        if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
        if (worldBookViewState.busy) return;
        const key = keyOf(row);
        if (view.selecting) {
            if (view.selected.has(key)) view.selected.delete(key);
            else view.selected.add(key);
            refreshWorldBookSelectUI(screenId);
        } else if (isDirectory) openWorldBookCategory(key);
        else openWorldBookEditor(key);
    });
    const header = document.getElementById(`${view.prefix}-select-header`);
    document.getElementById(screenId).querySelector('.wb-select-cancel').addEventListener('click', () => {
        if (!worldBookViewState.busy && (!isDirectory || worldBookViewState.featureTab === 'world-book')) exitWorldBookMultiSelectMode(screenId);
    });
    header.querySelector('.wb-select-delete').addEventListener('click', () => deleteSelectedWorldBooks(screenId));
    const scroller = isDirectory ? document.getElementById('wb-world-book-panel') : document.querySelector(`#${screenId} .content`);
    scroller.addEventListener('scroll', () => {
        // 隐藏滚动容器的 scrollTop 为 0，且旧 scroll 事件会延迟送达，不能覆盖先前位置。
        if (!document.getElementById(screenId).classList.contains('active') || (isDirectory && worldBookViewState.featureTab !== 'world-book')) return;
        if (isDirectory) worldBookViewState.directoryScroll = scroller.scrollTop;
        else worldBookViewState.categoryScrolls.set(worldBookViewState.category, scroller.scrollTop);
        if (pressedRow) clearPress();
    }, { passive: true });
}

function setupWorldBookApp() {
    if (worldBookViewState.initialized) return;
    worldBookViewState.initialized = true;
    document.getElementById('wb-world-book-tab')?.addEventListener('click', () => setWorldBookFeatureTab('world-book'));
    document.getElementById('wb-regex-tab')?.addEventListener('click', () => setWorldBookFeatureTab('regex'));
    Object.keys(worldBookViewState.views).forEach(bindWorldBookListEvents);
    document.getElementById('add-world-book-category-btn').addEventListener('click', promptWorldBookCategory);
    document.getElementById('add-world-book-btn').addEventListener('click', () => openWorldBookEditor());
    document.getElementById('rename-world-book-category-btn').addEventListener('click', promptRenameWorldBookCategory);
    editWorldBookForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (worldBookViewState.busy) return;
        setWorldBookBusy(true);
        let saved = null;
        try {
            saved = await saveWorldBookEntry({
                name: worldBookNameInput.value,
                content: worldBookContentInput.value,
                category: document.getElementById('world-book-category').value,
                position: editWorldBookForm.querySelector('input[name="world-book-position"]:checked').value
            }, currentEditingWorldBookId);
            worldBookViewState.editingCategory = getWorldBookCategoryKey(saved.category);
            showToast('世界书条目已保存');
        } catch (error) {
            console.error('保存世界书失败:', error);
            showToast(error.message || '保存失败，请重试');
        } finally {
            setWorldBookBusy(false);
        }
        // 同步 click 让 system_back 的捕获监听认出 uiBack；不能直接切屏额外压入前进记录。
        if (saved) document.querySelector('#edit-world-book-screen .back-btn').click();
    });
    document.querySelector('#edit-world-book-screen .back-btn').addEventListener('click', () => {
        worldBookViewState.category = worldBookViewState.editingCategory;
    });
    window._screenLeaveHooks = window._screenLeaveHooks || {};
    for (const id of Object.keys(worldBookViewState.views)) {
        const previousHook = window._screenLeaveHooks[id];
        window._screenLeaveHooks[id] = targetId => {
            // 离页钩子此时尚未隐藏容器：同步保存位置，不能只依赖稍后才送达的 scroll 事件。
            const scroller = id === 'world-book-screen' ? document.getElementById('wb-world-book-panel') : document.querySelector(`#${id} .content`);
            if (id === 'world-book-screen') {
                if (worldBookViewState.featureTab === 'world-book') worldBookViewState.directoryScroll = scroller.scrollTop;
                else if (typeof saveRegexDirectoryScroll === 'function') saveRegexDirectoryScroll();
            } else worldBookViewState.categoryScrolls.set(worldBookViewState.category, scroller.scrollTop);
            previousHook?.(targetId);
            exitWorldBookMultiSelectMode(id);
        };
    }
}

// 双列只是私聊的绑定方式；其他关联弹窗继续使用原来的单列分组选择器。
function openChatWorldBookSelection(chatId, chatType) {
    const chat = (chatType === 'private' ? db.characters : db.groups).find(item => item.id === chatId);
    if (!chat) return;
    worldBookSelectionList.dataset.chatId = chatId;
    worldBookSelectionList.dataset.chatType = chatType;
    renderCategorizedWorldBookList(worldBookSelectionList, db.worldBooks, chat.worldBookIds || [],
        chatType === 'private' ? 'wb-select' : 'wb-select-group', chatType === 'private' ? chat : null);
    worldBookSelectionModal.classList.add('visible');
}

// 与删除条目共用队列。只更新关联字段，且写成功后才改内存，不能调用吞错的 saveSingleChat。
function saveChatWorldBookSelection(chatId, chatType, selectedIds, modes) {
    return queueWorldBookWrite(async () => {
        const tableName = chatType === 'private' ? 'characters' : 'groups';
        const chat = db[tableName].find(item => item.id === chatId);
        if (!chat) throw new Error('这个聊天已被删除');
        const ids = [...new Set(selectedIds)].filter(id => db.worldBooks.some(book => book.id === id));
        const changes = { worldBookIds: ids };
        if (chatType === 'private') {
            const draft = { worldBookIds: ids, worldBookModes: modes };
            const entries = ids.map(id => [id, getChatWorldBookModes(draft, db.worldBooks.find(book => book.id === id))])
                .filter(([, value]) => value.online || value.offline);
            changes.worldBookIds = entries.map(([id]) => id);
            changes.worldBookModes = Object.fromEntries(entries);
        }
        const updated = await dexieDB[tableName].update(chatId, changes);
        if (!updated) throw new Error('聊天保存失败，请重新打开后重试');
        Object.assign(chat, changes);
    });
}

function readChatWorldBookSelection(container) {
    if (container.dataset.chatType !== 'private') {
        return { ids: Array.from(container.querySelectorAll('.item-checkbox:checked')).map(input => input.value) };
    }
    const modes = Object.fromEntries(Array.from(container.querySelectorAll('.wb-mode-row')).map(row => {
        const inputs = Array.from(row.querySelectorAll('.wb-mode-checkbox'));
        return [row.dataset.bookId, Object.fromEntries(inputs.map(input => [input.dataset.mode, !input.disabled && input.checked]))];
    }));
    return { ids: Object.keys(modes).filter(id => modes[id].online || modes[id].offline), modes };
}

// 原生 checkbox 保留键盘和屏幕阅读器支持；扩大点击区域，但不让标签点击折叠类别。
function createWorldBookModeCell(mode, name, checked = false, disabled = false) {
    const label = worldBookElement('label', 'wb-mode-cell');
    const input = worldBookElement('input', 'wb-mode-checkbox');
    input.type = 'checkbox';
    input.dataset.mode = mode;
    input.checked = checked;
    input.disabled = disabled;
    input.setAttribute('aria-label', `${name} · ${mode === 'online' ? '线上' : '线下'}`);
    if (disabled) label.title = '文风不用于线上聊天';
    label.appendChild(input);
    return label;
}

// 角色/群/论坛等绑定弹窗继续使用原来的分组选择器；空类别不是可绑定内容。
// 只有传入 privateChat 才画双列，不能把某次私聊的模式筛选带到其他功能。
function renderCategorizedWorldBookList(container, books, selectedIds, idPrefix, privateChat = null) {
    container.innerHTML = '';
    container.classList.toggle('wb-mode-list', !!privateChat);
    if (privateChat) {
        const heading = worldBookElement('li', 'wb-mode-heading');
        heading.append(worldBookElement('span', '', '世界书名称'), worldBookElement('span', '', '线上'), worldBookElement('span', '', '线下'));
        container.appendChild(heading);
    }
    if (!books || books.length === 0) {
        container.innerHTML = '<li style="color: #888; text-align: center; padding: 15px;">暂无世界书条目</li>';
        return;
    }
    const groupedBooks = new Map();
    books.forEach(book => {
        const category = getWorldBookCategoryKey(book.category);
        if (!groupedBooks.has(category)) groupedBooks.set(category, []);
        groupedBooks.get(category).push(book);
    });
    const sortedCategories = [...groupedBooks.keys()].sort((a, b) => {
        if (a === b) return 0;
        if (a === '未分类') return 1;
        if (b === '未分类') return -1;
        return a.localeCompare(b);
    });
    sortedCategories.forEach(category => {
        const categoryBooks = groupedBooks.get(category);
        const group = worldBookElement('div', 'world-book-category-group');
        const header = worldBookElement('div', 'world-book-category-header');
        if (privateChat) {
            header.classList.add('wb-mode-heading');
            const toggle = worldBookElement('button', 'wb-mode-category-toggle');
            toggle.type = 'button';
            toggle.setAttribute('aria-expanded', 'false');
            toggle.append(worldBookElement('span', 'category-name', category), worldBookElement('span', 'category-arrow', '▼'));
            header.appendChild(toggle);
            const list = worldBookElement('ul', 'world-book-items-list');
            const modes = ['online', 'offline'];
            const categoryInputs = modes.map(mode => {
                const cell = createWorldBookModeCell(mode, `${category}全选`);
                header.appendChild(cell);
                return cell.querySelector('input');
            });
            const refresh = () => modes.forEach((mode, index) => {
                const inputs = Array.from(list.querySelectorAll('.wb-mode-checkbox')).filter(input => input.dataset.mode === mode && !input.disabled);
                const selected = inputs.filter(input => input.checked).length;
                categoryInputs[index].disabled = inputs.length === 0;
                categoryInputs[index].checked = inputs.length > 0 && selected === inputs.length;
                categoryInputs[index].indeterminate = selected > 0 && selected < inputs.length;
            });
            categoryBooks.forEach(book => {
                const row = worldBookElement('li', 'wb-mode-row');
                row.dataset.bookId = book.id;
                const name = worldBookElement('div', 'wb-mode-name');
                name.append(worldBookElement('span', '', book.name), worldBookElement('small', 'wb-mode-type',
                    ({ before: '世界观', after: '重要事项', writing: '文风' })[book.position] || '世界观'));
                row.appendChild(name);
                const selected = getChatWorldBookModes(privateChat, book);
                modes.forEach(mode => {
                    const cell = createWorldBookModeCell(mode, book.name, selected[mode], mode === 'online' && book.position === 'writing');
                    cell.querySelector('input').addEventListener('change', refresh);
                    row.appendChild(cell);
                });
                list.appendChild(row);
            });
            categoryInputs.forEach((input, index) => input.addEventListener('change', () => {
                list.querySelectorAll('.wb-mode-checkbox').forEach(item => {
                    if (item.dataset.mode === modes[index] && !item.disabled) item.checked = input.checked;
                });
                refresh();
            }));
            toggle.addEventListener('click', () => {
                group.classList.toggle('open');
                toggle.setAttribute('aria-expanded', String(group.classList.contains('open')));
            });
            refresh();
            group.append(header, list);
            container.appendChild(group);
            return;
        }
        const categoryCheckbox = worldBookElement('input', 'category-checkbox');
        categoryCheckbox.type = 'checkbox';
        categoryCheckbox.checked = categoryBooks.every(book => selectedIds.includes(book.id));
        header.append(categoryCheckbox, worldBookElement('span', 'category-name', category), worldBookElement('span', 'category-arrow', '▼'));
        const list = worldBookElement('ul', 'world-book-items-list');
        categoryBooks.forEach(book => {
            const row = worldBookElement('li', 'world-book-select-item');
            const checkbox = worldBookElement('input', 'item-checkbox');
            checkbox.type = 'checkbox';
            checkbox.id = `${idPrefix}-${book.id}`;
            checkbox.value = book.id;
            checkbox.checked = selectedIds.includes(book.id);
            const label = worldBookElement('label', '', book.name);
            label.htmlFor = checkbox.id;
            row.append(checkbox, label);
            list.appendChild(row);
            checkbox.addEventListener('change', () => {
                categoryCheckbox.checked = Array.from(list.querySelectorAll('.item-checkbox')).every(item => item.checked);
            });
        });
        header.addEventListener('click', event => {
            if (event.target.type !== 'checkbox') group.classList.toggle('open');
        });
        categoryCheckbox.addEventListener('change', () => {
            list.querySelectorAll('.item-checkbox').forEach(item => { item.checked = categoryCheckbox.checked; });
        });
        group.append(header, list);
        container.appendChild(group);
    });
}
