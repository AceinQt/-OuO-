// --- notification_center.js ---
// 系统消息通知中枢（Step 1：总开关 + 权限 + 全局保活时长 + 测试通知）
// 说明：本应用无推送服务器，通知只能在 JS 存活时弹出（前台，或后台保活窗口内）。
//       因此通知与 chat_feature_proactive.js 的"静音音频保活"是配套的。

(function () {
    'use strict';

    const APP_ICON = './icon/icon_cat.png';
    const KEEPALIVE_MIN = 1;
    const KEEPALIVE_MAX = 1440;

    // 读取全局通知设置（带默认值兜底，兼容旧库——旧库缺的新字段在这里补齐）
    function getSettings() {
        const defaults = { enabled: false, keepAliveEnabled: true, keepAliveMinutes: 30, foldMessages: true, showSenderName: true, silent: false, badgeEnabled: true };
        if (!window.db) return defaults;
        if (!db.globalNotifySettings || typeof db.globalNotifySettings !== 'object') {
            db.globalNotifySettings = { ...defaults };
        }
        const s = db.globalNotifySettings;
        if (s.enabled === undefined) s.enabled = defaults.enabled;
        if (s.keepAliveEnabled === undefined) s.keepAliveEnabled = defaults.keepAliveEnabled; // 新增独立开关
        if (s.keepAliveMinutes === undefined) s.keepAliveMinutes = defaults.keepAliveMinutes;
        if (s.foldMessages === undefined) s.foldMessages = defaults.foldMessages;
        if (s.showSenderName === undefined) s.showSenderName = defaults.showSenderName;
        if (s.silent === undefined) s.silent = defaults.silent;
        if (s.badgeEnabled === undefined) s.badgeEnabled = defaults.badgeEnabled; // 新增：桌面角标独立开关
        return s;
    }

    function isSupported() {
        return typeof window !== 'undefined'
            && 'Notification' in window
            && 'serviceWorker' in navigator;
    }

    function permissionState() {
        if (!('Notification' in window)) return 'unsupported';
        return Notification.permission; // 'default' | 'granted' | 'denied'
    }

    // 拿到一个 active 的 ServiceWorkerRegistration。
    // SW 现已注册在根目录（scope '/'，控制根页面），ready 正常可用；
    // 但仍优先用已存下的 __swRegistration，并对 ready 加 3 秒超时兜底，最稳。
    async function getActiveReg() {
        if (window.__swRegistration && window.__swRegistration.active) {
            return window.__swRegistration;
        }
        let reg = null;
        try {
            reg = await navigator.serviceWorker.getRegistration();
            if (!reg) {
                const all = await navigator.serviceWorker.getRegistrations();
                reg = (all && all[0]) || window.__swRegistration || null;
            }
        } catch (_) {
            reg = window.__swRegistration || null;
        }
        if (reg && reg.active) return reg;
        // 还没 active：等一会儿，但最多 3 秒，避免永久挂起
        try {
            return await Promise.race([
                navigator.serviceWorker.ready,
                new Promise(res => setTimeout(() => res(reg || null), 3000))
            ]);
        } catch (_) {
            return reg || null;
        }
    }

    // 核心：弹一条系统通知（经 Service Worker，移动端唯一可靠路径）
    // opts: { tag, renotify, data, silent, force }
    //   force=true 时忽略"仅后台"限制（测试按钮用）
    async function fire(title, body, opts = {}) {
        const s = getSettings();
        if (!opts.force) {
            if (!s.enabled) return false;
            // 仅在后台时弹，避免前台看着页面还弹通知
            if (document.visibilityState !== 'hidden') return false;
        }
        if (!isSupported() || Notification.permission !== 'granted') {
            console.warn('[通知] 未满足弹出条件: supported=', isSupported(), 'perm=', ('Notification' in window) ? Notification.permission : 'n/a');
            return false;
        }

        const reg = await getActiveReg();
        if (!reg || typeof reg.showNotification !== 'function') {
            console.warn('[通知] 拿不到可用的 Service Worker registration，无法弹通知。reg=', reg);
            return false;
        }
        console.log('[通知] 使用 registration:', reg.scope, 'active=', !!reg.active);

        try {
            await reg.showNotification(title || '新消息', {
                body: body || '',
                icon: APP_ICON,
                badge: APP_ICON,
                tag: opts.tag || undefined,
                renotify: opts.tag ? (opts.renotify || false) : false,
                silent: opts.silent || false,
                data: opts.data || {}
            });
            return true;
        } catch (e) {
            console.warn('[通知] showNotification 抛错:', e);
            return false;
        }
    }

    // ── 消息内容 → 通知文案 提取 ──────────────────────────────
    function contentOf(message) {
        if (!message) return '';
        if (typeof message.content === 'string') return message.content;
        if (message.parts && message.parts[0] && typeof message.parts[0].text === 'string') {
            return message.parts[0].text;
        }
        return '';
    }

    // 把一条消息转成通知正文预览；返回 '' 表示这条不该弹通知（系统/视觉类）
    function previewOf(message) {
        if (message && message.isWithdrawn) return '撤回了一条消息';
        let t = contentOf(message);
        if (!t) return '';
        // 线下动作旁白(system-narration)是用户能看到的正文，应作为一条消息通知，取其内容预览
        const narr = t.match(/\[system-narration:([\s\S]*)\]/);
        if (narr) {
            let nt = narr[1].trim();
            if (nt.length > 80) nt = nt.slice(0, 80) + '…';
            return nt;
        }
        // 系统 / 视觉类不通知
        if (t.includes('[time-divider]') || t.includes('system-display') || t.startsWith('[system')) return '';
        // 特殊消息类型 → 占位
        if (/(发来的?照片|照片\/视频|的照片)/.test(t)) return '[照片]';
        if (/(发来的?语音|的语音)/.test(t)) return '[语音]';
        if (/(发来的?转账|的转账)/.test(t)) return '[转账]';
        if (/(送来的?礼物|的礼物)/.test(t)) return '[礼物]';
        // 去掉 [名字的消息：正文] 之类的包装
        if (t.startsWith('[')) {
            const m = t.match(/^\[[^\]]*?[:：]([\s\S]+?)\]?$/);
            if (m) t = m[1];
        }
        t = t.replace(/^\[+/, '').replace(/\]+$/, '').trim();
        if (t.length > 80) t = t.slice(0, 80) + '…';
        return t;
    }

    function chatDisplayName(chat, chatType) {
        if (!chat) return '新消息';
        if (chatType === 'group') return chat.name || chat.groupName || '群聊';
        return chat.remarkName || chat.realName || chat.name || '新消息';
    }

    function senderName(chat, chatType, message) {
        if (chatType !== 'group') return chatDisplayName(chat, chatType);
        if (message && message.senderId && Array.isArray(chat.members)) {
            const m = chat.members.find(x => x.id === message.senderId);
            if (m) return m.groupNickname || m.realName || m.name || '成员';
        }
        const t = contentOf(message);
        const mm = t.match(/^\[([^\]:：]+?)(?:的消息|发来|的语音|的转账|送来|更新状态|的照片)/);
        if (mm) return mm[1];
        return '群成员';
    }

    // 按"是否显示角色名"开关，构造一条消息的通知标题/正文
    function buildTitleBody(chat, chatType, message, showName) {
        const preview = previewOf(message);
        if (!showName) {
            // 隐藏身份：标题统一"新消息"，正文只给内容，不暴露是谁
            return { title: '新消息', body: preview };
        }
        if (chatType === 'group') {
            return {
                title: chatDisplayName(chat, chatType),
                body: senderName(chat, chatType, message) + '：' + preview
            };
        }
        return { title: chatDisplayName(chat, chatType), body: preview };
    }

    // 后台收到一批新消息时弹通知。messages 为本次新增的消息数组。
    // 受两个开关控制：foldMessages（折叠/分开）、showSenderName（是否显示角色名）。
    async function notifyMessages(chat, chatType, messages) {
        try {
            const s = getSettings();
            const vis = document.visibilityState;
            const perm = ('Notification' in window) ? Notification.permission : 'n/a';
            const cnt = Array.isArray(messages) ? messages.length : 0;
            console.log(`[通知] notifyMessages: enabled=${s.enabled} vis=${vis} perm=${perm} fold=${s.foldMessages} showName=${s.showSenderName} chat=${chat && chat.id} msgs=${cnt}`);

            if (!s.enabled) { console.log('[通知] 跳过：总开关未开'); return; }
            if (vis !== 'hidden') { console.log('[通知] 跳过：前台可见（仅后台弹）'); return; }
            if (!chat || !cnt) { console.log('[通知] 跳过：无 chat 或无消息'); return; }

            const notifiable = messages.filter(m => m && m.role === 'assistant' && previewOf(m));
            if (!notifiable.length) { console.log('[通知] 跳过：无可通知消息（都是系统/视觉类）'); return; }

            const showName = s.showSenderName !== false;
            const silent = s.silent === true;
            const data = { chatId: chat.id, chatType: chatType };

            if (s.foldMessages !== false) {
                // 折叠：同一会话只弹一条，tag 固定，后到的替换先到的
                const last = notifiable[notifiable.length - 1];
                let { title, body } = buildTitleBody(chat, chatType, last, showName);
                if (notifiable.length > 1) body = `[${notifiable.length}条] ` + body;
                console.log(`[通知] 折叠弹出: title="${title}" body="${body}" silent=${silent}`);
                const ok = await fire(title, body, { tag: 'chat-' + chat.id, renotify: true, silent, data });
                console.log('[通知] fire 返回:', ok);
            } else {
                // 分开：每条一个通知，tag 各不相同
                for (const m of notifiable) {
                    const { title, body } = buildTitleBody(chat, chatType, m, showName);
                    const tag = 'msg-' + (m.id || (chat.id + '-' + (m.timestamp || '')));
                    console.log(`[通知] 分开弹出: title="${title}" body="${body}" silent=${silent}`);
                    const ok = await fire(title, body, { tag, renotify: false, silent, data });
                    console.log('[通知] fire 返回:', ok);
                }
            }
        } catch (e) {
            console.warn('[通知] notifyMessages 异常:', e);
        }
    }

    // 供「进阶推送节点」移交时复用：把一批消息按当前通知设置(折叠/显名/静音)
    // 算成最终推送文案。返回 { title, body, tag, silent } 或 null(无可通知内容)。
    // 与本地 notifyMessages 用同一 tag('chat-'+id)，保证 CF 推送与本地投递能折叠去重。
    function buildPushPayload(chat, chatType, messages) {
        const s = getSettings();
        const notifiable = (Array.isArray(messages) ? messages : [])
            .filter(m => m && m.role === 'assistant' && previewOf(m));
        if (!chat || !notifiable.length) return null;

        const showName = s.showSenderName !== false;
        const last = notifiable[notifiable.length - 1];
        let { title, body } = buildTitleBody(chat, chatType, last, showName);
        if (s.foldMessages !== false && notifiable.length > 1) {
            body = `[${notifiable.length}条] ` + body;
        }
        return { title, body, tag: 'chat-' + chat.id, silent: s.silent === true };
    }

    // 请求通知权限（必须在用户手势内调用，例如点击开关）
    async function requestPermission() {
        if (!('Notification' in window)) return 'unsupported';
        if (Notification.permission === 'granted') return 'granted';
        if (Notification.permission === 'denied') return 'denied';
        try {
            const result = await Notification.requestPermission();
            return result;
        } catch (e) {
            console.warn('[通知] 权限请求异常:', e);
            return 'denied';
        }
    }

    // ── 设置页 UI ──────────────────────────────────────────────

function updateHint() {
        const hint = document.getElementById('notify-permission-hint');
        const toggle = document.getElementById('system-notification-toggle');
        const advancedSettings = document.getElementById('advanced-notification-settings');

        // 1. 同步更新下方高级设置区域的显示/隐藏状态
        if (toggle && advancedSettings) {
            if (toggle.checked) {
                advancedSettings.classList.remove('d-none');
            } else {
                advancedSettings.classList.add('d-none');
            }
        }

        // 2. 原有的提示文字更新逻辑
        if (!hint) return;
        if (!isSupported()) {
            hint.textContent = '当前环境不支持系统通知（需在支持的浏览器 / 已添加到主屏幕的 PWA 中使用）。';
            return;
        }
        const p = permissionState();
        if (p === 'denied') {
            hint.textContent = '通知权限已被拒绝。请到系统 / 浏览器设置里手动允许本应用的通知后再试。';
        } else if (p === 'granted') {
            hint.textContent = '通知已授权。切到后台时若有新消息会弹出系统通知。iOS 需先"添加到主屏幕"。';
        } else {
            hint.textContent = '开启后，切到后台时若有新消息会弹出系统通知。iOS 需先"添加到主屏幕"。';
        }
    }

    async function onToggleChange(e) {
        const toggle = e.target;
        const s = getSettings();

        if (toggle.checked) {
            if (!isSupported()) {
                toggle.checked = false;
                updateHint();
                await uiAlert('当前环境不支持系统通知。');
                return;
            }
            // ★ 必须在 await 权限弹窗之前预热保活音频——此刻用户手势激活还在，
            //   等权限弹窗结束后激活会被消耗，audio.play() 就会被拦截。
            if (typeof window.ensureBgAudioUnlocked === 'function') {
                window.ensureBgAudioUnlocked();
            }
            const result = await requestPermission();
            if (result !== 'granted') {
                toggle.checked = false;
                s.enabled = false;
                updateHint();
                await uiAlert(result === 'denied'
                    ? '通知权限被拒绝，请到系统设置里手动开启后再试。'
                    : '未获得通知权限。');
                await persist();
                return;
            }
            s.enabled = true;
            updateHint();
            // 立即把当前未读数反映到桌面角标
            if (typeof updateHomeChatBadge === 'function') updateHomeChatBadge();
            await persist();
        } else {
            s.enabled = false;
            updateHint();
            try { if (navigator.clearAppBadge) await navigator.clearAppBadge(); } catch (_) {}
            // 关掉通知总开关：撤销 CF 上所有待发推送任务
            if (window.PushNode && typeof window.PushNode.cancelAllDevice === 'function') {
                try { await window.PushNode.cancelAllDevice(); } catch (_) {}
            }
            await persist();
        }
    }

    async function onKeepAliveChange(e) {
        const s = getSettings();
        let v = parseInt(e.target.value, 10);
        if (isNaN(v)) v = 30;
        v = Math.max(KEEPALIVE_MIN, Math.min(KEEPALIVE_MAX, v));
        e.target.value = v;
        s.keepAliveMinutes = v;
        await persist();
    }

    async function onTestClick() {
        if (!isSupported()) {
            await uiAlert('当前环境不支持系统通知。');
            return;
        }
        if (Notification.permission !== 'granted') {
            const r = await requestPermission();
            updateHint();
            if (r !== 'granted') {
                await uiAlert('请先在上方打开"允许系统通知"。');
                return;
            }
        }
        const ok = await fire('测试通知', '如果你看到这条通知，说明通知功能正常 🎉', {
            tag: 'notify-test',
            renotify: true,
            force: true
        });
        uiToast(ok ? '测试通知已发送' : '通知发送失败，请检查权限。');
    }

    async function persist() {
        try {
            if (typeof window.saveData === 'function') await window.saveData();
        } catch (e) {
            console.warn('[通知] 保存设置失败:', e);
        }
    }

    // UI 提示小工具（AppUI 是裸全局 const，不挂在 window 上）
    function uiAlert(msg) {
        if (typeof AppUI !== 'undefined' && AppUI.alert) return AppUI.alert(msg);
        return Promise.resolve();
    }
    function uiToast(msg) {
        if (window.showToast) window.showToast(msg);
    }

    // 打开"消息通知"页时初始化控件（由 main.js pageActions 调用）
    function initSettingsUI() {
        const s = getSettings();

        const toggle = document.getElementById('system-notification-toggle');
        if (toggle) {
            // 复选框反映"已开启且已授权"
            toggle.checked = !!(s.enabled && permissionState() === 'granted');
            // 若之前开着但权限被系统撤销，纠正状态
            if (s.enabled && permissionState() !== 'granted') {
                s.enabled = false;
                persist();
            }
            toggle.onchange = onToggleChange;
        }

        const foldToggle = document.getElementById('notify-fold-toggle');
        if (foldToggle) {
            foldToggle.checked = s.foldMessages !== false;
            foldToggle.onchange = async (e) => { getSettings().foldMessages = e.target.checked; await persist(); };
        }

        const nameToggle = document.getElementById('notify-showname-toggle');
        if (nameToggle) {
            nameToggle.checked = s.showSenderName !== false;
            nameToggle.onchange = async (e) => { getSettings().showSenderName = e.target.checked; await persist(); };
        }

        const silentToggle = document.getElementById('notify-silent-toggle');
        if (silentToggle) {
            silentToggle.checked = s.silent === true;
            silentToggle.onchange = async (e) => { getSettings().silent = e.target.checked; await persist(); };
        }

        const badgeToggle = document.getElementById('notify-badge-toggle');
        if (badgeToggle) {
            badgeToggle.checked = s.badgeEnabled !== false;
            badgeToggle.onchange = async (e) => {
                getSettings().badgeEnabled = e.target.checked;
                await persist();
                // 立即生效：开→刷新角标数字，关→清掉角标
                if (typeof updateHomeChatBadge === 'function') updateHomeChatBadge();
                else if (!e.target.checked) { try { if (navigator.clearAppBadge) await navigator.clearAppBadge(); } catch (_) {} }
            };
        }
        
        const keepAliveToggle = document.getElementById('notify-keepalive-toggle');
        if (keepAliveToggle) {
            keepAliveToggle.checked = s.keepAliveEnabled !== false;
            keepAliveToggle.onchange = async (e) => { 
                getSettings().keepAliveEnabled = e.target.checked; 
                await persist(); 
            };
        }

        const keepInput = document.getElementById('notify-keepalive-input');
        if (keepInput) {
            keepInput.value = s.keepAliveMinutes || 30;
            keepInput.onchange = onKeepAliveChange;
        }

        const testBtn = document.getElementById('notify-test-btn');
        if (testBtn) testBtn.onclick = onTestClick;

        updateHint();

        // 进阶：自定义推送节点(CF Worker)——同页初始化
        if (window.PushNode && typeof window.PushNode.initSettingsUI === 'function') {
            try { window.PushNode.initSettingsUI(); } catch (e) { console.warn('[推送节点] UI 初始化失败:', e); }
        }
    }

// ── 设置页问号说明弹窗 ──────────────────────────────────────────────
    window.showNotifyGroupInfo = function(key) {
        const groupInfos = {
            'system-notify': {
                title: '系统通知说明',
                content: '开启后，切到后台时如有新消息会弹出系统通知。\n\n⚠️ iOS 用户须在 Safari 中点击「分享」-「添加到主屏幕」，并在主屏幕打开应用方可接收。'
            },
            'notify-content': {
                title: '通知内容说明',
                content: '【折叠消息】\n开启：多条消息合并，避免霸屏。\n关闭：每条消息独立弹出通知。\n\n【显示角色/群名】\n关闭：统一显示"新消息"，隐藏对方身份。\n\n【静音通知】\n开启：仅亮屏弹出，无铃声震动。\n\n【桌面角标】\n开启：应用图标显示红点或数字（受系统限制可能仅显示红点或者1）。'
            },
            'keepalive': {
                title: '后台保活说明',
                content: '【允许后台持续保活】\n开启：后台播放无声循环音频，防止系统杀后台，确保实时收信（略微增加耗电）。\n关闭：切后台后随时可能断连。\n\n【保活时长】\n切后台后保持存活的有效分钟数。该项取全局与各个单独聊天的最高值。'
            },
            'push-node': {
                title: '自定义推送说明',
                content: '此为进阶功能：\n\n可部署专属的 Cloudflare Worker 节点。即使应用被杀后台或深度休眠时，服务器会准点发起 Web Push 通知，\n\n需按照配置流程填入 Worker 地址与公钥。'
            }
        };

        if (groupInfos[key]) {
            if (typeof AppUI !== 'undefined' && typeof AppUI.alert === 'function') {
                AppUI.alert(groupInfos[key].content, groupInfos[key].title, "我知道了");
            } else {
                alert(`【${groupInfos[key].title}】\n\n${groupInfos[key].content}`);
            }
        }
    };

    window.NotifyCenter = {
        getSettings,
        isSupported,
        permissionState,
        fire,
        notifyMessages,
        buildPushPayload,
        requestPermission,
        initSettingsUI
    };
})();
