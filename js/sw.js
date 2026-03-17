// --- sw.js ---

self.addEventListener('install', (event) => {
  console.log('Service worker installing...');
  self.skipWaiting(); // 强制立即接管控制权
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // 暂时不拦截网络请求，交给浏览器处理
  return;
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