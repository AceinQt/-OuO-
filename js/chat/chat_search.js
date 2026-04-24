// --- chat_search.js (性能优化版) ---

const searchConfigModal = document.getElementById('search-config-modal');
const searchConfigForm = document.getElementById('search-config-form');
const searchDateInput = document.getElementById('search-date-input');
const searchKeywordInput = document.getElementById('search-keyword-input');
const cancelSearchBtn = document.getElementById('cancel-search-btn');

const searchResultsScreen = document.getElementById('search-results-screen');
const searchResultsList = document.getElementById('search-results-list');
const searchScrollContainer = document.getElementById('search-scroll-container'); // 滚动容器
const exitSearchResultsBtn = document.getElementById('exit-search-results-btn');

// 状态提示元素
const searchLoadingEl = document.getElementById('search-loading');
const searchNoMoreEl = document.getElementById('search-no-more');
const searchEmptyEl = document.getElementById('search-empty');

// === 核心变量 ===
let allMatchedResults = []; // 存储所有搜索到的原始数据
let renderedCount = 0;      // 当前已渲染的数量
const BATCH_SIZE = 50;      // 每次滚动加载多少条
let isSearching = false;    // 防重复标志

// 初始化搜索系统
function setupSearchSystem() {
    // 1. 关闭搜索配置弹窗
    cancelSearchBtn.addEventListener('click', () => {
        searchConfigModal.classList.remove('visible');
    });

    // 2. 提交搜索表单
    searchConfigForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const dateVal = searchDateInput.value;
        const keywordVal = searchKeywordInput.value.trim();

        if (!dateVal && !keywordVal) {
            showToast('请至少输入一个搜索条件');
            return;
        }

        performSearch(dateVal, keywordVal);
    });

    // 3. 退出搜索结果页
    exitSearchResultsBtn.addEventListener('click', () => {
        switchScreen('chat-room-screen');
        // 清空列表以释放内存
        setTimeout(() => {
            searchResultsList.innerHTML = '';
            allMatchedResults = [];
        }, 300);
    });

    // 4. === 核心新增：滚动监听 ===
    searchScrollContainer.addEventListener('scroll', () => {
        // 如果正在加载或已经显示完所有结果，则不处理
        if (renderedCount >= allMatchedResults.length) return;

        // 距离底部 100px 时触发加载
        const { scrollTop, scrollHeight, clientHeight } = searchScrollContainer;
        if (scrollTop + clientHeight >= scrollHeight - 100) {
            renderNextBatch();
        }
    });
}

// 打开搜索配置弹窗
function openSearchModal() {
    searchConfigForm.reset();
    searchConfigModal.classList.add('visible');
    // 自动聚焦输入框
    setTimeout(() => searchKeywordInput.focus(), 100);
}

// 执行搜索逻辑
function performSearch(dateStr, keyword) {
    const chat = (currentChatType === 'private') 
        ? db.characters.find(c => c.id === currentChatId) 
        : db.groups.find(g => g.id === currentChatId);

    if (!chat || !chat.history) return;

const invisibleRegex = /\[.*?更新状态为[:：].*?\]|\[system:.*?\]|\[.*?(?:接收|退回).*?的转账\]|\[.*?已接收礼物\]|\[系统情景通知：.*?\]/;
    // 1. 筛选数据 (计算密集型操作，数据极大时可考虑 Web Worker，但几万条内通常 JS 还能扛住)
    const rawResults = chat.history.filter(msg => {
        // 过滤掉不可见的系统内部指令
        if (msg.role === 'system' && msg.isHidden) return false;
        
        if (invisibleRegex.test(msg.content)) {
            return false; 
        }
        
        if (msg.isWithdrawn) return false;

        let matchDate = true;
        let matchKeyword = true;

        // 日期匹配
        if (dateStr) {
            const msgDate = new Date(msg.timestamp);
            const yyyy = msgDate.getFullYear();
            const mm = String(msgDate.getMonth() + 1).padStart(2, '0');
            const dd = String(msgDate.getDate()).padStart(2, '0');
            const msgDateStr = `${yyyy}-${mm}-${dd}`;
            if (msgDateStr !== dateStr) matchDate = false;
        }

        // 关键词匹配 (忽略大小写)
        if (keyword) {
            let contentToCheck = msg.content;
            
            // 简单的格式清洗，提高匹配准确度
            const textMatch = msg.content.match(/\[.*?的消息：([\s\S]+?)\]/);
            if (textMatch) contentToCheck = textMatch[1];
            
            if (contentToCheck.startsWith('[system-narration:')) {
                const narMatch = contentToCheck.match(/\[system-narration:([\s\S]+?)\]/);
                if(narMatch) contentToCheck = narMatch[1];
            }

            if (!contentToCheck.toLowerCase().includes(keyword.toLowerCase())) {
                matchKeyword = false;
            }
        }

        return matchDate && matchKeyword;
    });

    // 2. 倒序排列：让最新的消息排在最前面
    allMatchedResults = rawResults.reverse();

    // 3. 重置渲染状态
    renderedCount = 0;
    searchResultsList.innerHTML = '';
    searchScrollContainer.scrollTop = 0;
    
    // 4. UI 状态重置
    searchEmptyEl.style.display = 'none';
    searchNoMoreEl.style.display = 'none';
    searchLoadingEl.style.display = 'none';

    searchConfigModal.classList.remove('visible');
    switchScreen('search-results-screen');

    // 5. 开始渲染第一批
    if (allMatchedResults.length === 0) {
        searchEmptyEl.style.display = 'block';
    } else {
        renderNextBatch();
    }
}

// 分批渲染逻辑
function renderNextBatch() {
    // 显示加载提示
    searchLoadingEl.style.display = 'block';

    // 使用 requestAnimationFrame 避免阻塞 UI 线程
    requestAnimationFrame(() => {
        const start = renderedCount;
        const end = Math.min(renderedCount + BATCH_SIZE, allMatchedResults.length);
        const batch = allMatchedResults.slice(start, end);

        const fragment = document.createDocumentFragment();

        batch.forEach(msg => {
            const item = createSearchResultItem(msg);
            fragment.appendChild(item);
        });

        searchResultsList.appendChild(fragment);
        renderedCount = end;

        // 隐藏加载提示
        searchLoadingEl.style.display = 'none';

        // 检查是否已全部加载
        if (renderedCount >= allMatchedResults.length) {
            searchNoMoreEl.style.display = 'block';
        }
    });
}

// 创建单个结果 DOM 元素
function createSearchResultItem(msg) {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    
    // 获取发送者名字
    let senderName = '未知';
    const chat = (currentChatType === 'private') ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
    
    if (msg.role === 'user') {
        senderName = '我';
    } else if (msg.role === 'assistant') {
         if (currentChatType === 'private') {
             senderName = chat.remarkName || chat.name;
         } else {
             const member = chat.members.find(m => m.id === msg.senderId);
             senderName = member ? member.groupNickname : '群成员';
         }
    } else if (msg.content.includes('system-narration') || msg.content.includes('剧情旁白')) {
        senderName = '旁白';
    }

    // 处理预览内容，移除 Markdown 符号，限制长度
    let previewText = msg.content;
    const textMatch = msg.content.match(/\[.*?的消息：([\s\S]+?)\]/);
    if (textMatch) previewText = textMatch[1];
    else if (msg.content.includes('system-narration')) {
        const narMatch = msg.content.match(/\[system-narration:([\s\S]+?)\]/);
        previewText = narMatch ? narMatch[1] : '剧情旁白...';
    }
    
    // 简单清洗 HTML 标签 (如果 DOMPurify 可用最好用 DOMPurify.sanitize)
    // 这里假设 DOMPurify 全局可用，如果不可用请删除 .sanitize
    if (typeof DOMPurify !== 'undefined') {
        previewText = DOMPurify.sanitize(previewText, {ALLOWED_TAGS: []});
    }

    const dateObj = new Date(msg.timestamp);
    const timeStr = `${dateObj.getMonth()+1}-${dateObj.getDate()} ${String(dateObj.getHours()).padStart(2,'0')}:${String(dateObj.getMinutes()).padStart(2,'0')}`;

    item.innerHTML = `
        <div class="result-header">
            <span class="result-sender">${senderName}</span>
            <span class="result-time">${timeStr}</span>
        </div>
        <div class="result-content">${previewText}</div>
    `;

    item.addEventListener('click', () => {
         confirmJumpToMessage(msg.id);
    });
    
    return item;
}

// 确认跳转
async function confirmJumpToMessage(messageId) {
    if (await AppUI.confirm("是否跳转到该消息位置？", "跳转确认", "跳转", "取消")) {
        jumpToMessageInChat(messageId);
    }
}

// 核心功能：跳转到指定消息
function jumpToMessageInChat(messageId) {
    const chat = (currentChatType === 'private') 
        ? db.characters.find(c => c.id === currentChatId) 
        : db.groups.find(g => g.id === currentChatId);
    
    // 1. 找到索引
    const msgIndex = chat.history.findIndex(m => m.id === messageId);
    if (msgIndex === -1) {
        showToast('消息似乎不存在');
        return;
    }

    // 2. 计算页码 (逻辑：最新消息在最后，Page 1 显示最后 N 条)
    // 假设 MESSAGES_PER_PAGE 是 20，总数 100
    // Index 99 (最新) -> (100-99)/20 = 0.05 -> ceil = 1
    // Index 0 (最旧) -> (100-0)/20 = 5 -> ceil = 5
    const totalMessages = chat.history.length;
// 计算跳转渲染窗口：以目标消息为中心，前后各 1 页
    //    避免渲染整段历史（可能几万条），也确保消息在 DOM 里
    const JUMP_WINDOW = MESSAGES_PER_PAGE * 2;
    const jumpStart = Math.max(0, msgIndex - MESSAGES_PER_PAGE);
    const jumpEnd   = Math.min(totalMessages, jumpStart + JUMP_WINDOW);
    window._jumpRenderStart = jumpStart;
    window._jumpRenderEnd   = jumpEnd;

    // 3. 切换回聊天室
    switchScreen('chat-room-screen');

    // 4. 强制重绘（renderMessages 内部会消费 _jumpRenderStart/End）
    if (typeof renderMessages === 'function') {
        renderMessages(false, false);
    }

    // 6. 滚动高亮（含通话折叠自动展开）
    setTimeout(() => {
        // 先尝试直接找到消息气泡
        let bubble = document.querySelector(`.message-wrapper[data-id="${messageId}"]`);

        // 如果没找到，检查是否被通话折叠隐藏了
        if (!bubble) {
            const targetMsg = chat.history.find(m => m.id === messageId);
            const sessionId = targetMsg?.callSessionId;

            if (sessionId) {
                // 先找折叠气泡，再找已展开容器（可能已被其他跳转展开过）
                const collapsedEl = document.querySelector(
                    `.collapsed-call-bubble[data-call-session-id="${sessionId}"]`
                );
                const expandedContainer = document.querySelector(
                    `[data-call-session-expanded-container="${sessionId}"]`
                );

                if (collapsedEl) {
                    // 展开折叠的通话记录
                    if (typeof expandCallSession === 'function') {
                        expandCallSession(sessionId, collapsedEl);
                    }
                } else if (!expandedContainer) {
                    // 既没有折叠气泡也没有展开容器，真的定位不到
                    showToast('定位消息失败');
                    return;
                }

                // 展开后重新查找气泡（需要再等一帧渲染）
                setTimeout(() => {
                    bubble = document.querySelector(`.message-wrapper[data-id="${messageId}"]`);
                    if (bubble) {
                        bubble.scrollIntoView({ behavior: 'auto', block: 'center' });
                        bubble.classList.add('message-highlight');
                        setTimeout(() => bubble.classList.remove('message-highlight'), 2000);
                    } else {
                        showToast('定位消息失败');
                    }
                }, 80);
                return; // 等待上面的 setTimeout 处理
            } else {
                showToast('定位消息失败');
                return;
            }
        }

        // 正常路径：气泡直接可见
        bubble.scrollIntoView({ behavior: 'auto', block: 'center' });
        bubble.classList.add('message-highlight');
        setTimeout(() => bubble.classList.remove('message-highlight'), 2000);
    }, 150); // 给渲染留出时间
}

// 启动
document.addEventListener('DOMContentLoaded', setupSearchSystem);