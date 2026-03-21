// ==========================================
// peek_cart.js
// 购物车渲染、购物车生成
// ==========================================

function renderPeekCart(items) {
    const screen = document.getElementById('peek-cart-screen');
    let itemsHtml = '';
    let totalPrice = 0;

    const isEdit = PeekDeleteManager.isEditMode && PeekDeleteManager.currentAppType === 'cart';

    if (!items || items.length === 0) {
        itemsHtml = '<p class="placeholder-text">正在生成购物车内容...</p>';
    } else {
        items.forEach(item => {
            if (!item.id) item.id = 'cart_old_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            const isSelected = isEdit && PeekDeleteManager.selectedIds.has(item.id);
            itemsHtml += `
                <li class="cart-item ${isEdit ? 'is-selecting' : ''} ${isSelected ? 'selected' : ''}" data-id="${item.id}">
                    <img src="https://i.postimg.cc/wMbSMvR9/export202509181930036600.png" class="cart-item-image" alt="${item.title}">
                    <div class="cart-item-details">
                        <h3 class="cart-item-title">${item.title} ${item.isNew ? '<span class="new-badge">new!</span>' : ''}</h3>
                        <p class="cart-item-spec">规格：${item.spec}</p>
                        <p class="cart-item-price">¥${item.price}</p>
                    </div>
                </li>
            `;
            totalPrice += parseFloat(item.price);
        });
    }

    screen.innerHTML = `
        <header class="app-header">
            <button class="back-btn" data-target="peek-screen">‹</button>
            <div class="title-container"><h1 class="title">购物车</h1></div>
            <button class="action-btn"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"></path></svg></button>
        </header>
        <main class="content"><ul class="cart-item-list">${itemsHtml}</ul></main>
        <footer class="cart-footer">
            <div class="cart-total-price">
                <span class="label">合计：</span>¥${totalPrice.toFixed(2)}
            </div>
            <button class="checkout-btn">结算</button>
        </footer>
    `;

    screen.querySelector('.checkout-btn').addEventListener('click', () => showToast('功能开发中'));
    screen.querySelector('.action-btn').addEventListener('click', () => generateAndRenderPeekCart({ forceRefresh: true }));

    let hasNewCart = false;
    if (items) {
        items.forEach(item => {
            if (item.isNew) { item.isNew = false; hasNewCart = true; }
        });
        if (hasNewCart) savePeekData(window.activePeekCharId);
    }
}

async function generateAndRenderPeekCart(options = {}) {
    const appType = 'cart';
    const { forceRefresh = false } = options;

    if (generatingPeekApps.has(appType)) { showToast('购物车内容正在生成中，请稍候...'); return; }

    if (!forceRefresh && peekContentCache[appType]) {
        renderPeekCart(peekContentCache[appType].items);
        switchScreen('peek-cart-screen');
        return;
    }

    const char = db.characters.find(c => c.id === window.activePeekCharId);
    if (!char) return showToast('无法找到当前角色');

    const { url, key, model } = db.apiSettings;
    if (!url || !key || !model) { showToast('请先配置 API！'); return switchScreen('api-settings-screen'); }

    generatingPeekApps.add(appType);
    switchScreen('peek-cart-screen');
    const hideLoading = showLoadingToast('正在读取购物车数据...');

    try {
        const peekSettings = char.peekScreenSettings || {};
        const limitCount = (peekSettings.contextLimit !== undefined) ? peekSettings.contextLimit : 50;
        const mainChatContext = limitCount > 0 ? char.history.slice(-limitCount).map(m => m.content).join('\n') : "";

        const senderName = char.realName || char.name;
        const baseContextPrompt = getPeekBasePromptContext(char, mainChatContext);

        let systemPrompt = `你正在模拟角色 ${char.realName} 的手机电商平台购物车。\n`;
        systemPrompt += baseContextPrompt;
        systemPrompt += `
【任务1：购物车记录】
请为 ${char.realName} 生成3-4件购物车内的商品。这些商品应该反映Ta近期的兴趣、生活需求或最近聊到的话题。你需要生成商品标题(#TITLE#)、商品规格(#SPEC#)和商品价格(#PRICE#)。

【任务2：话题分享】
在购物车内容生成完毕后，请从刚刚生成的商品中挑选1件Ta最纠结要不要买，或者最想展示的商品。
预测一下，在未来的某个时间，${senderName}会围绕这个商品，发送消息给${char.myName}开启话题。
`;
        systemPrompt += getPeekProactiveFormatPrompt(char);
        systemPrompt += `
请严格按照以下标签文本格式输出，**每件商品之间使用 ===SEP=== 分隔**。在所有商品结束后，使用 ===PROACTIVE_MESSAGES=== 分割，再输出主动消息。

输出格式示例：
#TITLE#
某品牌无线降噪耳机
#SPEC#
星空黑 / 官方标配
#PRICE#
1299.00
===SEP===
#TITLE#
猫咪零食冻干大礼包
#SPEC#
混合口味 500g
#PRICE#
89.90
===PROACTIVE_MESSAGES===
#SECRET_CHAT_EVENING_85%#[19:16|${senderName}发来的照片/视频:耳机的图片][19:15|${senderName}的消息:你觉得黑色的耳机好看还是白色的好看？][19:16|${senderName}的消息:我想换个新耳机，但在颜色上纠结了半天...]
`;

        const requestBody = { model: model, messages: [{ role: 'user', content: systemPrompt }], temperature: 0.85 };
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) throw new Error(`API error: ${response.status}`);
        const result = await response.json();
        const contentStr = result.choices[0].message.content.trim();

        const parts = contentStr.split(/===PROACTIVE_MESSAGES===/i);
        const cartRawText = parts[0] || '';
        const hitchhikerRawText = parts.length > 1 ? parts[1] : '';

        const rawItems = cartRawText.split('===SEP===');
        const parsedItems = [];

        rawItems.forEach((rawText) => {
            if (!rawText.trim()) return;
            const titleMatch = rawText.match(/#TITLE#\s*([\s\S]*?)(?=#SPEC#|$)/);
            const specMatch = rawText.match(/#SPEC#\s*([\s\S]*?)(?=#PRICE#|$)/);
            const priceMatch = rawText.match(/#PRICE#\s*([\s\S]*?)(?=(?:===SEP===|$))/);

            if (titleMatch && specMatch && priceMatch) {
                let cleanPrice = priceMatch[1].replace(/[^\d.]/g, '').trim();
                parsedItems.push({
                    id: `cart_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    title: titleMatch[1].trim(),
                    spec: specMatch[1].trim(),
                    price: cleanPrice || "0.00",
                    isNew: true
                });
            }
        });

        if (parsedItems.length > 0) {
            if (!peekContentCache['cart']) peekContentCache['cart'] = { items: [] };
            peekContentCache['cart'].items = [...parsedItems, ...peekContentCache['cart'].items];
            savePeekData(char.id).catch(e => console.error("Peek自动保存失败:", e));
            renderPeekCart(peekContentCache['cart'].items);
        } else {
            throw new Error("解析购物车内容失败，未找到对应标签。");
        }

        if (hitchhikerRawText.trim()) {
            parseAndSavePeekProactiveHitchhiker(char, hitchhikerRawText);
            saveSingleChat(char.id, 'private').catch(e => console.error(e));
        }

    } catch (error) {
        console.error(error);
        showApiError(error);
        if (peekContentCache['cart']?.items?.length > 0) {
            renderPeekCart(peekContentCache['cart'].items);
            if (typeof showToast === 'function') showToast('刷新失败: ' + error.message);
        } else {
            const screen = document.getElementById('peek-cart-screen');
            if (screen) {
                const listEl = screen.querySelector('.cart-item-list');
                if (listEl) listEl.innerHTML = `<li style="padding:20px; text-align:center; color:#ff4d4f;">内容生成失败，请重试。<br><span style="font-size:12px;">${error.message}</span></li>`;
            }
        }
    } finally {
        generatingPeekApps.delete(appType);
        hideLoading();
    }
}
