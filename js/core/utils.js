// --- js/core/utils.js ---

function switchScreen(targetId) {
    const targetScreen = document.getElementById(targetId);
    if (!targetScreen) return;

    // ── 页面离开钩子 ──
    // 下面那句"关闭所有遮罩层"只认 .modal-overlay / .action-sheet-overlay / .settings-sidebar，
    // 用裸 .visible 控制显隐的面板（如聊天室底部的"+"面板、表情面板）会活着跟去下一个页面。
    // 各模块在这里注册自己的复位逻辑，返回键 / 滑动返回 / 系统返回键最终都会走到这。
    const leavingScreen = document.querySelector('.screen.active');
    const leavingId = leavingScreen ? leavingScreen.id : null;
    if (leavingId && leavingId !== targetId && window._screenLeaveHooks?.[leavingId]) {
        try {
            window._screenLeaveHooks[leavingId](targetId);
        } catch (e) {
            console.error(`[switchScreen] 离开钩子执行失败 (${leavingId}):`, e);
        }
    }

    // 检查是否是滑动返回触发的切换
    const isSwipeBack = targetScreen.dataset.swipeBack === 'true';

    // ── 屏幕切换逻辑 ──
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        // 清理非当前目标页面的 no-anim，确保下次正常进入它们时有动画
        if (s.id !== targetId) {
            s.classList.remove('no-anim');
        }
    });

    // 核心修复：如果是滑动返回，保留 no-anim 从而彻底阻止闪烁；普通切换则移除。
    if (isSwipeBack) {
        delete targetScreen.dataset.swipeBack;
        // 注意：这里不再去 remove('no-anim')，让它安安静静待在屏幕上
    } else {
        targetScreen.classList.remove('no-anim');
    }

    targetScreen.classList.add('active');

    // 关闭所有遮罩层和侧边栏
    document.querySelectorAll('.modal-overlay, .action-sheet-overlay, .settings-sidebar')
        .forEach(o => o.classList.remove('visible', 'open'));

    // 更新底部导航栏高亮
    document.querySelectorAll('.bottom-tab-bar .tab-item').forEach(t => {
        t.classList.toggle('active', t.dataset.target === targetId);
    });

    // 控制底部导航栏显示/隐藏
    const globalNav = document.querySelector('.bottom-tab-bar');
    if (globalNav) {
        globalNav.style.display = targetScreen.classList.contains('has-bottom-nav') ? 'flex' : 'none';
    }

    // 动态处理状态栏颜色
    updateThemeColorForScreen(targetId, targetScreen);

    // 页面进入钩子（各模块按需注册，不污染 switchScreen 本体）
    if (window._screenEnterHooks?.[targetId]) {
        window._screenEnterHooks[targetId]();
    }
}             
            // ── 顶部通知条 ────────────────────────────────────────────
            const TOAST_HOLD_RICH = 3500;   // 可点击的新消息通知：留够反应时间
            const TOAST_HOLD_PLAIN = 1500;  // 纯文字提示
            const TOAST_MAX_TOTAL = 8000;   // 同一条就地刷新最多占用这么久，免得别的会话一直排不上
            const TOAST_MIN_TAIL = 1500;    // 预算不足这么多时就不再顺延，让它到点收起（内容仍是最新的）

            // 收起动作：自动超时和"点击跳转"共用一份，
            // 免得点击跳转后旧的超时定时器又把 isToastVisible 复位一次、把下一条提前挤出来。
            let _toastHideTimer = null;
            let _toastNextTimer = null;
            let _toastCurrentChatId = null; // 正在显示的是哪个会话（同会话的后续消息就地替换，不排队）
            let _toastShownAt = 0;          // 这一条最初出现的时刻（就地刷新不更新它，用于算总占用上限）
            function dismissToast(toastElement) {
                clearTimeout(_toastHideTimer);
                clearTimeout(_toastNextTimer);
                _toastCurrentChatId = null;
                toastElement.classList.remove('show');
                // 等隐藏动画（0.5秒）结束后，处理下一条
                _toastNextTimer = setTimeout(() => {
                    isToastVisible = false;
                    processToastQueue();
                }, 500);
            }

            // 把一条通知的内容填进通知条，返回可跳转的会话 id（没有则 null）。
            // 新弹一条和"就地换成最新那条"共用这段，两条路径的外观/点击行为不会漂移。
            function renderToastContent(toastElement, notification) {
                const avatarEl = toastElement.querySelector('.toast-avatar');
                const nameEl = toastElement.querySelector('.toast-name');
                const messageEl = toastElement.querySelector('.toast-message');
                const isRichNotification = typeof notification === 'object' && notification !== null && notification.name;

                if (isRichNotification) {
                    toastElement.classList.remove('simple');
                    avatarEl.style.display = 'block';
                    nameEl.style.display = 'block';
                    messageEl.style.textAlign = 'left';
                    const avatarUrl = notification.avatar || './png/avatar_default.jpg';
                    // 就地替换时头像多半没变，同一个 URL 别重新赋值，免得闪一下
                    if (avatarEl.getAttribute('src') !== avatarUrl) avatarEl.src = avatarUrl;
                    nameEl.textContent = notification.name;
                    messageEl.textContent = notification.message;
                } else {
                    toastElement.classList.add('simple');
                    avatarEl.style.display = 'none';
                    nameEl.style.display = 'none';
                    messageEl.style.textAlign = 'center';
                    messageEl.textContent = notification;
                }

                // ── 点击跳转 ──
                // 带了 chatId 的通知（在别的页面收到新消息时弹的那种）可以点，
                // 点一下直接进对应聊天室；纯文字提示不给点击态。
                const jumpId = isRichNotification ? notification.chatId : null;
                const jumpType = isRichNotification ? (notification.chatType || 'private') : null;
                toastElement.classList.toggle('clickable', !!jumpId);
                toastElement.onclick = jumpId ? () => {
                    dismissToast(toastElement);
                    if (typeof openChatRoom !== 'function') return;
                    window.currentChatId = jumpId;
                    window.currentChatType = jumpType;
                    openChatRoom(jumpId, jumpType);
                } : null;
                return jumpId || null;
            }


                                                        function processToastQueue() {
                if (isToastVisible || notificationQueue.length === 0) {
                    return;
                }

                isToastVisible = true;
                const notification = notificationQueue.shift(); // 取出队列中的第一个通知

                const toastElement = document.getElementById('toast-notification');
                const jumpId = renderToastContent(toastElement, notification);
                _toastCurrentChatId = jumpId;
                _toastShownAt = Date.now();

                toastElement.classList.add('show');

                // 设置定时器，在通知显示一段时间后将其隐藏
                // 可点击的通知留久一点，1.5 秒不够手指反应过来
                _toastHideTimer = setTimeout(() => dismissToast(toastElement), jumpId ? TOAST_HOLD_RICH : TOAST_HOLD_PLAIN);
            }

            const showToast = (notification) => {
                // ★ 同一会话连发多条时不排队。
                // AI 一次回复会连着推好几条消息，逐条排队的话每条至少占 3.5+0.5 秒，
                // 聊天列表那边消息早就出完了，通知条还在一条条慢慢演，点进去看到的和通知里
                // 写的不是同一条。所以同会话的后续消息直接把当前这条的内容换成最新的，
                // 频率跟着消息走；只有跨会话才真正排队。
                const isRich = typeof notification === 'object' && notification !== null && notification.name;
                if (isRich && notification.chatId && isToastVisible
                    && _toastCurrentChatId === notification.chatId) {
                    const toastElement = document.getElementById('toast-notification');
                    if (toastElement && toastElement.classList.contains('show')) {
                        renderToastContent(toastElement, notification);
                        // 内容换成最新的了，但收起时间不是无条件顺延：
                        // 整条通知的总驻留有 TOAST_MAX_TOTAL 上限，一直刷屏时不能让它无限续命
                        // 把别的会话饿死。预算够就重新计时，见底就沿用已排好的定时器
                        // ——内容仍是最新的，只是不再延长，到点收起。
                        const budget = TOAST_MAX_TOTAL - (Date.now() - _toastShownAt);
                        if (budget >= TOAST_MIN_TAIL) {
                            clearTimeout(_toastHideTimer);
                            _toastHideTimer = setTimeout(
                                () => dismissToast(toastElement),
                                Math.min(TOAST_HOLD_RICH, budget)
                            );
                        }
                        return;
                    }
                }
                // 队列里已经有同会话的待弹项时，同样只留最新那条，不要堆一串
                if (isRich && notification.chatId) {
                    for (let i = notificationQueue.length - 1; i >= 0; i--) {
                        const q = notificationQueue[i];
                        if (q && typeof q === 'object' && q.chatId === notification.chatId) {
                            notificationQueue.splice(i, 1);
                        }
                    }
                }
                notificationQueue.push(notification); // 将通知加入队列
                processToastQueue(); // 尝试处理队列
            };
            

           // 显示持久化的加载提示 (居中 + showToast风格)
            function showLoadingToast(message) {
                // 1. 创建元素
                const toast = document.createElement('div');
                toast.className = 'toast loading'; // 应用我们刚才写的 CSS 类

                // 2. 填充内容 (Spinner + 文字)
                toast.innerHTML = `
        <div class="toast-spinner"></div>
        <div style="font-size: 15px; font-weight: 500; color: #333;">${message}</div>
    `;

                // 3. 添加到页面
                document.body.appendChild(toast);

                // 4. 触发显示动画 (微小延迟确保 CSS transition 生效)
                requestAnimationFrame(() => {
                    toast.classList.add('show');
                });

                // 5. 返回一个“关闭函数”，供外部调用以关闭这个提示
                return function hide() {
                    toast.classList.remove('show'); // 淡出
                    // 等待淡出动画结束后从 DOM 移除
                    setTimeout(() => {
                        if (toast.parentNode) toast.parentNode.removeChild(toast);
                    }, 300);
                };
            }

// ── 页面忙锁 ────────────────────────────────────────────────────────
// 用于"中途离开会留下半成品"的操作（备份导出/导入、全盘扫描等）：
// 锁住所在页面的全部控件（含返回按钮，靠 .ui-busy 的 CSS 置灰 + 屏蔽点击），
// 同时让三条返回通道一起失效 —— 界面返回按钮走 main.js 的导航代理，
// 另外两条是 swipe_back.js 的滑动返回和 system_back.js 的安卓返回键。
// 只挡用户手势，不挡程序内部的 switchScreen（导入完成后的跳转/刷新照常）。
//
// 计数而不是布尔：同一页面可能叠着两个操作（存储统计还在跑就点了导出），
// 先结束的那个不能把锁提前解掉。
let _uiBusyDepth = 0;

window.isUiBusy = () => _uiBusyDepth > 0;

/**
 * 开始一个忙状态。返回解锁函数 —— **必须放在 finally 里调**，
 * 否则中途抛错会把界面永久锁死（showToast 之类抛错会跳过 catch 段）。
 * 返回的函数可重复调用，只有第一次生效。
 * @param {string} [screenId] 要锁的页面 id，省略则锁当前 .screen.active
 */
window.beginUiBusy = function (screenId) {
    const el = screenId
        ? document.getElementById(screenId)
        : document.querySelector('.screen.active');
    if (el) el.classList.add('ui-busy');
    _uiBusyDepth++;

    let released = false;
    return function endUiBusy() {
        if (released) return;
        released = true;
        _uiBusyDepth = Math.max(0, _uiBusyDepth - 1);
        if (_uiBusyDepth === 0) {
            // 锁全部解开才清 class：叠加的两个操作用的可能是同一个页面元素
            document.querySelectorAll('.screen.ui-busy')
                .forEach(s => s.classList.remove('ui-busy'));
        }
    };
};


// 动态修改安卓状态栏颜色
function setAndroidThemeColor(color) {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
        meta = document.createElement('meta');
        meta.name = "theme-color";
        document.head.appendChild(meta);
    }
    meta.content = color;
}

// ================================================================
// === 新增：统一的顶部状态栏颜色管理引擎
// ================================================================
function updateThemeColorForScreen(targetId, targetScreen) {
    if (typeof setAndroidThemeColor !== 'function') return;

    // 1. 最高优先级：如果通话界面处于打开状态，强制黑色
    const callOverlay = document.getElementById('call-overlay');
    if (callOverlay && callOverlay.style.display !== 'none') {
        setAndroidThemeColor('#080808');
        document.body.style.backgroundColor = '#080808';
        return;
    }

    // 2. 主页特殊处理
    if (targetId === 'home-screen' && typeof window.db !== 'undefined') {
        setAndroidThemeColor(window.db.homeStatusBarColor || '#FFFFFF');
        document.body.style.backgroundColor = window.db.homeNavigationBarColor || '#FFFFFF';
        return;
    }

    // 3. 🎯 【关键处理】角色主页、用户主页的特殊处理
    if (targetId === 'persona-edit-screen' || targetId === 'character-edit-screen' || targetId === 'peek-memo-detail-screen') {
        setAndroidThemeColor('#f2f2f7'); // 替换为护眼灰
        document.body.style.backgroundColor = '#f2f2f7';
        return;
    }

    // 4. 其他常规页面：动态抓取 header 颜色
    if (!targetScreen) {
        targetScreen = document.getElementById(targetId);
    }
    if (!targetScreen) return;

    requestAnimationFrame(() => {
        const header = targetScreen.querySelector('.app-header');
        if (header) {
            const bgColor = window.getComputedStyle(header).backgroundColor;
            if (bgColor === 'rgba(0, 0, 0, 0)' || bgColor === 'transparent') {
                setAndroidThemeColor('#FFFFFF');
                document.body.style.backgroundColor = '#FFFFFF';
            } else {
                setAndroidThemeColor(bgColor);
                document.body.style.backgroundColor = bgColor;
            }
        } else {
            setAndroidThemeColor('#FFFFFF');
            document.body.style.backgroundColor = '#FFFFFF';
        }
    });
}

// ================================================================
// === 新增：自动监听通话界面 (call-overlay) 的隐现状态
// ================================================================
document.addEventListener('DOMContentLoaded', () => {
    const callOverlay = document.getElementById('call-overlay');
    if (callOverlay) {
        // 创建一个观察器，随时盯着通话界面的 style.display 变动
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'style') {
                    if (callOverlay.style.display !== 'none') {
                        // 通话界面弹出了 -> 立刻变深色
                        if (typeof setAndroidThemeColor === 'function') {
                            setAndroidThemeColor('#080808');
                            document.body.style.backgroundColor = '#080808';
                        }
                    } else {
                        // 通话界面挂断关闭了 -> 恢复当前屏幕本来的颜色
                        const activeScreen = document.querySelector('.screen.active');
                        if (activeScreen) {
                            updateThemeColorForScreen(activeScreen.id, activeScreen);
                        }
                    }
                }
            });
        });
        // 绑定监听
        observer.observe(callOverlay, { attributes: true, attributeFilter: ['style'] });
    }
});



// 压缩图片

            async function compressImage(file, options = {}) {
                const {
                    quality = 0.8, maxWidth = 800, maxHeight = 800
                } = options;

                // --- 新增：处理GIF动图 ---
                // 如果文件是GIF，则不经过canvas压缩，直接返回原始文件数据以保留动画
                if (file.type === 'image/gif') {
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.readAsDataURL(file);
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = error => reject(error);
                    });
                }

                // --- 对其他静态图片（如PNG, JPG）进行压缩 ---
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsDataURL(file);
                    reader.onerror = reject;
                    reader.onload = (event) => {
                        const img = new Image();
                        img.src = event.target.result;
                        img.onerror = reject;
                        img.onload = () => {
                            let width = img.width;
                            let height = img.height;

                            if (width > height) {
                                if (width > maxWidth) {
                                    height = Math.round(height * (maxWidth / width));
                                    width = maxWidth;
                                }
                            } else {
                                if (height > maxHeight) {
                                    width = Math.round(width * (maxHeight / height));
                                    height = maxHeight;
                                }
                            }

                            const canvas = document.createElement('canvas');
                            canvas.width = width;
                            canvas.height = height;
                            const ctx = canvas.getContext('2d');

                            // 对于有透明背景的PNG图片，先填充一个白色背景
                            // 这样可以防止透明区域在转换成JPEG时变黑
                            if (file.type === 'image/png') {
                                ctx.fillStyle = '#FFFFFF'; // 白色背景
                                ctx.fillRect(0, 0, width, height);
                            }

                            ctx.drawImage(img, 0, 0, width, height);

                            // --- 关键修正：将输出格式改为 'image/jpeg' ---
                            // JPEG格式可以显著减小文件大小，避免浏览器处理超大Base64字符串时崩溃
                            const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                            resolve(compressedDataUrl);
                        };
                    };
                });
            }
            
 // --- 通用复制函数 (兼容所有环境) ---
        async function copyTextToClipboard(text) {
            if (!text) return Promise.reject('没有内容可复制');

            // 优先尝试标准 API (需要 HTTPS 或 localhost)
            if (navigator.clipboard && window.isSecureContext) {
                try {
                    await navigator.clipboard.writeText(text);
                    return Promise.resolve();
                } catch (err) {
                    console.warn('Clipboard API failed, trying fallback...', err);
                }
            }

            // 回退方案：使用传统的 textarea + execCommand
            // 这种方法在绝大多数 Webview 和 HTTP 环境下都能工作
            return new Promise((resolve, reject) => {
                try {
                    const textArea = document.createElement("textarea");
                    textArea.value = text;
                    
                    // 防止在移动端拉起键盘或造成页面滚动
                    textArea.style.position = "fixed";
                    textArea.style.left = "-9999px";
                    textArea.style.top = "0";
                    textArea.setAttribute("readonly", "");
                    
                    document.body.appendChild(textArea);
                    textArea.focus();
                    textArea.select();
                    
                    const successful = document.execCommand('copy');
                    document.body.removeChild(textArea);
                    
                    if (successful) {
                        resolve();
                    } else {
                        reject(new Error('execCommand returned false'));
                    }
                } catch (err) {
                    reject(err);
                }
            });
        }
        
 // ==========================================================
// === AppUI: 全局通用 UI 工具 (复用 components.css 样式) ===
// ==========================================================
const AppUI = {
    /**
     * 基础显示函数
     */
    show({ title = "提示", content = "", type = "alert", placeholder = "", confirmText = "确定", cancelText = "取消" } = {}) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('app-global-dialog');
            const titleEl = document.getElementById('global-dialog-title');
            const contentEl = document.getElementById('global-dialog-content');
            const actionsEl = document.getElementById('global-dialog-actions');
            const inputContainer = document.getElementById('global-dialog-input-container');
            const inputEl = document.getElementById('global-dialog-input');

            if (!overlay) return resolve(false);

            // 1. 设置内容
            titleEl.innerText = title;
            contentEl.innerText = content;
            actionsEl.innerHTML = '';
            
            // 2. 初始化输入框状态
            inputContainer.style.display = 'none';
            inputEl.value = '';
            
            const close = () => {
                overlay.classList.remove('visible');
                inputEl.onkeydown = null;
            };

            // 辅助：创建复用样式的按钮
            // cls 传入 'btn-primary', 'btn-neutral', 'btn-danger' 等
            const createBtn = (text, cls, onClick) => {
                const btn = document.createElement('button');
                // 【关键】这里复用了你 components.css 中的 .btn 类
                btn.className = `btn ${cls}`; 
                // 如果是双按钮，让它们平分宽度；单按钮则自适应
                btn.style.flex = "1"; 
                btn.style.padding = "10px"; // 稍微调整内边距适应弹窗
                btn.innerText = text;
                btn.onclick = (e) => {
                    e.stopPropagation();
                    close();
                    onClick();
                };
                return btn;
            };

            // 3. 根据类型生成按钮
            if (type === 'alert') {
                // 单个按钮使用主色调
                const btn = createBtn(confirmText, "btn-primary", () => resolve(true));
                actionsEl.appendChild(btn);
                setTimeout(() => btn.focus(), 50);
            } 
            else if (type === 'confirm') {
                // 取消用灰色(neutral)，确定用主色(primary)
                const cancelBtn = createBtn(cancelText, "btn-neutral", () => resolve(false));
                const confirmBtn = createBtn(confirmText, "btn-primary", () => resolve(true));               
                actionsEl.appendChild(confirmBtn);
                actionsEl.appendChild(cancelBtn);
            } 
            else if (type === 'prompt') {
                inputContainer.style.display = 'block';
                inputEl.placeholder = placeholder;

                const cancelBtn = createBtn(cancelText, "btn-neutral", () => resolve(null));
                const confirmBtn = createBtn(confirmText, "btn-primary", () => resolve(inputEl.value));
                actionsEl.appendChild(confirmBtn);
                actionsEl.appendChild(cancelBtn);

                setTimeout(() => inputEl.focus(), 50);
                
                inputEl.onkeydown = (e) => {
                    if (e.key === 'Enter') confirmBtn.click();
                };
            }

            // 4. 显示弹窗 (复用 visible 类触发动画)
            overlay.classList.add('visible');

            // 5. 长文案时给正文区加分隔线（高度限制与滚动由 CSS 负责）
            contentEl.classList.remove('is-scrollable');
            contentEl.scrollTop = 0;
            requestAnimationFrame(() => {
                if (contentEl.scrollHeight > contentEl.clientHeight + 1) {
                    contentEl.classList.add('is-scrollable');
                }
            });
        });
    },

    // --- 快捷方法 (保持不变) ---
    async alert(content, title = "提示", btnText = "我知道了") {
        return this.show({ type: 'alert', content, title, confirmText: btnText });
    },

async confirm(content, title = "确认操作", confirmText = "确定", cancelText = "取消") {
        return this.show({ type: 'confirm', content, title, confirmText, cancelText });
    },

    async prompt(content, placeholder = "", title = "请输入", confirmText = "确定", cancelText = "取消") {
        return this.show({ type: 'prompt', content, placeholder, title, confirmText, cancelText });
    }, // <--- 注意：这里必须要加一个逗号

    /**
     * 多行文本弹窗（textarea 版 prompt）。
     * 清单/长文本用这个，别用 prompt —— 那个是单行 input，回车会直接当"确定"，换行根本进不去。
     * 这里回车就是换行，要提交用底部按钮或 Ctrl/Cmd + Enter。
     * @param {string} content 正文说明
     * @param {object} opts { value, placeholder, title, rows, confirmText, cancelText }
     * @returns {Promise<string|null>} 确定=textarea 里的原始文本（不做 trim），取消=null
     */
    async promptMultiline(content, {
        value = '', placeholder = '', title = '编辑',
        rows = 8, confirmText = '保存', cancelText = '取消'
    } = {}) {
        return new Promise((resolve) => {
            const overlay        = document.getElementById('app-global-dialog');
            const titleEl        = document.getElementById('global-dialog-title');
            const contentEl      = document.getElementById('global-dialog-content');
            const actionsEl      = document.getElementById('global-dialog-actions');
            const inputContainer = document.getElementById('global-dialog-input-container');

            if (!overlay) return resolve(null);

            titleEl.innerText   = title;
            contentEl.innerText = content || '';
            contentEl.classList.remove('is-scrollable');
            contentEl.scrollTop = 0;
            actionsEl.innerHTML = '';

            // 和 form() 同一套劫持手法：原有子节点整体存下来，关闭时原样塞回。
            // 别学 select() 那样关闭时硬拼 innerHTML 还原——两个弹窗叠开时后关的会冲掉前面的 DOM。
            const savedNodes   = Array.from(inputContainer.childNodes);
            const savedDisplay = inputContainer.style.display;
            inputContainer.innerHTML = '';
            inputContainer.style.display = 'block';

            const area = document.createElement('textarea');
            area.className   = 'appui-textarea';
            area.rows        = rows;
            area.placeholder = placeholder;
            area.value       = value == null ? '' : String(value);
            area.autocomplete = 'off';
            area.spellcheck   = false;
            inputContainer.appendChild(area);

            const close = () => {
                overlay.classList.remove('visible');
                area.onkeydown = null;
                inputContainer.innerHTML = '';
                savedNodes.forEach(node => inputContainer.appendChild(node));
                inputContainer.style.display = savedDisplay || 'none';
            };

            const createBtn = (text, cls, onClick) => {
                const btn = document.createElement('button');
                btn.className     = `btn ${cls}`;
                btn.style.flex    = '1';
                btn.style.padding = '10px';
                btn.innerText     = text;
                btn.onclick = (e) => { e.stopPropagation(); close(); onClick(); };
                return btn;
            };

            // 取值必须在 close() 之前读，close 会把 textarea 从 DOM 里摘掉
            const cancelBtn  = createBtn(cancelText,  'btn-neutral', () => resolve(null));
            const confirmBtn = document.createElement('button');
            confirmBtn.className     = 'btn btn-primary';
            confirmBtn.style.flex    = '1';
            confirmBtn.style.padding = '10px';
            confirmBtn.innerText     = confirmText;
            confirmBtn.onclick = (e) => {
                e.stopPropagation();
                const text = area.value;
                close();
                resolve(text);
            };
            actionsEl.appendChild(confirmBtn);
            actionsEl.appendChild(cancelBtn);

            // 回车留给换行，Ctrl/Cmd + Enter 才是提交
            area.onkeydown = (e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    confirmBtn.click();
                }
            };

            overlay.classList.add('visible');
            setTimeout(() => area.focus(), 50);
        });
    },

    /**
     * 下拉选择弹窗
     * @param {Array<{value:string, label:string}>} options  选项列表
     * @param {object} opts  { title, confirmText, cancelText }
     * @returns {Promise<string|null>}  返回选中的 value，取消返回 null
     */
    async select(options = [], { title = '请选择', confirmText = '确定', cancelText = '取消' } = {}) {
        return new Promise((resolve) => {
            const overlay        = document.getElementById('app-global-dialog');
            const titleEl        = document.getElementById('global-dialog-title');
            const contentEl      = document.getElementById('global-dialog-content');
            const actionsEl      = document.getElementById('global-dialog-actions');
            const inputContainer = document.getElementById('global-dialog-input-container');

            if (!overlay) return resolve(null);

            titleEl.innerText   = title;
            contentEl.innerText = '';
            contentEl.classList.remove('is-scrollable');
            actionsEl.innerHTML = '';

            // 把 input-container 里的 input 临时替换成 select
            inputContainer.style.display = 'block';
            inputContainer.innerHTML = `
                <select id="global-dialog-select" class="appui-select">
                    ${options.map(o =>
                        `<option value="${String(o.value).replace(/"/g,'&quot;')}">${o.label}</option>`
                    ).join('')}
                </select>`;

            const close = () => {
                overlay.classList.remove('visible');
                // 还原 input-container 为原始 input，避免影响后续弹窗
                inputContainer.innerHTML = '<input type="text" id="global-dialog-input" autocomplete="off">';
                inputContainer.style.display = 'none';
            };

            const createBtn = (text, cls, onClick) => {
                const btn = document.createElement('button');
                btn.className   = `btn ${cls}`;
                btn.style.flex  = '1';
                btn.style.padding = '10px';
                btn.innerText   = text;
                btn.onclick = (e) => { e.stopPropagation(); close(); onClick(); };
                return btn;
            };

            const cancelBtn  = createBtn(cancelText,  'btn-neutral', () => resolve(null));
            const confirmBtn = createBtn(confirmText, 'btn-primary',  () => {
                const sel = document.getElementById('global-dialog-select');
                resolve(sel ? sel.value : null);
            });
            actionsEl.appendChild(confirmBtn);
            actionsEl.appendChild(cancelBtn);

            overlay.classList.add('visible');
        });
    },

    /**
     * 通用多字段表单弹窗（复用 components.css / api.css 的 .form-group、.switch 样式，不新增 CSS）
     * @param {Array<{type:'select'|'switch'|'text'|'note', key:string, label:string, options?:Array<{value:string,label:string}>, value?:any, placeholder?:string, hint?:string}>} fields
     *        note 类型只展示不可编辑，也不会出现在返回的结果里（给"这个值在别处改"用）
     * @param {object} opts { title, confirmText, cancelText }
     * @returns {Promise<object|null>} 返回 { key: value } 映射；取消返回 null
     */
    async form(fields = [], { title = '设置', confirmText = '保存', cancelText = '取消' } = {}) {
        return new Promise((resolve) => {
            const overlay        = document.getElementById('app-global-dialog');
            const titleEl        = document.getElementById('global-dialog-title');
            const contentEl      = document.getElementById('global-dialog-content');
            const actionsEl      = document.getElementById('global-dialog-actions');
            const inputContainer = document.getElementById('global-dialog-input-container');

            if (!overlay) return resolve(null);

            titleEl.innerText   = title;
            contentEl.innerText = '';
            contentEl.classList.remove('is-scrollable');
            actionsEl.innerHTML = '';

            // 劫持 input-container：把原有子节点整体存下来，关闭时原样塞回。
            // 注意别学 select() 那样关闭时硬拼 innerHTML 还原——两个弹窗叠开时，后关的会冲掉前面的 DOM。
            const savedNodes   = Array.from(inputContainer.childNodes);
            const savedDisplay = inputContainer.style.display;
            inputContainer.innerHTML = '';
            inputContainer.style.display = 'block';

            // key -> 读值函数
            const readers = new Map();

            fields.forEach(field => {
                const row = document.createElement('div');
                row.className = field.type === 'switch' ? 'form-group form-group-switch' : 'form-group';

                const labelEl = document.createElement('label');
                labelEl.innerText = field.label || field.key;
                row.appendChild(labelEl);

                if (field.type === 'note') {
                    // 只展示、不可编辑、不参与取值。用于"这个值在别处改"这类场景，
                    // 比如云端同步弹框里显示当前用的仓库并指路去哪改。
                    const noteEl = document.createElement('div');
                    noteEl.className = 'appui-note';
                    noteEl.innerText = field.value == null ? '' : String(field.value);
                    row.appendChild(noteEl);
                    if (field.hint) {
                        const hintEl = document.createElement('div');
                        hintEl.className = 'appui-note-hint';
                        hintEl.innerText = field.hint;
                        row.appendChild(hintEl);
                    }
                    // 故意不 readers.set —— note 不该出现在返回值里
                } else if (field.type === 'select') {
                    const sel = document.createElement('select');
                    sel.className = 'appui-select';
                    (field.options || []).forEach(o => {
                        const opt = document.createElement('option');
                        opt.value = String(o.value);
                        opt.textContent = o.label;
                        sel.appendChild(opt);
                    });
                    sel.value = String(field.value == null ? '' : field.value);
                    row.appendChild(sel);
                    readers.set(field.key, () => sel.value);
                } else if (field.type === 'switch') {
                    const sw = document.createElement('label');
                    sw.className = 'switch';
                    const box = document.createElement('input');
                    box.type = 'checkbox';
                    box.checked = !!field.value;
                    const slider = document.createElement('span');
                    slider.className = 'slider round';
                    sw.appendChild(box);
                    sw.appendChild(slider);
                    row.appendChild(sw);
                    readers.set(field.key, () => box.checked);
                } else {
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.autocomplete = 'off';
                    input.placeholder = field.placeholder || '';
                    input.value = field.value == null ? '' : String(field.value);
                    row.appendChild(input);
                    readers.set(field.key, () => input.value);
                }

                inputContainer.appendChild(row);
            });

            const close = () => {
                overlay.classList.remove('visible');
                inputContainer.innerHTML = '';
                savedNodes.forEach(node => inputContainer.appendChild(node));
                inputContainer.style.display = savedDisplay || 'none';
            };

            const createBtn = (text, cls, onClick) => {
                const btn = document.createElement('button');
                btn.className     = `btn ${cls}`;
                btn.style.flex    = '1';
                btn.style.padding = '10px';
                btn.innerText     = text;
                btn.onclick = (e) => { e.stopPropagation(); close(); onClick(); };
                return btn;
            };

            const cancelBtn  = createBtn(cancelText,  'btn-neutral', () => resolve(null));
            const confirmBtn = createBtn(confirmText, 'btn-primary',  () => {
                const result = {};
                readers.forEach((read, key) => { result[key] = read(); });
                resolve(result);
            });
            actionsEl.appendChild(confirmBtn);
            actionsEl.appendChild(cancelBtn);

            overlay.classList.add('visible');
        });
    },

    /**
     * 先弹窗、后填内容的确认框：点下去立刻有反馈，正文先显示"计算中"且确定按钮禁用，
     * 等异步任务出结果再替换正文并启用确定。避免统计耗时让用户以为没点到而反复点
     * @param {string}   loadingText 计算期间的占位正文
     * @param {Function} task        async 函数，返回最终正文字符串；返回 null 表示无事可做（弹窗自动关闭）
     * @returns {Promise<boolean|null>} 确定=true，取消=false，task 返回 null 时=null
     */
    confirmPending(loadingText, task, { title = '确认操作', confirmText = '确定', cancelText = '取消' } = {}) {
        return new Promise((resolve, reject) => {
            const overlay        = document.getElementById('app-global-dialog');
            const titleEl        = document.getElementById('global-dialog-title');
            const contentEl      = document.getElementById('global-dialog-content');
            const actionsEl      = document.getElementById('global-dialog-actions');
            const inputContainer = document.getElementById('global-dialog-input-container');
            if (!overlay) return resolve(false);

            let settled = false;

            titleEl.innerText   = title;
            contentEl.innerText = loadingText;
            contentEl.classList.remove('is-scrollable');
            actionsEl.innerHTML = '';
            if (inputContainer) inputContainer.style.display = 'none';

            const close = () => { settled = true; overlay.classList.remove('visible'); };

            const createBtn = (text, cls, onClick) => {
                const btn = document.createElement('button');
                btn.className     = `btn ${cls}`;
                btn.style.flex    = '1';
                btn.style.padding = '10px';
                btn.innerText     = text;
                btn.onclick = (e) => { e.stopPropagation(); close(); onClick(); };
                return btn;
            };

            const confirmBtn = createBtn(confirmText, 'btn-primary', () => resolve(true));
            const cancelBtn  = createBtn(cancelText,  'btn-neutral', () => resolve(false));

            // 计算完成前禁用确定，只能取消
            // 禁用时用灰色（和取消按钮一致），别让它看起来还能点
            confirmBtn.disabled = true;
            confirmBtn.className = 'btn btn-neutral';

            actionsEl.appendChild(confirmBtn);
            actionsEl.appendChild(cancelBtn);
            overlay.classList.add('visible');

            Promise.resolve()
                .then(task)
                .then(text => {
                    if (settled) return;                     // 用户已经点了取消
                    if (text === null || text === undefined) { close(); resolve(null); return; }
                    contentEl.innerText = text;
                    confirmBtn.disabled = false;
                    confirmBtn.className = 'btn btn-primary';   // 可用了才亮起主色
                    requestAnimationFrame(() => {
                        if (contentEl.scrollHeight > contentEl.clientHeight + 1) {
                            contentEl.classList.add('is-scrollable');
                        }
                    });
                })
                .catch(err => { if (!settled) close(); reject(err); });
        });
    },

    /**
     * 进度弹窗：复用同一个全局弹窗，正文可实时更新，底部只有一个「停止」按钮
     * 不返回 Promise，直接返回控制句柄，由调用方在循环里驱动
     * @returns {{ update:(text:string)=>void, isStopped:()=>boolean, close:()=>void }}
     */
    progress(content = '处理中…', { title = '请稍候', stopText = '停止' } = {}) {
        const overlay        = document.getElementById('app-global-dialog');
        const titleEl        = document.getElementById('global-dialog-title');
        const contentEl      = document.getElementById('global-dialog-content');
        const actionsEl      = document.getElementById('global-dialog-actions');
        const inputContainer = document.getElementById('global-dialog-input-container');

        let stopped = false;
        if (!overlay) return { update() {}, isStopped: () => stopped, close() {} };

        titleEl.innerText   = title;
        contentEl.innerText = content;
        contentEl.classList.remove('is-scrollable');
        actionsEl.innerHTML = '';
        if (inputContainer) inputContainer.style.display = 'none';

        const btn = document.createElement('button');
        btn.className     = 'btn btn-neutral';
        btn.style.flex    = '1';
        btn.style.padding = '10px';
        btn.innerText     = stopText;
        btn.onclick = (e) => {
            e.stopPropagation();
            stopped = true;
            btn.innerText = '正在停止…';
            btn.disabled  = true;
        };
        actionsEl.appendChild(btn);

        overlay.classList.add('visible');

        return {
            update: (text) => { contentEl.innerText = text; },
            // 弹窗被别的方式关掉（比如系统返回键）也视为停止，避免任务在后台闷头跑
            isStopped: () => stopped || !overlay.classList.contains('visible'),
            close: () => {
                overlay.classList.remove('visible');
                actionsEl.innerHTML = '';
            }
        };
    }

};

// ================================================================
// === AppHelp: 小标题右边的问号说明 ==============================
// ================================================================
// 设置类页面上大段的说明文字会把设置项本身挤没了，所以统一收进问号弹窗：
//   · 小标题右边一个问号 → 讲这一段
//   · app-header 右边一个 action-btn → 讲整个页面
// 页面上只留一句话都不留，需要的人点问号，不需要的人眼里就是干净的设置列表。
//
// ★ 文案不集中放在这个文件里 —— 每个页面模块自己 register 自己的那几条，
//   改功能的时候文案就在手边，不用跨文件找，也不会攒成一个几百行的大字典。
//   这里只管"存"和"弹"两件事。
//
// 用法：
//   模块加载时（js/settings/github_repos.js 那样）：
//     AppHelp.register('github', {
//         page: { title: '关于 GitHub 仓库', content: '……' },
//         repo: { title: '仓库配置说明',     content: () => `……` }   // 函数 = 点开时才生成
//     });
//   HTML 里（notification-settings-screen / github-repos-screen 那样）：
//     <svg class="settings-group-info-icon" onclick="showHelp('github','repo')" …>
//
// ★ 正文走 AppUI.alert，而 AppUI 用的是 innerText —— 换行写 \n，不要写 <br>。
// ================================================================
const AppHelp = {
    // scope（页面名）→ { key: {title, content} }。scope 是为了让不同页面能各用
    // 各自的 'page'、'repo' 这种短 key，不用担心撞车
    _scopes: {},

    /**
     * 注册说明文案。同一个 scope 可以多次调用，结果是合并 —— 一个页面拆成
     * 几个模块时，各自注册自己那几条即可
     * @param {string} scope  页面/模块名，如 'notify'、'github'
     * @param {Object} topics { key: {title, content} }；value 直接给字符串时标题用默认值
     */
    register(scope, topics) {
        if (!scope || !topics) return;
        const bucket = this._scopes[scope] || (this._scopes[scope] = {});
        Object.keys(topics).forEach(key => {
            const topic = topics[key];
            bucket[key] = (typeof topic === 'string' || typeof topic === 'function')
                ? { title: '说明', content: topic }
                : topic;
        });
    },

    /** 取一条，没注册返回 null */
    get(scope, key) {
        const bucket = this._scopes[scope];
        return (bucket && bucket[key]) || null;
    },

    /**
     * 弹出说明。content 允许是函数，点开的那一刻才求值 ——
     * 像"用途列表"这种内容跟着数据变的说明，写死字符串就会过期
     */
    show(scope, key) {
        const topic = this.get(scope, key);
        if (!topic) {
            console.warn(`[AppHelp] 未注册的说明：${scope}/${key}`);
            return;
        }
        const title = topic.title || '说明';
        let content = topic.content;
        if (typeof content === 'function') {
            try {
                content = content();
            } catch (err) {
                // 说明文案生成失败不该把页面带崩，退化成一句话就行
                console.warn(`[AppHelp] ${scope}/${key} 文案生成失败`, err);
                content = '说明加载失败了。';
            }
        }
        if (typeof AppUI !== 'undefined' && typeof AppUI.alert === 'function') {
            AppUI.alert(String(content || ''), title, '我知道了');
        } else {
            alert(`【${title}】\n\n${content}`);
        }
    }
};
window.AppHelp = AppHelp;

// HTML 的 onclick 里用的短名字：showHelp('github', 'repo')
window.showHelp = function (scope, key) { AppHelp.show(scope, key); };

// ================================================================
// === historyToPlainText: 聊天记录转纯文本（过滤图片等非文本内容）===
// ================================================================
function historyToPlainText(history) {
    if (!Array.isArray(history)) return '';
    return history
        .filter(m => typeof m.content === 'string' && !m.content.startsWith('data:'))
        .map(m => m.content)
        .join('\n');
}

// ================================================================
// === findGroupMemberById: 按 senderId 找群成员，退群的从归档里找 ===
//   被移出群聊的成员会从 group.members 挪到 group.removedMembers，
//   但他们留下的历史消息仍要显示原来的头像和群昵称，所以渲染侧统一走这里。
// ================================================================
function findGroupMemberById(group, senderId) {
    if (!group || !senderId) return null;
    return (group.members || []).find(m => m.id === senderId)
        || (group.removedMembers || []).find(m => m.id === senderId)
        || null;
}
window.findGroupMemberById = findGroupMemberById;

// ================================================================
// === getRandomValue: 多 Key 轮换（逗号分隔时随机取一个）===
//   Gemini 等按 Key 限流的服务商可以在设置里填多个 Key 摊平配额。
//   调用方：chat_ai_service.js、chat_feature_basic.js、chat_feature_proactive.js、
//           settings/api_settings.js 的拉取模型。原先住在那个文件里，
//           但它跟"API 设置页"无关，是纯工具函数，故归到 core。
// ================================================================
function getRandomValue(str) {
    if (str.includes(',')) {
        const arr = str.split(',').map(s => s.trim());
        return arr[Math.floor(Math.random() * arr.length)];
    }
    return str;
}
window.getRandomValue = getRandomValue;

// ================================================================
// === base64 <-> 字节：语音合成、GitHub 上传下载都要用 ===
//   放在 core 是因为 js/api/tts_api.js 和 js/api/github_repo_api.js
//   都需要它。让后者去调前者的私有函数会形成"仓库模块依赖 TTS 模块"的
//   反向依赖 —— 仓库模块压根不该知道语音的存在。
// ================================================================

/** base64 字符串 → Uint8Array */
function base64ToBytes(b64) {
    const bin = atob(String(b64 || ''));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
}
window.base64ToBytes = base64ToBytes;

/**
 * Uint8Array → base64 字符串。
 * ★ 必须分块。String.fromCharCode.apply 一次传太多参数会爆调用栈
 *   （几十万个参数就炸），而音频动辄几百 KB。
 */
function bytesToBase64(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    const CHUNK = 0x8000;   // 32K 个字符一批，实测安全
    let binary = '';
    for (let i = 0; i < u8.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}
window.bytesToBase64 = bytesToBase64;
