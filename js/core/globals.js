// --- js/core/globals.js ---

window.db = {
    characters: [],
    userPersonas: [],
    groups: [],
    apiSettings: {},
    wallpaper: 'https://i.postimg.cc/W4Z9R9x4/ins-1.jpg',
    myStickers: [],
    homeScreenMode: 'day',
    enableTopSafeArea: true,
    enableBottomSafeArea: true,
    enableScreenAdaptation: false,
    enableSwipeBack: false,
    homeStatusBarColor: '#ffffff',
    homeNavigationBarColor: '#ffffff',
    worldBooks: [],
    fontUrl: '',
    customIcons: {},
    apiPresets: [],
    bubbleCssPresets: [],
    myPersonaPresets: [], // (旧字段兼容)
    forumPosts: [],    
    peekData: {}, 
    globalCss: '',
    globalCssPresets: [],
    homeSignature: '编辑个性签名...',
    favoritePostIds: [],
    watchingPostIds: [],
    forumBindings: {
        worldBookIds: [],
        charIds: [],
        userPersonaIds: [],
        useChatHistory: false,
        historyLimit: 50
    },
    forumUserIdentity: {
        nickname: '新用户',
        avatar: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
        persona: '',
        realName: '',
        anonCode: '0311',
        customDetailCss: ''
    },
    rpgProfiles: [],
    pomodoroTasks: [],
    pomodoroSettings: {
        boundCharId: null,
        userPersona: '',
        focusBackground: '',
        taskCardBackground: '',
        encouragementMinutes: 25,
        pokeLimit: 5,
        globalWorldBookIds: [] 
    },
    insWidgetSettings: {
        avatar1: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
        bubble1: 'love u.',
        avatar2: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg',
        bubble2: 'miss u.'
    },
    currentViewingPostId: null
};
            
// --- 全局常量 ---
window.MESSAGES_PER_PAGE = 50;

// --- 导航与视图状态 ---
window.currentSourceScreen = 'forum-screen'; 
window.currentPage = 1;
window.notificationQueue = [];
window.isToastVisible = false;
window.currentPageIndex = 0;

// --- 聊天核心状态 ---
window.currentChatId = null;
window.currentChatType = null;
window.isGenerating = false;
window.editingMessageId = null;
window.currentTransferMessageId = null;
window.currentStickerActionTarget = null;
window.currentQuoteInfo = null; 
window.currentGroupAction = { type: null, recipients: [] }; 

// --- 交互状态 ---
window.longPressTimer = null;
window.isInMultiSelectMode = false;
window.selectedMessageIds = new Set();

// --- 世界书与编辑器 ---
window.currentEditingWorldBookId = null;
window.isWorldBookMultiSelectMode = false;
window.selectedWorldBookIds = new Set();

// --- 记忆/日记状态 ---
window.currentMemoryTab = 'summary'; 
window.currentSummarySubTab = 'short';
window.currentJournalDetailId = null;

// --- 番茄钟状态 ---
window.currentPomodoroTask = null;
window.pomodoroInterval = null;
window.pomodoroRemainingSeconds = 0;
window.pomodoroCurrentSessionSeconds = 0;
window.isPomodoroPaused = true;
window.pomodoroPokeCount = 0;
window.pomodoroIsInterrupted = false;
window.currentPomodoroSettingsContext = null;
window.pomodoroSessionHistory = [];

// --- 表情包管理 ---
window.isStickerManageMode = false;
window.selectedStickerIds = new Set();

// --- 偷看手机 (Peek) ---
window.peekContentCache = {};
window.generatingPeekApps = new Set(); 

// --- RPG 游戏 ---
window.currentProfileId = null;

// 1. 所有 SVG 代码常量
const FORUM_SVG_CODE = `<svg class="icon-img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M18,2.5a1.52,1.52,0,0,0-.84.26L14.24,2a1,1,0,0,0-1.19.65l-2,6A1,1,0,0,0,11.68,10,1.25,1.25,0,0,0,12,10,1,1,0,0,0,13,9.32l1.71-5.13,2,.51A1.5,1.5,0,1,0,18,2.5Z" fill="rgb(129, 175, 217)"></path><path d="M22,11a4,4,0,0,0-4-4,4,4,0,0,0-3,1.33A14.17,14.17,0,0,0,9,8.33,4,4,0,0,0,6,7a4,4,0,0,0-4,4,3.93,3.93,0,0,0,.47,1.87A5.15,5.15,0,0,0,2,15c0,3.92,4.39,7,10,7s10-3.08,10-7a5.15,5.15,0,0,0-.47-2.13A3.93,3.93,0,0,0,22,11Z" fill="currentColor"></path><path d="M10,14a1.5,1.5,0,1,1-1.5-1.5A1.5,1.5,0,0,1,10,14Zm5.5-1.5A1.5,1.5,0,1,0,17,14,1.5,1.5,0,0,0,15.5,12.5Z" fill="rgb(129, 175, 217)"></path></svg>`;

const CHAT_SVG_CODE = `<svg class="icon-img" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity="1" d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 13.5997 2.37562 15.1116 3.04346 16.4525C3.22094 16.8088 3.28001 17.2161 3.17712 17.6006L2.58151 19.8267C2.32295 20.793 3.20701 21.677 4.17335 21.4185L6.39939 20.8229C6.78393 20.72 7.19121 20.7791 7.54753 20.9565C8.88837 21.6244 10.4003 22 12 22Z" fill="currentColor"/><path opacity="1" d="M7.5 11.1093C7.5 12.4777 8.81884 13.9135 10.0286 14.9426C10.8524 15.6435 11.2644 15.9939 12 15.9939C12.7356 15.9939 13.1476 15.6435 13.9714 14.9426C15.1812 13.9135 16.5 12.4777 16.5 11.1093C16.5 8.43212 14.0249 7.4326 12 9.50069C9.97507 7.4326 7.5 8.43212 7.5 11.1093Z" fill="#81AFD9"/></svg>`;

const POMODORO_SVG_CODE = `<svg class="icon-img" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity="1" d="M11.9998 21.9997C16.836 21.9997 20.7565 18.1159 20.7565 13.325C20.7565 8.53417 16.836 4.65039 11.9998 4.65039C7.16366 4.65039 3.24316 8.53417 3.24316 13.325C3.24316 18.1159 7.16366 21.9997 11.9998 21.9997Z" fill="currentColor"/><path d="M11.9993 8.74707C12.4023 8.74707 12.729 9.07072 12.729 9.46996V13.0259L14.9477 15.2238C15.2326 15.5061 15.2326 15.9638 14.9477 16.2461C14.6627 16.5285 14.2006 16.5285 13.9157 16.2461L11.4833 13.8365C11.3464 13.701 11.2695 13.5171 11.2695 13.3254V9.46996C11.2695 9.07072 11.5962 8.74707 11.9993 8.74707Z" fill="#81AFD9"/><path fill-rule="evenodd" clip-rule="evenodd" d="M8.2405 2.33986C8.45409 2.67841 8.3502 3.1244 8.00844 3.33599L4.11657 5.74562C3.77481 5.95722 3.32461 5.8543 3.11102 5.51574C2.89742 5.17718 3.00131 4.7312 3.34307 4.5196L7.23494 2.10998C7.5767 1.89838 8.0269 2.0013 8.2405 2.33986Z" fill="#81AFD9"/><path fill-rule="evenodd" clip-rule="evenodd" d="M15.7595 2.33985C15.9731 2.0013 16.4233 1.89838 16.7651 2.10998L20.6569 4.5196C20.9987 4.7312 21.1026 5.17719 20.889 5.51574C20.6754 5.8543 20.2252 5.95722 19.8834 5.74562L15.9916 3.33599C15.6498 3.1244 15.5459 2.67841 15.7595 2.33985Z" fill="#81AFD9"/></svg>`;

const WORLDBOOK_SVG_CODE = `<svg class="icon-img" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity="1" d="M21.6602 10.44L20.6802 14.62C19.8402 18.23 18.1802 19.69 15.0602 19.39C14.5602 19.35 14.0202 19.26 13.4402 19.12L11.7602 18.72C7.59018 17.73 6.30018 15.67 7.28018 11.49L8.26018 7.30001C8.46018 6.45001 8.70018 5.71001 9.00018 5.10001C10.1702 2.68001 12.1602 2.03001 15.5002 2.82001L17.1702 3.21001C21.3602 4.19001 22.6402 6.26001 21.6602 10.44Z" fill="currentColor"/><path d="M15.0603 19.3901C14.4403 19.8101 13.6603 20.1601 12.7103 20.4701L11.1303 20.9901C7.16034 22.2701 5.07034 21.2001 3.78034 17.2301L2.50034 13.2801C1.22034 9.3101 2.28034 7.2101 6.25034 5.9301L7.83034 5.4101C8.24034 5.2801 8.63034 5.1701 9.00034 5.1001C8.70034 5.7101 8.46034 6.4501 8.26034 7.3001L7.28034 11.4901C6.30034 15.6701 7.59034 17.7301 11.7603 18.7201L13.4403 19.1201C14.0203 19.2601 14.5603 19.3501 15.0603 19.3901Z" fill="#81AFD9"/><path d="M17.4894 10.51C17.4294 10.51 17.3694 10.5 17.2994 10.49L12.4494 9.26002C12.0494 9.16002 11.8094 8.75002 11.9094 8.35002C12.0094 7.95002 12.4194 7.71002 12.8194 7.81002L17.6694 9.04002C18.0694 9.14002 18.3094 9.55002 18.2094 9.95002C18.1294 10.28 17.8194 10.51 17.4894 10.51Z" fill="#81AFD9"/><path d="M14.5592 13.8899C14.4992 13.8899 14.4392 13.8799 14.3692 13.8699L11.4592 13.1299C11.0592 13.0299 10.8192 12.6199 10.9192 12.2199C11.0192 11.8199 11.4292 11.5799 11.8292 11.6799L14.7392 12.4199C15.1392 12.5199 15.3792 12.9299 15.2792 13.3299C15.1992 13.6699 14.8992 13.8899 14.5592 13.8899Z" fill="#81AFD9"/></svg>`;

const SETTINGS_SVG_CODE = `<svg class="icon-img" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path opacity="1" fill-rule="evenodd" clip-rule="evenodd" d="M14.2788 2.15224C13.9085 2 13.439 2 12.5 2C11.561 2 11.0915 2 10.7212 2.15224C10.2274 2.35523 9.83509 2.74458 9.63056 3.23463C9.53719 3.45834 9.50065 3.7185 9.48635 4.09799C9.46534 4.65568 9.17716 5.17189 8.69017 5.45093C8.20318 5.72996 7.60864 5.71954 7.11149 5.45876C6.77318 5.2813 6.52789 5.18262 6.28599 5.15102C5.75609 5.08178 5.22018 5.22429 4.79616 5.5472C4.47814 5.78938 4.24339 6.1929 3.7739 6.99993C3.30441 7.80697 3.06967 8.21048 3.01735 8.60491C2.94758 9.1308 3.09118 9.66266 3.41655 10.0835C3.56506 10.2756 3.77377 10.437 4.0977 10.639C4.57391 10.936 4.88032 11.4419 4.88029 12C4.88026 12.5581 4.57386 13.0639 4.0977 13.3608C3.77372 13.5629 3.56497 13.7244 3.41645 13.9165C3.09108 14.3373 2.94749 14.8691 3.01725 15.395C3.06957 15.7894 3.30432 16.193 3.7738 17C4.24329 17.807 4.47804 18.2106 4.79606 18.4527C5.22008 18.7756 5.75599 18.9181 6.28589 18.8489C6.52778 18.8173 6.77305 18.7186 7.11133 18.5412C7.60852 18.2804 8.2031 18.27 8.69012 18.549C9.17714 18.8281 9.46533 19.3443 9.48635 19.9021C9.50065 20.2815 9.53719 20.5417 9.63056 20.7654C9.83509 21.2554 10.2274 21.6448 10.7212 21.8478C11.0915 22 11.561 22 12.5 22C13.439 22 13.9085 22 14.2788 21.8478C14.7726 21.6448 15.1649 21.2554 15.3694 20.7654C15.4628 20.5417 15.4994 20.2815 15.5137 19.902C15.5347 19.3443 15.8228 18.8281 16.3098 18.549C16.7968 18.2699 17.3914 18.2804 17.8886 18.5412C18.2269 18.7186 18.4721 18.8172 18.714 18.8488C19.2439 18.9181 19.7798 18.7756 20.2038 18.4527C20.5219 18.2105 20.7566 17.807 21.2261 16.9999C21.6956 16.1929 21.9303 15.7894 21.9827 15.395C22.0524 14.8691 21.9088 14.3372 21.5835 13.9164C21.4349 13.7243 21.2262 13.5628 20.9022 13.3608C20.4261 13.0639 20.1197 12.558 20.1197 11.9999C20.1197 11.4418 20.4261 10.9361 20.9022 10.6392C21.2263 10.4371 21.435 10.2757 21.5836 10.0835C21.9089 9.66273 22.0525 9.13087 21.9828 8.60497C21.9304 8.21055 21.6957 7.80703 21.2262 7C20.7567 6.19297 20.522 5.78945 20.2039 5.54727C19.7799 5.22436 19.244 5.08185 18.7141 5.15109C18.4722 5.18269 18.2269 5.28136 17.8887 5.4588C17.3915 5.71959 16.7969 5.73002 16.3099 5.45096C15.8229 5.17191 15.5347 4.65566 15.5136 4.09794C15.4993 3.71848 15.4628 3.45833 15.3694 3.23463C15.1649 2.74458 14.7726 2.35523 14.2788 2.15224Z" fill="currentColor"/><path d="M15.5227 12C15.5227 13.6569 14.1694 15 12.4999 15C10.8304 15 9.47705 13.6569 9.47705 12C9.47705 10.3431 10.8304 9 12.4999 9C14.1694 9 15.5227 10.3431 15.5227 12Z" fill="#81AFD9"/></svg>`;

const RPG_SVG_CODE = `<svg class="icon-img" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g transform="translate(12, 12) scale(1.08) rotate(15) translate(-12, -11)"><path opacity="1" d="M18.53,13A8.55,8.55,0,0,0,21,7.59a1,1,0,0,0-.41-.84,5,5,0,0,0-4.82-.24,6.83,6.83,0,0,0-3.35-4.42,1,1,0,0,0-.84,0A6.83,6.83,0,0,0,8.23,6.51a5,5,0,0,0-4.82.24A1,1,0,0,0,3,7.59,8.55,8.55,0,0,0,5.47,13,5.94,5.94,0,0,0,4,15.76a1,1,0,0,0,.26,1c1.78,1.77,4.57,2.13,7.71,1a10.25,10.25,0,0,0,3.42.65,5.92,5.92,0,0,0,4.29-1.65,1,1,0,0,0,.26-1A5.94,5.94,0,0,0,18.53,13Z" fill="currentColor"/><path opacity="1" d="M12,22a1,1,0,0,1-1-1V12a1,1,0,0,1,2,0v9A1,1,0,0,1,12,22Z" fill="#81AFD9"/></g></svg>`;

// 2. 默认设置对象
const defaultWidgetSettings = {
    centralCircleImage: 'https://i.postimg.cc/mD83gR29/avatar-1.jpg',
};

const simulatedMemos = [];

// 3. 应用图标配置表
const defaultIcons = {
    'chat-list-screen': { name: '聊天', url: './icon/chat.svg', svgCode: CHAT_SVG_CODE },
    'pomodoro-screen': { name: '番茄钟', url: './icon/pomodoro.svg', svgCode: POMODORO_SVG_CODE },
    'world-book-screen': { name: '世界书', url: './icon/worldbook.svg', svgCode: WORLDBOOK_SVG_CODE },
    'settings-screen': { name: '设置', url: './icon/settings.svg', svgCode: SETTINGS_SVG_CODE },
    'rpg-title-screen': { name: '传说之旅', url: './icon/rpg.svg', svgCode: RPG_SVG_CODE },
    'api-settings-screen': { name: 'api', url: 'https://i.postimg.cc/50FqT8GL/chan-125.png' },
    'wallpaper-screen': { name: '壁纸', url: 'https://i.postimg.cc/VvQB8dQT/chan-143.png' },
    'customize-screen': { name: '自定义', url: 'https://i.postimg.cc/vZVdC7gt/chan-133.png' },
    'font-settings-screen': { name: '字体', url: 'https://i.postimg.cc/FzVtC0x4/chan-21.png' },
    'tutorial-screen': { name: '教程', url: 'https://i.postimg.cc/6QgNzCFf/chan-118.png' },
    'day-mode-btn': { name: '白昼模式', url: 'https://i.postimg.cc/Jz0tYqnT/chan-145.png' },
    'night-mode-btn': { name: '夜间模式', url: 'https://i.postimg.cc/htYvkdQK/chan-146.png' },
    'forum-screen': { name: '喵坛', url: './icon/forum.svg', svgCode: FORUM_SVG_CODE },
    'diary-screen': { name: '日记本', url: 'https://i.postimg.cc/ydd65txK/1758451018266.png' },
    'piggy-bank-screen': { name: '存钱罐', url: 'https://i.postimg.cc/3RmWRRtS/chan-18.png' },
    'storage-analysis-screen': { name: '存储分析', url: 'https://i.postimg.cc/J0F3Lt0T/chan-107.png' }
};