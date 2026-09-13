// --- sw.js ---
// 注意：本文件必须放在【项目根目录】，使 Service Worker 作用域为 '/'，
//       从而能控制根页面（否则 navigator.serviceWorker.ready 会永久挂起），
//       并让通知点击、图标等相对路径都从根目录解析。

const CACHE_NAME = 'ouo-cache-Q2.1.0';
// 三段式：前两位是大版本，第三位是测试次数。
// 【每次改代码都要把第三位 +1】，不是攒到部署时才动 —— 不升的话 SW 会端出旧缓存，
// 改动到不了手机上，看到的还是旧代码。
// 第二位只在发正式版时升，同时第三位归零（Q2.0.37 → Q2.1.0），时机由用户定。
// 详见 CLAUDE.md 开头那一节。

// 从缓存名里剥出纯版本号（如 'Q1.8.0'），作为全站版本号的唯一来源
const APP_VERSION = CACHE_NAME.replace('ouo-cache-', '');

// 前台询问版本号：收到 GET_VERSION 就把版本回投给发起方
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'GET_VERSION') {
        const port = event.ports && event.ports[0];
        if (port) port.postMessage({ type: 'VERSION', version: APP_VERSION });
        else if (event.source) event.source.postMessage({ type: 'VERSION', version: APP_VERSION });
    }
});

self.addEventListener('install', (event) => {
    console.log('[SW] Installing... version:', CACHE_NAME);
    self.skipWaiting(); // 强制立即接管控制权，不等旧 SW 退出
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        // 清理所有旧版本缓存
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => {
                    console.log('[SW] 清理旧缓存:', k);
                    return caches.delete(k);
                })
            );
        }).then(() => {
            console.log('[SW] Activated, 旧缓存已清理');
            return self.clients.claim(); // 立即接管所有页面
        })
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 非同源请求（用户数据里手填的外链图、外部字体等）直接放行，不走缓存。
    // ★ 内置图片曾经全放在 postimg 图床上，正是走到这里被放行、一张都不进缓存，
    //   网络一抖就整片裂图 —— 现已全部落到 png/ 下，改走下面的「图片缓存优先」。
    if (url.origin !== location.origin) {
        return;
    }

    // 代码类文件（JS / CSS / HTML / JSON）：网络优先，保证总是拿到最新代码
    // 网络失败时才用缓存兜底（离线场景）
    //
    // ★ CSS 原先在下面那条「缓存优先」分支里，这就是"手机端改了样式不生效"的根因：
    //   有缓存就直接用、根本不去网络问，只有升 CACHE_NAME 把旧缓存清掉才会重新拉。
    //   样式和 JS 一样属于代码、改动频率同级，所以归到同一条规则里。
    //   这样改 CSS 不需要在文件名后面挂 ?v=123 之类的版本号，刷新一次就是最新的。
    //   （代价：冷启动时 CSS 也要走网络。CSS 总共 500 多 KB，而 JS 已经有 3 MB 在走
    //     同一条规则了，多出来的这点可以忽略。）
    //
    // ★ 例外 js/lib/：第三方库虽然也是 .js，但它不是"我们的代码"——文件名里带版本号，
    //   同一路径的内容永不改变，网络优先对它只有坏处：echarts 一个就 1 MB，而 Dexie
    //   是"拉不到就整个 App 起不来"的东西，不该每次冷启动都押在网络上。放它掉到下面
    //   那条「缓存优先」规则里。升级库＝换文件名，旧文件随 CACHE_NAME 一起清掉。
    //   用 includes 而非 startsWith，是为了兼容部署在子路径下的情况。
    if (
        !url.pathname.includes('/js/lib/') &&
        (
            url.pathname.endsWith('.js') ||
            url.pathname.endsWith('.css') ||
            url.pathname.endsWith('.html') ||
            url.pathname.endsWith('.json') ||
            url.pathname === '/'
        )
    ) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // 拿到最新文件，顺手更新缓存
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => {
                    // 网络断了，用缓存兜底
                    return caches.match(event.request);
                })
        );
        return;
    }

    // 图片 / 字体 / 音频等静态资源，以及 js/lib/ 下的第三方库：缓存优先，
    // 有缓存直接用，没有才去网络拿
    // （这些是"内容"不是"代码"，换的时候一般是换文件名，不需要每次回源问）
    event.respondWith(
        caches.match(event.request).then(cached => {
            if (cached) return cached;
            return fetch(event.request).then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            });
        })
    );
});

// ── 接收来自「进阶推送中转（CF Worker）」的真实 Web Push ──────────────
// App 可能已被系统彻底杀死，此时只有 Service Worker 被推送唤醒。
// payload 里的 title/body/tag 是前端在移交时就用通知设置算好的最终文案，
// 这里直接展示即可（SW 拿不到 db / NotifyCenter，不能再做业务判断）。
// 注意：userVisibleOnly 约束下，每个到达的 push 都必须弹一条通知，
//       所以「要不要发」的决定必须在 Worker 端就拦好，不能到这里再丢弃。
self.addEventListener('push', (event) => {
    let data = {};
    try {
        if (event.data) data = event.data.json();
    } catch (e) {
        try { data = { title: '新消息', body: event.data ? event.data.text() : '' }; } catch (_) { data = {}; }
    }

    const title = data.title || '新消息';
    const options = {
        body: data.body || '',
        icon: './icon/icon_cat.png',
        badge: './icon/icon_cat.png',
        tag: data.tag || undefined,          // 与前台 NotifyCenter 同 tag，可折叠去重
        renotify: data.tag ? (data.renotify !== false) : false,
        silent: data.silent === true,
        data: { chatId: data.chatId, chatType: data.chatType, fromPush: true }
    };

    // 同 tag 的新通知本来是「原地替换」，不少安卓 ROM 对替换不重新提醒，
    // 用户就会觉得"上一条没划掉就收不到新的"。先关掉旧的再弹，让系统当新通知处理。
    event.waitUntil(
        (options.tag
            ? self.registration.getNotifications({ tag: options.tag })
                .then(list => { list.forEach(n => n.close()); })
                .catch(() => {})
            : Promise.resolve()
        ).then(() => self.registration.showNotification(title, options))
    );
});

// 点击系统通知：聚焦已打开的窗口并跳进对应聊天室，没有窗口就带着会话 id 冷启动
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const nd = event.notification.data || {};
    const targetChatId = nd.chatId;
    const targetChatType = nd.chatType;

    event.waitUntil(
        self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(clients => {
            for (const client of clients) {
                if ('focus' in client) {
                    // 先聚焦再投消息，保证前台是可见状态下处理跳转
                    return Promise.resolve(client.focus()).then(c => {
                        const target = c || client;
                        if (targetChatId) {
                            target.postMessage({
                                type: 'NOTIFICATION_CLICK',
                                chatId: targetChatId,
                                chatType: targetChatType
                            });
                        }
                    });
                }
            }
            if (self.clients.openWindow) {
                // 页面已被彻底关掉：把会话 id 挂在 hash 上，冷启动后由前台读出来跳转。
                // SW 位于根作用域，'./' 即 App 根目录（同时兼容子路径部署）
                let url = './';
                if (targetChatId) {
                    url += '#chat=' + encodeURIComponent(targetChatId);
                    if (targetChatType) url += '&type=' + encodeURIComponent(targetChatType);
                }
                return self.clients.openWindow(url);
            }
        })
    );
});

// 监听系统发起的周期性后台同步
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'check-proactive') {
        console.log('[SW] 系统触发了 Periodic Sync，准备唤醒前台页面...');

        event.waitUntil(
            self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(clients => {
                if (clients && clients.length > 0) {
                    // 如果发现 App 还在后台挂着，向它发送暗号
                    clients.forEach(client => {
                        client.postMessage({ type: 'PERIODIC_CHECK' });
                    });
                } else {
                    console.log('[SW] 页面已被彻底划掉关闭，无法投递暗号。');
                }
            })
        );
    }
});
