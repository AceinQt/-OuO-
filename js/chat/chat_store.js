// ==========================================
// store_chat.js - 聊天室统一数据管家
// ==========================================

/**
 * 核心魔法 1：无脑获取当前会话（自动判断私聊/群聊）
 */
function getCurrentChat() {
    if (!currentChatId) return null;
    if (currentChatType === 'private') {
        return db.characters.find(c => c.id === currentChatId);
    } else {
        return db.groups.find(g => g.id === currentChatId);
    }
}

/**
 * 核心魔法 2：无脑获取当前“我”的身份信息（抹平私聊和群聊的数据结构差异）
 */
function getMyIdentity(chat) {
    if (!chat) return null;
    if (currentChatType === 'private') {
        return {
            id: 'user_me',
            realName: chat.myName,
            nickname: chat.myNickname || chat.myName,
            avatar: chat.myAvatar
        };
    } else {
        return {
            id: 'user_me',
            realName: chat.me.realName,
            nickname: chat.me.nickname || chat.me.groupNickname || chat.me.realName,
            avatar: chat.me.avatar
        };
    }
}