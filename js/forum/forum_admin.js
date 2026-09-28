// forum_admin.js - 世界页「管理」Tab：论坛 API 预设（DOM 在这，读写仍归 forum_bindings.js）、
//                  按时间范围批量删帖（可跳过收藏/在看）、帖子正文自定义 CSS
//
// 正文 CSS 原来长在「我」页的「正文样式」Tab 里，跟昵称/人设一起由 me-save-btn 保存。
// 搬到这以后**只有**世界页右上角那个保存按钮会写它（forum_bindings.js 的 save 分支里调
// saveForumAdminPane）。forum_me_page.js 不再碰 customDetailCss —— 它保存时从 db 里原样
// 带过去，否则在「我」页存一次昵称就会把这边刚写的 CSS 冲成空。

// --- 按时间范围查/删帖子 ---
// 都走 forumPosts 的 timestamp 索引（DB v14 加的，缺字段的老帖已回填成 0，索引覆盖全表），
// 所以懒加载开着、内存只有窗口时也能删到窗口外的老帖 —— 别拿 db.forumPosts 当数据源。
//
// 「跳过收藏 / 跳过在看」两个开关（默认开）在这一层表达成一份**保护名单**：
// 统计和删除各自把名单里的 id 剔掉，两处必须用同一个 opts，否则预览说「将删除 3 条」、
// 实际删了 5 条 —— 而删帖没有回收站，对不上就是数据没了。
// ★ id 一律 String 化再比：库里的主键可能是数字，收藏/在看名单存的是 post.id 原值
//   （forum_detail.js 是 push(post.id)），不归一化的话 5 !== '5'，开关看着开着却保护不住。
function _forumProtectedPostIds({ skipFavorites = false, skipWatching = false } = {}) {
    const keep = new Set();
    if (skipFavorites) (db.favoritePostIds || []).forEach(id => keep.add(String(id)));
    if (skipWatching) (db.watchingPostIds || []).forEach(id => keep.add(String(id)));
    return keep;
}

async function _forumCountPostsInRange(startTs, endTs, opts) {
    if (!window.dexieDB) return 0;
    const query = () => window.dexieDB.forumPosts
        .where('timestamp').between(startTs, endTs, true, true);

    const keep = _forumProtectedPostIds(opts);
    // 没有保护名单时走索引 count()：它不用把主键全捞进内存，而这个函数每敲一下键盘就跑一次
    if (keep.size === 0) return await query().count();

    const ids = await query().primaryKeys();
    return ids.filter(id => !keep.has(String(id))).length;
}

async function _forumDeletePostsInRange(startTs, endTs, opts) {
    const keep = _forumProtectedPostIds(opts);
    let ids = await window.dexieDB.forumPosts
        .where('timestamp').between(startTs, endTs, true, true)
        .primaryKeys();
    if (keep.size > 0) ids = ids.filter(id => !keep.has(String(id)));

    if (ids.length === 0) return 0;

    // 1. 先删库（跟单条删帖同一个顺序：库是真相，内存是缓存）
    await window.dexieDB.forumPosts.bulkDelete(ids);

    // 2. 内存窗口用同一个谓词过一遍。用谓词而不是 id 列表：内存里的 timestamp 缺失项
    //    按 (p.timestamp||0) 归零，和索引里回填的 0 语义一致，两边不会删漏。
    //    保护名单要在这儿**再判一次** —— 只按时间谓词过的话，被跳过的收藏帖还在库里、
    //    却从内存窗口里消失了，表现为「跳过收藏生效了，但帖子刷新前看不见」。
    //    ★ 懒加载游标 window._forumOldestContiguousTs 不用动：两边删的是同一批，
    //      「内存前缀 == DB 最新一段」这个不变量还成立，游标只是个时间边界值，
    //      不绑定某条具体帖子，被删掉也不影响 fetchOlderForumPosts 继续往老处翻。
    db.forumPosts = (db.forumPosts || []).filter(p => {
        const ts = p.timestamp || 0;
        if (ts < startTs || ts > endTs) return true;
        return keep.has(String(p.id));
    });

    // 3. 收藏/在看里的悬空 id 一起清掉（不清的话收藏页会渲染出空白项）。
    //    这里按**真正删掉的那批**算，所以被保护的 id 自然留在名单里 —— 比如只开「跳过收藏」时，
    //    一条「收藏了又在看」的帖子没被删，它在两份名单里都该原样保留。
    const gone = new Set(ids.map(String));
    if (db.favoritePostIds) db.favoritePostIds = db.favoritePostIds.filter(id => !gone.has(String(id)));
    if (db.watchingPostIds) db.watchingPostIds = db.watchingPostIds.filter(id => !gone.has(String(id)));
    await saveForumMeta();

    return ids.length;
}

// --- 「管理」Tab 的读写：正文 CSS ---
// 进世界页时由 renderWorldPageList 调，跟那边的列表渲染同一个时机
function loadForumAdminPane() {
    const cssInput = document.getElementById('forum-detail-css-input');
    if (cssInput) cssInput.value = (db.forumUserIdentity || {}).customDetailCss || '';
}

// 世界页保存时由 forum_bindings.js 调：只改 customDetailCss 一个字段，
// 其余身份字段（昵称/头像/人设/匿名码/人设绑定）原样留着 —— 那些归「我」页管。
function saveForumAdminPane() {
    const cssInput = document.getElementById('forum-detail-css-input');
    if (!cssInput) return;

    if (!db.forumUserIdentity) {
        db.forumUserIdentity = {
            nickname: '新用户', avatar: './png/avatar_default.jpg', persona: '',
            realName: '', anonCode: '0311', customDetailCss: '', boundPersonaId: null
        };
    }
    db.forumUserIdentity.customDetailCss = cssInput.value || '';

    // 立刻生效，不用等下次进详情页
    if (typeof applyCustomPostCss === 'function') applyCustomPostCss();
}

function setupForumAdminFeature() {
    const openBtn = document.getElementById('forum-batch-delete-btn');
    const modal = document.getElementById('forum-batch-delete-modal');
    const confirmBtn = document.getElementById('forum-del-confirm-btn');
    const resultEl = document.getElementById('forum-del-range-result');

    if (!openBtn || !modal || !confirmBtn) return;

    const FIELD_IDS = [
        'forum-del-start-year', 'forum-del-start-month', 'forum-del-start-day', 'forum-del-start-hour',
        'forum-del-end-year', 'forum-del-end-month', 'forum-del-end-day', 'forum-del-end-hour'
    ];

    const SKIP_IDS = ['forum-del-skip-fav', 'forum-del-skip-watching'];

    // 读两个开关。★ 元素找不着时算「开着」，不是「关着」：这函数的返回值直接决定删多少，
    // 万一 HTML 改名没同步，坏的方向必须是「少删」。
    const readSkip = () => {
        const on = (id) => {
            const el = document.getElementById(id);
            return el ? el.checked : true;
        };
        return { skipFavorites: on('forum-del-skip-fav'), skipWatching: on('forum-del-skip-watching') };
    };

    // 读出起止时间戳。起始取整点 00:00、截止取整点 59:59.999，
    // 和总结那边的 _updateTimeRangePreview 口径一致（填同一个「时」＝含这一整个小时）
    const readRange = () => {
        const v = FIELD_IDS.map(id => parseInt((document.getElementById(id) || {}).value));
        if (v.some(isNaN)) return null;
        const [sY, sM, sD, sH, eY, eM, eD, eH] = v;
        return {
            startTs: new Date(sY, sM - 1, sD, sH, 0, 0, 0).getTime(),
            endTs: new Date(eY, eM - 1, eD, eH, 59, 59, 999).getTime()
        };
    };

    const setBtnEnabled = (on) => {
        confirmBtn.disabled = !on;
        confirmBtn.style.opacity = on ? '1' : '0.5';
        confirmBtn.style.pointerEvents = on ? 'auto' : 'none';
    };

    // 实时预览命中条数。竞态保护照抄 summary_init.js：改得快时只让最后一次写 DOM
    let previewSeq = 0;
    const updatePreview = async () => {
        if (!resultEl) return;
        const range = readRange();
        if (!range) {
            resultEl.style.color = '#888';
            resultEl.textContent = '请填完整起止时间';
            setBtnEnabled(false);
            return;
        }
        if (range.startTs > range.endTs) {
            resultEl.style.color = 'var(--danger-color, #e74c3c)';
            resultEl.textContent = '⚠ 起始时间不能晚于截止时间';
            setBtnEnabled(false);
            return;
        }

        resultEl.style.color = '#888';
        resultEl.textContent = '统计中...';
        setBtnEnabled(false);

        const skip = readSkip();
        const mySeq = ++previewSeq;
        let count = 0, skipped = 0;
        try {
            // 区间总数走索引 count()（便宜），过滤后的数量才捞主键。两者之差就是被跳过的条数 ——
            // 不显示这个差值的话，用户看着「将删除 3 条」和列表里明明有 20 条对不上，会以为坏了。
            const total = await _forumCountPostsInRange(range.startTs, range.endTs);
            count = (skip.skipFavorites || skip.skipWatching)
                ? await _forumCountPostsInRange(range.startTs, range.endTs, skip)
                : total;
            skipped = total - count;
        } catch (e) {
            console.error('❌ [批量删帖] 统计失败:', e);
            if (mySeq !== previewSeq) return;
            resultEl.style.color = 'var(--danger-color, #e74c3c)';
            resultEl.textContent = '统计失败：' + e.message;
            return;
        }
        if (mySeq !== previewSeq) return;

        if (count === 0) {
            resultEl.style.color = '#888';
            resultEl.textContent = skipped > 0
                ? `该时间段内的 ${skipped} 条帖子都在收藏/在看里，已全部跳过`
                : '该时间段内没有帖子';
            setBtnEnabled(false);
        } else {
            resultEl.style.color = 'var(--danger-color, #e74c3c)';
            resultEl.textContent = skipped > 0
                ? `将删除 ${count} 条帖子（跳过 ${skipped} 条收藏/在看）`
                : `将删除 ${count} 条帖子`;
            setBtnEnabled(true);
        }
    };

    FIELD_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updatePreview);
    });

    // 开关也要重算预览：它和日期一样会改「将删除 N 条」那个数
    SKIP_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updatePreview);
    });

    // 打开弹窗：默认填「最早 ~ 今天」，用户多半是想清历史，改截止日比改起始日省事
    openBtn.addEventListener('click', () => {
        const now = new Date();
        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };
        set('forum-del-start-year', 2000);
        set('forum-del-start-month', 1);
        set('forum-del-start-day', 1);
        set('forum-del-start-hour', 0);
        set('forum-del-end-year', now.getFullYear());
        set('forum-del-end-month', now.getMonth() + 1);
        set('forum-del-end-day', now.getDate());
        set('forum-del-end-hour', now.getHours());

        // 两个开关跟日期一样每次回到默认值（都开着）。上次关掉过就不该悄悄留着：
        // 这是个删了不可恢复的操作，每次打开都从最保守的状态起步。
        SKIP_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.checked = true;
        });

        modal.classList.add('visible');
        updatePreview();
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('visible');
    });

    confirmBtn.addEventListener('click', async () => {
        const range = readRange();
        if (!range) { showToast('请填完整起止时间'); return; }
        if (range.startTs > range.endTs) { showToast('起始时间不能晚于截止时间'); return; }

        // 二次确认里的条数必须和真正要删的那批一致，所以统计和删除吃同一个 skip
        const skip = readSkip();
        let count = 0;
        try {
            count = await _forumCountPostsInRange(range.startTs, range.endTs, skip);
        } catch (e) {
            console.error('❌ [批量删帖] 统计失败:', e);
            showToast('统计失败: ' + e.message);
            return;
        }
        if (count === 0) { showToast('该时间段内没有可删除的帖子'); return; }

        const skipNote = [skip.skipFavorites && '收藏', skip.skipWatching && '在看'].filter(Boolean).join('/');
        const fmt = (ts) => new Date(ts).toLocaleString();
        const ok = await AppUI.confirm(
            `将删除 ${fmt(range.startTs)} 至 ${fmt(range.endTs)} 的 ${count} 条帖子` +
            (skipNote ? `（已跳过${skipNote}）` : '') + '，删掉不可恢复。确定吗？',
            '批量删除', '确认删除', '取消'
        );
        if (!ok) return;

        try {
            const deleted = await _forumDeletePostsInRange(range.startTs, range.endTs, skip);

            // 列表整条重绘（内部会把 currentForumPage 归 1）。记住的滚动位置也得清 —— 列表短了，
            // 不清的话下次进论坛会 requestAnimationFrame 滚到一个不存在的位置
            if (typeof renderForumPosts === 'function') renderForumPosts(db.forumPosts, false);
            if (typeof renderHotPosts === 'function') renderHotPosts();
            if (typeof savedForumScrollY !== 'undefined') savedForumScrollY = 0;
            if (typeof renderFavoritesList === 'function') renderFavoritesList();

            modal.classList.remove('visible');
            showToast(`已删除 ${deleted} 条帖子`);
        } catch (e) {
            console.error('❌ [批量删帖] 删除失败:', e);
            showToast('删除失败: ' + e.message);
        }
    });
}
