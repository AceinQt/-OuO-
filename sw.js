// --- sw.js ---
// 注意：本文件必须放在【项目根目录】，使 Service Worker 作用域为 '/'，
//       从而能控制根页面（否则 navigator.serviceWorker.ready 会永久挂起），
//       并让通知点击、图标等相对路径都从根目录解析。

const CACHE_NAME = 'ouo-cache-Q2.0.0';
// 每次部署新版本时，把上面的版本号往上加
// SW 会自动清理旧缓存，确保用户拿到最新文件

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

    // 非同源请求（postimg、外部字体等）直接放行，不走缓存
    if (url.origin !== location.origin) {
        return;
    }

    // JS / HTML / JSON 文件：网络优先，保证总是拿到最新代码
    // 网络失败时才用缓存兜底（离线场景）
    if (
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.html') ||
        url.pathname.endsWith('.json') ||
        url.pathname === '/'
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

    // CSS / 图片等静态资源：缓存优先，有缓存直接用，没有才去网络拿
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
