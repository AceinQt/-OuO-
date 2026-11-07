// 正则管理只负责目录、编辑和聊天关联；编译/替换/隔离预览由 ChatRegex 负责。
// 说明紧贴本模块维护：字段细节放在各自问号里，总教程只保留入门、迁移边界和使用流程。
AppHelp.register('regex', {
    page: {
        title: '正则怎么用',
        content: String.raw`正则就是「按固定规律查找，再替换」。不用先学会写语法，把想改的句子交给 AI，再用预览检查即可。

【怎么告诉 AI】
可以复制下面这段，把例子换成自己的：

请帮我写用于 JavaScript String.replace 的正则，分别给出「匹配表达式」「替换内容」「标志」三个字段。
需求：把「把XXXX给YYYY了」改成「把XXXXYYYY了」，只删除这个句式中间的「给」，保留前后内容。不跨换行或句子标点匹配。
应当修改：把衣服给洗了。→ 把衣服洗了。
应当修改：把作业给写完了！→ 把作业写完了！
不应修改：请给我一本书。
匹配表达式不要带两侧 /；替换内容用 $1、$2 等 JavaScript 捕获组，不用酒馆宏。请同时给出测试原文与预期结果，并指出可能误改的情况。

【上面这个例子怎么填】
匹配表达式：把([^，。！？；\r\n]+?)给([^，。！？；\r\n]+?)了
替换内容：把$1$2了
标志：g

$1、$2 就是保留匹配到的前后两段。它只认文字规律，不懂句意：「把礼物给你了」也会被改。如果有不想改的句子，也要作为反例交给 AI，不能指望一条正则理解所有中文。

【从 SillyTavern（酒馆）搬过来】
普通 JavaScript 查找与替换通常可以迁移，但不是整份配置直接粘贴。各字段的填写与转换方法见标题旁的问号。
Trim Out、深度、作用位置、提示词选项、脚本命令等酒馆设置不会一起迁移，需要重新适配；这里也不能直接导入酒馆正则 JSON。

【预览和正式使用】
点「预览」，在「普通」页填入测试原文并点「测试替换」，结果框也会显示没有匹配或表达式错误的提示。「HTML」页切入时自动按最新原文测试；只有当前规则勾选「HTML 卡片」且实际命中，才启用交互。切换页签不会清空原文。点击弹窗外的遮罩即可关闭。测试只运行当前这一条，即使还没填名称、还没保存也能试。
确认正例和反例都符合预期后再保存，并在聊天或论坛设置中关联使用。
正则仅处理 AI 消息及 AI 论坛正文，不处理自己发送的消息、手写帖子或评论；自行发测试串不会替换，请用预览或 AI 消息测试。`
    },
    name: {
        title: '名称',
        content: '给这条正则起一个方便辨认的名称，保存时必填。名称只用于管理，不参与匹配。'
    },
    category: {
        title: '类别',
        content: '选择这条正则所属的类别。保存后，在聊天或论坛设置中关联整个类别即可使用其中的规则。私聊还要勾选当前使用的线上/线下模式。'
    },
    pattern: {
        title: '匹配表达式',
        content: String.raw`填写 JavaScript 正则表达式，只填表达式本身，不带两侧 /。

从酒馆迁移时，Find Regex 对应这里。/表达式/gi 要拆成这里的「表达式」与标志字段的「gi」，不能整段粘贴。

它只认文字规律，不懂句意。先用预览测试应当修改和不应修改的例子，避免误改。`
    },
    replacement: {
        title: '替换内容',
        content: String.raw`填写匹配后要换成的内容，支持多行；留空会删除匹配到的部分。
$1、$2 等表示捕获组，$& 表示整个匹配，也可以填写 HTML 模板。

从酒馆迁移时，Replace With 对应这里。$1、$2 可沿用；{{match}} 要改成 $&。{{user}}、{{char}} 等酒馆宏不会自动展开。

需要卡片交互时开启「HTML 卡片」，具体能力见该字段旁的问号。`
    },
    html: {
        title: 'HTML 卡片',
        content: '命中后用卡片代替普通气泡，支持展开、翻面等内联脚本交互。固定为“仅显示替换”，不把模板写入消息或模型上下文。仅对 AI 消息生效。\n\n整段替换结果都放进卡片，未匹配的文字不会被删除；最外层的 HTML 代码围栏会自动去掉。不开启时，HTML 仍只显示静态排版。\n\n请只启用可信模板。卡片在隔离页面中运行，无法读取聊天数据或主页面存储；仅支持内联脚本、样式和 data 资源，不加载外链脚本、图片、样式或字体，也不提供酒馆接口。卡片内输入与展开状态不保存，离开后重建会重置。\n\n【手动修正卡片】\nAI 输出格式有误时，长按消息→编辑→「HTML 块（正则显示）」，在「卡片正则」中选择当前聊天已启用的卡片规则。下方只填写修正后的原始短文本（例如 status 块），不要粘贴完整 HTML 模板。保存前会检查规则是否匹配；保存只记录修正原文和规则 ID，显示时才展开模板。没有可选规则时，请先在聊天中关联并启用 HTML 卡片类别。'
    },
    flags: {
        title: '标志（匹配选项）',
        content: '它是匹配选项，不是规则名称：\ng：一段文字里所有匹配都替换；留空只替换第一处。\ni：忽略英文字母大小写，可与 g 合写为 gi。\nm：让 ^ 和 $ 按每一行的开头、结尾匹配。\ns：让 . 也能匹配换行。它与 m 不是一回事。\n\n一般保留 g；需要别的选项，让 AI 直接给出标志即可。从酒馆迁移时，原规则没带标志就要清空默认 g，才能保留只替换一次的行为。'
    },
    mode: {
        title: '处理方式',
        content: '「修改并保存」会改写适用的新 AI 正文，取消关联也不会还原已经改写的内容。\n\n「仅显示替换」只改变显示，不改写原始消息或模型上下文。\n\n开启「HTML 卡片」后固定使用「仅显示替换」，不能切到「修改并保存」，避免把模板写入消息。'
    },
    order: {
        title: '执行顺序',
        content: '数字小的规则先执行，后面的规则继续处理前面替换后的结果。多条规则可能互相影响；预览只测试当前这一条，关联多个规则后还要检查实际显示效果。'
    }
});
const regexViewState = {
    initialized: false, busy: false, dialogPending: false, categoryId: null, editingId: null, editingCategoryId: null,
    directoryScroll: 0, categoryScrolls: new Map(), writeQueue: Promise.resolve(),
    views: {
        'world-book-screen': { prefix: 'regex-directory', listId: 'regex-category-list', selecting: false, selected: new Set(), cancelPress: null },
        'regex-category-screen': { prefix: 'regex-category', listId: 'regex-rule-list', selecting: false, selected: new Set(), cancelPress: null }
    }
};
window.RegexManager = regexViewState;
const regexElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
};
function getRegexCategories() { return Array.isArray(db.regexCategories) ? db.regexCategories : []; }
function findRegexRule(categories, id) {
    for (const category of categories) {
        const rule = category.rules.find(item => item.id === id);
        if (rule) return { category, rule };
    }
    return null;
}
function queueRegexWrite(action) {
    const result = regexViewState.writeQueue.then(action);
    regexViewState.writeQueue = result.catch(() => {});
    return result;
}
// 每次事务都重读持久化值，不能用旧内存把其他窗口新建的目录覆盖掉。
function writeRegexCategories(mutator, cascade = false) {
    return queueRegexWrite(async () => {
        let categories, result;
        const affected = [];
        const tables = cascade ? [dexieDB.globalSettings, dexieDB.characters, dexieDB.groups] : [dexieDB.globalSettings];
        await dexieDB.transaction('rw', ...tables, async () => {
            const stored = await dexieDB.globalSettings.get('regexCategories');
            categories = normalizeRegexCategories(stored ? stored.value : []);
            if (cascade) {
                // 在移动/删除规则前按旧归属升级绑定，不能等规则移走后再猜原先关联了哪个类别。
                for (const tableName of ['characters', 'groups']) {
                    for (const chat of await dexieDB[tableName].toArray()) {
                        const changes = getRegexBindingChanges(chat, tableName === 'characters' ? 'private' : 'group', categories);
                        if (changes) await dexieDB[tableName].update(chat.id, changes);
                        // 即使磁盘已经规范化，也要发布最新绑定，不能让旧内存漏掉其他窗口的修改。
                        applyRegexBindingChanges(chat, changes);
                        affected.push({ tableName, id: chat.id, changes: getRegexBindingFields(chat) });
                    }
                }
            }
            result = await mutator(categories, affected);
            await dexieDB.globalSettings.put({ key: 'regexCategories', value: categories });
        });
        // 提交成功才发布到内存，失败时包括关联在内都保持原样。
        db.regexCategories = categories;
        for (const item of affected) {
            const chat = (db[item.tableName] || []).find(row => row.id === item.id);
            if (chat) applyRegexBindingChanges(chat, item.changes);
        }
        return result;
    });
}
function regexCategoryName(name, categories, exceptId) {
    const value = String(name || '').trim();
    if (!value) throw new Error('类别名称不能为空');
    if (categories.some(item => item.id !== exceptId && item.name === value)) throw new Error('这个类别已经存在');
    return value;
}
function createRegexCategory(name) {
    return writeRegexCategories(categories => {
        const category = { id: `regex_category_${crypto.randomUUID()}`, name: regexCategoryName(name, categories), rules: [] };
        categories.push(category);
        return category;
    });
}
function renameRegexCategory(id, name) {
    return writeRegexCategories(categories => {
        const category = categories.find(item => item.id === id);
        if (!category) throw new Error('这个类别已被删除');
        category.name = regexCategoryName(name, categories, id);
        return category;
    });
}
function compileRegexDraft(rule) {
    if (!rule.pattern) throw new Error('匹配表达式不能为空');
    return window.ChatRegex?.compileRule ? window.ChatRegex.compileRule(rule) : new RegExp(rule.pattern, rule.flags);
}
function saveRegexRule(values, editingId = null) {
    return writeRegexCategories(categories => {
        const previous = editingId ? findRegexRule(categories, editingId) : null;
        if (editingId && !previous) throw new Error('这个正则已被删除，请返回列表');
        const category = categories.find(item => item.id === values.categoryId);
        if (!category) throw new Error('请选择一个存在的类别');
        const name = String(values.name || '').trim();
        if (!name) throw new Error('正则名称不能为空');
        const order = Number(values.order);
        if (!Number.isFinite(order)) throw new Error('执行顺序必须是有效数字');
        const rule = { id: previous ? previous.rule.id : `regex_rule_${crypto.randomUUID()}`, name,
            pattern: String(values.pattern ?? ''), flags: String(values.flags ?? 'g').trim(), replacement: String(values.replacement ?? ''),
            mode: values.html === true || values.mode === 'display' ? 'display' : 'storage', html: values.html === true, order };
        compileRegexDraft(rule);
        if (previous) previous.category.rules = previous.category.rules.filter(item => item.id !== editingId);
        category.rules.push(rule);
        return { rule, categoryId: category.id };
    }, true);
}
function moveRegexRule(id, direction) {
    return writeRegexCategories(categories => {
        const found = findRegexRule(categories, id);
        if (!found) throw new Error('这个正则已被删除');
        const rules = found.category.rules.slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        const index = rules.findIndex(rule => rule.id === id);
        const next = index + (direction < 0 ? -1 : 1);
        if (next < 0 || next >= rules.length) return;
        [rules[index], rules[next]] = [rules[next], rules[index]];
        // 有并列顺序时也要真正换位；只在当前类别内重新编号，不改别的类别。
        const start = Math.min(...rules.map(rule => rule.order));
        rules.forEach((rule, i) => { rule.order = start + i; });
    });
}
function deleteRegexData(ruleIds = [], categoryIds = []) {
    const requested = new Set(ruleIds), removedCategories = new Set(categoryIds);
    return writeRegexCategories(async (categories, affected) => {
        for (const category of categories) if (removedCategories.has(category.id)) category.rules.forEach(rule => requested.add(rule.id));
        for (const category of categories) category.rules = category.rules.filter(rule => !requested.has(rule.id));
        for (let i = categories.length - 1; i >= 0; i--) if (removedCategories.has(categories[i].id)) categories.splice(i, 1);
        for (const tableName of ['characters', 'groups']) {
            // 持久化聊天可能比内存多一条，或刚更新了资料；只改引用，不整条 put 回旧 metadata。
            for (const chat of await dexieDB[tableName].toArray()) {
                const ids = Array.isArray(chat.regexCategoryIds) ? chat.regexCategoryIds : [];
                const modes = chat.regexCategoryModes && typeof chat.regexCategoryModes === 'object' ? chat.regexCategoryModes : {};
                if (!ids.some(id => removedCategories.has(id)) && !Object.keys(modes).some(id => removedCategories.has(id))) continue;
                const changes = { regexCategoryIds: ids.filter(id => !removedCategories.has(id)) };
                if (tableName === 'characters') changes.regexCategoryModes = Object.fromEntries(Object.entries(modes).filter(([id]) => !removedCategories.has(id)));
                await dexieDB[tableName].update(chat.id, changes);
                affected.push({ tableName, id: chat.id, changes });
            }
        }
    }, true);
}
function saveChatRegexSelection(chatId, chatType, selectedIds, modes = {}) {
    return queueRegexWrite(async () => {
        const tableName = chatType === 'private' ? 'characters' : 'groups';
        let changes, categories;
        await dexieDB.transaction('rw', dexieDB.globalSettings, dexieDB[tableName], async () => {
            const chat = await dexieDB[tableName].get(chatId);
            if (!chat) throw new Error('这个聊天已被删除');
            const stored = await dexieDB.globalSettings.get('regexCategories');
            categories = normalizeRegexCategories(stored ? stored.value : []);
            const valid = new Set(categories.map(category => category.id));
            const ids = [...new Set(selectedIds)].filter(id => valid.has(id));
            changes = { regexCategoryIds: ids, regexRuleIds: undefined, regexRuleModes: undefined };
            if (chatType === 'private') {
                const entries = ids.map(id => [id, { online: modes[id]?.online === true, offline: modes[id]?.offline === true }]).filter(([, value]) => value.online || value.offline);
                changes.regexCategoryIds = entries.map(([id]) => id);
                changes.regexCategoryModes = Object.fromEntries(entries);
            } else if (Object.prototype.hasOwnProperty.call(chat, 'regexCategoryModes')) changes.regexCategoryModes = undefined;
            if (!await dexieDB[tableName].update(chatId, changes)) throw new Error('聊天保存失败，请重试');
        });
        db.regexCategories = categories;
        const chat = (db[tableName] || []).find(item => item.id === chatId);
        if (chat) applyRegexBindingChanges(chat, changes);
    });
}
function saveRegexDirectoryScroll() { regexViewState.directoryScroll = document.getElementById('wb-regex-panel').scrollTop; }
function renderRegexCategoryList() {
    const list = document.getElementById('regex-category-list');
    list.replaceChildren();
    for (const category of getRegexCategories()) {
        const row = regexElement('li', 'draft-card-item regex-category-card'); row.dataset.categoryId = category.id;
        const icon = regexElement('div', 'draft-card-icon-wrapper regex-card-icon', '.*');
        const details = regexElement('div', 'draft-card-content');
        details.append(regexElement('div', 'draft-card-title', category.name), regexElement('div', 'draft-card-subtitle', `包含 ${category.rules.length} 个正则`));
        row.append(icon, details); list.appendChild(row);
    }
    document.getElementById('no-regex-categories').hidden = getRegexCategories().length > 0;
    refreshRegexSelectUI('world-book-screen');
    document.getElementById('wb-regex-panel').scrollTop = regexViewState.directoryScroll;
}
function regexModeLabel(rule) { return rule.mode === 'display' ? '仅显示替换' : '修改并保存'; }
function renderRegexRuleList() {
    const category = getRegexCategories().find(item => item.id === regexViewState.categoryId);
    const list = document.getElementById('regex-rule-list'); list.replaceChildren();
    document.getElementById('regex-category-title').textContent = category?.name || '正则类别';
    const rules = (category?.rules || []).slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    for (const [index, rule] of rules.entries()) {
        const row = regexElement('li', 'draft-card-item regex-rule-card'); row.dataset.ruleId = rule.id;
        const icon = regexElement('div', 'wb-entry-icon');
        // 类别内规则与世界书条目共用 Lucide 单本书，目录首页的正则符号保持不变。
        icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-book preview-icon" aria-hidden="true"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>';
        const details = regexElement('div', 'draft-card-content regex-rule-open');
        details.append(regexElement('div', 'draft-card-title', rule.name), regexElement('div', 'draft-card-subtitle', `${regexModeLabel(rule)}${rule.html ? ' · HTML 卡片' : ''} · 顺序 ${rule.order}`));
        const controls = regexElement('div', 'regex-rule-controls');
        for (const [direction, text] of [[-1, '↑'], [1, '↓']]) {
            const button = regexElement('button', 'regex-order-btn', text); button.type = 'button'; button.disabled = index === (direction < 0 ? 0 : rules.length - 1);
            button.setAttribute('aria-label', `${direction < 0 ? '上移' : '下移'} ${rule.name}`);
            button.addEventListener('click', event => { event.stopPropagation(); if (!regexViewState.views['regex-category-screen'].selecting) runRegexUI(async () => { await moveRegexRule(rule.id, direction); renderRegexRuleList(); }, '顺序已更新'); });
            controls.appendChild(button);
        }
        row.append(icon, details, controls); list.appendChild(row);
    }
    document.getElementById('no-regex-rules').hidden = rules.length > 0;
    refreshRegexSelectUI('regex-category-screen');
    document.querySelector('#regex-category-screen .content').scrollTop = regexViewState.categoryScrolls.get(regexViewState.categoryId) || 0;
}
function openRegexCategory(id) { if (regexViewState.busy) return; worldBookViewState.featureTab = 'regex'; regexViewState.categoryId = id; navigateTo('regex-category-screen'); }
function openRegexEditor(id = null) {
    if (regexViewState.busy) return;
    const found = id ? findRegexRule(getRegexCategories(), id) : null;
    if (id && !found) return;
    regexViewState.editingId = id;
    regexViewState.editingCategoryId = found?.category.id || regexViewState.categoryId;
    const rule = found?.rule || { name: '', pattern: '', replacement: '', flags: 'g', mode: 'storage', order: Math.max(-1, ...getRegexCategories().flatMap(category => category.rules.map(item => item.order))) + 1 };
    const select = document.getElementById('regex-category'); select.replaceChildren();
    for (const category of getRegexCategories()) { const option = regexElement('option', '', category.name); option.value = category.id; select.appendChild(option); }
    select.value = regexViewState.editingCategoryId;
    for (const field of ['name', 'pattern', 'replacement', 'flags', 'mode', 'order']) document.getElementById(`regex-${field}`).value = rule[field];
    document.getElementById('regex-html').checked = rule.html === true;
    syncRegexHtmlMode();
    document.getElementById('edit-regex-title').textContent = id ? '编辑正则' : '创建正则';
    for (const field of ['regex-test-original', 'regex-test-output']) document.getElementById(field).value = '';
    document.getElementById('regex-test-output').placeholder = '没有匹配';
    document.getElementById('regex-test-preview').replaceChildren();
    closeRegexPreview();
    setRegexPreviewTab('text');
    navigateTo('edit-regex-screen');
}
function syncRegexHtmlMode() {
    const html = document.getElementById('regex-html').checked;
    const mode = document.getElementById('regex-mode');
    if (html) mode.value = 'display';
    mode.disabled = html;
}
function readRegexDraft() {
    syncRegexHtmlMode();
    return { categoryId: document.getElementById('regex-category').value, name: document.getElementById('regex-name').value,
        pattern: document.getElementById('regex-pattern').value, replacement: document.getElementById('regex-replacement').value,
        flags: document.getElementById('regex-flags').value.trim(), mode: document.getElementById('regex-mode').value,
        html: document.getElementById('regex-html').checked, order: document.getElementById('regex-order').value };
}
function setRegexBusy(busy) {
    regexViewState.busy = busy;
    for (const id of ['add-regex-category-btn', 'add-regex-rule-btn', 'rename-regex-category-btn', 'save-regex-rule-btn', 'preview-regex-rule-btn', 'test-regex-rule-btn']) document.getElementById(id).disabled = busy;
    for (const view of Object.values(regexViewState.views)) document.getElementById(view.listId).classList.toggle('regex-busy', busy);
    Object.keys(regexViewState.views).forEach(refreshRegexSelectUI);
}
async function runRegexUI(action, success) {
    if (regexViewState.busy) return;
    setRegexBusy(true);
    try { const result = await action(); if (result !== false && success) showToast(success); return result; }
    catch (error) { console.error('正则操作失败:', error); showToast(error.message || '保存失败，请重试'); }
    finally { setRegexBusy(false); }
}
async function awaitRegexDialog(action) {
    regexViewState.dialogPending = true;
    try { return await action(); } finally { regexViewState.dialogPending = false; }
}
// 页面返回与遮罩、系统返回共用取消入口，必须结束 AppUI 等待才能释放忙锁。
function cancelRegexDialog(overlay) {
    if (!regexViewState.dialogPending || !overlay || overlay.id !== 'app-global-dialog') return false;
    if (typeof AppUI.dismiss === 'function') return AppUI.dismiss(overlay);
    const cancel = overlay.querySelector('.btn-neutral');
    if (!cancel) return false;
    cancel.click();
    return true;
}
function consumeRegexBack() {
    const active = document.querySelector('.screen.active');
    if (!active || (!['regex-category-screen', 'edit-regex-screen'].includes(active.id) && !(active.id === 'world-book-screen' && worldBookViewState.featureTab === 'regex'))) return false;
    if (cancelRegexDialog(document.getElementById('app-global-dialog'))) return true;
    if (document.getElementById('regex-preview-modal').classList.contains('visible')) { closeRegexPreview(); return true; }
    if (regexViewState.busy) return true;
    if (!regexViewState.views[active.id]?.selecting) return false;
    exitRegexMultiSelectMode(active.id);
    return true;
}
function setRegexPreviewTab(tab) {
    for (const name of ['text', 'html']) {
        const active = name === tab;
        const button = document.getElementById(`regex-preview-${name}-tab`);
        button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
        document.getElementById(`regex-preview-${name}-panel`).hidden = !active;
    }
    // HTML 页没有测试按钮，切入时用最新原文重算；面板先显示，避免 iframe 在隐藏容器里量到零宽度。
    document.getElementById('regex-test-preview').replaceChildren();
    if (tab === 'html' && document.getElementById('regex-preview-modal').classList.contains('visible')) testRegexDraft();
}
function openRegexPreview() {
    if (regexViewState.busy) return;
    document.getElementById('regex-preview-modal').classList.add('visible');
    testRegexDraft();
    const tab = document.getElementById('regex-preview-text-panel').hidden ? 'html' : 'text';
    document.getElementById(`regex-preview-${tab}-tab`).focus();
}
function closeRegexPreview() {
    const modal = document.getElementById('regex-preview-modal');
    const wasOpen = modal.classList.contains('visible');
    modal.classList.remove('visible');
    document.getElementById('regex-test-preview').replaceChildren();
    if (wasOpen) document.getElementById('preview-regex-rule-btn').focus();
}
function testRegexDraft() {
    const preview = document.getElementById('regex-test-preview'); preview.replaceChildren();
    const output = document.getElementById('regex-test-output');
    output.value = ''; output.placeholder = '没有匹配';
    try {
        const rule = readRegexDraft(); compileRegexDraft(rule);
        const original = document.getElementById('regex-test-original').value;
        const result = window.ChatRegex.replaceText(original, [rule]);
        if (result.errors.length) throw new Error(result.errors[0].message);
        // 状态收进结果框，不把提示拼到结果里；空替换也要和「没有匹配」区分。
        output.value = result.matched ? result.text : '';
        output.placeholder = result.matched ? '匹配成功，替换结果为空' : '没有匹配';
        if (!document.getElementById('regex-preview-html-panel').hidden && document.getElementById('regex-preview-modal').classList.contains('visible')) {
            window.ChatRegex.renderHtmlPreview(preview, result.text, { interactive: result.html === true });
        }
    } catch (error) { output.placeholder = `表达式无效：${error.message}`; }
}
// 关联只到类别，不提供子规则展开或半选；空类别先关联，之后新增规则自动跟随。
function renderRegexSelection(container, chat, chatType) {
    const privateChat = chatType === 'private'; container.replaceChildren(); container.classList.toggle('wb-mode-list', privateChat);
    if (privateChat) { const heading = regexElement('li', 'wb-mode-heading'); heading.append(regexElement('span', '', '正则类别'), regexElement('span', '', '线上'), regexElement('span', '', '线下')); container.appendChild(heading); }
    const binding = getChatRegexBinding(chat, chatType, getRegexCategories());
    for (const category of getRegexCategories()) {
        const row = regexElement('li', privateChat ? 'wb-mode-row regex-binding-row' : 'regex-binding-row regex-group-row'); row.dataset.categoryId = category.id;
        const name = regexElement('div', 'wb-mode-name'); name.append(regexElement('span', '', category.name), regexElement('small', 'wb-mode-type', `${category.rules.length} 个正则`)); row.appendChild(name);
        for (const mode of (privateChat ? ['online', 'offline'] : ['group'])) {
            const cell = regexElement('label', 'wb-mode-cell'); const input = regexElement('input', 'regex-binding-checkbox wb-mode-checkbox');
            input.type = 'checkbox'; input.dataset.mode = mode;
            input.checked = binding.ids.includes(category.id) && (!privateChat || binding.modes[category.id]?.[mode] === true);
            input.setAttribute('aria-label', `${category.name} · ${mode === 'offline' ? '线下' : privateChat ? '线上' : '群聊'}`);
            cell.appendChild(input); row.appendChild(cell);
        }
        container.appendChild(row);
    }
    if (!getRegexCategories().length) container.appendChild(regexElement('li', 'placeholder-text', '暂无正则类别，请先在世界书左栏的正则页创建'));
}
function openChatRegexSelection(chatId, chatType) {
    if (document.getElementById('save-regex-selection-btn').disabled) return;
    const chat = (chatType === 'private' ? db.characters : db.groups).find(item => item.id === chatId);
    if (!chat) return;
    const list = document.getElementById('regex-selection-list'); list.dataset.chatId = chatId; list.dataset.chatType = chatType;
    renderRegexSelection(list, chat, chatType); document.getElementById('regex-selection-modal').classList.add('visible');
}
function readChatRegexSelection(container) {
    const modes = Object.create(null), ids = [];
    for (const row of container.querySelectorAll('.regex-binding-row')) {
        const inputs = Array.from(row.querySelectorAll('.regex-binding-checkbox'));
        if (container.dataset.chatType === 'private') {
            modes[row.dataset.categoryId] = Object.fromEntries(inputs.map(input => [input.dataset.mode, input.checked]));
            if (inputs.some(input => input.checked)) ids.push(row.dataset.categoryId);
        } else if (inputs.some(input => input.checked)) ids.push(row.dataset.categoryId);
    }
    return { ids, modes };
}
async function confirmChatRegexSelection() {
    const button = document.getElementById('save-regex-selection-btn'); if (button.disabled) return;
    const list = document.getElementById('regex-selection-list'); const { chatId, chatType } = list.dataset; const selection = readChatRegexSelection(list);
    button.disabled = true;
    try {
        await saveChatRegexSelection(chatId, chatType, selection.ids, selection.modes);
        if (list.dataset.chatId === chatId && list.dataset.chatType === chatType) document.getElementById('regex-selection-modal').classList.remove('visible');
        if (typeof currentChatId !== 'undefined' && currentChatId === chatId && typeof renderMessages === 'function') renderMessages(false, true);
        showToast('正则关联已更新');
    } catch (error) { console.error('正则关联保存失败:', error); showToast(error.message || '保存失败，请重试'); }
    finally { button.disabled = false; }
}
// 目录和条目各自保存选择集；共享页面的顶栏/X 只由当前功能更新，不能被隐藏 tab 清理覆盖。
function refreshRegexSelectUI(screenId) {
    const view = regexViewState.views[screenId];
    const directory = screenId === 'world-book-screen';
    const activeTab = !directory || worldBookViewState.featureTab === 'regex';
    const screen = document.getElementById(screenId);
    const rows = Array.from(document.getElementById(view.listId).children);
    const keyOf = row => directory ? row.dataset.categoryId : row.dataset.ruleId;
    const valid = new Set(rows.map(keyOf));
    for (const key of view.selected) if (!valid.has(key)) view.selected.delete(key);
    if (activeTab) screen.classList.toggle('wb-selecting', view.selecting);
    document.getElementById(`${view.prefix}-header`).style.display = view.selecting ? 'none' : '';
    const header = document.getElementById(`${view.prefix}-select-header`);
    if (directory) header.hidden = !activeTab;
    header.style.display = view.selecting ? '' : 'none';
    header.querySelector('.wb-select-count').textContent = `选择 ${view.selected.size} ${directory ? '个类别' : '个正则'}`;
    header.querySelector('.wb-select-delete').disabled = regexViewState.busy || !view.selected.size;
    if (activeTab) screen.querySelector('.wb-select-cancel').disabled = regexViewState.busy;
    rows.forEach(row => {
        const selected = view.selected.has(keyOf(row));
        row.classList.toggle('is-selecting', view.selecting);
        row.classList.toggle('selected', selected);
        row.setAttribute('aria-selected', String(selected));
    });
}
function enterRegexMultiSelectMode(screenId, key) {
    const view = regexViewState.views[screenId];
    if (!view || view.selecting || regexViewState.busy || !document.getElementById(screenId).classList.contains('active')) return;
    if (screenId === 'world-book-screen' && worldBookViewState.featureTab !== 'regex') return;
    view.selecting = true;
    view.selected.clear();
    view.selected.add(key);
    refreshRegexSelectUI(screenId);
}
function exitRegexMultiSelectMode(screenId) {
    const view = regexViewState.views[screenId];
    if (!view) return;
    view.selecting = false;
    view.selected.clear();
    view.cancelPress?.();
    refreshRegexSelectUI(screenId);
}
async function deleteSelectedRegexData(screenId) {
    const view = regexViewState.views[screenId];
    if (!view || !view.selecting || !view.selected.size || regexViewState.busy) return;
    const directory = screenId === 'world-book-screen';
    const selected = [...view.selected];
    const count = getRegexCategories().filter(category => selected.includes(category.id)).reduce((sum, category) => sum + category.rules.length, 0);
    const message = directory
        ? `确定删除选中的 ${selected.length} 个类别及其中的 ${count} 个正则？聊天中的关联也会移除，此操作不可撤销。`
        : `确定删除选中的 ${selected.length} 个正则？类别关联会保留，此操作不可撤销。`;
    await runRegexUI(async () => {
        if (!await awaitRegexDialog(() => AppUI.confirm(message, directory ? '删除类别' : '删除正则', '删除', '取消'))) return false;
        await deleteRegexData(directory ? [] : selected, directory ? selected : []);
        exitRegexMultiSelectMode(screenId);
        if (directory) renderRegexCategoryList();
        else renderRegexRuleList();
    }, directory ? '所选类别及其中正则已删除' : '所选正则已删除');
}
function bindRegexListEvents(screenId) {
    const view = regexViewState.views[screenId];
    const directory = screenId === 'world-book-screen';
    const list = document.getElementById(view.listId);
    const selector = directory ? '.regex-category-card' : '.regex-rule-card';
    const keyOf = row => directory ? row.dataset.categoryId : row.dataset.ruleId;
    const isVisible = () => document.getElementById(screenId).classList.contains('active') && (!directory || worldBookViewState.featureTab === 'regex');
    let timer = null, start = null, suppressClick = false;
    const clearPress = () => { clearTimeout(timer); timer = null; start = null; };
    view.cancelPress = () => { clearPress(); suppressClick = false; };
    list.addEventListener('pointerdown', event => {
        view.cancelPress();
        if (!isVisible() || regexViewState.busy || view.selecting || event.button !== 0 || event.isPrimary === false || event.target.closest('.regex-rule-controls')) return;
        const row = event.target.closest(selector);
        if (!row) return;
        start = { x: event.clientX, y: event.clientY };
        timer = setTimeout(() => { suppressClick = true; enterRegexMultiSelectMode(screenId, keyOf(row)); }, 500);
    });
    list.addEventListener('pointermove', event => {
        if (start && (Math.abs(event.clientX - start.x) > 10 || Math.abs(event.clientY - start.y) > 10)) clearPress();
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) list.addEventListener(type, clearPress);
    list.addEventListener('contextmenu', event => {
        const row = event.target.closest(selector);
        if (!row || !isVisible() || event.target.closest('.regex-rule-controls')) return;
        event.preventDefault();
        // 原生长按菜单可能晚于计时器，重复到达只抑制 click，不反选已经选中的条目。
        suppressClick = true;
        clearPress();
        enterRegexMultiSelectMode(screenId, keyOf(row));
    });
    list.addEventListener('click', event => {
        const row = event.target.closest(selector);
        if (!row || !isVisible() || event.target.closest('.regex-rule-controls')) return;
        if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
        if (regexViewState.busy) return;
        const key = keyOf(row);
        if (view.selecting) {
            if (view.selected.has(key)) view.selected.delete(key);
            else view.selected.add(key);
            refreshRegexSelectUI(screenId);
        } else if (directory) openRegexCategory(key);
        else openRegexEditor(key);
    });
    document.getElementById(screenId).querySelector('.wb-select-cancel').addEventListener('click', () => {
        if (isVisible() && !regexViewState.busy) exitRegexMultiSelectMode(screenId);
    });
    document.getElementById(`${view.prefix}-select-header`).querySelector('.wb-select-delete').addEventListener('click', () => deleteSelectedRegexData(screenId));
    const scroller = directory ? document.getElementById('wb-regex-panel') : document.querySelector(`#${screenId} .content`);
    scroller.addEventListener('scroll', () => {
        if (!isVisible()) return;
        if (directory) saveRegexDirectoryScroll();
        else regexViewState.categoryScrolls.set(regexViewState.categoryId, scroller.scrollTop);
        clearPress();
    }, { passive: true });
}
function setupRegexApp() {
    if (regexViewState.initialized) return; regexViewState.initialized = true;
    Object.keys(regexViewState.views).forEach(bindRegexListEvents);
    document.getElementById('add-regex-category-btn').addEventListener('click', () => runRegexUI(async () => { const name = await awaitRegexDialog(() => AppUI.prompt('输入新的类别名称', '', '新增正则类别')); if (name === null) return false; await createRegexCategory(name); renderRegexCategoryList(); }, '类别已创建'));
    document.getElementById('add-regex-rule-btn').addEventListener('click', () => openRegexEditor());
    document.getElementById('rename-regex-category-btn').addEventListener('click', () => runRegexUI(async () => { const category = getRegexCategories().find(item => item.id === regexViewState.categoryId); if (!category) throw new Error('类别已删除'); const name = await awaitRegexDialog(() => AppUI.prompt('输入类别名称', category.name, '重命名类别')); if (name === null) return false; await renameRegexCategory(category.id, name); renderRegexRuleList(); }, '类别已重命名'));
    document.getElementById('edit-regex-form').addEventListener('submit', async event => {
        event.preventDefault(); let saved = false;
        await runRegexUI(async () => { const result = await saveRegexRule(readRegexDraft(), regexViewState.editingId); regexViewState.editingCategoryId = result.categoryId; saved = true; }, '正则已保存');
        if (saved) document.querySelector('#edit-regex-screen .back-btn').click();
    });
    document.querySelector('#edit-regex-screen .back-btn').addEventListener('click', () => { if (!regexViewState.busy) regexViewState.categoryId = regexViewState.editingCategoryId; });
    document.getElementById('regex-html').addEventListener('change', syncRegexHtmlMode);
    document.getElementById('regex-help-btn').addEventListener('click', () => AppHelp.show('regex', 'page'));
    document.getElementById('preview-regex-rule-btn').addEventListener('click', openRegexPreview);
    const previewModal = document.getElementById('regex-preview-modal');
    previewModal.addEventListener('click', event => { if (event.target === previewModal) closeRegexPreview(); });
    previewModal.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRegexPreview(); }
    });
    for (const tab of ['text', 'html']) {
        const button = document.getElementById(`regex-preview-${tab}-tab`);
        button.addEventListener('click', () => setRegexPreviewTab(tab));
        button.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const target = event.key === 'Home' ? 'text' : event.key === 'End' ? 'html' : tab === 'text' ? 'html' : 'text';
            setRegexPreviewTab(target); document.getElementById(`regex-preview-${target}-tab`).focus();
        });
    }
    document.getElementById('test-regex-rule-btn').addEventListener('click', testRegexDraft);
    document.getElementById('save-regex-selection-btn').addEventListener('click', confirmChatRegexSelection);
    document.getElementById('cancel-regex-selection-btn').addEventListener('click', () => { if (!document.getElementById('save-regex-selection-btn').disabled) document.getElementById('regex-selection-modal').classList.remove('visible'); });
    window._screenLeaveHooks = window._screenLeaveHooks || {};
    const previousEditorLeave = window._screenLeaveHooks['edit-regex-screen'];
    window._screenLeaveHooks['edit-regex-screen'] = target => { closeRegexPreview(); previousEditorLeave?.(target); };
    for (const id of Object.keys(regexViewState.views)) {
        const previous = window._screenLeaveHooks[id];
        window._screenLeaveHooks[id] = target => {
            // 离页时容器还可测量；先保存可见面板位置，再取消计时器与选择集。
            if (id === 'world-book-screen') {
                if (worldBookViewState.featureTab === 'regex') saveRegexDirectoryScroll();
            } else regexViewState.categoryScrolls.set(regexViewState.categoryId, document.querySelector(`#${id} .content`).scrollTop);
            previous?.(target);
            exitRegexMultiSelectMode(id);
        };
    }
}
