// --- sw.js ---

const CACHE_NAME = 'qchat-cache-Q1.7';
// 每次部署新版本时，把上面的 v1 改成 v2、v3...
// SW 会自动清理旧缓存，确保用户拿到最新文件

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
