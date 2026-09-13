// --- js/core/restart_diag.js ---
// 运行状态与重启原因记录器。
//
// 解决的问题：安卓 Chrome PWA 切后台再切回时偶发「明明看到页面了却重新启动」。
// 这类事件由系统内存压力触发，用户侧无法复现，也无法从控制台看到（页面已经重开，
// 上一次运行的日志全没了）。所以把判定结果落到 localStorage，跨会话留痕。
//
// 判定依据（都是浏览器给的事实，不是猜测）：
//   document.wasDiscarded === true  → 系统内存不足丢弃了页面，这次是丢弃后的重载（确诊）
//   navigation.type === 'reload'    → 刷新（用户下拉刷新，或导入/云恢复后的 location.reload）
//   navigation.type === 'navigate' 且上次会话没留下干净退出标记
//                                   → 渲染进程非正常终止（内存不足被系统强制结束 / 崩溃）
//   navigation.type === 'navigate' 且有干净退出标记 → 正常冷启动
//
// 干净退出标记由 pagehide / freeze 写入。这两个事件是「页面即将被冻结或卸载」时
// 浏览器保证会给的最后一次机会；如果下次启动发现标记没写上，说明上次是被强制结束的。
(function initRestartDiag() {
    'use strict';

    const LOG_KEY = 'ouo_restart_log';      // 环形日志（最近 N 条会话记录）
    const LIVE_KEY = 'ouo_session_live';    // 本次会话的「进行中」标记
    const MAX_ENTRIES = 60;   // 现在连正常关闭也记（用来和异常那次对照），环形缓冲放宽一些

    // 必须用本地时间。用 toISOString() 会得到 UTC，而后面 new Date(那个字符串)
    // 又按本地时间解析，两者一减就凭空多出一个时区差（国内 +8 会算出多活 480 分钟）；
    // 而且报告里的时间跟用户看表的时间对不上，没法和"我刚才几点碰到重启"对照。
    const nowIso = () => {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
               `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    const mb = n => (typeof n === 'number' ? +(n / 1048576).toFixed(1) : null);

    function heap() {
        const m = performance.memory;
        if (!m) return null;
        return { usedMB: mb(m.usedJSHeapSize), limitMB: mb(m.jsHeapSizeLimit) };
    }

    function readJSON(key, fallback) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
        catch (_) { return fallback; }
    }
    function writeJSON(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
    }

    // ── 1. 判定上一次会话是怎么结束的 ─────────────────────────────
    const nav = performance.getEntriesByType('navigation')[0];
    const navType = nav ? nav.type : 'unknown';
    const prev = readJSON(LIVE_KEY, null);   // 上次会话留下的「进行中」快照

    let reason, detail;
    // 上次 pagehide 到现在过了多久。pagehide 是"文档即将被卸载"，如果紧接着（几秒内）
    // 就有新文档起来，那就不是用户手动重开 App，而是页面自己被导航/重载掉了。
    const gapSec = (prev && prev.exitAt)
        ? Math.round((Date.now() - new Date(prev.exitAt).getTime()) / 1000)
        : null;
    // ★ 上次"还有动静"到本次启动之间隔了多久。这是区分「系统正常回收后台页面」
    //   和「用着的时候突然重启」的关键指标：
    //   离开一两个小时才回来，安卓回收掉后台页面是完全正常的，不是 bug；
    //   而离开几秒就重启，那才是真问题。
    const awaySec = (prev && prev.lastSeenAt)
        ? Math.round((Date.now() - new Date(prev.lastSeenAt).getTime()) / 1000)
        : null;
    const awayText = awaySec == null ? ''
        : (awaySec >= 120 ? `离开 ${(awaySec / 60).toFixed(0)} 分钟后才回来`
                          : `离开仅 ${awaySec} 秒就回来了`);
    // 长时间离开后被回收属于系统正常行为，短时间内就重启才值得追
    const awayLong = awaySec != null && awaySec >= 120;

    if (document.wasDiscarded) {
        reason = 'discarded';
        detail = '系统内存不足，浏览器回收了页面（切回时先看到截图，随后才真正重新载入）'
               + (awayText ? `。${awayText}` : '');
    } else if (prev && !prev.cleanExit) {
        // ★ 这一条必须排在 navType 之前判断。
        //   之前把 navType==='back_forward' 放在前面，结果"上次被强制结束"这个更重要的
        //   事实被盖成了看起来无害的"前进/后退恢复"——实际上正是被系统回收后重新载入。
        reason = 'killed';
        detail = '上次运行没留下正常的结束记录 → 被系统回收或强制结束'
               + (navType === 'back_forward'
                    ? '，返回 App 时浏览器只能重新载入页面（所以像是重启）'
                    : '')
               + (awayText ? `。${awayText}` : '')
               + (awayLong
                    ? ' —— 后台放这么久被系统收回内存属正常现象，不是 App 的问题'
                    : ' —— 这么短时间就被收走，值得追查');
    } else if (navType === 'reload') {
        reason = 'reload';
        detail = '页面被刷新（下拉刷新，或导入数据/云端恢复后的自动刷新）';
    } else if (navType === 'back_forward') {
        // 注意：真正命中后台缓存时文档不会重建，本脚本压根不会重新执行、也不会记这一条。
        // 能走到这里说明缓存没命中，文档是被重新载入的。
        reason = 'restored';
        detail = '通过前进/后退返回，但后台缓存已失效，页面被重新载入'
               + (awayText ? `。${awayText}` : '');
    } else if (prev && prev.cleanExit && prev.exitAt && gapSec !== null && gapSec >= 0 && gapSec <= 20) {
        // ★ 这就是我们要抓的那种"突然重启"：上一个文档正常走完了 pagehide，
        //   然后几秒内新文档就起来了 —— 说明是页面被导航掉后立刻重新加载，
        //   不是内存不足被回收（那种不会有 pagehide），也不是用户手动重开（间隔会长得多）。
        reason = 'navigated';
        detail = `页面在 ${gapSec} 秒前关闭后立即重新载入 —— 是一次真实的页面跳转，`
               + `不是内存不足导致的回收。关闭时停留在：${prev.exitScreen || '?'}`;
    } else if (prev && prev.cleanExit && prev.exitAt) {
        // 文档确实正常卸载了，但隔了一段时间才有新文档。可能是用户自己关掉再打开，
        // 也可能是 App 窗口被返回键/系统关掉、随后又点开的。exitScreen 能区分：
        // 如果每次都恰好结束在 home-screen，那就不是巧合。
        reason = 'closed';
        detail = `上次运行在 ${prev.exitAt} 正常结束（停留在 ${prev.exitScreen || '?'}），`
               + `${gapSec} 秒后才重新打开。如果那次不是你自己关的，就说明 App 窗口是被动关闭的。`;
    } else if (!prev) {
        reason = 'nostate';
        detail = '没有上次运行的记录 —— 本地存储被清理过，或这是装好后第一次启动';
    } else {
        reason = 'coldstart';
        detail = '正常启动';
    }

    const entry = {
        at: nowIso(),
        reason,
        detail,
        navType,
        // 上次运行结束前的快照，用来看结束之前内存涨到了多少
        prevSession: prev ? {
            startedAt: prev.startedAt,
            lastSeenAt: prev.lastSeenAt,
            aliveMin: prev.startedAt && prev.lastSeenAt
                ? +((new Date(prev.lastSeenAt) - new Date(prev.startedAt)) / 60000).toFixed(1)
                : null,
            peakHeapMB: prev.peakHeapMB,
            lastHeapMB: prev.lastHeapMB,
            domNodes: prev.domNodes,
            logLines: prev.logLines,
            hiddenCount: prev.hiddenCount,
            froze: prev.froze,
            cleanExit: prev.cleanExit,
            activeScreen: prev.activeScreen ?? null,
            screenTrail: prev.screenTrail || [],
            // 卸载现场：pagehide 时停在哪一页、event.persisted 是不是进了 bfcache
            exitAt: prev.exitAt ?? null,
            exitScreen: prev.exitScreen ?? null,
            exitPersisted: prev.exitPersisted ?? null,
            gapSec,
            awaySec,   // 上次还有动静 → 本次启动，隔了多久（判断是不是后台放太久被系统收走）
            // 上次运行里所有的 history 操作。history.go(-N) 这类跳转如果退过了头，
            // 在 standalone PWA 里会把窗口整个关掉，看起来就是"突然重启"。
            histTrail: prev.histTrail || [],
            lastHref: prev.href ?? null
        } : null,
        navUrl: nav ? nav.name : null,
        device: {
            deviceMemoryGB: navigator.deviceMemory ?? null,
            heapLimitMB: heap()?.limitMB ?? null
        }
    };

    // 除了"真的什么都没发生"的纯冷启动，其余全部记录。
    // 上一版只记异常，结果最想抓的那种"突然重启"恰好被归到了 coldstart 里，一条都没留下
    // —— 用户看到的就是"凡是异常重启的都没记录，记录的都是我自己关掉的"。
    // 现在连正常关闭也记，正是为了拿它当基线和异常那次对照。
    if (reason !== 'coldstart') {
        const log = readJSON(LOG_KEY, []);
        log.push(entry);
        while (log.length > MAX_ENTRIES) log.shift();
        writeJSON(LOG_KEY, log);
        console.warn('[运行诊断] 上次运行的结束方式：' + reason + ' — ' + detail);
    }

    // ── 2. 开始记录本次会话 ───────────────────────────────────────
    const live = {
        startedAt: nowIso(),
        lastSeenAt: nowIso(),
        peakHeapMB: heap()?.usedMB ?? null,
        lastHeapMB: heap()?.usedMB ?? null,
        domNodes: null,
        logLines: null,
        hiddenCount: 0,
        froze: false,
        cleanExit: false,
        activeScreen: null,   // 运行结束那一刻停留在哪个页面
        screenTrail: [],      // 最近的页面切换轨迹（最新在后）
        histTrail: [],        // 最近的 history 操作（pushState / go / back …）
        href: location.href,
        exitAt: null,         // pagehide 发生的时刻
        exitScreen: null,     // pagehide 时停在哪一页
        exitPersisted: null   // pagehide 的 event.persisted：true=进 bfcache，false=真的被卸载
    };
    writeJSON(LIVE_KEY, live);

    function currentScreenId() {
        const el = document.querySelector('.screen.active');
        return el ? el.id : null;
    }

    function sample() {
        const h = heap();
        live.lastSeenAt = nowIso();
        if (h) {
            live.lastHeapMB = h.usedMB;
            if (live.peakHeapMB == null || h.usedMB > live.peakHeapMB) live.peakHeapMB = h.usedMB;
        }
        live.domNodes = document.getElementsByTagName('*').length;
        const out = document.getElementById('dev-console-output');
        live.logLines = out ? out.children.length : null;
        live.activeScreen = currentScreenId();
        live.href = location.href;
        writeJSON(LIVE_KEY, live);
    }

    // 记录所有 history 操作。「返回主屏时突然重启」如果是 history.go(-N) 退过了头
    // 把 standalone PWA 的窗口整个关掉造成的，那这条轨迹就是唯一的证据——
    // 它会显示 pagehide 之前最后一步正是一次 go(-N)。
    function noteHist(op) {
        try {
            live.histTrail.push(`${nowIso().slice(11)} ${op} len=${history.length} @${currentScreenId() || '?'}`);
            while (live.histTrail.length > 20) live.histTrail.shift();
            writeJSON(LIVE_KEY, live);
        } catch (_) {}
    }
    try {
        const h = History.prototype;
        const wrap = (name, fmt) => {
            const orig = h[name];
            if (typeof orig !== 'function' || orig._diagWrapped) return;
            const patched = function (...args) {
                noteHist(fmt(args));
                return orig.apply(this, args);
            };
            patched._diagWrapped = true;
            h[name] = patched;
        };
        wrap('pushState',    () => 'pushState');
        wrap('replaceState', () => 'replaceState');
        wrap('go',           a => `go(${a[0] ?? 0})`);
        wrap('back',         () => 'back()');
        wrap('forward',      () => 'forward()');
    } catch (_) { /* 补丁失败不影响其余诊断 */ }
    window.addEventListener('popstate', () => noteHist('popstate'));

    // 页面切换轨迹。用户报告"基本都是返回主屏时重启"，光有"结束时停在哪一页"不够——
    // 还需要知道结束之前的几步操作，才能判断是不是某条特定的跳转路径触发的。
    // 用 MutationObserver 监听 .screen 的 class 变化，不依赖 switchScreen
    // （restart_diag 必须最先加载，那时 switchScreen 还没定义，包不了）。
    let lastTrailId = null;
    try {
        const trailMo = new MutationObserver(() => {
            const id = currentScreenId();
            if (!id || id === lastTrailId) return;
            lastTrailId = id;
            live.screenTrail.push(nowIso().slice(11) + ' ' + id);
            while (live.screenTrail.length > 12) live.screenTrail.shift();
            live.activeScreen = id;
            writeJSON(LIVE_KEY, live);
        });
        document.addEventListener('DOMContentLoaded', () => {
            lastTrailId = currentScreenId();
            if (lastTrailId) live.screenTrail.push(nowIso().slice(11) + ' ' + lastTrailId);
            trailMo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
        });
    } catch (_) { /* 观察器不可用时静默降级，诊断其余部分照常工作 */ }

    // 30 秒采样一次，持续更新「还活着 + 当前内存」快照
    setInterval(sample, 30000);

    // 切后台时补一次采样。这一刻的数值最有价值：系统正是在这时决定要不要回收页面
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { live.hiddenCount++; sample(); }
    });

    // freeze：Chrome 冻结后台页面时触发，是「即将被丢弃」的前兆。
    // 注意这里【不能】标记干净退出——安卓上「冻结 → 内存不足被系统回收」这条路径里
    // wasDiscarded 是 false，若冻结就算干净退出，这次回收就会被误判成正常启动而漏记。
    // 冻结只是暂停，不是结束，所以只记 froze 供事后参考。
    document.addEventListener('freeze', () => { live.froze = true; sample(); });
    // pagehide 才是真正的「页面即将卸载」——正常关闭/跳转会给，被强制结束不会给。
    // 所以它是判断上次是否正常收尾的唯一依据。
    // event.persisted=false 表示文档真的被卸载掉了（而不是进 bfcache），
    // 配合下次启动时的时间间隔，就能认出「被导航掉后立刻重载」这种假重启。
    window.addEventListener('pagehide', (e) => {
        live.cleanExit = true;
        live.exitAt = nowIso();
        live.exitScreen = currentScreenId();
        live.exitPersisted = !!(e && e.persisted);
        sample();
    });
    // 从冻结/bfcache 中恢复：这次运行还在继续，把退出痕迹全部清掉，
    // 否则残留的 exitAt 会让下次启动误判成"被导航掉后立刻重载"。
    document.addEventListener('resume', () => {
        live.froze = false; live.cleanExit = false;
        live.exitAt = null; live.exitScreen = null; live.exitPersisted = null;
        sample();
    });
    window.addEventListener('pageshow', (e) => {
        if (e && e.persisted) {
            live.cleanExit = false;
            live.exitAt = null; live.exitScreen = null; live.exitPersisted = null;
            sample();
        }
    });

    // ── 3. 查看接口 ───────────────────────────────────────────────
    window.OuODiag = {
        // 手机上点「系统日志」页右上角那个按钮即可；电脑控制台可用 OuODiag.report(30) 看更多。
        // 默认只列最近 10 条明细——全部记录都留着，但一次性铺开几十条在手机上没法看，
        // 而且真正有用的规律已经由 summary() 的页面分布统计给出了。
        report(limit = 10) {
            const log = readJSON(LOG_KEY, []);
            if (!log.length) { console.log('[运行诊断] 暂无记录'); return log; }
            const shown = log.slice(-Math.max(1, limit));
            console.log(`[运行诊断] 共 ${log.length} 条记录，以下是最近 ${shown.length} 条（新的在下面）：`);
            shown.forEach(e => {
                const p = e.prevSession;
                // 拆成多条 console.log：日志面板对单条有 2000 字符上限，
                // 两条轨迹拼在一起会超，超了就被截断反而丢掉最关键的尾部。
                console.log(`${e.at}  ${e.reason}\n  ${e.detail}\n  navType=${e.navType}` +
                            (e.navUrl ? `\n  本次载入的地址：${e.navUrl}` : ''));
                if (!p) return;
                console.log('  上次运行：' +
                    `持续 ${p.aliveMin ?? '?'} 分钟，切后台 ${p.hiddenCount ?? '?'} 次，` +
                    `内存峰值 ${p.peakHeapMB ?? '?'}MB / 上限 ${e.device.heapLimitMB ?? '?'}MB，` +
                    `DOM ${p.domNodes ?? '?'} 节点，日志 ${p.logLines ?? '?'} 行\n` +
                    `  结束时停留页面：${p.activeScreen ?? '(未记录)'}\n` +
                    '  结束方式：' + (p.exitAt
                        ? `${p.exitAt} 在 ${p.exitScreen || '?'} 正常结束` +
                          (p.exitPersisted == null ? ''
                             : p.exitPersisted ? '（转入后台缓存）' : '（页面确实被关闭）') +
                          (p.gapSec == null ? '' : `，${p.gapSec} 秒后重新载入`)
                        : '没有留下正常的结束记录 → 上次是被系统回收或强制结束的') +
                    // 这一行最关键：离开越久，被系统收走越正常；离开几秒就重启才是真问题
                    (p.awaySec == null ? ''
                       : `\n  判断依据：上次有动静到本次启动隔了 ` +
                         (p.awaySec >= 120 ? `${(p.awaySec / 60).toFixed(0)} 分钟 → 属系统正常回收后台页面`
                                           : `${p.awaySec} 秒 → 间隔这么短，是需要追查的异常`)));
                console.log('  结束前的页面轨迹：\n    ' +
                    ((p.screenTrail && p.screenTrail.length) ? p.screenTrail.join('\n    ') : '(未记录)'));
                console.log('  结束前的跳转记录：\n    ' +
                    ((p.histTrail && p.histTrail.length) ? p.histTrail.join('\n    ') : '(未记录)'));
            });
            return log;
        },
        // 当前实时状态
        now() { sample(); return { ...live, heapLimitMB: heap()?.limitMB ?? null }; },
        // 汇总。明细只列最近 10 条，但统计跑全部记录——
        // "是不是每次都结束在某一页"这种规律要靠全量才看得出来，这也是本次排查最需要的一条。
        summary() {
            const log = readJSON(LOG_KEY, []);
            const by = {};
            log.forEach(e => { by[e.reason] = (by[e.reason] || 0) + 1; });
            const peaks = log.map(e => e.prevSession?.peakHeapMB).filter(v => typeof v === 'number');
            // 结束时停留在哪一页的分布（只统计能说明问题的那几类，正常启动不算）
            const byScreen = {};
            log.filter(e => e.reason !== 'coldstart' && e.reason !== 'nostate').forEach(e => {
                const s = e.prevSession?.exitScreen || e.prevSession?.activeScreen || '(未记录)';
                byScreen[s] = (byScreen[s] || 0) + 1;
            });
            // 分开数「后台放久了被系统收走」和「用着的时候突然重启」。
            // 前者是安卓的正常行为，混在一起统计会把真问题淹掉。
            let 后台回收 = 0, 短时间异常 = 0;
            log.filter(e => e.reason !== 'coldstart' && e.reason !== 'nostate').forEach(e => {
                const a = e.prevSession?.awaySec;
                if (a == null) return;
                if (a >= 120) 后台回收++; else 短时间异常++;
            });
            return {
                总记录数: log.length,
                各类型次数: by,
                后台放久被回收: 后台回收,
                短时间内异常重启: 短时间异常,
                结束时停留页面分布: Object.keys(byScreen).length ? byScreen : null,
                结束前内存峰值MB: peaks.length ? { 最大: Math.max(...peaks), 最小: Math.min(...peaks) } : null,
                内存上限MB: heap()?.limitMB ?? null,
                设备内存GB: navigator.deviceMemory ?? null
            };
        },
        clear() { try { localStorage.removeItem(LOG_KEY); } catch (_) {} console.log('[运行诊断] 已清空'); }
    };

    // ── 4. 手机上的入口 ──────────────────────────────────────────
    // 手机上没有 devtools，「系统日志」页也只有输出区、没有输入框，
    // 所以 OuODiag.report() 在真机上根本没法调用——加个按钮把报告打到输出区。
    document.addEventListener('DOMContentLoaded', () => {
        const btn = document.getElementById('diag-report-btn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            console.log('──────── 运行诊断报告 ────────');
            const s = window.OuODiag.summary();
            console.log('汇总：' + JSON.stringify(s, null, 2));
            window.OuODiag.report(10);
            const n = window.OuODiag.now();
            console.log('本次运行（进行中）：\n' +
                `  已运行 ${+((Date.now() - new Date(n.startedAt).getTime()) / 60000).toFixed(1)} 分钟，` +
                `切后台 ${n.hiddenCount} 次\n` +
                `  当前内存 ${n.lastHeapMB ?? '?'}MB / 峰值 ${n.peakHeapMB ?? '?'}MB / 上限 ${n.heapLimitMB ?? '?'}MB\n` +
                `  DOM ${n.domNodes ?? '?'} 节点，日志 ${n.logLines ?? '?'} 行\n` +
                `  当前页面：${n.activeScreen ?? '?'}\n` +
                '  页面轨迹：\n    ' + (n.screenTrail || []).join('\n    '));
            console.log('──────── 报告结束 ────────');
        });
    });
})();
