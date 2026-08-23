// ============================================================
// github_repos.js — GitHub 仓库设置页
// ============================================================
// 凭据归一化、请求、错误转人话、连通性检查都在 js/api/github_repo_api.js，
// 本文件只管这个 screen 的表单读写。
//
// 页面分「仓库配置」和「用途配置」两段，对应两层数据：
//   db.githubRepos    —— 仓库定义（含令牌）。同一个仓库能被多个用途共用
//   db.githubBindings —— 用途绑定（哪个功能用哪个仓库、存哪个目录）
// 拆开的理由见 github_repo_api.js 顶部：仓库是共享资源，凭据不该跟着用途复制好几份。
//
// ★ 用途行是按 GITHUB_PURPOSES 动态渲染的，加一个用途不用改这个文件。
//
// ★ 版式和说明文字：版式沿用 notification-settings-screen 的
//   settings-group-title + settings-card（类在 css/pages/settings/settings_screen.css），
//   说明一律不铺在页面上，注册到 AppHelp（js/core/utils.js）后由问号弹出。
//
// 对外符号：
//   openGithubReposScreen（main.js 的 pageActions 调用）
//   refreshGithubReposSummary（设置页那一行的状态文案）
// ============================================================

// 页面上的编辑草稿。点保存前所有改动只在这里，不碰 db。
let _ghDraft = null;
let _ghLoadedRepoId = '';

// ============================================================
// 问号说明
// ============================================================
// 这页原本把注意事项全铺在页面上，结果说明比设置项还长。现在一律收进问号：
//   header 右上角 → page（整页）
//   「仓库配置」旁 → repo
//   「用途配置」旁 → purpose
// 弹窗机制是公共的，在 js/core/utils.js 的 AppHelp 里；这里只放文案。
//
// ★ 正文经 AppUI.alert → innerText 输出，换行只能用 \n，写 <br> 会原样显示。
// ★ purpose 那条用函数而不是字符串：各用途的说明来自 GITHUB_PURPOSES，
//   点开时才拼，这样加/改用途不用回来同步文案。
AppHelp.register('github', {
    page: {
        title: '关于 GitHub 仓库',
        content:
            '这页把「仓库」和「用途」分成两层：\n'
            + '仓库配置里存的是一个个仓库和它的令牌，用途配置只是挑一个仓库来用。'
            + '所以同一个仓库能被多个用途共用，换令牌也只用改一处。\n\n'
            + '【令牌放在哪】\n'
            + '令牌明文存在这台设备的浏览器里，也会一起进备份文件——备份必须含令牌，'
            + '否则换设备恢复后已归档的旧内容会因为拿不到凭据而读不回来。'
            + '所以请用细粒度 PAT 且只给目标仓库的写权限，并且别把备份文件随手发给别人。\n\n'
            + '【改绑定会不会弄丢旧内容】\n'
            + '不会。已归档的每条内容都记着它当时用的仓库，之后换绑定或加新仓库都不影响它。'
            + '但删掉仓库定义会连令牌一起没，那些旧内容就读不到了——删除前会提示。\n\n'
            + '改完记得点底部的「保存仓库配置」。'
    },
    repo: {
        title: '仓库配置说明',
        content:
            '这一段定义仓库和令牌，下面的用途只是引用它。同一个仓库可以被多个用途共用。\n\n'
            + '【选择仓库】\n'
            + '右边三个按钮依次是：新增一个空仓库、以当前仓库为模板复制一份、删除当前仓库。'
            + '切换下拉时当前填的内容会自动留住，不会丢。\n\n'
            + '【备注名】\n'
            + '只给你自己看，用途配置里靠它区分是哪个仓库。\n\n'
            + '【访问令牌】\n'
            + '建议用细粒度 PAT（Fine-grained token），权限只勾这一个仓库的 Contents 读写。\n\n'
            + '【用户名 / 仓库名】\n'
            + 'GitHub 上的账号名和仓库名。建议单独建一个私有仓库专门存这些内容。\n\n'
            + '【分支】\n'
            + '一般填 main。填完点「测试连接」验一下连通性和写权限，别等到归档时才发现填错。'
    },
    purpose: {
        title: '用途配置说明',
        content: () => {
            const items = (typeof GITHUB_PURPOSES !== 'undefined' ? GITHUB_PURPOSES : [])
                .map(p => `【${p.label}】\n${p.hint || '（暂无说明）'}`)
                .join('\n\n');
            return '每项用途挑一个上面定义好的仓库。选「不使用」＝该内容只留在本机，'
                + '清缓存或换设备就没了。\n\n'
                + '存放目录是定死的，不用填也改不了：填错了内容会散在奇怪的地方，'
                + '而且改目录会让按旧目录归档的内容找不回来。\n\n'
                + items;
        }
    }
});

function _ghVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function _ghSetVal(id, v) { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }

function _ghSetButtonLoading(id, loading) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('loading', !!loading);
    btn.disabled = !!loading;
}

/** 测试结果块。state: 'ok' | 'error' | 'info' */
function _ghSetTestResult(message, state = 'info') {
    const el = document.getElementById('gh-test-result');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-error', state === 'error');
    el.classList.toggle('is-ok', state === 'ok');
    el.hidden = !message;
}

// ============================================================
// 仓库定义段
// ============================================================

function _ghPopulateRepoSelect(selectedId) {
    const select = document.getElementById('gh-repo-select');
    if (!select || !_ghDraft) return;
    select.innerHTML = '';
    if (!_ghDraft.repos.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '— 还没有仓库，点 + 新增 —';
        select.appendChild(option);
    }
    _ghDraft.repos.forEach(repo => {
        const option = document.createElement('option');
        option.value = repo.id;
        const where = describeGithubRepo(repo);
        option.textContent = where ? `${repo.name}（${where}）` : repo.name;
        select.appendChild(option);
    });
    select.value = selectedId || _ghLoadedRepoId || (_ghDraft.repos[0] || {}).id || '';
}

/** 从表单读出当前正在编辑的那个仓库（不落库，只取值） */
function _ghReadRepoFromForm() {
    return _normalizeGithubRepo({
        id: _ghLoadedRepoId,
        name: _ghVal('gh-repo-name').trim(),
        token: _ghVal('gh-repo-token').trim(),
        username: _ghVal('gh-repo-username').trim(),
        repo: _ghVal('gh-repo-repo').trim(),
        branch: _ghVal('gh-repo-branch').trim()
    });
}

function _ghApplyRepoToForm(repoId) {
    const repo = _ghDraft && _ghDraft.repos.find(r => r.id === repoId);
    _ghLoadedRepoId = repo ? repo.id : '';
    _ghSetVal('gh-repo-name', repo ? repo.name : '');
    _ghSetVal('gh-repo-token', repo ? repo.token : '');
    _ghSetVal('gh-repo-username', repo ? repo.username : '');
    _ghSetVal('gh-repo-repo', repo ? repo.repo : '');
    _ghSetVal('gh-repo-branch', repo ? repo.branch : GITHUB_BRANCH_DEFAULT);
    _ghPopulateRepoSelect(_ghLoadedRepoId);
    _ghSetTestResult('');
}

/**
 * 把表单上的编辑写回草稿。切仓库、新增、删除、保存前都要先调，
 * 否则用户改完某个仓库直接切走，改动就丢了。
 */
function _ghSyncRepoFromForm() {
    if (!_ghDraft || !_ghLoadedRepoId) return;
    const index = _ghDraft.repos.findIndex(r => r.id === _ghLoadedRepoId);
    if (index < 0) return;
    const edited = _ghReadRepoFromForm();
    const old = _ghDraft.repos[index];
    _ghDraft.repos[index] = { ...edited, name: edited.name || old.name };
}

function _ghAddRepo(copyCurrent = false) {
    _ghSyncRepoFromForm();
    const source = copyCurrent && _ghDraft.repos.find(r => r.id === _ghLoadedRepoId);
    const baseName = source ? source.name : '仓库';
    const taken = _ghDraft.repos.map(r => r.name);
    let suffix = source ? 2 : 1;
    let name = `${baseName}${suffix}`;
    while (taken.includes(name)) name = `${baseName}${++suffix}`;
    const repo = source
        ? { ...source, id: _newGithubRepoId(), name }
        : _normalizeGithubRepo({ id: _newGithubRepoId(), name });
    _ghDraft.repos.push(repo);
    _ghApplyRepoToForm(repo.id);
    _ghRenderPurposes();
}

async function _ghDeleteRepo() {
    if (!_ghLoadedRepoId) return showToast('还没有可删除的仓库');
    const repo = _ghDraft.repos.find(r => r.id === _ghLoadedRepoId);
    if (!repo) return;

    // 删掉仓库定义 = 连令牌一起没，引用它的已归档内容会读不回来。先说清楚代价。
    const usedBy = GITHUB_PURPOSES
        .filter(p => _ghDraft.bindings[p.key] && _ghDraft.bindings[p.key].repoId === repo.id)
        .map(p => p.label);
    const archived = await _ghCountArchivedIn(repo.id);

    let warn = '';
    if (usedBy.length) warn += `\n\n「${usedBy.join('、')}」正在用它，删除后会变成未绑定。`;
    if (archived.total > 0) {
        const details = [];
        if (archived.voice > 0) details.push(`${archived.voice} 条语音`);
        if (archived.image > 0) details.push(`${archived.image} 张图片`);
        warn += `\n\n已经有 ${details.join('、')}归档在这个仓库里，`
            + '删掉它的令牌之后这些内容就读不回来了（GitHub 上的文件还在，重新添加同一个仓库即可恢复访问）。';
    }

    const ok = await AppUI.confirm(
        `确定删除仓库「${repo.name}」？${warn}`, '删除仓库', '删除', '取消');
    if (!ok) return;

    _ghDraft.repos = _ghDraft.repos.filter(r => r.id !== repo.id);
    // 引用它的绑定一起清掉，避免留下指向不存在仓库的悬空 id
    // （enabled 是从 repoId 派生的，清了 repoId 它自然就是 false）
    GITHUB_PURPOSES.forEach(p => {
        if (_ghDraft.bindings[p.key] && _ghDraft.bindings[p.key].repoId === repo.id) {
            _ghDraft.bindings[p.key].repoId = '';
            _ghDraft.bindings[p.key].enabled = false;
        }
    });
    _ghApplyRepoToForm((_ghDraft.repos[0] || {}).id);
    _ghRenderPurposes();
}

/** 分别统计语音和图片对仓库的历史引用，删除前必须把两类风险都说清楚。 */
async function _ghCountArchivedIn(repoId) {
    const [voice, image] = await Promise.all([
        typeof countVoiceClipsInRepo === 'function'
            ? Promise.resolve().then(() => countVoiceClipsInRepo(repoId)).catch(() => 0)
            : 0,
        typeof countImageMessagesInRepo === 'function'
            ? Promise.resolve().then(() => countImageMessagesInRepo(repoId)).catch(() => 0)
            : 0
    ]);
    return { voice: Number(voice) || 0, image: Number(image) || 0, total: (Number(voice) || 0) + (Number(image) || 0) };
}

async function testGithubRepoConnection() {
    const cfg = _ghReadRepoFromForm();
    if (!cfg.token || !cfg.username || !cfg.repo) {
        return showToast('请先填全令牌、用户名和仓库名');
    }
    _ghSetButtonLoading('gh-test-btn', true);
    _ghSetTestResult('正在连接 GitHub…', 'info');
    try {
        const result = await checkGithubRepo(cfg);
        _ghSetTestResult(result.message, result.ok ? 'ok' : 'error');
    } catch (error) {
        // checkGithubRepo 自己不抛，走到这儿说明是意料外的错
        _ghSetTestResult(`测试失败：${error.message}`, 'error');
    } finally {
        _ghSetButtonLoading('gh-test-btn', false);
    }
}

// ============================================================
// 用途绑定段
// ============================================================

// 用途行左边的小图标。纯装饰，按 key 取，取不到就落回默认那个 ——
// 所以往 GITHUB_PURPOSES 加新用途依然不用回来改这个文件。
// 图标放在页面层而不是 GITHUB_PURPOSES 里，是因为 js/api/ 那层不该认识长什么样。
const _GH_PURPOSE_ICONS = {
    backup: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>',
    voice: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>'
};
const _GH_PURPOSE_ICON_FALLBACK = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>';

/**
 * 按 GITHUB_PURPOSES 渲染用途行。每行就是「用途名 + 一个仓库下拉」，没别的。
 *
 * ★ 刻意只有一个 select：
 *   · 没有启用开关 —— 下拉里的「不使用」就是关闭状态。两个控件表达同一件事
 *     就会有互相矛盾的可能（绑了仓库但开关是关的）
 *   · 没有目录输入框 —— 目录在 GITHUB_PURPOSES 里定死了
 *   · 没有「每日自动备份」—— 那个归「存储备份 > 云端同步」弹框管，
 *     两个地方都能改同一个开关就是重复
 *   这样"一个用途只对应一个仓库"这件事，看一眼就能确认，不需要猜。
 *
 * ★ 行内不再写 hint —— 各用途的说明搬进了「用途配置」旁边的问号（见文件顶部
 *   AppHelp.register）。文案还是从 GITHUB_PURPOSES 来，只是换了个地方显示。
 *
 * 每次仓库列表变动都要重渲染，否则下拉里还留着已删掉的仓库。
 */
function _ghRenderPurposes() {
    const host = document.getElementById('gh-purpose-list');
    if (!host || !_ghDraft) return;
    host.innerHTML = '';

    GITHUB_PURPOSES.forEach(p => {
        const binding = _ghDraft.bindings[p.key] || {};

        // 版式跟消息通知页的"带输入框的设置项"一致：标题一行，控件占满下一行。
        // 下拉里的文案可能是「语音仓库（user/repo）」这种长串，塞不进右侧窄栏。
        const row = document.createElement('div');
        row.className = 'settings-item column-layout';

        const header = document.createElement('div');
        header.className = 'item-header';

        const iconBox = document.createElement('div');
        iconBox.className = 'setting-icon-box';
        iconBox.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"'
            + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            + (_GH_PURPOSE_ICONS[p.key] || _GH_PURPOSE_ICON_FALLBACK)
            + '</svg>';
        header.appendChild(iconBox);

        const nameEl = document.createElement('span');
        nameEl.className = 'item-name';
        nameEl.textContent = p.label;
        header.appendChild(nameEl);

        row.appendChild(header);

        const repoSel = document.createElement('select');
        repoSel.className = 'form-control settings-input-text';
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '不使用';
        repoSel.appendChild(emptyOpt);
        _ghDraft.repos.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id;
            const where = describeGithubRepo(r);
            opt.textContent = where ? `${r.name}（${where}）` : r.name;
            repoSel.appendChild(opt);
        });
        // 绑定的仓库可能刚被删了 —— 那就落回"不使用"，不留悬空 id
        repoSel.value = _ghDraft.repos.some(r => r.id === binding.repoId) ? binding.repoId : '';
        row.appendChild(repoSel);
        host.appendChild(row);

        // 就地写回草稿，不用等保存时再回来扫 DOM。
        // autoBackup 原样带过去 —— 它不在这个页面编辑，但也不能被这里抹掉。
        repoSel.addEventListener('change', () => {
            _ghDraft.bindings[p.key] = {
                ...binding,
                repoId: repoSel.value,
                enabled: !!repoSel.value
            };
        });
    });
}

// ============================================================
// 页面级
// ============================================================

/** 设置页「GitHub 仓库」那一行右侧的状态文案 */
function refreshGithubReposSummary() {
    const el = document.getElementById('github-repos-summary');
    if (!el || typeof _normalizeGithubRepos !== 'function') return;
    const repos = _normalizeGithubRepos(db.githubRepos);
    const bindings = _normalizeGithubBindings(db.githubBindings);
    const active = GITHUB_PURPOSES.filter(p => {
        const b = bindings[p.key];
        return b && b.enabled && repos.some(r => r.id === b.repoId);
    });
    if (!repos.length) el.textContent = '未配置';
    else if (!active.length) el.textContent = `${repos.length} 个仓库 · 未启用`;
    // 用 shortLabel（备份/语音/图片）而不是 label —— 三项全开时全称在窄屏上会折行。
    else el.textContent = active.map(p => p.shortLabel || p.label).join('、');
}

async function saveGithubRepos() {
    _ghSyncRepoFromForm();

    // 填了一半的仓库存下来只会在归档时安静地失败，现在就拦住
    const broken = _ghDraft.repos.filter(r => !r.token || !r.username || !r.repo);
    if (broken.length) {
        return showToast(`仓库「${broken[0].name}」还没填全令牌、用户名和仓库名`);
    }
    // 注：不用再校验"开了但没选仓库" —— enabled 是从 repoId 派生的，
    //     没选仓库就等于没开，构造不出这种半开状态。

    db.githubRepos = _normalizeGithubRepos(_ghDraft.repos);
    db.githubBindings = _normalizeGithubBindings(_ghDraft.bindings);
    await saveGlobalKeys(['githubRepos', 'githubBindings']);
    _ghDraft = {
        repos: _normalizeGithubRepos(db.githubRepos),
        bindings: _normalizeGithubBindings(db.githubBindings)
    };
    refreshGithubReposSummary();
    showToast('仓库配置已保存');
}

// 事件只绑一次；每次进页面只刷新数据
let _ghBound = false;

/** 每次打开这个 screen 时调用（由 main.js 的 pageActions 触发） */
function openGithubReposScreen() {
    _ghDraft = {
        repos: _normalizeGithubRepos(db.githubRepos),
        bindings: _normalizeGithubBindings(db.githubBindings)
    };
    _ghLoadedRepoId = '';
    _ghApplyRepoToForm((_ghDraft.repos[0] || {}).id);
    _ghRenderPurposes();
    _ghSetTestResult('');

    if (_ghBound) return;
    _ghBound = true;

    const on = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    };
    on('gh-add-repo', () => _ghAddRepo(false));
    on('gh-copy-repo', () => _ghAddRepo(true));
    on('gh-del-repo', _ghDeleteRepo);
    on('gh-test-btn', testGithubRepoConnection);
    on('gh-save-btn', saveGithubRepos);
    // header 右上角的问号 = 整页说明。小标题旁边那两个问号走 HTML 里的 onclick
    on('gh-help-btn', () => AppHelp.show('github', 'page'));

    // 切仓库前先把当前编辑写回草稿，否则改完直接切走改动就丢了
    const select = document.getElementById('gh-repo-select');
    if (select) select.addEventListener('change', () => {
        _ghSyncRepoFromForm();
        _ghApplyRepoToForm(select.value);
        _ghRenderPurposes();   // 备注名可能改了，用途里的下拉文案要跟着变
    });

    // 仓库的名字/地址变了，用途下拉里的显示文案也该跟着变
    ['gh-repo-name', 'gh-repo-username', 'gh-repo-repo', 'gh-repo-branch'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => {
            _ghSyncRepoFromForm();
            _ghPopulateRepoSelect(_ghLoadedRepoId);
            _ghRenderPurposes();
        });
    });
}
