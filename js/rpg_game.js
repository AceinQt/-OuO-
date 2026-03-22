/* --- RPG Game游戏 Integration Logic (Fixed V4) --- */
            // --- 游戏RPG Global Variables (Must be at top) ---
window.rpgGameInstance = null; // 全局实例
const RPG_CONFIG = { TILE: 64 };
const rpgInput = { x: 0, y: 0 };
// 存档上下文
let rpgSaveContext = 'title';
let selectedPartnerCharId = null; // 全局变量存储选中的伙伴ID
let tempRpgConfig = null;
// --- RPG 全局变量补充 ---
let selectedRpgWorldBookIds = []; // 用于新游戏创建时暂存
// RPG DOM Cache
            // === 新增：RPG游戏 按钮缓存 ===
const rpgNewGameBtn = document.getElementById('rpg-new-game-btn');
const rpgLoadGameBtn = document.getElementById('rpg-load-game-btn');
const rpgExitGameBtn = document.getElementById('rpg-exit-game-btn');
const rpgStartAdventureBtn = document.getElementById('rpg-start-adventure-btn');
const rpgBackToTitleBtn = document.getElementById('rpg-back-to-title-btn');
const rpgOpenSaveBtn = document.getElementById('rpg-open-save-btn');
const rpgSaveBackBtn = document.getElementById('rpg-save-back-btn'); // 修正存档页返回按钮
// === RPG 物品数据库 ===


const RPG_ITEMS = {
    // 地图道具
    'return_scroll': { name: '回家卷轴', icon: '📜', desc: '立即传送回温馨家园 (一次性)', type: 'consumable', use: 'map' },
    'tent': { name: '野营帐篷', icon: '⛺', desc: '露营休息，恢复全员状态 (一次性)', type: 'consumable', use: 'map' },
    
    // 战斗道具
    'potion_red': { name: '生命药水', icon: '🍷', desc: '恢复单体 100 HP', type: 'consumable', use: 'battle', effect: { type: 'heal_hp', val: 100 } },
    'potion_blue': { name: '魔力药水', icon: '💧', desc: '恢复单体 50 MP', type: 'consumable', use: 'battle', effect: { type: 'heal_mp', val: 50 } },
    'potion_revive': { name: '复活药水', icon: '✝️', desc: '复活无法战斗的队友并恢复50%HP', type: 'consumable', use: 'battle', effect: { type: 'revive', val: 0.5 } },
    'smoke_bomb': { name: '烟雾弹', icon: '💨', desc: '立即从战斗中逃跑', type: 'consumable', use: 'battle', effect: { type: 'flee' } },
    'potion_purify': { name: '净化药水', icon: '✨', desc: '解除所有异常状态', type: 'consumable', use: 'battle', effect: { type: 'cure_all' } },
       
             
    // 任务/家园道具
    'dye': { name: '神奇染料', icon: '🎨', desc: '似乎可以改变衣服的颜色', type: 'material', use: 'home' },
    'blueprint': { name: '家具图纸', icon: '📐', desc: '稀有的设计图', type: 'material', use: 'home' },
    'currency': { name: '金币', icon: '💰', desc: '通用的货币，可以用来购买家具', type: 'currency' }
};

 // === 掉落配置表 (在这里修改概率) ===
// rate: 0.0 ~ 1.0 (例如 0.35 代表 35%)
// min/max: 掉落数量范围
const RPG_DROP_CONFIG = {
    // 普通怪物掉落列表 (独立计算，互不冲突)
    normal: [
        { id: 'currency',    rate: 1.0,  min: 1, max: 3, name: '' },        // 100% 掉 1-3 金币
        { id: 'potion_red',  rate: 0.10, min: 1, max: 1,  name: '生命药水' }, // 10% 掉红药
        { id: 'potion_blue', rate: 0.05, min: 1, max: 1,  name: '魔力药水' }, // 5% 掉蓝药
        // 想加新物品直接在下面加一行：
        
        { id: 'potion_revive', rate: 0.05, min: 1, max: 1,  name: '复活药水' }, 
        { id: 'potion_purify', rate: 0.05, min: 1, max: 1,  name: '净化药水' }, 
        { id: 'smoke_bomb', rate: 0.05, min: 1, max: 1,  name: '烟雾弹' } 
    ],
    
    // BOSS 掉落列表
    boss: [
        { id: 'currency',    rate: 1.0,  min: 50, max: 100, name: '' },      // 100% 掉 100-150 金币
        { id: 'return_scroll', rate: 0.3, min: 1, max: 1, name: '回家卷轴' },
        { id: 'dye',         rate: 0.2,  min: 1,   max: 1,   name: '染料' },  // 80% 掉染料
        { id: 'blueprint',   rate: 0.2,  min: 1,   max: 1,   name: '图纸' },  // 30% 掉图纸
        { id: 'tent', rate: 0.3, min: 1, max: 1,  name: '帐篷' }
    ]
};   


// === 家具数据库 ===
// === 图片资源配置表 ===
// 你可以在这里替换为你自己的 PNG 图片链接 (支持 HTTP URL 或 Base64)
const RPG_ASSETS = {
    // 建筑与环境
    'house_exterior': './png/pixel_house.png', // 房子外观图
    'shop_sign': './png/shop_sign.png',      // 商店告示牌
    'fence_l': './png/fence_l.png',           // 左边栅栏
    'fence_r': './png/fence_r.png',
    'tree': './png/tree.png',           // 右边栅栏
    
    // 家具 (对应 RPG_FURNITURE 中的 key)
    'bed': './png/bed.png',
    'plant': './png/plant.png',
    'wardrobe': './png/wardrobe.png',
    'log': './png/log.png'
};

// 预加载图片工具
const loadedImages = {};
function preloadImages() {
    Object.keys(RPG_ASSETS).forEach(key => {
        const img = new Image();
        img.src = RPG_ASSETS[key];
        loadedImages[key] = img;
    });
}
// 立即执行预加载
preloadImages();
// === 家具数据库 (添加 mapChar) ===
const RPG_FURNITURE = {
    // 购买类家具
    'bed':   { name: '床', cost: 200, icon: '🛏️', mapChar: 'b', type: 'bed', w: 64, h: 128, max: 1 , cols: 1, rows: 2},
    'plant': { name: '绿植盆栽', cost: 50,  icon: '🪴', mapChar: 'p', type: 'plant', w: 64, h: 64, max: 3, cols: 1, rows: 1},
    'tree': { name: '树木', cost: 100, icon: '🌳', mapChar: 't', type: 'tree' , w: 192, h: 192, max: 6 , cols: 1, rows: 1},
    'shop_sign': { name: '商店', cost: 0, icon: '🎁', mapChar: 's', type: 'shop_sign' , w: 64, h: 128, max: 1, cols: 1, rows: 1},
    'wardrobe': { name: '衣柜', cost: 150, icon: '🧺', mapChar: 'w', type: 'wardrobe' , w: 64, h: 128, max: 1, cols: 1, rows: 1},
    'log':  { name: '书桌', cost: 100, icon: '📖', mapChar: 'l', type: 'log' , w: 64, h: 128, max: 1, cols: 1, rows: 2}
};

// 状态效果定义
const RPG_STATUS = {
    POISON: 'poison', // 中毒
    STUN: 'stun'      // 眩晕
};

// === 异常状态配置表 (在这里自定义BUFF/DEBUFF) ===
// === 异常状态配置表 (完全数据驱动版) ===
const RPG_STATUS_CONFIG = {
    'poison': { 
        name: '中毒', 
        icon: '☠️', 
        overlay: 'rgba(46, 204, 113, 0.4)', 
        // 【新增】施加规则：10%概率触发，持续3回合
        apply: { rate: 0.10, duration: 3, msg: "中毒了！" },
        effect: { 
            damage_pct: 0.10, 
            shake: true, 
            can_move: true 
        }
    },
    'stun': { 
        name: '眩晕', 
        icon: '💫', 
        overlay: null, 
        // 【新增】施加规则：5%概率触发，持续1回合
        apply: { rate: 0.05, duration: 1, msg: "晕倒了！" },
        effect: { 
            can_move: false 
        }
    }

};

    // 完整素材库
// 完整素材库
    const ASSETS = {
        // === 正面 Front ===
        BANGS_46_FRONT: { y: 7, data: [
            "...............................D................................",
            "..............................D.................................",
            "................................................................",
            "................................................................",
            "................................................................",
            "...................................D............................",
            ".......................D............D...........................",
            "......................D......HH......D........H.................",
            "...............LHHHHHDHHHHDHHDHHHHHHHDHHHHHHHHHD................",
            "..............LHHHHHHDHHHHHDDHHHHHHHHHDHHHHHDHHHD...............",
            "..............LHHHHHDHHHHHHHHHLHHHHHHHDHHHHHHDHHHL..............",
            "..............LHHHHHDHHHHHLHHLDLHHHHHHDHHHHHHDHHHL..............",
            "..............LHHHHHDHHHHLDLHLDDLHHHHHHHHHHHHHHHHL..............",
            "..............LHHHHHHHHHHLDDLDDDLHHHHHLHHHHHHDHHHL..............",
            "..............LHHHHHDHHHHL......LHHHHHLHHHHHHDHHHL..............",
            "...............LHHHHDDHHHL......LHHHHL.LHHHHHDHHHL..............",
            "...............LHHHHDLHHHL......LHHHL..LHHHHHDHHL...............",
            "................LHHHDLLHHL......LHHL....LHHHLDHHL...............",
            "................LHHHDL.LHL......LHL.....LHHLDDHL................",
            ".................LHHDL..L........L......LHL.LDHL................",
            "..................LHHL..................LL..LDL.................",
            "...................LHL..................L...LL..................",
            "....................LL......................L...................",
            ".....................L.........................................."
        ]},
        BANGS_M_FRONT: { y: 8, data: [
            ".............................D..................................",
            "............................D...................................",
            "...........................D....................................",
            "...........................D....................................",
            "..........................D.....................................",
            "..........................D.....................................",
            ".........................D......................................",
            ".........................D......................................",
            "........................DD......................................",
            "..............LDHHHHHHHHDLHHHHHHHHHHHHHHHHHHHHHHDL..............",
            "..............LDHHHHHHHDL.LHHHHHHHLHHHHHHHHHHHHHDL..............",
            "..............LDHHHHHHHDL.LHHHHHHL.LDHHHHHHHDHHHDL..............",
            "..............LDHHHHHHDL..LHHHHHHL..LDHHHHHHHDHHHL..............",
            "..............LDHHHHHHDL..LDHHHHHL...LDHHHHHHDHHHL..............",
            "..............LDHHHHHHDL...LHHHHHL....LDHHHHHHDHHL..............",
            "..............LDHHHHHDL....LDHHHHL.....LDHHHHHDHHL..............",
            "..............LDHDHHHDL.....LDHDHHL....LDHHHHHDHHL..............",
            "..............LDHLDHHDL......LDLDHL.....LDHHHHLHHHL.............",
            ".............LDDL.LHDL........L.LDL.....LDHHHDLLHHHL............",
            "..............LL..LDDL...........L.......LDHDL..LLL.............",
            "...................LDL...................LDHL...................",
            "....................L....................LDL....................",
            "..........................................L....................."
        ]},
        BANGS_QI_FRONT: { y: 12, data: [
            ".........................D............D.........................",
            "........................D..............D........................",
            ".......................D................D.......................",
            ".......................D................D.......................",
            "...............LDHHHHHDHHHHHHHHHHHHHHHHHHDHHHHHHDL..............",
            "..............LDHHHHHHDHHHHHHHHHHHHHHHHHHDHHHHHHDL..............",
            "..............LDHHHHHDHHHHHHHHHHHHHHHHHHHHDHHHHHDL..............",
            "..............LDHHHHHDHHHHHHHHHHHHHHHHHHHHDHHHHHDL..............",
            "..............LDHHHHHDHHHHHHHHHHHHHHHHHHHHDHHHHHDL..............",
            "..............LDHHHHDLHHHHHHHHHHHHHHHHHHHHLDHHHHDL..............",
            "..............LDHHHHDLDHHHHHHHHHHHHHHHHHHHLDHHHHDL..............",
            "..............LDHHHHDLDHHHHHHHHHHHHHHHHHHDLDHHHHDL..............",
            "..............LDHHHHL.LLLLLLLLLLLLLLLLLLLL.LHHHHDL..............",
            "..............LDHHHHL......................LHHHHDL..............",
            "..............LDHHHHL......................LHHHHDL..............",
            "..............LDHHHHL......................LHHHHDL..............",
            "...............LDHHHL......................LHHHDL..............",
            "................LDDHL......................LHDDL................",
            ".................LLDDL....................LDDLL.................",
            "...................LL......................LL..................."
        ]},
        BODY_FRONT: { y: 5, data: [
            "..........................LLLLL.LLLLLL..........................",
            ".......................LLLDDDDDLDDDDDDLLL.......................",
            ".....................LLDDDHHHHHHHHHHHHDDDLL.....................",
            "....................LDDHHHHHHHHHHHHHHHHHHDDL....................",
            "...................LDHHHHHHHHHHHHHHHHHHHHHHDL...................",
            "..................LDHHHHHHHHHHHHHHHHHHHHHHHHDL..................",
            ".................LDHHHHHHHHHHHHHHHHHHHHHHHHHHDL.................",
            "................LDHHHHHHHHHHHHHHHHHHHHHHHHHHHHDL................",
            "................LDHHHHHHHHHHHHHHHHHHHHHHHHHHHHDL................",
            "...............LDHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHDL...............",
            "...............LDHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHDL...............",
            "...............LDHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHDL..............",
            "...............DSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS................",
            "................SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS................",
            "................SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS................",
            "................SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS................",
            "................SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS................",
            "................SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS................",
            "................SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS................",
            "................SSSSSSSSSSSSSSSSSSSSSSSSSSSSSSSS................",
            "................SSSSSSSOOOOOOSSSSSSOOOOOOSSSSSSS................",
            ".................MMMSSOSGEEWGSSSSSSGEEWGSOSSMMM.................",
            "................MSSSSSSSGEEEGSSSSSSGEEEGSSSSSSSM................",
            "................MSYSYSSSWAEAWSSSSSSWAEAWSSSYSYSM................",
            "................MSSYSSSSWAAAWSSSSSSWAAAWSSSSYSSM................",
            ".................MSSYSSFFFSSSSSSSSSSSSFFFSSYSSM.................",
            "..................MYYYSSSSSSSSSSSSSSSSSSSSYYYM..................",
            "...................MMMMYSSSSSSSSSSSSSSSSYMMMM...................",
            ".......................MMMSSSSSSSSSSSSMMM.......................",
            "..........................MMMYYYYYYMMM..........................",
            "...........................NZMMYYMMZN...........................",
            "..........................NCCCNYYNCCCN..........................",
            "..........................ZNCCCNNCCCNZ..........................",
            "..........................CZNNNCCNNNZC..........................",
            "..........................NCCCNCNZCCZN..........................",
            "..........................NCCCNCCCCCCN..........................",
            ".........................ZNCCCNCNCCCCNZ.........................",
            ".........................NCCCCNCCCCCCZN.........................",
            "........................ZNCCCCNCNCCCCZNZ........................",
            "........................ZNCCCCNCCCCCCZNZ........................",
            ".........................NZCCZNNZZCCCZN.........................",
            "..........................NZZN..NNZZZN..........................",
            "...........................NN.....NNN..........................."
        ]},
        // 拆分出单独的左手、右手（加入防断层顶部延伸）
        ARM_L_FRONT: { y: 35, data: [
            "...........................NC...................................",
            "..........................NC....................................",
            ".........................NC.....................................",
            "........................NCC.....................................",
            "........................NC......................................",
            ".......................NCC......................................",
            ".......................NCC......................................",
            ".......................NC.......................................",
            "......................NCC.......................................",
            "......................NCC.......................................",
            "......................NCC.......................................",
            "......................YNN.......................................",
            "......................YSS.......................................",
            ".......................YY......................................."
        ]},
        ARM_R_FRONT: { y: 35, data: [
            "...................................CN...........................",
            "....................................CN..........................",
            ".....................................CN.........................",
            ".....................................CCN........................",
            "......................................CN........................",
            "......................................CCN.......................",
            "......................................CCN.......................",
            ".......................................CN.......................",
            ".......................................CCN......................",
            ".......................................CCN......................",
            ".......................................CCN......................",
            ".......................................NNY......................",
            ".......................................SSY......................",
            ".......................................YY......................."
        ]},
        // 拆分裙子/裤子顶部
        SKIRT_FRONT: { y: 46, data: [
            ".........................ITKKKKKKKKKKKI.........................",
            "........................IKTTTTTTTTTTTKKI........................",
            ".......................IKTTTTTTTTTTTTTKKI.......................",
            ".......................IKTTTTTTTTTTTTTKKI.......................",
            "......................IKTTTTTTTTTTTTTTTKKI......................",
            "......................IKTTTTTTTTTTTTTTTKKI......................",
            ".......................IIKKKKKKKKKKKKKKII.......................",
            ".........................IIIIIIIIIIIIII........................."
        ]},
        PANTS_TOP_FRONT: { y: 46, data: [
            ".........................ITTTTKKTTTTTTI.........................",
            ".........................ITTTTTTTTTTTKI.........................",
            ".........................ITTTTTTTTTTTKI.........................",
            ".........................ITTTKIIIITTTKI........................."
        ]},
        // 拆分出独立的左右腿 (带裙子时的光腿)
        LEG_BARE_L_FRONT: { y: 52, data: [
            "..........................YYYY..................................",
            "..........................YYYY..................................",
            "..........................YYYY..................................",
            "..........................SSSS..................................",
            "..........................SSSS..................................",
            ".........................JSSSSJ.................................",
            ".........................JBBBBJ.................................",
            ".........................JBBBBJ.................................",
            "..........................JJJJ.................................."
        ]},
        LEG_BARE_R_FRONT: { y: 52, data: [
            "..................................YYYY..........................",
            "..................................YYYY..........................",
            "..................................YYYY..........................",
            "..................................SSSS..........................",
            "..................................SSSS..........................",
            ".................................JSSSSJ.........................",
            ".................................JBBBBJ.........................",
            ".................................JBBBBJ.........................",
            "..................................JJJJ.........................."
        ]},
        // 拆分出独立的左右腿 (穿裤子时的腿)
        LEG_PANTS_L_FRONT: { y: 48, data: [
            ".........................ITTTKI.................................",
            ".........................ITTTKI.................................",
            ".........................ITTTKI.................................",
            ".........................ITTTKI.................................",
            ".........................ITTTKI.................................",
            ".........................ITTTKI.................................",
            ".........................ITTTKI.................................",
            ".........................ITTTKI.................................",
            ".........................JIIIIJ.................................",
            ".........................JBBBBJ.................................",
            ".........................JBBBBJ.................................",
            "..........................JJJJ.................................."
        ]},
        LEG_PANTS_R_FRONT: { y: 48, data: [
            ".................................ITTTKI.........................",
            ".................................ITTTKI.........................",
            ".................................ITTTKI.........................",
            ".................................ITTTKI.........................",
            ".................................ITTTKI.........................",
            ".................................ITTTKI.........................",
            ".................................ITTTKI.........................",
            ".................................ITTTKI.........................",
            ".................................JIIIIJ.........................",
            ".................................JBBBBJ.........................",
            ".................................JBBBBJ.........................",
            "..................................JJJJ.........................."
        ]},
        BACKHAIR_MID_FRONT: { y: 33, data: [
            "....................LDD................DDDDL....................",
            "....................LDDDDD............DDDDDL....................",
            "...................LDDDLDDL..........LDDLDDDL...................",
            "....................LLL.LL............LL.LLL...................."
        ]},
        BACKHAIR_LONG_FRONT: { y: 18, data: [
            "...............DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD..............",
            "..............DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD..............",
            "..............DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD..............",
            "..............DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "..............LHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHL..............",
            "..............LHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHL..............",
            "..............LHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHL..............",
            "..............LHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHL..............",
            "..............LHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHL..............",
            "..............LHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHHL..............",
            "..............LHHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHHL..............",
            "..............LHHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHHL..............",
            "..............LHHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHHL..............",
            "..............LHHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHHL..............",
            ".............LHHHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHHHL.............",
            ".............LHHHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHHHL.............",
            ".............LHHHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHHHL.............",
            ".............LHHHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHHHL.............",
            ".............LHHHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHHHL.............",
            ".............LHHHDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDHHHL.............",
            "............LHHHHHDDDDDDDDDDDDDDDDDDDDDDDDDDDDHHHHHL............",
            "............LHHHHHDDDDDDDDDDDDDDDDDDDDDDDDDDDDHHHHHL............",
            ".............LHHHHHDDDDDDDDDDDDDDDDDDDDDDDDDDHHHHHL.............",
            "..............LHHHHDDDDDDDDDDDDDDDDDDDDDDDDDDHHHHL..............",
            "...............LHHHHDDDDDDDDDDDDDDDDDDDDDDDDHHHHL...............",
            "................LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL................"
        ]},

        // === 背面 Back ===
        BODY_BACK: { y: 5, data: [
            "..........................LLLLL.LLLLLL..........................",
            ".......................LLLDDDDDLDDDDDDLLL.......................",
            ".....................LLDDDHHHHHHHHHHHHDDDLL.....................",
            "....................LDDHHHHHHHHHHHHHHHHHHDDL....................",
            "...................LDHHHHHHHHHHHHHHHHHHHHHHDL...................",
            "..................LDHHHHHHHHHHHHHHHHHHHHHHHHDL..................",
            ".................LDHHHHHHHHHHHHHHHHHHHHHHHHHHDL.................",
            "................LDHHHHHHHHHHHHHHHHHHHHHHHHHHHHDL................",
            "................LDHHHHHHHHHHHHHHHHHHHHHHHHHHHHDL................",
            "...............LDHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHDL...............",
            "...............LDHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHDL...............",
            "...............LDHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHDDL..............",
            "..............LDDDHHHHHHHHHHHHHHHHHHHHHHHHHHHHDDDL..............",
            "..............LDDDDHHHHHHHHHHHHHHHHHHHHHHHHHHDDDDL..............",
            "..............LDDDDDHHHHHHHHHHHHHHHHHHHHHHHHDDDDDL..............",
            "..............LDDDDDDDHHHHHHHHHHHHHHHHHHHHDDDDDDDL..............",
            "..............LDDDDDDDDDDHHHHHHHHHHHHHHDDDDDDDDDDL..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "...............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL...............",
            "...............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL...............",
            "...............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL...............",
            "................LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL................",
            "................MLDDDDDDDDDDDDDDDDDDDDDDDDDDDDLM................",
            "................MSLDDDDDDDDDDDDDDDDDDDDDDDDDDLSM................",
            "................MSSLDDDDDDDDDDDDDDDDDDDDDDDDLSSM................",
            ".................MSSLDDDDDDDDDDDDDDDDDDDDDDLSSM.................",
            "..................MYYLDDDDDDDDDDDDDDDDDDDDLYYM..................",
            "...................MMMLDDDDDDDDDDDDDDDDDDLMMM...................",
            ".......................LLLDDDDDDDDDDDDLLL.......................",
            "..........................LLLDDDDDDLLL..........................",
            "...........................NZLLLLLLZN...........................",
            "..........................NCCZZZZZZCCN..........................",
            "..........................NCCCCCCCCCCN..........................",
            "..........................NCCCCCCCCCCN..........................",
            "..........................NCCCCCCCCCCN..........................",
            "..........................NCCCCCCCCCCN..........................",
            "..........................NCCCCCCCCCCN..........................",
            ".........................NCCCCCCCCCCCCN.........................",
            ".........................NCCCCCCCCCCCCN.........................",
            ".........................NCCCCCCCCCCCCN.........................",
            ".........................NCCCCCCCCCCCCN.........................",
            "..........................NCCCCCCCCCCN..........................",
            "...........................NNNNNNNNNN..........................."
        ]},
        BANGS_46_BACK: { y: 16, data: [
            "..............LD................................................",
            "..............L.................................................",
            "..............L.................................................",
            "..............L.................................................",
            "..............L.................................................",
            "..............L.................................................",
            "................................................................",
            "...............L................................................"
        ]},
        BANGS_M_BACK: { y: 17, data: [
            "...............D.................................L..............",
            "...............D.................................L..............",
            "..............L..................................L..............",
            "..............L..................................L..............",
            "..............L..................................L..............",
            "..............L..................................L..............",
            "..............LD................................DL..............",
            "..............LD................................DL..............",
            "..............LD................................DDL.............",
            ".............LDDL..............................LDDDL............",
            "..............LL................................LLL.............",
            ".....................L.........................................."
        ]},
        BANGS_QI_BACK: { y: 16, data: [
            "...............L.................................L..............",
            "..............L..................................L..............",
            "..............L..................................L..............",
            "..............L..................................L..............",
            "..............L..................................L..............",
            "..............L..................................L..............",
            "..............L.................................DL..............",
            "..............LDD...............................DL..............",
            "..............LDD...............................DL..............",
            "..............LDD..............................DDL..............",
            "..............LDD.............................DDDL..............",
            "..............LDDD...........................DDDDL..............",
            "...............LDDD.........................DDDDL...............",
            "................LDDD.......................DDDDL................",
            ".................LLDD......................DDLL.................",
            "...................LL......................LL..................."
        ]},
        BACKHAIR_MID_BACK: { y: 32, data: [
            ".....................LDD................DDL.....................",
            "....................LDDDDD............DDDDDL....................",
            "....................LDDDDDDDDDDDDDDDDDDDDDDL....................",
            "...................LDDDLDDDDDDDDDDDDDDDDLDDDL...................",
            "....................LLL.LDDLLLLLLLLLLDDL.LLL....................",
            ".........................LL..........LL........................."
        ]},
        BACKHAIR_LONG_BACK: { y: 22, data: [
            "..............L..................................L..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            ".............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL.............",
            ".............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL.............",
            ".............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL.............",
            ".............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL.............",
            ".............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL.............",
            ".............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL.............",
            "............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL.............",
            "............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL.............",
            ".............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL.............",
            "..............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL..............",
            "...............LDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDL...............",
            "................LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL................"
        ]},

        // === 侧面 Side ===
        BODY_SIDE: { y: 6, data: [
            "...........................LLLLLLLLLL...........................",
            ".........................LLDDHHHHHHHDLL.........................",
            ".......................LLDHHHHHHHHHHHHDLL.......................",
            "......................LDHHHHHHHHHHHHHHHHDL......................",
            ".....................LDHHHHHHHHHHHHHHHHHHDL.....................",
            "....................LDHHHHHHHHHHHHHHHHHHHHDL....................",
            "...................LDHHHHHHHHHHHHHHHHHHHHHHDL...................",
            "..................LDHHHHHHHHHHHHHHHHHHHHHHHHDL..................",
            "..................LHHHHHHHHHHHHHHHHHHHHHHHHHDL..................",
            ".................LDHHHHHHHHHHHHHHHHHHHHHHHHHHDL.................",
            ".................LHHHHHHHHHHHHHHHHHHHHHHHHHHHDL.................",
            ".................LHHHHHHHHHHHHHHHHHHHHHHHHHHHDL.................",
            ".................LHHHHHHHHHHHHHHHHHHHHHHHHHHHDL.................",
            "....................SSSSSSSSSSSSSSSSSSHHHHHHHDDL................",
            "....................SSSSSSSSSSSSSSSSSSHHHHHHDDDL................",
            "....................SSSSSSSSSSSSSSSSSSHHHHHDDDDL................",
            "....................SSSSSSSSSSSSSSSSSSHHHHDDDDDL................",
            "....................SSSSSSSSSSSSSSSSSSHHDDDDDDDL................",
            "....................MSSSSSSSSSSSSSSSSSDDDDDDDDDL................",
            "....................MSOOOOSSSSSSSSSSSSDDDDDDDDDL................",
            ".....................MSWEGOSSSSSSSSMMMDDDDDDDDL.................",
            ".....................MSEEGSSSSSSSSMSSSMDDDDDDDL.................",
            ".....................MSEAWSSSSSSSSMYYSMDDDDDDDL.................",
            "....................MSSAAWSSSSSSSSYYYSMDDDDDDL..................",
            "....................MSSSFFFSSSSSSSYYSSMDDDDDL...................",
            "....................MSSSSSSSSSSSSSSSSMDDDDDL....................",
            ".....................MSSSSSSSSSSYMMMMDDDDLL.....................",
            "......................MSSSSSSSYYMDDDDDLLL.......................",
            ".......................MMMMMMMYYCDLLLL..........................",
            "............................NNYCCCN............................",
            "...........................NCCCNNCN............................",
            "...........................NNCNCCCN............................",
            "...........................NCNCCCCCN............................",
            "...........................NCCCCCCCN............................",
            "..........................NCCCCCCCCN............................",
            "..........................NCCCCCCCCN............................",
            "..........................NCCCCCCCCN............................",
            ".........................NCCCCCCCCCN............................",
            ".........................NCCCCCCCCCCN...........................",
            ".........................NCCCCCCCCCCN...........................",
            "..........................NNNN....NN............................"]},
        BANGS_46_SIDE: { y: 10, data: [
            ".........................D......................................",
            "........................D.......................................",
            "................................................................",
            "...................D....DDD.......D.............................",
            "...................DDD.D...D.......D............................",
            "...................D..D............D............................",
            "..................D.................D...........................",
            "................LDDHH.D.LH...D......L...........................",
            "................LDHHHLDLDLHHHHD..H.HHL..........................",
            "................LDHHHLDLDLHHHHDHHHHHHL..........................",
            "................LDHHLDLDDLHHHHHDHHHHHHLH........................",
            "................LDHHL....LHHHHHDHHHHHHLH........................",
            "................LDHHL....DLHHHHDHHHHHHLH........................",
            ".................LHHL.....LHHHHDHHDHHHHL........................",
            "..................LHHL.....LHHHDHHDHHHHL........................",
            "...................LHL.....LHHHLDHHDHHHHL.......................",
            "....................LL......LHHLLDHDHHHHHL......................",
            ".............................LHLHLHHLHHHHHL.....................",
            "..............................L...LL.LHHHL......................",
            "......................................LLL......................."
        ]},
        BANGS_M_SIDE: { y: 16, data: [
            "..................................D.............................",
            "................LD................D.............................",
            "................LD.................D............................",
            "...............LDHHHHDHHHHHHDHHHHHHDHH..........................",
            "...............LDHHHHDDHHHHHHHHHHHHHDH......H...................",
            "...............LDHHHHDLHHHHHDHHHHHHHDH.....HH...................",
            "...............LDHHHHL.LHHHHDHHHHHHHDDH..DHHHH..................",
            "................LHHHHL..LHHHDHHHHHHHDDD.H.DHHH.L................",
            "................LHHHHL...LHHDHHHHHHLDD..H.DDHHHL................",
            ".................LHHHL....LHLHHHHHHLDD.....LHHH.L...............",
            "..................LHHL.....LHHHHHHHL........LHHHHL..............",
            "...................LHL......LHHHHHL..........LLLL...............",
            "....................L.......LHHHLL..............................",
            "............................LHLL................................",
            ".............................L.................................."
        ]},
        BANGS_QI_SIDE: { y: 17, data: [
            "................LD..............................................",
            "................LH..............................................",
            "................LHHHHHHHHHHHHHHDHHHHHHHD........................",
            "................LHHHHHHHHHHHHHHDHHHHHHHD........................",
            "................LHHHHHHHHHHHHHHLHHHHHHHL........................",
            "................LDHHHHHHHHHHHHDLHHHHHHHL........................",
            "................LDDDDDDDDDDDDDDLDHHHHHHL........................",
            ".................LLLLLLLLLLLLLL.LHHHHHDL........................",
            "................................LHHHHHDL........................",
            "................................LHHHHDLD........................",
            "................................LHHHDDLD........................",
            "................................LHHDDL.D........................",
            "................................LHDDL..D........................",
            "...............................LDDLL...D........................",
            "................................LL.....D........................"
        ]},
        BACKHAIR_LONG_SIDE: { y: 19, data: [
            "........................................H..HHH..................",
            "........................................H..HHH..................",
            "........................................H..HHH..................",
            "........................................H.HHHH.L................",
            "........................................HHHHHH.L................",
            ".......................................HHHHHHH.L................",
            ".......................................HHHHHHH.L................",
            ".......................................HHHHHHHHL................",
            ".......................................HHHHHHHHL................",
            ".......................................HHHHHHHHL................",
            ".......................................HHHHHHHHL................",
            ".......................................HHHHHHHHL................",
            ".......................................HHHHHHHHL................",
            ".......................................DHHHHHHHL................",
            ".................................D...DDDHHHHHHHL................",
            "..................................DDDDDDHHHHHHHDL...............",
            "..................................DDDDDDHHHHHHHDL...............",
            "...................................DDDDDHHHHHHHDL...............",
            "...................................DDDDDHHHHHHHHL...............",
            "....................................DDDDHHHHHHHHL...............",
            "....................................DDDDHHHHHHHHL...............",
            "....................................DDDDHHHHHHHHDL..............",
            "....................................DDDDHHHHHHHHDL...............",
            "....................................DDDDHHHHHHHHL...............",
            "....................................DDDHHHHHHHHL................",
            ".....................................DHHHHHHHHL.................",
            ".....................................LLLLLLLLL.................."
        ]},
        BACKHAIR_MID_SIDE: { y: 30, data: [
            "............................................L...................",
            "...........................................L....................",
            ".........................................DDL....................",
            "......................................DDDDDL....................",
            "..................................DDDDDDDDDL....................",
            "..................................DDDDDDDLDDL...................",
            "...................................DDLLDDDLL....................",
            "....................................LL.LLL......................"
        ]},
        // 侧面用的单手，可以通过偏移量当近手和远手
        ARM_SIDE: { y: 39, data: [
            "................................................................",
            "..............................NCCCN............................",
            "..............................NCCCN............................",
            ".............................NCCCCN.............................",
            ".............................NCCCCN.............................",
            ".............................NCCCCN.............................",
            "..............................NNCCN.............................",
            ".............................MSNNM..............................",
            ".............................MSSSM..............................",
            "..............................MMM..............................."
        ]},
        SKIRT_SIDE: { y: 46, data: [
            "...........................KKKKKKKKI............................",
            ".........................ITTTTTTTTKKI...........................",
            "........................ITTTTTTTTTTKKI..........................",
            "........................ITTTTTTTTTTKKI..........................",
            ".......................ITTTTTTTTTTTTKKI.........................",
            ".......................ITTTTTTTTTTTTKKI.........................",
            "........................IIKKKKKKKKKKII..........................",
            "..........................IIIIIIIIII............................"
        ]},
        PANTS_TOP_SIDE: { y: 46, data: [
            "...........................ITTTTTT..............................",
            "...........................ITTTTTKKI............................",
            "...........................ITTTTTKI.............................",
            "...........................ITTTTTKI............................."
        ]},
        // 侧面单腿，复制两份并错开就可以走路
        LEG_BARE_SIDE: { y: 52, data: [
            "............................MYYYYM..............................",
            "............................MYYYYM..............................",
            "............................MYYYYM..............................",
            "............................MSSSSM..............................",
            "............................MSSSSM..............................",
            "..........................JJJBBBBJ..............................",
            "..........................JBBBBBBJ..............................",
            "..........................JBBBBBBJ..............................",
            "...........................JJJJJJ..............................."
        ]},
        LEG_PANTS_SIDE: { y: 48, data: [
            "...........................ITTTTKI..............................",
            "...........................ITTTTKI..............................",
            "...........................ITTTTKI..............................",
            "...........................ITTTTKI..............................",
            "...........................ITTTTKI..............................",
            "...........................ITTTTKI..............................",
            "...........................ITTTTKI..............................",
            "...........................ITTTTKI..............................",
            "..........................JJBBBBBJ..............................",
            "..........................JBBBBBBJ..............................",
            "..........................JBBBBBBJ..............................",
            "...........................JJJJJJ..............................."
        ]}
    };

// === 通用的绘制逻辑，用于 P1 和 P2 ===
    const drawCroppedPreview = (canvas, settings) => {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        const sheet = generateCharaSprite(settings);

        canvas.width = 64;  
        canvas.height = 64; 

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(sheet, 0, 0, 64, 64, 0, 0, 64, 64);
    };

// --- 辅助工具：颜色变亮/变暗 ---
function adjustColor(col, amt) {
    let usePound = false;
    if (col[0] == "#") {
        col = col.slice(1);
        usePound = true;
    }
    let num = parseInt(col, 16);
    let r = (num >> 16) + amt;
    if (r > 255) r = 255; else if (r < 0) r = 0;
    let b = ((num >> 8) & 0x00FF) + amt;
    if (b > 255) b = 255; else if (b < 0) b = 0;
    let g = (num & 0x0000FF) + amt;
    if (g > 255) g = 255; else if (g < 0) g = 0;
    return (usePound ? "#" : "") + (g | (b << 8) | (r << 16)).toString(16).padStart(6, '0');
}




// 角色创建页逻辑更新
function setupRpgCreateScreenLogic() {
    // 1. 获取所有输入框 (保持原有逻辑不变)
    const getInputs = (prefix) => ({
        hair: document.getElementById(`${prefix}-color-hair`).value,
        eye: document.getElementById(`${prefix}-color-eye`).value,
        skin: document.getElementById(`${prefix}-color-skin`).value,
        top: document.getElementById(`${prefix}-color-top`).value,
        bottom: document.getElementById(`${prefix}-color-bottom`).value,
        shoe: document.getElementById(`${prefix}-color-shoe`).value,
        bangs: document.getElementById(`${prefix}-style-bangs`).value,
        back: document.getElementById(`${prefix}-style-back`).value,
        botStyle: document.getElementById(`${prefix}-style-bottom`).value
    });

    // 【新增】P1 实时预览监听
    document.querySelectorAll('.preview-trigger-p1').forEach(el => {
        el.addEventListener('input', () => updatePreview('p1'));
        el.addEventListener('change', () => updatePreview('p1'));
    });

    // 【新增】P2 实时预览监听
    document.querySelectorAll('.preview-trigger-p2').forEach(el => {
        el.addEventListener('input', () => updatePreview('p2'));
        el.addEventListener('change', () => updatePreview('p2'));
    });

    // 2. 预览更新函数 (保持不变)
   const updatePreview = (target) => {
        const canvasId = `${target}-preview-canvas`;
        const canvas = document.getElementById(canvasId);
        const settings = getInputs(target);
        drawCroppedPreview(canvas, settings);
    };

    // ============================================================
    // 1. 读取用户人设 (样式适配)
    // ============================================================
    const loadUserBtn = document.getElementById('rpg-load-user-btn');
    const userPersonaModal = document.getElementById('rpg-user-persona-modal');
    const userPersonaList = document.getElementById('rpg-user-persona-list');
    const confirmUserBtn = document.getElementById('rpg-confirm-user-persona');

    if (loadUserBtn) {
        loadUserBtn.addEventListener('click', () => {
            const presets = db.userPersonas || [];
            userPersonaList.innerHTML = '';
            
            if (presets.length === 0) {
                userPersonaList.innerHTML = '<li class="list-item" style="color:#aaa; justify-content:center;">暂无人设预设</li>';
            } else {
                presets.forEach((preset, index) => {
                    const li = document.createElement('li');
                    li.className = 'list-item'; // 使用通用样式
                    li.style.cssText = "display:flex; align-items:center; padding:12px;";
                    // 使用单选框
                    li.innerHTML = `
<input type="radio" name="rpg_user_select" value="${index}" id="rpg_u_${index}" style="margin-right:15px; transform:scale(1.2);">
<label for="rpg_u_${index}" style="display:flex; align-items:center; flex:1; cursor:pointer;">
    <img src="${preset.avatar}" style="width:36px; height:36px; border-radius:50%; margin-right:10px; object-fit:cover;">
    <div style="display:flex; flex-direction:column; justify-content:center;">
        <div style="font-weight:bold; color:var(--primary-color);">${preset.nickname}</div>
        <div style="font-size:12px; color:#666; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:200px;">姓名：${preset.realName || '勇者'}</div>
    </div>
</label>
                    `;
                    userPersonaList.appendChild(li);
                });
            }
            userPersonaModal.classList.add('visible');
        });
    }
    
    // 确认读取用户人设
    if (confirmUserBtn) {
        const newBtn = confirmUserBtn.cloneNode(true);
        confirmUserBtn.parentNode.replaceChild(newBtn, confirmUserBtn);
        newBtn.addEventListener('click', () => {
            const checked = userPersonaList.querySelector('input[name="rpg_user_select"]:checked');
            if (checked) {
                const preset = db.userPersonas[parseInt(checked.value)];
                document.getElementById('p1-name-input').value = preset.nickname;
                document.getElementById('p1-persona-hidden').value = preset.persona;
                showToast(`已读取: ${preset.nickname}`);
                userPersonaModal.classList.remove('visible');
            } else {
                showToast("请先选择一项");
            }
        });
    }


    // ============================================================
    // 2. 选择伙伴 (样式适配)
    // ============================================================
    const choosePartnerBtn = document.getElementById('rpg-choose-partner-btn');
    const partnerModal = document.getElementById('rpg-partner-select-modal');
    const partnerList = document.getElementById('rpg-partner-list');
    const confirmPartnerBtn = document.getElementById('rpg-confirm-partner-select');
    const startBtn = document.getElementById('rpg-start-adventure-btn');

    if (choosePartnerBtn) {
        choosePartnerBtn.addEventListener('click', () => {
            partnerList.innerHTML = '';
            const chars = db.characters || [];
            
            if (chars.length === 0) {
                partnerList.innerHTML = '<li class="list-item" style="color:#aaa; justify-content:center;">没有角色数据</li>';
            } else {
                chars.forEach(char => {
                    const li = document.createElement('li');
                    li.className = 'list-item';
                    li.style.cssText = "display:flex; align-items:center; padding:10px;";
                    const name = char.remarkName || char.realName;
                    
                    li.innerHTML = `
<input type="radio" name="rpg_partner_select" value="${char.id}" id="rpg_p_${char.id}" style="margin-right:15px; transform:scale(1.2);">
<label for="rpg_p_${char.id}" style="display:flex; align-items:center; flex:1; cursor:pointer;">
    <img src="${char.avatar}" style="width:36px; height:36px; border-radius:50%; margin-right:10px; object-fit:cover;">
    <div style="display:flex; flex-direction:column; justify-content:center;">
        <div style="font-weight:bold; color:var(--primary-color);">${name}</div>
        <div style="font-size:12px; color:#666; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:200px;">姓名：${char.realName}</div>
    </div>
</label>
                    `;
                    partnerList.appendChild(li);
                });
            }
            partnerModal.classList.add('visible');
        });
    }

    // 确认选择伙伴逻辑保持不变，只需重新绑定按钮即可
    if (confirmPartnerBtn) {
        const newBtn = confirmPartnerBtn.cloneNode(true);
        confirmPartnerBtn.parentNode.replaceChild(newBtn, confirmPartnerBtn);
        newBtn.addEventListener('click', () => {
             const checked = partnerList.querySelector('input[name="rpg_partner_select"]:checked');
             if (checked) {
                 selectedPartnerCharId = checked.value;
                 const char = db.characters.find(c => c.id === selectedPartnerCharId);
                
                // 显示 P2 设置区域
                const p2Card = document.getElementById('rpg-partner-card');
                if (p2Card) p2Card.style.display = 'block';
                const nameToUse = char.remarkName || char.realName;
                
                // 显示 AI 初始化按钮
                const aiBtn = document.getElementById('rpg-ai-init-btn');
                if (aiBtn) aiBtn.style.display = 'inline-block';
                
                choosePartnerBtn.innerText = `当前伙伴: ${char.realName}`;
                document.getElementById('p2-name-input').value = nameToUse;
                
                // 【关键修复】禁用开始按钮，并置灰
                if (startBtn) {
                    startBtn.disabled = true; // 设置 disabled 属性
                    startBtn.innerText = "请先进行冒险初始化";
                }
                
                // 重置填充率显示
                const rateEl = document.getElementById('fill-rate-val');
                if(rateEl) {
                    rateEl.innerText = "0% (等待初始化)";
                    rateEl.style.color = "#aaa";
                }

                // 立即渲染一次默认的 P2 预览
                setTimeout(() => updatePreview('p2'), 50);
            } else {
                showToast("请先选择一个角色");
                return; // 没选不关闭
            }
            partnerModal.classList.remove('visible');
        });
    }

    // ============================================================
    // 3. 【新版】选择世界书 (单按钮 + 通用列表样式)
    // ============================================================
    const selectWbBtn = document.getElementById('rpg-select-wb-btn');
    const wbModal = document.getElementById('rpg-wb-select-modal');
    const wbList = document.getElementById('rpg-wb-list');
    const wbConfirmBtn = document.getElementById('rpg-wb-confirm-btn');
    const wbPreview = document.getElementById('rpg-wb-preview-text');

    // 点击模态框背景关闭
    wbModal.addEventListener('click', (e) => {
        if (e.target === wbModal) wbModal.classList.remove('visible');
    });

    if (selectWbBtn) {
        selectWbBtn.addEventListener('click', () => {
            // 使用通用的渲染函数 (与日记/WorldBook 保持一致)
            // 参数: 容器, 数据源, 已选ID数组, ID前缀
            if (typeof renderCategorizedWorldBookList === 'function') {
                renderCategorizedWorldBookList(wbList, db.worldBooks, selectedRpgWorldBookIds, 'rpg-newgame-wb');
            } else {
                console.error("renderCategorizedWorldBookList function not found!");
            }
            
            wbModal.dataset.context = 'new_game'; // 标记当前是新游戏界面
            wbModal.classList.add('visible');
        });
    }

    if (wbConfirmBtn) {
        const newBtn = wbConfirmBtn.cloneNode(true);
        wbConfirmBtn.parentNode.replaceChild(newBtn, wbConfirmBtn);
        
        newBtn.addEventListener('click', () => {
            // 获取所有选中的 item-checkbox
            const selectedInputs = Array.from(wbList.querySelectorAll('.item-checkbox:checked'));
            const selectedIds = selectedInputs.map(input => input.value);
            const context = wbModal.dataset.context;

            if (context === 'new_game') {
                // 新游戏界面逻辑
                selectedRpgWorldBookIds = selectedIds;
                
                if (selectedIds.length > 0) {
                    selectWbBtn.innerText = `已绑定 ${selectedIds.length} 本世界书`;
                    selectWbBtn.classList.remove('btn-neutral');
                    selectWbBtn.classList.add('btn-primary'); 
                } else {
                    selectWbBtn.innerText = `绑定世界书 (可选)`;
                    selectWbBtn.classList.remove('btn-primary');
                    selectWbBtn.classList.add('btn-neutral');
                }
                showToast(`已绑定 ${selectedIds.length} 本世界书`);
                
            } else if (context === 'status_screen') {
                if (window.rpgGameInstance) {
                    window.rpgGameInstance.worldBookIds = selectedIds;
                    showToast("绑定已更新，请记得保存游戏！");
                    window.rpgGameInstance.renderStatusScreen(); 
                }
            }
            
            wbModal.classList.remove('visible');
        });
    }



    // ============================================================
    // 4. AI 冒险初始化 (生成台词和颜色)
    // ============================================================
     const aiInitBtn = document.getElementById('rpg-ai-init-btn');
    
// 在 setupRpgCreateScreenLogic 中
    if (aiInitBtn) {
        aiInitBtn.addEventListener('click', async () => {
            if (!selectedPartnerCharId) return showToast("请先选择伙伴");
            const { url, key, model } = db.apiSettings;
            if (!url || !key || !model) return showToast('请先配置API');

           // 2. 准备 P1 (勇者) 数据
            // 游戏名：取输入框的值
            const p1GameName = document.getElementById('p1-name-input').value || "勇者";
            // 人设：取隐藏域的值（如果为空则兜底）
            let p1PersonaText = document.getElementById('p1-persona-hidden').value || "普通的冒险者";
            
            // 真名：尝试回溯选中的用户档案
            let p1RealName = p1GameName; // 默认真名等于游戏名
            const p1SelectedRadio = document.querySelector('input[name="rpg_user_select"]:checked');
            if (p1SelectedRadio && db.userPersonas) {
                const preset = db.userPersonas[p1SelectedRadio.value];
                if (preset) {
                    p1RealName = preset.realName; // 获取档案里的名字作为真名
                    // 如果隐藏域为空（可能是手动修改了名字但没重载人设），这里补救一下
                    if (!p1PersonaText) p1PersonaText = preset.persona;
                }
            }

            // 3. 准备 P2 (伙伴) 数据
            const char = db.characters.find(c => c.id === selectedPartnerCharId);
            // 游戏名：取输入框的值 (用户可能修改了)
            const p2GameName = document.getElementById('p2-name-input').value || char.realName;
            // 真名：数据库里的名字
            const p2RealName = char.realName;
            // 人设
            const p2PersonaText = char.persona || "忠诚的伙伴";

            // 4. 准备世界书内容
            const currentWbIds = selectedRpgWorldBookIds || [];
            const getWb = (pos) => currentWbIds
                .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === pos))
                .filter(Boolean)
                .map(wb => wb.content)
                .join('\n');
            
            const wbBefore = getWb('before');
            const wbAfter = getWb('after');
            const wbWriting = getWb('writing');

            // 5. 构建 Prompt
            aiInitBtn.disabled = true;
            aiInitBtn.innerText = "初始化中...";

            let prompt = `你是一个RPG游戏文案策划。请根据以下设定，为角色【${p2RealName}】生成在像素RPG中的全套台词和形象配色。\n`;
            
            if (wbBefore) prompt += `【世界观】\n${wbBefore}\n\n`;
            
            prompt += `【角色资料】
勇者: 游戏名是${p1GameName} (真名: ${p1RealName})
勇者设定: ${p1PersonaText}

冒险伙伴: 游戏名是${p2GameName} (真名: ${p2RealName})
冒险伙伴设定: ${p2PersonaText}

关系：两人是共同冒险的搭档，冒险伙伴的台词需要体现对勇者的特定态度。
\n`;

            if (wbAfter) prompt += `【重要事项说明】\n${wbAfter}\n\n`;
            if (wbWriting) prompt += `【你的写作风格】\n${wbWriting}\n\n`;

            prompt += `
【输出要求】：
1. 严禁返回JSON。请严格使用下方【格式模板】，每个标签占一行。
2. 战斗类和剧情类台词，每种请按要求生成不同的变体，用竖线 "|" 分隔。
3. 台词要符合RPG风格。

【形象配色参数输出要求】：
请提供以下9个标签，颜色请使用Hex代码，样式请输出数字代码。
#C_HAIR# 头发颜色 (Hex)
#C_EYE# 眼睛颜色 (Hex)
#C_SKIN# 皮肤颜色 (Hex，推荐 #FFE4CF 或 #FAD7BB)
#C_TOP# 上衣颜色 (Hex)
#C_BOT# 下装颜色 (Hex)
#C_SHOE# 鞋子颜色 (Hex)
#S_BANG# 刘海样式代码 (0=分发, 1=M字, 2=齐刘海) - 请根据人设选择最合适的
#S_BACK# 后发样式代码 (0=短发, 1=中发, 2=长发)
#S_BTYP# 下装类型代码 (0=裤子, 1=裙子) - 请根据你推断的人物性别选择最合适的

【台词输出要求】：
#INTRO# 开场白 (1句)
#MAP1# 迷雾森林的闲聊 (3-5句，用|分隔)
#MAP2# 遗忘废墟的闲聊 (3-5句，用|分隔)
#MAP3# 魔王城的闲聊 (3-5句，用|分隔)
#MAP_RETURN# 回到已探索地图时的吐槽 (3句，用|分隔)
#ATK# 发起攻击时的喊话 (3句，用|分隔，例如：看招！|接好了！|哈！)
#HURT# 被攻击受伤时的反应 (3句，用|分隔，例如：好痛！|大意了...|你等着！)
#HEAL# 治疗时的台词 (3句，用|分隔，例如：别乱动。|治疗术！|感觉好点没？)
#HEALED# 被玩家治疗时的感谢 (3句，用|分隔，例如：谢了。|复活了！|你还挺在行的。)
#LVUP# 升级时的喜悦 (3句，用|分隔)
#DEAD# 战斗失败/死亡时的遗言 (3句，用|分隔)
#ENDING# 通关后的感言 (5句以上，用|分隔，例如：终于结束了...|我们是冠军！|该回家了。|谢谢你一直陪着我。|再见，朋友。)`;

        try {
            const response = await fetch(`${url}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.8
                })
            });
            
            const data = await response.json();
            const content = data.choices[0].message.content;

            const parseTag = (tag) => {
                const regex = new RegExp(`${tag}\\s*(.*)`);
                const match = content.match(regex);
                return match ? match[1].trim() : null;
            };
            const splitLines = (text) => text ? text.split('|').map(t => t.trim()).filter(t => t) : [];

            tempRpgConfig = {
                p2Name: char.realName,
                styleData: {
                    hair: parseTag('#C_HAIR#') || '#e74c3c',
                    eye: parseTag('#C_EYE#') || '#2c3e50',
                    skin: parseTag('#C_SKIN#') || '#FFE4CF',
                    top: parseTag('#C_TOP#') || '#2ecc71',
                    bottom: parseTag('#C_BOT#') || '#2c3e50',
                    shoe: parseTag('#C_SHOE#') || '#101018',
                    bangs: parseTag('#S_BANG#') || '0',
                    back: parseTag('#S_BACK#') || '0',
                    botStyle: parseTag('#S_BTYP#') || '0'
                },
                headColor: parseTag('#C_HAIR#') || '#e74c3c',
                bodyColor: parseTag('#C_TOP#') || '#2ecc71',
                intro: parseTag('#INTRO#') || "我们出发吧！",
                dialogues: {
                    map1: splitLines(parseTag('#MAP1#')),
                    map2: splitLines(parseTag('#MAP2#')),
                    map3: splitLines(parseTag('#MAP3#')),
                    return: splitLines(parseTag('#MAP_RETURN#')),
                    atk: splitLines(parseTag('#ATK#')),
                    hurt: splitLines(parseTag('#HURT#')),
                    heal: splitLines(parseTag('#HEAL#')),
                    healed: splitLines(parseTag('#HEALED#')),
                    lvup: splitLines(parseTag('#LVUP#')),
                    dead: splitLines(parseTag('#DEAD#')),
                    ending: splitLines(parseTag('#ENDING#'))
                }
            };

            const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
            
            setVal('p2-color-hair', tempRpgConfig.styleData.hair);
            setVal('p2-color-eye', tempRpgConfig.styleData.eye);
            setVal('p2-color-skin', tempRpgConfig.styleData.skin);
            setVal('p2-color-top', tempRpgConfig.styleData.top);
            setVal('p2-color-bottom', tempRpgConfig.styleData.bottom);
            setVal('p2-color-shoe', tempRpgConfig.styleData.shoe);
            setVal('p2-style-bangs', tempRpgConfig.styleData.bangs);
            setVal('p2-style-back', tempRpgConfig.styleData.back);
            setVal('p2-style-bottom', tempRpgConfig.styleData.botStyle);

            // 【关键修复】显示伙伴设置区域和预览
            const settingsContainer = document.getElementById('rpg-partner-settings-container');
            const waitMsg = document.getElementById('rpg-partner-wait-msg');
            if (settingsContainer) settingsContainer.style.display = 'block';
            if (waitMsg) waitMsg.style.display = 'none';

            // 触发预览更新
            updatePreview('p2');

            const keys = ['map1','map2','map3','return','atk','hurt','heal','healed','lvup','dead','ending'];
            let filledCount = 0;
            keys.forEach(k => { 
                if(tempRpgConfig.dialogues[k] && tempRpgConfig.dialogues[k].length > 0) filledCount++; 
            });
            const rate = Math.floor((filledCount / keys.length) * 100);
            
            const rateEl = document.getElementById('fill-rate-val');
            if(rateEl) {
                rateEl.innerText = `${rate}%`;
                rateEl.style.color = rate >= 80 ? '#2ecc71' : '#e74c3c';
            }

            const startBtn = document.getElementById('rpg-start-adventure-btn');
            if (rate > 50) {
                startBtn.disabled = false;
                startBtn.innerText = "开始冒险";
                showToast("初始化成功！");
            } else {
                startBtn.innerText = "初始化填充率过低";
                showToast("生成缺失较多，请重试");
            }

        } catch (e) {
            console.error(e);
            showToast("生成失败，请检查API设置");
        } finally {
            aiInitBtn.disabled = false;
            aiInitBtn.innerText = "✨ 冒险初始化";
        }
    });
}


}


// --- 矩阵绘图工具 ---
// ctx: 画布上下文
// matrix: 字符数组，例如 ["001100", "011110"]
// palette: 颜色映射对象，例如 { '0': null, '1': hairColor, '2': skinColor }
// startX, startY: 起始坐标
function drawFromMatrix(ctx, matrix, palette, startX, startY) {
    for (let y = 0; y < matrix.length; y++) {
        const row = matrix[y];
        for (let x = 0; x < row.length; x++) {
            const char = row[x];
            const color = palette[char];
            if (color) { // 如果颜色不为 null/false 才绘制
                ctx.fillStyle = color;
                ctx.fillRect(startX + x, startY + y, 1, 1);
            }
        }
    }
}


/* 【✪开始】JS: 怪物生成与角色生成器更新 */

// 1. 怪物生成器 (48x48) - 3种固定样式
function generateMonsterSprite(type) {
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // 简单绘制逻辑，实际可以是更复杂的矩阵
    const drawPixel = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, 4, 4); }; // 放大像素点

    if (type === 0) { // 史莱姆 (Slime)
        ctx.fillStyle = "#e74c3c"; // 红色
        ctx.beginPath();
        ctx.arc(24, 30, 16, Math.PI, 0); // 半圆顶
        ctx.lineTo(40, 44); ctx.lineTo(8, 44);
        ctx.fill();
        // 眼睛
        ctx.fillStyle = "#fff"; ctx.fillRect(16, 26, 4, 8); ctx.fillRect(28, 26, 4, 8);
        ctx.fillStyle = "#000"; ctx.fillRect(18, 28, 2, 4); ctx.fillRect(30, 28, 2, 4);
    } else if (type === 1) { // 蝙蝠 (Bat)
        ctx.fillStyle = "#8e44ad"; // 紫色
        ctx.beginPath();
        ctx.arc(24, 24, 10, 0, Math.PI*2); ctx.fill(); // 身体
        // 翅膀
        ctx.beginPath(); ctx.moveTo(14, 24); ctx.lineTo(2, 10); ctx.lineTo(14, 18); ctx.fill();
        ctx.beginPath(); ctx.moveTo(34, 24); ctx.lineTo(46, 10); ctx.lineTo(34, 18); ctx.fill();
        // 眼睛
        ctx.fillStyle = "#f1c40f"; ctx.fillRect(20, 22, 2, 2); ctx.fillRect(26, 22, 2, 2);
    } else if (type === 2) { // 幽灵/BOSS (Ghost)
        ctx.fillStyle = "#bdc3c7"; // 白色
        ctx.beginPath();
        ctx.arc(24, 20, 14, Math.PI, 0); // 头部
        ctx.lineTo(38, 44); ctx.lineTo(32, 38); ctx.lineTo(24, 44); ctx.lineTo(16, 38); ctx.lineTo(10, 44);
        ctx.lineTo(10, 20); 
        ctx.fill();
        // 眼睛
        ctx.fillStyle = "#2c3e50"; ctx.fillRect(18, 18, 4, 4); ctx.fillRect(26, 18, 4, 4);
    }
    return canvas;
}

// 2. 角色生成器更新 (支持所有9个参数)
// 角色生成器更新
function generateCharaSprite(settings) {
    const S = {
        hair: settings.hair || '#917C66',
        eye: settings.eye || '#D7CAFF',
        skin: settings.skin || '#FFE4CF',
        top: settings.top || '#3498db',     
        bottom: settings.bottom || '#2c3e50', 
        shoe: settings.shoe || '#101018',   
        bangs: settings.bangs !== undefined ? parseInt(settings.bangs) : 0, 
        back: settings.back !== undefined ? parseInt(settings.back) : 0,    
        botStyle: settings.botStyle !== undefined ? parseInt(settings.botStyle) : 0 
    };

    const SIZE = 64; 
    const canvas = document.createElement('canvas');
    canvas.width = SIZE * 4;  
    canvas.height = SIZE * 4; 
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const adjust = (c, a) => typeof adjustColor === 'function' ? adjustColor(c, a) : c; 

    const P = {
        '.': null, 
        'H': S.hair, 'D': adjust(S.hair, -30), 'L': adjust(S.hair, -100),
        'S': S.skin, 'M': adjust(S.skin, -80), 'Y': adjust(S.skin, -40),
        'E': adjust(S.eye, -60), 'A': S.eye, 'W': "#ffffff", 'O': "#4a3c31", 'G': "#cccccc", 'F': "#ffb0a0",
        'C': S.top, 'Z': adjust(S.top, -30), 'N': adjust(S.top, -110),
        'T': S.bottom, 'K': adjust(S.bottom, -30), 'I': adjust(S.bottom, -110),
        'B': S.shoe, 'J': adjust(S.shoe, -110)
    };

    // 绘制矩阵函数 (新增了 dx, dy 肢体摆动偏移，以及 darken 阴影选项)
    const drawMatrix = (matrixObj, ox, oy, flipX, dx = 0, dy = 0, darken = false) => {
        if (!matrixObj || !matrixObj.data) return;
        const matrix = matrixObj.data;
        const startY = matrixObj.y + oy + dy; 
        
        for (let y = 0; y < matrix.length; y++) {
            const rowStr = matrix[y];
            for (let x = 0; x < rowStr.length; x++) {
                const char = rowStr[x];
                if (P[char]) {
                    const drawX = flipX ? (SIZE - 1 - x) : x;
                    ctx.fillStyle = darken ? adjust(P[char], -40) : P[char];
                    ctx.fillRect(ox + drawX + dx, startY + y, 1, 1);
                }
            }
        }
    };

    // 绘图循环 (4方向 x 4帧)
    for (let dir = 0; dir < 4; dir++) {
        for (let frame = 0; frame < 4; frame++) {
            const isWalk = (frame === 1 || frame === 3);
            const bob = isWalk ? 2 : 0; 
            const ox = frame * SIZE;
            const oy = dir * SIZE;
            const isSkirt = (S.botStyle === 1);

            // 正面 / 背面
            if (dir === 0 || dir === 3) { 
                const isBack = (dir === 3);
                
                let leftLegDy = 0, rightLegDy = 0;
                let leftArmDy = 0, rightArmDy = 0;
                
                if (frame === 1) { // 踏步
                    leftLegDy = -2; rightLegDy = 0;
                    leftArmDy = -2; rightArmDy = 1;
                } else if (frame === 3) { // 交替踏步
                    leftLegDy = 0; rightLegDy = -2;
                    leftArmDy = 1; rightArmDy = -2;
                }

                if (!isBack) {
                    if (S.back === 1) drawMatrix(ASSETS.BACKHAIR_MID_FRONT, ox, oy + bob, false);
                    if (S.back === 2) drawMatrix(ASSETS.BACKHAIR_LONG_FRONT, ox, oy + bob, false);
                }

                if (isSkirt) {
                    drawMatrix(ASSETS.LEG_BARE_L_FRONT, ox, oy + bob, false, 0, leftLegDy);
                    drawMatrix(ASSETS.LEG_BARE_R_FRONT, ox, oy + bob, false, 0, rightLegDy);
                } else {
                    drawMatrix(ASSETS.LEG_PANTS_L_FRONT, ox, oy + bob, false, 0, leftLegDy);
                    drawMatrix(ASSETS.LEG_PANTS_R_FRONT, ox, oy + bob, false, 0, rightLegDy);
                }



                if (isSkirt) drawMatrix(ASSETS.SKIRT_FRONT, ox, oy + bob, false);
                else drawMatrix(ASSETS.PANTS_TOP_FRONT, ox, oy + bob, false);
                                drawMatrix(isBack ? ASSETS.BODY_BACK : ASSETS.BODY_FRONT, ox, oy + bob, false);

                if (isBack) {
                    if (S.bangs === 0) drawMatrix(ASSETS.BANGS_46_BACK, ox, oy + bob, false);
                    else if (S.bangs === 1) drawMatrix(ASSETS.BANGS_M_BACK, ox, oy + bob, false);
                    else if (S.bangs === 2) drawMatrix(ASSETS.BANGS_QI_BACK, ox, oy + bob, false);
                } else {
                    if (S.bangs === 0) drawMatrix(ASSETS.BANGS_46_FRONT, ox, oy + bob, false);
                    else if (S.bangs === 1) drawMatrix(ASSETS.BANGS_M_FRONT, ox, oy + bob, false);
                    else if (S.bangs === 2) drawMatrix(ASSETS.BANGS_QI_FRONT, ox, oy + bob, false);
                }

                drawMatrix(ASSETS.ARM_L_FRONT, ox, oy + bob, false, 0, leftArmDy);
                drawMatrix(ASSETS.ARM_R_FRONT, ox, oy + bob, false, 0, rightArmDy);

                if (isBack) {
                    if (S.back === 1) drawMatrix(ASSETS.BACKHAIR_MID_BACK, ox, oy + bob, false);
                    if (S.back === 2) drawMatrix(ASSETS.BACKHAIR_LONG_BACK, ox, oy + bob, false);
                }
            }
            // 侧面
            else if (dir === 1 || dir === 2) {
                const flip = (dir === 2); 
                const dirSign = flip ? -1 : 1; 

                // 辅助：负数代表角色面向的前方，正数代表后方
                const walkShift = (fwd, up) => ({ dx: fwd * dirSign, dy: up });

                let nLeg = {dx:0, dy:0}, fLeg = {dx:0, dy:0}; // 近腿, 远腿(暗)
                let nArm = {dx:0, dy:0}, fArm = {dx:0, dy:0}; // 近手, 远手(暗)

                // 【核心优化】：改变步态逻辑，让远处的暗腿总是偏前（开放站姿）
                if (frame === 1) {
                    // 第一帧：暗腿(远)向前踩实，亮腿(近)向后略微抬起
                    fLeg = walkShift(-3, 0);   
                    nLeg = walkShift(3, -1);   
                    fArm = walkShift(3, -1);   // 手与腿反向摆动
                    nArm = walkShift(-3, 0);   
                } else if (frame === 3) {
                    // 第三帧：暗腿(远)向后略微抬起，亮腿(近)向前踩实
                    fLeg = walkShift(3, -1);   
                    nLeg = walkShift(-3, 0);   
                    fArm = walkShift(-3, 0);   
                    nArm = walkShift(3, -1);   
                } else { 
                    // 站立帧：默认让暗腿稍微在前，匹配身体微微前倾的 3/4 侧身角度
                    fLeg = walkShift(-1, 0);   
                    nLeg = walkShift(1, 0);    
                    fArm = walkShift(1, 0);    // 暗手臂也配合往后微调
                    nArm = walkShift(0, 0);    
                }

                // 按正确的遮挡关系绘制 (远手 -> 远腿 -> 近腿 -> 后发 -> 身体 -> 裙子 -> 近手)
                
                // 1. 远手（传入 true 调暗产生阴影距离感）
                drawMatrix(ASSETS.ARM_SIDE, ox, oy + bob, flip, fArm.dx, fArm.dy, true);

                // 2. 远腿（传入 true 调暗产生阴影距离感）
                if (isSkirt) drawMatrix(ASSETS.LEG_BARE_SIDE, ox, oy + bob, flip, fLeg.dx, fLeg.dy, true);
                else drawMatrix(ASSETS.LEG_PANTS_SIDE, ox, oy + bob, flip, fLeg.dx, fLeg.dy, true);

                // 3. 近腿
                if (isSkirt) drawMatrix(ASSETS.LEG_BARE_SIDE, ox, oy + bob, flip, nLeg.dx, nLeg.dy, false);
                else drawMatrix(ASSETS.LEG_PANTS_SIDE, ox, oy + bob, flip, nLeg.dx, nLeg.dy, false);





                // 6. 固定的裙摆/裤头
                if (isSkirt) drawMatrix(ASSETS.SKIRT_SIDE, ox, oy + bob, flip);
                else drawMatrix(ASSETS.PANTS_TOP_SIDE, ox, oy + bob, flip);
                
                                // 5. 身体核心
                drawMatrix(ASSETS.BODY_SIDE, ox, oy + bob, flip);

                // 4. 后发
                if (S.back === 1) drawMatrix(ASSETS.BACKHAIR_MID_SIDE, ox, oy + bob, flip);
                if (S.back === 2) drawMatrix(ASSETS.BACKHAIR_LONG_SIDE, ox, oy + bob, flip);

                // 7. 刘海
                if (S.bangs === 0) drawMatrix(ASSETS.BANGS_46_SIDE, ox, oy + bob, flip);
                else if (S.bangs === 1) drawMatrix(ASSETS.BANGS_M_SIDE, ox, oy + bob, flip);
                else if (S.bangs === 2) drawMatrix(ASSETS.BANGS_QI_SIDE, ox, oy + bob, flip);

                // 8. 近手
                drawMatrix(ASSETS.ARM_SIDE, ox, oy + bob, flip, nArm.dx, nArm.dy, false);
            }
        }
    }
    return canvas;
}


// --- 实体类定义 ---
// 1. 修正 RpgEntity 构造函数
class RpgEntity {
    constructor(name, styleData, type) {
        this.name = name;
        this.type = type;
        this.status = {}; // { poison: 2, stun: 1 } key: turn_count
        this.pendingRecovery = [];
        
        // 【关键】确保 styleData 被保存为实例属性
        this.styleData = (typeof styleData === 'object' && styleData !== null) ? styleData : {};

        this.x = 0; this.y = 0;
        this.lv = 1; this.maxHp = 100; this.hp = 100;
        this.maxMp = 50; this.mp = 50; this.atk = 20;
        this.xp = 0; this.nextXp = 100; this.shake = 0;
        this.direction = 0; this.step = 0;

        // 生成 Sprite
        if (type === 'player' || type === 'partner') {
            this.sprite = generateCharaSprite(this.styleData);
            // 兼容旧逻辑的颜色属性
            this.headColor = this.styleData.hair || '#f1c40f';
            this.bodyColor = this.styleData.top || '#3498db';
        } else if (type === 'enemy' || type === 'boss') {
            const mType = this.styleData.monsterType !== undefined ? this.styleData.monsterType : 0;
            this.sprite = generateMonsterSprite(mType);
            this.bodyColor = '#e74c3c'; 
        }
    }

    levelUp() {
        this.lv++; this.maxHp += 20; this.hp = this.maxHp; 
        this.maxMp += 10; this.mp = this.maxMp; 
        this.atk += 5; this.nextXp = Math.floor(this.nextXp * 1.5);
    }
}

// --- 界面交互函数 ---

async function rpgStartNewGame() {
    // 1. 获取 P1 (主角) 完整数据
    const p1Name = document.getElementById('p1-name-input').value || "勇者";
    const p1Persona = document.getElementById('p1-persona-hidden').value || "勇敢的冒险者";
    
    const p1StyleData = {
        hair: document.getElementById('p1-color-hair').value,
        eye: document.getElementById('p1-color-eye').value,
        skin: document.getElementById('p1-color-skin').value,
        top: document.getElementById('p1-color-top').value,
        bottom: document.getElementById('p1-color-bottom').value,
        shoe: document.getElementById('p1-color-shoe').value,
        bangs: document.getElementById('p1-style-bangs').value,
        back: document.getElementById('p1-style-back').value,
        botStyle: document.getElementById('p1-style-bottom').value
    };

    // 【新增】尝试获取 P1 的源 ID (用于后续同步)
    let p1SourceId = null;
    const userSelect = document.querySelector('input[name="rpg_user_select"]:checked');
    if (userSelect && db.userPersonas) {
        const preset = db.userPersonas[userSelect.value];
        if (preset) p1SourceId = preset.id;
    }

    // 2. 获取 P2 (伙伴) 数据
    const p2CardVisible = document.getElementById('rpg-partner-card').style.display !== 'none';
    let p2Config = null;
    let p2RealName = "";
    let p2Persona = "";
    
    if (p2CardVisible) {
        // 尝试从选中的 ID 获取原始人设
        if (typeof selectedPartnerCharId !== 'undefined' && selectedPartnerCharId) {
            const char = db.characters.find(c => c.id === selectedPartnerCharId);
            if (char) {
                p2RealName = char.realName;
                p2Persona = char.persona;
            }
        }
        
        const uiP2Name = document.getElementById('p2-name-input').value || "伙伴";

        // 如果有 AI 生成的配置，优先使用
        if (typeof tempRpgConfig !== 'undefined' && tempRpgConfig) {
            p2Config = tempRpgConfig;
            p2Config.p2Name = uiP2Name; // ★ 强制覆盖为输入框里的名字
        } else {
            // 没有 AI 配置，使用默认配置
            p2Config = {
                p2Name: uiP2Name,
                intro: "准备好了吗？",
                dialogues: {}
            };
        }
        
        // 强制使用 UI 当前的设置覆盖 (以防用户手动修改了 AI 生成的结果)
        p2Config.styleData = {
            hair: document.getElementById('p2-color-hair').value,
            eye: document.getElementById('p2-color-eye').value,
            skin: document.getElementById('p2-color-skin').value,
            top: document.getElementById('p2-color-top').value,
            bottom: document.getElementById('p2-color-bottom').value,
            shoe: document.getElementById('p2-color-shoe').value,
            bangs: document.getElementById('p2-style-bangs').value,
            back: document.getElementById('p2-style-back').value,
            botStyle: document.getElementById('p2-style-bottom').value
        };
        // 兼容旧逻辑的颜色字段
        p2Config.headColor = p2Config.styleData.hair; 
        p2Config.bodyColor = p2Config.styleData.top;

        // 【新增】保存 P2 的源 ID
        p2Config.sourceId = selectedPartnerCharId || null;

    } else {
        // 路人配置
        p2Config = {
            p2Name: "路人",
            styleData: { hair: '#555', top: '#333' } 
        };
    }

    p2Config.realName = p2RealName || p2Config.p2Name; // 如果没真名就用昵称
    p2Config.persona = p2Persona || "忠诚的伙伴";     // 兜底人设

    const newProfileId = Date.now().toString(); // 生成唯一ID
    const newProfile = {
        id: newProfileId,
        name: `${p1Name} 与 ${p2Config.p2Name} 的冒险`,
        p1Name: p1Name,
        p2Name: p2Config.p2Name,
        timestamp: Date.now(),
        saves: [null, null, null] 
    };
    
    // 存入数据库
    if (!db.rpgProfiles) db.rpgProfiles = [];
    db.rpgProfiles.push(newProfile);
    currentProfileId = newProfileId; // 锁定当前档案
    await saveSingleRPGProfile(newProfileId); // 立即保存

    switchScreen('rpg-game-screen');
    
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (window.rpgGameInstance) {
                // 【修改】将 p1SourceId 作为第5个参数传进去
                window.rpgGameInstance.initNewGame(p1Name, p1StyleData, p2Config, p1Persona, p1SourceId,selectedRpgWorldBookIds);
            }
        });
    });
}



function rpgBackToTitle() {
    window.rpgGameInstance.stop();
    setTimeout(async () => {
        if(await AppUI.confirm("返回标题画面？未保存的进度将丢失。", "返回标题", "确认", "取消")) {
            switchScreen('rpg-title-screen');
        } else {
            window.rpgGameInstance.resume(); // 恢复游戏
        }
    }, 50);
}

 

function rpgShowSaveScreen() {    
    window.rpgGameInstance.stop();
    switchScreen('rpg-load-screen');
    const titleEl = document.querySelector('#rpg-load-screen .title');
    if(titleEl) titleEl.innerText = "保存进度";
    setTimeout(renderSaveSlots, 50);
}

function rpgShowLoadScreen() {
    switchScreen('rpg-load-screen');
    const titleEl = document.querySelector('#rpg-load-screen .title');
    if(titleEl) titleEl.innerText = "读取进度";
    setTimeout(renderSaveSlots, 50);
}

// 【修改】统一返回逻辑
function rpgHandleSaveBack() {
    if (rpgSaveContext === 'title') {
        // 从标题/档案页进入 -> 返回档案列表
        switchScreen('rpg-profile-screen');
        renderProfileList();
    } 
    else if (rpgSaveContext === 'pause_save' || rpgSaveContext === 'pause_load') {
        // 从暂停菜单进入 -> 返回新的暂停页面
        switchScreen('rpg-pause-screen'); 
        // 不需要手动 flex 显示了，因为 switchScreen 会处理 .active 类
    } 
    else {
        // 游戏内直接调用等 -> 返回游戏并继续
        switchScreen('rpg-game-screen');
        if (window.rpgGameInstance) window.rpgGameInstance.resume();
    }
}

// 【新增】渲染档案列表
function renderProfileList() {
    const container = document.getElementById('rpg-profile-list-container');
    if (!container) return;
    container.innerHTML = '';

    if (!db.rpgProfiles || db.rpgProfiles.length === 0) {
        container.innerHTML = '<div class="text-center" style="color:#999; margin-top:50px;">暂无冒险档案</div>';
        return;
    }

    db.rpgProfiles.forEach((profile, index) => {
        const div = document.createElement('div');
        div.className = 'rpg-profile-card';
        
        // 计算游玩时间或最后存档时间（这里简单用创建时间展示）
        const dateStr = new Date(profile.timestamp).toLocaleString();

        div.innerHTML = `
            <div onclick="selectProfile('${profile.id}')" style="cursor:pointer; padding-right:50px;">
                <div class="profile-title">${profile.name}</div>
                <div class="profile-info">
                    <div>主角: ${profile.p1Name} & ${profile.p2Name}</div>
                    <div>创建于: ${dateStr}</div>
                </div>
            </div>
            <button class="profile-delete-btn" onclick="deleteProfile('${profile.id}', event)">删除</button>
        `;
        container.appendChild(div);
    });
}

// 【新增】选择档案
window.selectProfile = function(id) {
    currentProfileId = id; // 锁定当前档案ID
    rpgSaveContext = 'title';
    rpgShowLoadScreen();   // 进入原来的3个槽位界面
};

// 【新增】删除档案（双重确认）
window.deleteProfile = async function(id, e) {
    if (e) e.stopPropagation(); // 防止触发进入
    
    // 第一次确认
    if (!await AppUI.confirm(
        "确定要删除这个冒险档案吗？\n该档案下的所有存档都将丢失！", 
        "删除警告",  // 标题
        "确认删除",  // 确定按钮 (红色/主色)
        "取消"      // 取消按钮 (灰色)
    )) {
        return; // 如果用户点了取消，await 返回 false，这里就会 return
    }
    
    // 第二次确认
    const profile = db.rpgProfiles.find(p => p.id === id);
    const input = await AppUI.prompt(
        `【高危操作】\n请输入 "${profile.p1Name}" 以确认删除：`,
        "在这里输入主角名字",
        "最终确认"
    );
    
    if (input === profile.p1Name) {
        db.rpgProfiles = db.rpgProfiles.filter(p => p.id !== id);
        await dexieDB.rpgProfiles.delete(id);  // 保存更改
        renderProfileList(); // 刷新列表
        showToast("档案已彻底删除");
    } else {
        showToast("输入错误，删除取消");
    }
};



function renderSaveSlots() {
    const container = document.getElementById('rpg-save-list-container');
    if (!container) return;
    container.innerHTML = '';
    
    // 1. 找到当前档案
    const profile = db.rpgProfiles.find(p => p.id === currentProfileId);
    if (!profile) {
        showToast("档案读取错误");
        switchScreen('rpg-profile-screen');
        return;
    }
    
    // 2. 获取该档案下的 saves
    const saves = profile.saves || [null, null, null];
    
    saves.forEach((save, index) => {
        const div = document.createElement('div');
        div.className = 'rpg-save-slot ' + (save ? '' : 'empty');
        
        if (save) {
            div.innerHTML = `
    <div class="save-index">${index + 1}</div>
    <div class="save-info-col">
        <div class="save-name-row">
            <span>${save.p1.name}</span>
            <span style="color:#aaa; font-weight:normal;">&</span>
            <span>${save.p2.name}</span>
        </div>
        <div class="save-stats-text">
            LV.${save.p1.lv} / LV.${save.p2.lv}
        </div>
        <div class="save-meta-row">
            <span>${save.mapName}</span>
            <span>${new Date(save.timestamp).toLocaleDateString()}</span>
        </div>
    </div>
    <div class="save-avatars-row">
        <canvas id="save-cvs-${index}-p1" class="save-avatar-canvas avatar-p1" width="40" height="40"></canvas>
        <canvas id="save-cvs-${index}-p2" class="save-avatar-canvas avatar-p2" width="40" height="40"></canvas>
    </div>
            `;
            
            div.onclick = () => handleSlotClick(index);
            container.appendChild(div);

           setTimeout(() => {
    const drawHead = (char, cvsId) => {
        const cvs = document.getElementById(cvsId);
        if (!cvs) return;
        const ctx = cvs.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        
        const styleData = char.styleData || {
            hair: char.headColor || '#f1c40f',
            eye: '#2c3e50',
            skin: '#FFE4CF',
            top: char.bodyColor || '#3498db',
            bottom: '#2c3e50',
            shoe: '#101018',
            bangs: 0,
            back: 0,
            botStyle: 0
        };
        
        const sheet = generateCharaSprite(styleData);
        
        ctx.clearRect(0, 0, 40, 40);
        // 1:1绘制，像素完美
        ctx.drawImage(sheet, 12, 0, 40, 40, 0, 0, 40, 40);
    };
    
    drawHead(save.p1, `save-cvs-${index}-p1`);
    drawHead(save.p2, `save-cvs-${index}-p2`);
}, 0);

        } else {
            div.innerHTML = `
                <div class="save-index">${index + 1}</div>
                <div class="empty-slot-text">-- 空存档 --</div>
            `;
            div.onclick = () => handleSlotClick(index);
            container.appendChild(div);
        }
    });
}





// 存档处理：保存后立即刷新
// 【修改】handleSlotClick
async function handleSlotClick(index) {
    // 1. 找到当前档案
    const profile = db.rpgProfiles.find(p => p.id === currentProfileId);
    if (!profile) return;

    if (rpgSaveContext === 'game' || rpgSaveContext === 'pause_save') {
        // === 存档 ===
        if (await AppUI.confirm(`确定要覆盖存档 ${index + 1} 吗?`, "保存进度", "确定", "取消")) {
            const data = window.rpgGameInstance.exportSaveData();
            
            // 【关键】写入到当前档案的 saves 数组里
            profile.saves[index] = JSON.parse(JSON.stringify(data)); 
            
            // 更新档案的最后游玩时间
            profile.timestamp = Date.now();
            
            saveSingleRPGProfile(currentProfileId); // 全局保存
            showToast("游戏已保存");
            requestAnimationFrame(() => renderSaveSlots());
        }
    } else {
        // === 读档 ===
        // 【关键】从当前档案的 saves 里读
        const save = profile.saves[index]; 
        
        if (!save) return;
        if (await AppUI.confirm(`确定要读取存档 ${index + 1} 吗?`, "读取进度", "确定", "取消")) {
            switchScreen('rpg-game-screen');
           
            if (window.rpgGameInstance) {
                window.rpgGameInstance.isPaused = false;
            }
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (window.rpgGameInstance) window.rpgGameInstance.importSaveData(save);
                });
            });
        }
    }
}

// --- 游戏核心类 ---

class RpgGame {

// 【修改版】getStaticLevels：包含完整的新手关+修改后的家园+新增室内
getStaticLevels() {
    return [
        // 0. 序章 (保留)
        {
            id: 'prologue', name: "序章", type: 'prologue',
            story: [
                "很久很久以前，这片大陆被黑暗笼罩...",
                "传说中的勇者终于觉醒了。",
                "但是，一个人的力量太过渺小。",
                "于是，命运让两个人相遇了。"
            ]
        },
        // 1. 迷雾森林 (保留)
        {
            id: 'lv1', name: "迷雾森林", type: 'tutorial',
            intro: "冒险的起点。", partnerText: "准备好了吗？", returnText: "我们好像来过这里。",
            colors: { floor: "#27ae60", wall: "#1e824c" },
            enemyPool: { name: "史莱姆", hp: 40, atk: 8, color: "#e74c3c", mp: 0, lv: 1 }, 
            map: ["#######################","#S....................#","#.....................#","#.#######.......#####.#","#.#..M..#.......#...#.#","#.#.....#...M...#...#.#","#...................#.#","#.......#.......#.....#","#.#######.......#####.#","#...M..............M..#","#.....................E","#######################"]
        },
        // 2. 遗忘废墟 (保留)
        {
            id: 'lv2', name: "遗忘废墟", type: 'tutorial',
            intro: "古老的遗迹。", partnerText: "这里阴森森的。", returnText: "这堆石头我看腻了。",
            colors: { floor: "#95a5a6", wall: "#7f8c8d" },
            enemyPool: { name: "石像鬼", hp: 60, atk: 12, color: "#8e44ad", mp: 0, lv: 3 },
            map: ["#######################","#P........#...........#","#.........#...........#","#...M.....#.....M.....#","#####.#########.#######","#.........#...........#","#....M....#.....M.....#","#.........#...........#","#.###################.#","#.....................E","#######################"]
        },
        // 3. 魔王城 (保留)
        {
            id: 'lv3', name: "魔王城", type: 'tutorial',
            intro: "最终决战之地。", partnerText: "就是现在！", returnText: "还没打败魔王，不能走。",
            colors: { floor: "#34495e", wall: "#2c3e50" },
            enemyPool: { name: "黑骑士", hp: 100, atk: 20, color: "#555", mp: 0, lv: 5 },
            boss: { name: "魔王", hp: 800, atk: 50, color: "#c0392b", lv: 10 },
            map: ["###################",
            "#.................#",
            "#P................#",
            "#.M.............M.#",
            "#.................#",
            "#.......B.........#",
            "#.................#",
            "#.M.............M.#",
            "#.................#","###################"]
        },
        
// 在 getStaticLevels() 方法中修改

// 1. 室内地图 (直接用字母摆放家具)
{
    id: 'indoor', name: "我的小屋", type: 'indoor',
    intro: "温暖的小屋。", partnerText: "还是家里舒服。",
    colors: { floor: "#E7B56E", wall: "#EDDFC1" },
    map: [
        "#######",
        "#w.b.p#", // w=衣柜, l=日志
        "#.....#", // b=床
        "#....l#",        
        "#..S..#", // p=盆栽
        "#p.E.p#", 
        "#######"
    ]
},
       
        // 4. 温馨家园 (★修改了这里)
        {
            id: 'home', name: "温馨家园", type: 'home',
            intro: "这里是你们的家。", partnerText: "终于可以休息了。", returnText: "回家的感觉真好。",
            colors: { floor: "#B7D032", wall: "#7f8c8d" },
            // ★ 新增属性：用于分层渲染和进门判断
            hasHouse: true,
            // 根据你的地图 'H' 所在的位置 (x:10-12, y:3-5)，门应该在中间底部
            houseImgPos: { x: 5, y: 1 }, 
            
            doorPos: { x: 7, y: 4 }, 
            houseRect: { x: 7, y: 3, w: 3, h: 3 },
            map: [                
                "...............",
                "...............",
                "...t.......t...",
                ".t...........t.",
                "FFFFF..H..fffff",
                "..t.sHHSHHt....",
                "...............",
                "...............",
                ".......G.......",
                "###############"
            ]
        }
        
    ];
}
    
    
    constructor() {
        this.canvas = document.getElementById('rpgGameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.bufferCanvas = document.createElement('canvas');
        this.bufferCanvas.width = 64;
        this.bufferCanvas.height = 64;
        this.bufferCtx = this.bufferCanvas.getContext('2d');
        this.bufferCtx.imageSmoothingEnabled = false;
        this.container = document.querySelector('.rpg-canvas-container'); 
        if (window.ResizeObserver && this.container) {
        this.resizeObserver = new ResizeObserver(() => {
            this.resize();
            this.draw(); // 强制重绘一帧
        });
        this.resizeObserver.observe(this.container);
    }
        if (!this.container) this.container = document.querySelector('.rpg-canvas-container');
        this.isAutoBattle = false;
        this.STATE = { LOADING: 0, STORY: 1, MAP: 2, BATTLE_CMD: 3, BATTLE_TARGET: 4, BATTLE_ANIM: 5, GAME_OVER: 6 };
        
        this.LEVELS = this.getStaticLevels();

        this.p1 = new RpgEntity("勇者", "#f1c40f", "#3498db", "player");
        this.p2 = new RpgEntity("伙伴", "#e67e22", "#2ecc71", "partner");
        
        this.visitedLevels = new Set();
        this.mapEnemies = []; 
        this.cam = { x: 0, y: 0 };
        this.state = this.STATE.LOADING;
        this.battleTeam = [this.p1, this.p2]; 
        this.battleEnemies = [];            
        this.isRunning = false;
        this.animationFrameId = null;
        this.bindEvents();
        this.isGameClear = false;
    this.isGoingHome = false; // 【新增】标记是否正在回家园
    this.isPaused = false;
        
        // 初始背包 (送一点新手装备)
        this.inventory = {
            'potion_red': 3,
            'potion_blue': 1,
            'potion_purify': 1
        };
        this.currency = 0; // 兑换点数
        
        // 家园状态
        this.homeState = {
            furniture: [] // 存放已购买的家具ID ['bed', 'table']
        };

       
    }

resetUI() {
    // 1. 隐藏战斗相关 UI
    const battleMenu = document.getElementById('rpg-battle-menu');
    if (battleMenu) battleMenu.style.display = 'none';
    
    const targetPanel = document.getElementById('rpg-battle-target-panel');
    if (targetPanel) targetPanel.style.display = 'none';

    // 2. 隐藏对话框
    document.getElementById('rpg-bottom-dialog').style.display = 'none';
    document.getElementById('rpg-top-dialog').style.display = 'none';
    document.getElementById('rpg-game-over-screen').style.display = 'none';
    


    // 3. 隐藏其他覆盖层
    document.getElementById('rpg-controls').style.display = 'none'; 
    
    const autoBtn = document.getElementById('rpg-auto-battle-btn');
    if (autoBtn) autoBtn.style.display = 'none';
    
    // 4. 重置暂停状态
    // (注意：之前的修改中要求删除对 rpg-pause-menu 的引用)
    document.getElementById('rpg-common-modal').classList.remove('visible');
    this.isPaused = false; 

    // 5. 恢复交互按钮为隐藏
    const interactBtn = document.getElementById('rpg-interact-btn');
    if(interactBtn) interactBtn.style.display = 'none';
    this.pendingInteraction = null;

    // 6. 恢复顶部按钮
    const menuBtn = document.getElementById('rpg-menu-toggle-btn');
    if(menuBtn) menuBtn.style.display = 'flex'; 


    // 7. 【新增】重置标题为当前地图名
    const titleEl = document.getElementById('rpg-header-title');
    if (titleEl) {
        titleEl.innerText = this.curLv ? this.curLv.name : "加载中...";
        titleEl.style.color = 'var(--text-color)';
    }
}

// 【修复版】initNewGame
initNewGame(p1Name, p1StyleData, p2Config, p1Persona, p1SourceId, worldBookIds = []) {
    this.stop();
    this.resetUI();
    this.inventory = { 'potion_red': 3, 'potion_blue': 1, 'return_scroll': 1 };
        this.currency = 0;
        this.homeState = { furniture: [] };
        this.worldBookIds = worldBookIds || [];
    // 1. 重置为纯净的基础地图列表
    // 这确保了新游戏不会带有上一局的随机地图
    this.LEVELS = this.getStaticLevels();
    
    // 2. 重置角色数据
    this.p1 = new RpgEntity(p1Name, p1StyleData, "player");
    this.p1.persona = p1Persona || "勇敢的冒险者";
    this.p1.sourceId = p1SourceId;
    this.p2 = new RpgEntity(p2Config.p2Name, p2Config.styleData, "partner");
    this.p2.sourceId = p2Config.sourceId; 
    
    this.p2.customData = {
        intro: p2Config.intro,
        dialogues: p2Config.dialogues || {},
        realName: p2Config.realName || p2Config.p2Name, // 存入真名
        persona: p2Config.persona || "忠诚的伙伴"       // 存入人设
    };

    this.battleTeam = [this.p1, this.p2];
    this.visitedLevels.clear();
    
    // 3. 初始化随机地图系统
    this.randomMapData = {
        worldTheme: null,
        currentMapIndex: 0,
        mapStories: [],
        storyPoints: [],
         triggeredPoints: new Set(),
    // 【新增】每个地图的剧情点状态管理
    mapStates: {} // 格式: { 'random0': { points: [{x,y}], triggered: Set(['0,1', '2,3']) } }
    };
    
    // 4. 从序章开始
    this.loadLevel(0, 'start');
    this.start();
}

// 【修复版】exportSaveData - 显式保存所有关键字段
exportSaveData() {
    // 1. 提取所有类型为 'random' 的地图
    const randomLevels = this.LEVELS.filter(lv => lv.type === 'random');

    // 2. 构建 randomMapData 的完整副本
    // 【关键】必须显式解构保存 grandPlot, mapStories, worldTheme
    let savedRandomMapData = null;
    if (this.randomMapData) {
        savedRandomMapData = {
            worldTheme: this.randomMapData.worldTheme, // 必须保存主题！
            currentMapIndex: this.randomMapData.currentMapIndex,
            grandPlot: this.randomMapData.grandPlot || [], // 保存大纲
            mapStories: this.randomMapData.mapStories || [], // 保存剧情
            storyPoints: this.randomMapData.storyPoints || [],
            triggeredPoints: Array.from(this.randomMapData.triggeredPoints || []), // Set 转 Array
            // 保存每个地图的状态
            mapStates: Object.fromEntries(
                Object.entries(this.randomMapData.mapStates || {}).map(([id, state]) => [
                    id, 
                    { 
                        points: state.points, 
                        triggered: Array.from(state.triggered) // Set 转 Array
                    }
                ])
            )
        };
    }

    return {
        timestamp: Date.now(),
        mapName: this.curLv ? this.curLv.name : "未知",
        lvIdx: this.lvIdx,
        
        inventory: { ...this.inventory }, 
        
        // homeState 深拷贝
        homeState: JSON.parse(JSON.stringify(this.homeState)),
        
        currency: this.currency,
        
        // Set 转 Array
        visited: Array.from(this.visitedLevels),
        
        // 【关键】保存修复后的 randomMapData
        randomMapData: savedRandomMapData,
        
        // 保存生成的“所有”随机地图列表
        allRandomLevels: randomLevels,

        // 兼容旧存档
        customLevelData: (this.curLv.type === 'random') ? this.curLv : null,
        worldBookIds: this.worldBookIds || [],
        p1: { 
            name: this.p1.name,
            persona: this.p1.persona,
            lv: this.p1.lv,
            hp: this.p1.hp,
            maxHp: this.p1.maxHp,
            mp: this.p1.mp,
            maxMp: this.p1.maxMp,
            atk: this.p1.atk,
            xp: this.p1.xp,
            nextXp: this.p1.nextXp,
            x: this.p1.x,
            y: this.p1.y,
            direction: this.p1.direction,
            step: this.p1.step,
            type: this.p1.type,
            styleData: this.p1.styleData,
            headColor: this.p1.headColor,
            bodyColor: this.p1.bodyColor
        },
        p2: { 
            name: this.p2.name,
            lv: this.p2.lv,
            hp: this.p2.hp,
            maxHp: this.p2.maxHp,
            mp: this.p2.mp,
            maxMp: this.p2.maxMp,
            atk: this.p2.atk,
            xp: this.p2.xp,
            nextXp: this.p2.nextXp,
            x: this.p2.x,
            y: this.p2.y,
            direction: this.p2.direction,
            step: this.p2.step,
            type: this.p2.type,
            styleData: this.p2.styleData,
            headColor: this.p2.headColor,
            bodyColor: this.p2.bodyColor,
            customData: this.p2.customData
        }
    };
}

// 【修复版】importSaveData - 完整恢复数据结构
importSaveData(data) {
    this.stop();
    this.resetUI();

    // 1. 重置为纯净的基础地图列表
    this.LEVELS = this.getStaticLevels();

    // 2. 恢复随机世界状态
    if (data.randomMapData) {
        // 【关键】手动重建对象，防止丢失字段
        this.randomMapData = {
            worldTheme: data.randomMapData.worldTheme || "未知世界", // 兜底
            currentMapIndex: data.randomMapData.currentMapIndex || 0,
            grandPlot: data.randomMapData.grandPlot || [], // 恢复大纲
            mapStories: data.randomMapData.mapStories || [], // 恢复剧情
            storyPoints: data.randomMapData.storyPoints || [],
            triggeredPoints: new Set(data.randomMapData.triggeredPoints || []), // 恢复 Set
            mapStates: {}
        };
        
        // 恢复 mapStates
        if (data.randomMapData.mapStates) {
            Object.keys(data.randomMapData.mapStates).forEach(mapId => {
                const state = data.randomMapData.mapStates[mapId];
                this.randomMapData.mapStates[mapId] = {
                    points: state.points || [],
                    triggered: new Set(state.triggered || []) // Array 转回 Set
                };
            });
        }
    } else {
        // 如果存档里完全没有 randomMapData（极旧存档），初始化为空
        this.randomMapData = {
            worldTheme: null,
            currentMapIndex: 0,
            grandPlot: [],
            mapStories: [],
            storyPoints: [],
            triggeredPoints: new Set(),
            mapStates: {}
        };
    }

    // 3. 将存档里的随机地图插回去
    const homeIdx = this.LEVELS.findIndex(lv => lv.type === 'home');
    const insertBaseIndex = (homeIdx !== -1) ? (homeIdx + 1) : this.LEVELS.length;

    if (data.allRandomLevels && data.allRandomLevels.length > 0) {
        data.allRandomLevels.forEach((lv, i) => {
            // 确保插入的地图也是 random 类型
            if(lv.type === 'random') {
                this.LEVELS.splice(insertBaseIndex + i, 0, lv);
            }
        });
    } else if (data.customLevelData) {
        // 兼容旧存档
        const existing = this.LEVELS.find(l => l.id === data.customLevelData.id);
        if (!existing) {
            this.LEVELS.splice(insertBaseIndex, 0, data.customLevelData);
        }
    }

    this.worldBookIds = data.worldBookIds || [];
    
    // 4. 恢复角色数据
    const createFallbackStyle = (legacyHead, legacyBody) => ({
        hair: legacyHead || '#f1c40f', eye: '#2c3e50', skin: '#FFE4CF',
        top: legacyBody || '#3498db', bottom: '#2c3e50', shoe: '#101018',
        bangs: 0, back: 0, botStyle: 0
    });

    if (!data.p1.styleData) data.p1.styleData = createFallbackStyle(data.p1.headColor, data.p1.bodyColor);
    if (!data.p2.styleData) data.p2.styleData = createFallbackStyle(data.p2.headColor, data.p2.bodyColor);

// ... 在 importSaveData 函数内部 ...

    // 4. 恢复角色数据
    // ... (p1, p2 初始化代码保持不变) ...
    this.p1 = new RpgEntity(data.p1.name, data.p1.styleData, "player");
    Object.assign(this.p1, data.p1);
    
    this.p2 = new RpgEntity(data.p2.name, data.p2.styleData, "partner");
    Object.assign(this.p2, data.p2);

    // ============================================================
    // ★★★ 新增：同步最新人设逻辑 ★★★
    // ============================================================
    
    // 1. 同步 P1 (用户)
    if (this.p1.sourceId) { // 如果存档里记住了 ID
        const latestUser = db.userPersonas.find(u => u.id === this.p1.sourceId);
        if (latestUser) {
            console.log("检测到用户档案更新，正在同步...");
            this.p1.name = latestUser.nickname; // 同步昵称
            this.p1.persona = latestUser.persona; // 同步人设
            // 如果你想连外观颜色也同步，可以在这里更新 styleData，但可能会覆盖玩家在游戏里获得的装备外观，慎重
        }
    }

    // 2. 同步 P2 (AI伙伴)
    if (this.p2.sourceId) {
        const latestChar = db.characters.find(c => c.id === this.p2.sourceId);
        if (latestChar) {
            console.log("检测到角色档案更新，正在同步...");
            // 同步显示名 (优先用备注)
            this.p2.name = latestChar.remarkName || latestChar.realName;
            
            // 同步 AI 生成需要的真名和人设
            if (!this.p2.customData) this.p2.customData = {};
            this.p2.customData.realName = latestChar.realName;
            this.p2.customData.persona = latestChar.persona;
        }
    }
    // ============================================================
    // 确保 customData 存在
    if (!this.p2.customData) this.p2.customData = { dialogues: {} };

    this.battleTeam = [this.p1, this.p2];
    this.visitedLevels = new Set(data.visited || []);
    
    // 5. 加载地图
    // 增加边界检查，防止索引越界
    let safeLvIdx = data.lvIdx;
    if (safeLvIdx >= this.LEVELS.length) safeLvIdx = this.LEVELS.length - 1;
    this.loadLevel(safeLvIdx, 'load');
    
    this.p1.x = data.p1.x; this.p1.y = data.p1.y;
    this.p2.x = data.p1.x; this.p2.y = data.p1.y;

    this.inventory = data.inventory ? { ...data.inventory } : {};
    this.currency = data.currency || 0;
    this.homeState = data.homeState ? JSON.parse(JSON.stringify(data.homeState)) : { furniture: [] };
    
    this.state = this.STATE.MAP; 
    
    document.getElementById('rpg-controls').style.display = 'block';
    const menuBtn = document.getElementById('rpg-menu-toggle-btn');
    if(menuBtn) menuBtn.style.display = 'flex';

    this.start();
}


// 打开状态页
// 在 class RpgGame 内部

    openStatus() {

        
        // 2. 暂停游戏
        this.isPaused = true;
        this.stop();
        
        // 3. 跳转到状态屏幕
        switchScreen('rpg-status-screen');
        
        // 4. 渲染数据
        this.renderStatusScreen();
        
        // --- 绑定状态页内部按钮事件 ---
        
        // 返回按钮
        const backBtn = document.getElementById('rpg-status-back-btn');
        if (backBtn) {
            // 使用 cloneNode 防止重复绑定
            const newBackBtn = backBtn.cloneNode(true);
            backBtn.parentNode.replaceChild(newBackBtn, backBtn);
            newBackBtn.onclick = () => {
                // 返回时重新打开暂停菜单
                this.toggleMenu(true);
            };
        }

        // 修改世界书按钮 (复用通用的世界书选择逻辑)
        const wbBtn = document.getElementById('rpg-status-wb-btn');       
       if (wbBtn) {
            const newWbBtn = wbBtn.cloneNode(true);
            wbBtn.parentNode.replaceChild(newWbBtn, wbBtn);
            
            newWbBtn.onclick = () => {
                const modal = document.getElementById('rpg-wb-select-modal');
                const list = document.getElementById('rpg-wb-list');
                const currentIds = this.worldBookIds || [];
                
                // 复用全局的渲染函数 (假设 world_book.js 已加载)
                //如果不确定 renderCategorizedWorldBookList 是否全局可用，需确保 world_book.js 在 rpg_game.js 之前加载
                if (typeof renderCategorizedWorldBookList === 'function') {
                    renderCategorizedWorldBookList(list, db.worldBooks, currentIds, 'rpg-status-wb');
                }
                
                modal.dataset.context = 'status_screen'; // 标记上下文
                modal.classList.add('visible');
            };
        }

// ============================================================
        // 【新增】重生成战斗台词按钮逻辑
        // ============================================================
        const reinitBtn = document.getElementById('rpg-char-reinit-btn');
        if (reinitBtn) {
            const newReinitBtn = reinitBtn.cloneNode(true);
            reinitBtn.parentNode.replaceChild(newReinitBtn, reinitBtn);

            newReinitBtn.onclick = async () => {
                // 1. 确认弹窗
                if (!await AppUI.confirm(`确定要根据最新的【${this.p2.name}】人设和当前绑定的世界书，重新生成战斗、升级和死亡台词吗？\n\n(这将消耗API额度，且覆盖原有的战斗类台词)`, "台词更新", "确认", "取消")) {
                    return;
                }

                // 2. 检查API配置
                const { url, key, model } = db.apiSettings;
                if (!url || !key || !model) return showToast('请先配置API');

                // 3. 准备数据
                // P1 info
                const p1Name = this.p1.name;
                const p1RealName = this.p1.sourceId 
                    ? (db.userPersonas.find(u => u.id === this.p1.sourceId)?.realName || p1Name) 
                    : p1Name;
                const p1Persona = this.p1.persona || "普通的冒险者";

                // P2 info (优先取 customData 中的真名和人设，因为这是源头)
                const p2Name = this.p2.name; 
                const p2RealName = this.p2.customData?.realName || p2Name;
                const p2Persona = this.p2.customData?.persona || "忠诚的伙伴";

                // WorldBook info
                const currentWbIds = this.worldBookIds || [];
                const getWbContent = (pos) => currentWbIds
                    .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === pos))
                    .filter(Boolean)
                    .map(wb => wb.content)
                    .join('\n');

                const wbBefore = getWbContent('before');
                const wbAfter = getWbContent('after');
                const wbWriting = getWbContent('writing');

                // 4. 构建 Prompt
                newReinitBtn.disabled = true;
                newReinitBtn.innerText = "台词更新中...";

                let prompt = `你是一个RPG游戏文案策划。请根据以下设定，为角色【${p2RealName}】(游戏名:${p2Name}) 撰写台词。\n`;

                if (wbBefore) prompt += `【世界观】\n${wbBefore}\n\n`;

                prompt += `【角色资料】
勇者: ${p1Name} (真名: ${p1RealName})
勇者设定: ${p1Persona}

伙伴(当前角色): ${p2Name} (真名: ${p2RealName})
伙伴设定: ${p2Persona}\n\n`;

                if (wbAfter) prompt += `\n【重要设定补充】\n${wbAfter}`;
                if (wbWriting) prompt += `\n【写作风格要求】\n${wbWriting}`;

prompt += `\n关系：两人是共同冒险的搭档。请确保台词符合伙伴的人设性格。

【任务要求】
仅生成以下特定场景的台词，**严禁**修改其他未列出的内容。
严禁返回JSON，请严格使用下方格式模板，不同变体用竖线 "|" 分隔。

【输出格式模板】：
#MAP_RETURN# 回到已探索地图时的吐槽 (3句，用|分隔)
#ATK# 发起攻击时的喊话 (3句，用|分隔，例如：看招！|接好了！|哈！)
#HURT# 被攻击受伤时的反应 (3句，用|分隔，例如：好痛！|大意了...|你等着！)
#HEAL# 治疗队友时的台词 (3句，用|分隔，例如：别乱动。|治疗术！|感觉好点没？)
#HEALED# 被队友治疗时的感谢 (3句，用|分隔，例如：谢了。|复活了！|你还挺在行的。)
#LVUP# 升级时的喜悦 (3句，用|分隔)
#DEAD# 战斗失败/死亡时的遗言 (3句，用|分隔)
`;


                try {
                    const response = await fetch(`${url}/v1/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                        body: JSON.stringify({
                            model: model,
                            messages: [{ role: "user", content: prompt }],
                            temperature: 0.8
                        })
                    });

                    const data = await response.json();
                    const content = data.choices[0].message.content;

                    // 5. 解析结果
                    const parseTag = (tag) => {
                        const regex = new RegExp(`${tag}\\s*(.*)`);
                        const match = content.match(regex);
                        if (match && match[1]) {
                            return match[1].split('|').map(t => t.trim()).filter(t => t);
                        }
                        return null;
                    };

                    // 确保数据结构存在
                    if (!this.p2.customData) this.p2.customData = {};
                    if (!this.p2.customData.dialogues) this.p2.customData.dialogues = {};

                    const d = this.p2.customData.dialogues;

                    // 仅更新请求的字段，保留原有的 map1/map2/intro/ending 等
                    const newReturn = parseTag('#MAP_RETURN#');
                    const newAtk = parseTag('#ATK#');
                    const newHurt = parseTag('#HURT#');
                    const newHeal = parseTag('#HEAL#');
                    const newHealed = parseTag('#HEALED#');
                    const newLvup = parseTag('#LVUP#');
                    const newDead = parseTag('#DEAD#');

                    if (newReturn) d.return = newReturn;
                    if (newAtk) d.atk = newAtk;
                    if (newHurt) d.hurt = newHurt;
                    if (newHeal) d.heal = newHeal;
                    if (newHealed) d.healed = newHealed;
                    if (newLvup) d.lvup = newLvup;
                    if (newDead) d.dead = newDead;

                    showToast("战斗台词更新完毕！请记得点击保存。");

                } catch (e) {
                    console.error(e);
                    showToast("生成失败，请检查网络或API额度");
                } finally {
                    newReinitBtn.disabled = false;
                    newReinitBtn.innerText = "更新战斗台词";
                }
            };
        }

        
        // 保存按钮
        const saveBtn = document.getElementById('rpg-status-save-btn');
        if (saveBtn) {
            // 使用 cloneNode 防止重复绑定 (保持原逻辑不变)
            const newSaveBtn = saveBtn.cloneNode(true);
            saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
            
            newSaveBtn.onclick = () => {
                const newP1Name = document.getElementById('status-p1-name').value;
                const newP2Name = document.getElementById('status-p2-name').value;
                
                // 更新数据
                if(newP1Name) this.p1.name = newP1Name;
                if(newP2Name) this.p2.name = newP2Name;
                
                showToast("状态已更新");

                // 【新增】保存后返回暂停菜单
                // toggleMenu(true) 会自动调用 switchScreen('rpg-pause-screen')
                this.toggleMenu(true); 
            };
        }
    }

    // 渲染状态页数据
    renderStatusScreen() {
        // P1 数据
        document.getElementById('status-p1-name').value = this.p1.name;
        document.getElementById('status-p1-lv').innerText = this.p1.lv;
        document.getElementById('status-p1-xp').innerText = `${this.p1.xp}/${this.p1.nextXp}`;
        document.getElementById('status-p1-hp').innerText = `${this.p1.hp}/${this.p1.maxHp}`;
        document.getElementById('status-p1-mp').innerText = `${this.p1.mp}/${this.p1.maxMp}`;
        document.getElementById('status-p1-atk').innerText = this.p1.atk;
        
        const cvs1 = document.getElementById('status-p1-canvas');
        drawCroppedPreview(cvs1, this.p1.styleData);

        // P2 数据
        document.getElementById('status-p2-name').value = this.p2.name;
        document.getElementById('status-p2-lv').innerText = this.p2.lv;
        document.getElementById('status-p2-xp').innerText = `${this.p2.xp}/${this.p2.nextXp}`;
        document.getElementById('status-p2-hp').innerText = `${this.p2.hp}/${this.p2.maxHp}`;
        document.getElementById('status-p2-mp').innerText = `${this.p2.mp}/${this.p2.maxMp}`;
        document.getElementById('status-p2-atk').innerText = this.p2.atk;
        
        const cvs2 = document.getElementById('status-p2-canvas');
        drawCroppedPreview(cvs2, this.p2.styleData);
        
        // 世界书显示
        const wbBtn = document.getElementById('rpg-status-wb-btn');
        const ids = this.worldBookIds || [];
        
        if (wbBtn) {
            if (ids.length > 0) {
                wbBtn.innerText = `修改世界书绑定 (已选 ${ids.length} 本)`;
                wbBtn.classList.remove('btn-neutral');
                wbBtn.classList.add('btn-primary');
            } else {
                wbBtn.innerText = "绑定世界书 (可选)";
                wbBtn.classList.remove('btn-primary');
                wbBtn.classList.add('btn-neutral');
            }
        }
    }



resize() {
    if (this.canvas && this.container) {
        // 强制获取实际显示尺寸
        const rect = this.container.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const h = Math.floor(rect.height);
        
        // 只有当尺寸有效且发生变化时才调整
        if (w > 0 && h > 0 && (this.canvas.width !== w || this.canvas.height !== h)) {
            this.canvas.width = w;
            this.canvas.height = h;
            this.ctx = this.canvas.getContext('2d');
            this.ctx.imageSmoothingEnabled = false;
            
            this.updateCamera(true);
            this.draw();
        }
    }
}

    // 恢复游戏（用于从菜单返回）
    resume() {
        // 先计算尺寸
        this.resize(); 
        
        // 无论是否已经在运行，都强制重绘一帧静态画面
        // 这样即使 loop 有延迟，玩家也能立即看到当前状态
        this.draw(); 

        if (!this.isRunning) {
            this.isRunning = true;
            this.lastTime = Date.now();
            this.loop();
        }
    }

    start() {
        this.isRunning = true;
        this.resize();
        this.lastTime = Date.now();
        this.loop();
        
    }

    stop() {
        this.isRunning = false;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }
    


    bindEvents() {
        const setInput = (axis, val) => { rpgInput[axis] = val; };
        const bindKey = (cls, axis, val) => {
            const el = document.querySelector(cls);
            if(el) {
                el.addEventListener('touchstart', (e) => { e.preventDefault(); setInput(axis, val); }, {passive: false});
                el.addEventListener('touchend', (e) => { e.preventDefault(); setInput(axis, 0); });
                el.addEventListener('mousedown', (e) => { e.preventDefault(); setInput(axis, val); });
                el.addEventListener('mouseup', (e) => { e.preventDefault(); setInput(axis, 0); });
                el.addEventListener('mouseleave', (e) => { e.preventDefault(); setInput(axis, 0); });
            }
        };
        bindKey('.rpg-up', 'y', -1);
        bindKey('.rpg-down', 'y', 1);
        bindKey('.rpg-left', 'x', -1);
        bindKey('.rpg-right', 'x', 1);
        
        const goScreen = document.getElementById('rpg-game-over-screen');
        if(goScreen) {
            goScreen.addEventListener('pointerup', () => {
                if (this.state === this.STATE.GAME_OVER) {
                    switchScreen('rpg-title-screen');
                }
            });
        }
        
       
        
     // ============================================
        // 【新增/修改】右上角菜单按钮绑定
        // ============================================
        const menuBtn = document.getElementById('rpg-menu-toggle-btn');
        if (menuBtn) {
            // 使用 cloneNode(true) 移除之前所有可能绑定的事件，防止冲突
            const newMenuBtn = menuBtn.cloneNode(true);
            menuBtn.parentNode.replaceChild(newMenuBtn, menuBtn);
            
            // 绑定新的点击事件：打开暂停菜单
            newMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 防止冒泡
                this.toggleMenu(true); // 调用类内部的 toggleMenu 方法
            });
        }

        // ============================================
        // 【新增】战斗界面背包按钮绑定 (对应问题2)
        // ============================================
        const battleBagBtn = document.getElementById('rpg-battle-bag-btn');
        if (battleBagBtn) {
            const newBagBtn = battleBagBtn.cloneNode(true);
            battleBagBtn.parentNode.replaceChild(newBagBtn, battleBagBtn);

            newBagBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // 打开战斗背包
                this.openInventory('battle'); 
            });
        }
        const interactBtn = document.getElementById('rpg-interact-btn');
    if (interactBtn) {
        // 防止重复绑定
        const newBtn = interactBtn.cloneNode(true);
        interactBtn.parentNode.replaceChild(newBtn, interactBtn);
        
 newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.triggerInteraction(); // 执行交互
        });          
    }
    }
    
    triggerInteraction() {
    if (!this.pendingInteraction) return;

    const target = this.pendingInteraction;
    
    if (target.type === 'shop') {
        this.openShop();
    } else if (target.type === 'furniture') {
        this.interactWithFurniture(target.data);
    }
    // 交互后隐藏按钮，防止重复点击（可选，或者保留方便连续操作）
    document.getElementById('rpg-interact-btn').style.display = 'none';
}

// 【修复版】loadLevel 函数
loadLevel(idx, mode = 'start') {
    // === 修复点 1：清理旧状态，防止随机地图数据残留干扰 ===
    this.currentStoryPoints = [];
    
    // 1. 索引边界检查
    if (idx < 0) idx = 0;
    if (idx >= this.LEVELS.length) idx = this.LEVELS.length - 1;

    this.lvIdx = idx;
    this.curLv = this.LEVELS[idx];

    // === 修复点 2：立即更新标题
    const titleEl = document.getElementById('rpg-header-title');
    if (titleEl && this.curLv) {
        titleEl.innerText = this.curLv.name; 
        titleEl.style.color = 'var(--text-color)';
    }

    // 随机地图数据初始化逻辑
    if (this.curLv.type === 'random') {
        const mapId = this.curLv.id;
        if (!this.randomMapData.mapStates) {
            this.randomMapData.mapStates = {};
        }
        if (!this.randomMapData.mapStates[mapId]) {
            this.randomMapData.mapStates[mapId] = {
                points: [],
                triggered: new Set()
            };
        }
        this.randomMapData.mapStates[mapId].points = [];
    }

    // 2. 处理序章 (纯剧情，无地图)
    if (this.curLv.type === 'prologue') {
        this.state = this.STATE.STORY;
        this.storyQueue = [];
        this.curLv.story.forEach(text => {
            this.storyQueue.push({ name: "", text: text });
        });
        
        document.getElementById('rpg-controls').style.display = 'none';
        
        const menuBtn = document.getElementById('rpg-menu-toggle-btn');
        if (menuBtn) menuBtn.style.display = 'none';
        
        this.nextStory();
        return;
    }

    // =====================================================
    // === 【Gemini新增】解析地图 & 预计算 mapCache 缓存 ===
    // =====================================================
    this.mapData = [];
    this.mapEnemies = [];
    this.mapCache = []; // 【新增】用于存储碰撞和家具实例信息

    let rows = this.curLv.map;
    this.h = rows.length;
    this.w = rows[0].length;

    // 初始化 mapCache 二维数组
    for (let y = 0; y < this.h; y++) {
        this.mapCache[y] = [];
        for (let x = 0; x < this.w; x++) {
            this.mapCache[y][x] = { blocked: false, furniture: null };
        }
    }

    let startPos = { x: 1, y: 1 };
    let prevPos = { x: 1, y: 1 };
    let exitPos = { x: 1, y: 1 };
    this.gatePos = null;

    // 临时计数器（用于给家具编号，解决树跳动问题）
    let furnitureCounters = {};

    // 如果是随机地图且是初次进入，重置剧情点
    if (this.curLv.type === 'random' && mode !== 'prev' && !this.visitedLevels.has(this.curLv.id)) {
        if (this.randomMapData) {
            this.randomMapData.storyPoints = [];
            this.randomMapData.triggeredPoints = new Set();
        }
    }

    // 解析地图数据（含家具预处理）
    for (let y = 0; y < this.h; y++) {
        let rowStr = "";
        for (let x = 0; x < this.w; x++) {
            let char = rows[y][x];

// --- 预处理家具逻辑 ---
            const furnitureKey = Object.keys(RPG_FURNITURE).find(k => RPG_FURNITURE[k].mapChar === char);
            
            if (furnitureKey) {
                const item = RPG_FURNITURE[furnitureKey];
                
                // 1. 计数
                if (!furnitureCounters[char]) furnitureCounters[char] = 0;
                furnitureCounters[char]++;
                
                // 2. 构建家具信息对象
                const furnitureInfo = {
                    key: furnitureKey,
                    index: furnitureCounters[char], // 固定编号
                    w: item.w || 64,
                    h: item.h || 64,
                    cols: item.cols || 1,
                    rows: item.rows || 1
                };

                // 3. 【关键修复】将家具信息覆盖到它占用的所有格子上
                // 锚点在左下角 (x, y)，向右(c)延伸，向上(r)延伸
                for (let r = 0; r < furnitureInfo.rows; r++) {
                    for (let c = 0; c < furnitureInfo.cols; c++) {
                        let targetY = y - r; // 向上
                        let targetX = x + c; // 向右
                        
                        // 边界检查
                        if (targetY >= 0 && targetY < this.h && targetX >= 0 && targetX < this.w) {
                            // 给每个占用的格子都打上标记
                            this.mapCache[targetY][targetX].furniture = furnitureInfo;
                            
                            // 【注意】这里不再设置 blocked = true
                            // 我们改为在 updateMap 移动时动态判断是否拥有
                        }
                    }
                }
            }
            
            // --- 【Gemini新增】处理墙壁碰撞 ---
            if (char === '#' || char === 'F' || char === 'f' || char === 'H') {
                this.mapCache[y][x].blocked = true;
            }

            // --- 处理各类特殊地图字符（保持你原来的逻辑）---
            if (char === 'S') {
                startPos = { x, y };
            } else if (char === 'P') {
                prevPos = { x, y };
            } else if (char === 'E') {
                exitPos = { x, y };
            } else if (char === 'G') {
                this.gatePos = { x, y };
                char = '.';
            } else if (char === 'M') {
                let mType = Math.min(idx - 1, 1);
                let e = new RpgEntity("怪物", { monsterType: mType }, "enemy");
                if (this.curLv.enemyPool) {
                    e.hp = this.curLv.enemyPool.hp;
                    e.maxHp = this.curLv.enemyPool.hp;
                    e.atk = this.curLv.enemyPool.atk;
                    e.lv = this.curLv.enemyPool.lv;
                    e.xp = e.lv * 20;
                }
                e.x = x; e.y = y;
                this.mapEnemies.push(e);
                char = '.';
            } else if (char === 'B') {
                let e = new RpgEntity("BOSS", { monsterType: 2 }, "boss");
                if (this.curLv.boss) {
                    e.hp = this.curLv.boss.hp;
                    e.maxHp = this.curLv.boss.hp;
                    e.atk = this.curLv.boss.atk;
                    e.lv = this.curLv.boss.lv;
                    e.xp = e.lv * 50;
                }
                e.x = x; e.y = y;
                this.mapEnemies.push(e);
                char = '.';
            } else if (char === 'T') {
                // 记录剧情点坐标
                if (this.curLv.type === 'random') {
                    const mapId = this.curLv.id;
                    this.randomMapData.mapStates[mapId].points.push({ x, y });
                }
                if (!this.currentStoryPoints) this.currentStoryPoints = [];
                this.currentStoryPoints.push({ x, y });
            }

            rowStr += char;
        }
        this.mapData.push(rowStr);
    }

    // =====================================================
    // === 3. 处理家园地图特殊逻辑（保留原有结构）===
    // =====================================================
    if (this.curLv.type === 'home') {
        if (mode !== 'load') {
            // home 地图出生点固定
            this.p1.x = 1; this.p1.y = 7;
            this.p2.x = 1; this.p2.y = 7;
            this.state = this.STATE.STORY;
            this.storyQueue = [
                { name: "", text: this.curLv.intro },
                { name: this.p2.name, text: this.curLv.partnerText }
            ];
            document.getElementById('rpg-controls').style.display = 'none';
            const menuBtn = document.getElementById('rpg-menu-toggle-btn');
            if (menuBtn) menuBtn.style.display = 'none';
            this.nextStory();
        } else {
            this.state = this.STATE.MAP;
            document.getElementById('rpg-controls').style.display = 'block';
            const menuBtn = document.getElementById('rpg-menu-toggle-btn');
            if (menuBtn) menuBtn.style.display = 'flex';
        }
        this.updateCamera(true);
        return;
    }

    // =====================================================
    // === 4. 普通/随机/室内地图 —— 位置与剧情逻辑（保留原有结构）===
    // =====================================================
    if (mode !== 'load') {
        // 设置玩家坐标
        if (mode === 'start') {
            this.p1.x = startPos.x; this.p1.y = startPos.y;
        } else if (mode === 'prev') {
            if (prevPos.x !== 1 || prevPos.y !== 1) {
                this.p1.x = prevPos.x; this.p1.y = prevPos.y;
            } else {
                this.p1.x = Math.max(1, exitPos.x - 1); this.p1.y = exitPos.y;
            }
        }
        this.p2.x = this.p1.x; this.p2.y = this.p1.y;

        this.state = this.STATE.STORY;
        this.isOpeningStory = (mode === 'start' && !this.visitedLevels.has(this.curLv.id));
        this.storyQueue = [];

        // 判断是否是旧地重游
        const isRevisit = this.visitedLevels.has(this.curLv.id);

        if (isRevisit) {
            // --- 情况A：旧地重游 ---
            let envText = mode === 'prev' ? 
                (this.curLv.returnText || "回到了之前的区域。") : 
                "又回到了这里。";
            
            this.storyQueue.push({ name: "", text: envText });

            const returnLines = this.p2.customData?.dialogues?.return || [];
            if (returnLines.length > 0 && Math.random() > 0.5) {
                this.storyQueue.push({ name: this.p2.name, text: this.getRandomLine(returnLines) });
            }
        } else {
            // --- 情况B：初次探索 ---
            this.visitedLevels.add(this.curLv.id); 

            let hasRandomStory = false;
            if (this.curLv.type === 'random' && this.randomMapData) {
                const mapIdx = this.randomMapData.currentMapIndex;
                if (this.curLv.id === `random${mapIdx}`) {
                    const storyData = this.randomMapData.mapStories[mapIdx];
                    if (storyData && storyData.opening && storyData.opening.length > 0) {
                        storyData.opening.forEach(text => {
                            let parts = text.split(/[：:]/);
                            let speaker = parts.length >= 2 ? parts[0] : "";
                            let content = parts.length >= 2 ? parts.slice(1).join(":") : text;
                            this.storyQueue.push({ name: speaker, text: content });
                        });
                        hasRandomStory = true;
                    }
                }
            }
            
            if (!hasRandomStory) {
                let envText = this.curLv.intro || "来到了一个新的区域。";
                this.storyQueue.push({ name: "", text: envText });

                if (this.curLv.type !== 'random') {
                    // 固定地图的特殊对话
                    let lines = [];
                    if (idx === 1 && mode === 'start') {
                        const introLine = this.p2.customData?.intro;
                        if (introLine) lines.push(introLine);
                    }
                    
                    const mapKey = `map${idx}`;
                    const pool = this.p2.customData?.dialogues?.[mapKey] || [];
                    if (pool.length > 0) {
                        const shuffled = [...pool].sort(() => 0.5 - Math.random());
                        lines = lines.concat(shuffled.slice(0, 2));
                    }

                    lines.forEach(line => {
                        this.storyQueue.push({ name: this.p2.name, text: line });
                    });
                }
            }
        }

        document.getElementById('rpg-controls').style.display = 'none';
        this.nextStory();
    } else {
        // mode === 'load'
        this.state = this.STATE.MAP;
        document.getElementById('rpg-controls').style.display = 'block';
    }
    
    this.updateCamera(true);
}


// 【修复版】nextStory：处理序章跳转
nextStory() {
    if (this.state === this.STATE.STORY) {
        if (this.storyQueue && this.storyQueue.length > 0) {
            // 有剧情：显示下一句
            const talk = this.storyQueue.shift();
            this.showBottomDialog(talk.name, talk.text);
        } else {
        this.isOpeningStory = false;
            // --- 剧情播放完毕 ---
            this.closeDialogs();
            
            // 1. 检查是否通关 (保持原有逻辑)
            if (this.isGameClear) {
                this.isGameClear = false;
                this.stop();
                switchScreen('rpg-title-screen');
                return;
            }

            // 2. 检查是否回家 (保持原有逻辑)
            if (this.isGoingHome) {
                this.isGoingHome = false;
                const homeIdx = this.LEVELS.findIndex(lv => lv.type === 'home');
                if (homeIdx !== -1) this.loadLevel(homeIdx, 'start');
                else this.loadLevel(0, 'start');
                return;
            }
            
            // 3. 【核心修复】检查是否是序章
            // 如果刚看完序章，必须手动加载第1关，否则会停留在序章的黑屏状态！
            if (this.curLv.type === 'prologue') {
                // 加载下一关 (索引 0+1 = 1，即迷雾森林)
                this.loadLevel(this.lvIdx + 1, 'start');
                return; // 直接返回，让 loadLevel 接管后续逻辑
            }
            
            // 4. 普通地图剧情结束（比如刚进入迷雾森林看完介绍）
            // 恢复地图控制权
            this.state = this.STATE.MAP;
            
            // 强制恢复所有 UI 元素
            const controls = document.getElementById('rpg-controls');
            const menuBtn = document.getElementById('rpg-menu-toggle-btn');

            
            if (controls) controls.style.display = 'block';
            if (menuBtn) menuBtn.style.display = 'flex';

            
            // 重置输入状态
            if (typeof rpgInput !== 'undefined') {
                rpgInput.x = 0;
                rpgInput.y = 0;
            }
            
            // 确保游戏循环运行
            if (!this.isRunning) {
                this.start();
            }
        }
    }
}


// 【修改】切换暂停状态：不再是弹窗，而是切换页面
    toggleMenu(show) {
        this.isPaused = show;
        
        if (show) {
            this.stop(); // 停止游戏循环
            switchScreen('rpg-pause-screen'); // 切换到标准的暂停页面
        } else {
            switchScreen('rpg-game-screen'); // 切回游戏页面
            this.resume(); // 恢复游戏循环
        }
    }




    loop() {
        if (!this.isRunning) return;
        if (!this.isPaused) {
            this.update();
            this.draw();
        }
        this.animationFrameId = requestAnimationFrame(() => this.loop());
    }

    update() {
        if(this.state === this.STATE.MAP) this.updateMap();
        else if(this.state === this.STATE.BATTLE_TARGET) { /* managed by UI */ }
        this.updateCamera();
    }

    updateCamera(instant = false) {
        let targetX = this.p1.x * RPG_CONFIG.TILE - this.canvas.width/2 + RPG_CONFIG.TILE/2;
        let targetY = this.p1.y * RPG_CONFIG.TILE - this.canvas.height/2 + RPG_CONFIG.TILE/2;
        let minX = 0;
        let maxX = Math.max(0, this.w * RPG_CONFIG.TILE - this.canvas.width);
        let minY = 0;
        let maxY = Math.max(0, this.h * RPG_CONFIG.TILE - this.canvas.height);
        targetX = Math.max(minX, Math.min(targetX, maxX));
        targetY = Math.max(minY, Math.min(targetY, maxY));
        if(instant) { this.cam.x = targetX; this.cam.y = targetY; }
        else { this.cam.x += (targetX - this.cam.x) * 0.1; this.cam.y += (targetY - this.cam.y) * 0.1; }
    }

updateMap() {
    this.frameCounter = (this.frameCounter || 0) + 1;

    // 移动冷却
    if(this.moveWait > 0) { 
        this.moveWait--; 
        if (this.frameCounter % 5 === 0) {
            this.p1.step = (this.p1.step + 1) % 4;
            this.p2.step = (this.p2.step + 1) % 4;
        }
        return; 
    }

    // 无输入则静止
    if (rpgInput.x === 0 && rpgInput.y === 0) {
        this.p1.step = 0;
        this.p2.step = 0;
        return;
    }

    // 设置方向
    if (rpgInput.y > 0) this.p1.direction = 0;
    else if (rpgInput.x < 0) this.p1.direction = 1;
    else if (rpgInput.x > 0) this.p1.direction = 2;
    else if (rpgInput.y < 0) this.p1.direction = 3;

    // 计算目标坐标
    let nx = this.p1.x + rpgInput.x;
    let ny = this.p1.y + rpgInput.y;
    
    // 边界检查
    if(nx < 0 || nx >= this.w || ny < 0 || ny >= this.h) return;

    // 进门逻辑 (Home -> Indoor) —— 优先于碰撞检测
    const doorX = this.curLv.doorPos ? this.curLv.doorPos.x : 9;
    const doorY = this.curLv.doorPos ? this.curLv.doorPos.y : 5;

    if (this.curLv.id === 'home' && nx === doorX && ny === doorY) {
        this.loadLevel(this.LEVELS.findIndex(l => l.id === 'indoor'), 'start');
        const interactBtn = document.getElementById('rpg-interact-btn');
        if (interactBtn) interactBtn.style.display = 'none';
        return;
    }

    // --- 交互检测 ---
    let interactTarget = null;
    
    // 1. 检查家具交互
    const furniture = this.getFurnitureAt(nx, ny);
    if (furniture) {
        interactTarget = { type: 'furniture', data: furniture };
        if (furniture.type === 'empty_slot') {
            interactTarget = null; // 空位不显示按钮
        }
    }
    
    // 2. 检查商店告示牌
    if (this.mapData[ny][nx] === 's') {
        interactTarget = { type: 'shop' };
    }

    // 3. 处理交互逻辑
    const interactBtn = document.getElementById('rpg-interact-btn');
    
    if (interactTarget) {
        this.pendingInteraction = interactTarget;
        if (interactBtn) {
            interactBtn.style.display = 'flex';
            interactBtn.innerText = interactTarget.type === 'shop' ? '💰' : '🖐️';
        }
        return; // 有交互目标时阻止移动
    } else {
        this.pendingInteraction = null;
        if (interactBtn) interactBtn.style.display = 'none';
    }


    // 【核心修复 - 动态碰撞检测】
    const nextCell = this.mapCache[ny] && this.mapCache[ny][nx];
    if (!nextCell) return; // 地图外

    // 1. 检查硬性障碍 (墙壁、栅栏、房子结构)
    if (nextCell.blocked) return;

    // 2. 检查家具障碍 (根据拥有情况决定是否阻挡)
    if (nextCell.furniture) {
        const info = nextCell.furniture;
        const item = RPG_FURNITURE[info.key];
        
        // 统计拥有数量
        const ownedCount = this.homeState.furniture.filter(fid => fid === info.key).length;
        const isDefault = item.cost === 0;

        // 【逻辑】如果是默认家具，或者 拥有的数量 >= 家具在地图上的编号
        // 说明这个家具是“真实存在”的，需要阻挡
        if (isDefault || ownedCount >= info.index) {
            return; // 发生碰撞，无法移动
        }
        
        // 如果没买，就当它是空气，允许穿过
    }



    // --- 移动逻辑继续 ---

    // 出门逻辑 (Indoor -> Home)
    if (this.curLv.id === 'indoor' && this.mapData[ny][nx] === 'E') {
        const homeIdx = this.LEVELS.findIndex(l => l.id === 'home');
        const homeLevel = this.LEVELS[homeIdx];
        const homeDoorX = homeLevel.doorPos ? homeLevel.doorPos.x : 9;
        const homeDoorY = homeLevel.doorPos ? homeLevel.doorPos.y : 5;
        this.loadLevel(homeIdx, 'start');
        
        // 传送到门口正下方
        this.p1.x = homeDoorX; 
        this.p1.y = homeDoorY + 1; 
        this.p2.x = this.p1.x; this.p2.y = this.p1.y;

        if (interactBtn) interactBtn.style.display = 'none';
        return;
    }
    
    // 时空之门逻辑
    if (this.curLv.type === 'home' && this.gatePos && nx === this.gatePos.x && ny === this.gatePos.y) {
        this.triggerGateDialog();
        return;
    }
    
    // 剧情点逻辑
    if (this.currentStoryPoints && this.currentStoryPoints.length > 0) {
        const point = this.currentStoryPoints.find(p => p.x === nx && p.y === ny);
        
        if (point) {
            if (this.curLv.type === 'random') {
                const mapId = this.curLv.id;
                const mapState = this.randomMapData?.mapStates?.[mapId];
                const pointKey = `${nx},${ny}`;
                
                if (mapState && !mapState.triggered.has(pointKey)) {
                    this.triggerStoryPoint(point); 
                    return;
                }
            }
        }
    }
    
    // 遇敌逻辑
    let hitEnemy = this.mapEnemies.find(e => e.x === nx && e.y === ny);
    if(hitEnemy && !hitEnemy.isDefeated) { 
        this.startBattle(hitEnemy); 
        return; 
    }
    
    // 执行移动
    let ox = this.p1.x, oy = this.p1.y;
    let oldDir = this.p1.direction;

    this.p1.x = nx; this.p1.y = ny;
    this.moveWait = 10;
    
    // 队友跟随
    if(Math.abs(this.p1.x - this.p2.x) + Math.abs(this.p1.y - this.p2.y) > 1) { 
        this.p2.x = ox; 
        this.p2.y = oy;
        this.p2.direction = oldDir; 
    }
    
    // 地图切换 (上一层/下一层)
    let tile = this.mapData[ny][nx];
    
    if(tile === 'E') {
        if (this.curLv.type === 'random') {
            const mapId = this.curLv.id;
            const mapState = this.randomMapData.mapStates[mapId];
            const currentMapCount = mapState ? mapState.triggered.size : 0;
            
            if (this.curLv.id !== 'random0' && currentMapCount < 3) {
                this.triggerSimpleDialog("", "出口被一种神秘的力量封印着...\n(需要收集 3 个线索才能解锁)");
                return;
            }
        }
        
        if (this.isGenerating) return; 
        
        const nextIdx = this.lvIdx + 1;

        if (nextIdx < this.LEVELS.length) {
            if (this.LEVELS[nextIdx].type === 'random') {
                this.showTeleportScreen("正在前往下一区域", 'light');
                setTimeout(() => {
                    this.hideTeleportScreen();
                    this.loadLevel(nextIdx, 'start');
                }, 800);
            } else {
                this.loadLevel(nextIdx, 'start');
            }
        } 
        else if (this.curLv.type === 'random') {
            this.proceedToNextRandomMap(); 
        }
    } 
    else if (tile === 'P') {
        this.loadLevel(this.lvIdx - 1, 'prev');
    }
}



// 【完整修复】触发时空之门对话
triggerGateDialog() {
    this.stop(); // 暂停游戏循环
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7); z-index:1000; display:flex; align-items:center; justify-content:center;';
    
    const modal = document.createElement('div');
    modal.style.cssText = 'background:#fff; border-radius:12px; padding:20px; max-width:80%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);';
    
    modal.innerHTML = `
        <h3 style="margin:0 0 15px 0; color:#3498db; text-align:center;">时空之门</h3>
        <p style="margin:0 0 20px 0; color:#666; text-align:center; line-height:1.6;">${this.p2.name}：要去新的世界冒险吗？</p>
        <div style="display:flex; gap:10px; justify-content:center;">
            <button id="gate-yes-btn" class="btn btn-primary" style="min-width:80px;">是</button>
            <button id="gate-no-btn" class="btn btn-neutral" style="min-width:80px;">否</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // 【关键修复】必须在DOM插入后再绑定事件
    setTimeout(() => {
        const yesBtn = document.getElementById('gate-yes-btn');
        const noBtn = document.getElementById('gate-no-btn');
        
        if (yesBtn) {
            yesBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('点击了"是"按钮'); // 调试日志
                document.body.removeChild(overlay);
                this.showWorldInputModal();
            };
        } else {
            console.error('找不到"是"按钮');
        }
        
        if (noBtn) {
            noBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('点击了"否"按钮'); // 调试日志
                document.body.removeChild(overlay);
                this.resume();
            };
        } else {
            console.error('找不到"否"按钮');
        }
    }, 0);
}

// 【修复2】4字输入框（完美支持多字粘贴/输入）
showWorldInputModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible';
    overlay.style.zIndex = '2000';
    
    const modal = document.createElement('div');
    modal.className = 'modal-window';
    modal.style.textAlign = 'center';
    
    modal.innerHTML = `
        <h3 style="margin-bottom:20px; color:var(--primary-color);">输入新世界名称</h3>
        <p style="font-size:12px; color:#666; margin-bottom:15px;">请输入4个字的世界名称</p>
        
        <div class="code-input-container">
            <input type="text" class="code-input-box" maxlength="4" data-index="0">
            <input type="text" class="code-input-box" maxlength="4" data-index="1">
            <input type="text" class="code-input-box" maxlength="4" data-index="2">
            <input type="text" class="code-input-box" maxlength="4" data-index="3">
        </div>
        
        <div style="display:flex; gap:10px; margin-top:20px;">
            <button id="world-cancel-btn" class="btn btn-neutral" style="flex:1;">取消</button>
            <button id="world-confirm-btn" class="btn btn-primary" style="flex:1;">出发</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    const inputs = overlay.querySelectorAll('.code-input-box');
    
    inputs.forEach((input, idx) => {
        input.addEventListener('input', (e) => {
            const val = e.target.value;
            
            // 如果输入了内容（包括单字或多字粘贴）
            if (val.length >= 1) {
                const chars = val.split('');
                
                // 1. 填充当前及后续格子
                for (let i = 0; i < chars.length; i++) {
                    const targetIdx = idx + i;
                    if (targetIdx < inputs.length) {
                        inputs[targetIdx].value = chars[i];
                    }
                }
                
                // 2. 修正当前格子：只保留第一个字符（因为它是 maxlength=4 为了接收粘贴）
                input.value = chars[0];

                // 3. 自动聚焦到下一个空格子或最后一个格子
                const nextIdx = Math.min(idx + chars.length, inputs.length - 1);
                // 检查 nextIdx 是否有值，有则聚焦再下一个（防止覆盖用户刚填的）
                if (inputs[nextIdx].value && nextIdx < inputs.length - 1) {
                     inputs[nextIdx + 1].focus();
                } else {
                     inputs[nextIdx].focus();
                }
            }
        });
        
        // 回删逻辑
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && e.target.value === '') {
                if (idx > 0) inputs[idx - 1].focus();
            }
            if (e.key === 'Enter' && idx === 3) {
                 document.getElementById('world-confirm-btn').click();
            }
        });
        
        input.addEventListener('focus', (e) => e.target.select());
    });
    
    setTimeout(() => inputs[0].focus(), 100);

    document.getElementById('world-cancel-btn').onclick = () => {
        document.body.removeChild(overlay);
        this.resume();
    };

    document.getElementById('world-confirm-btn').onclick = async () => {
        let theme = "";
        inputs.forEach(input => theme += input.value);
        if (theme.length === 0) return showToast("请输入世界名称");
        document.body.removeChild(overlay);
        await this.generateRandomWorld(theme);
    };
}

// 【新增】生成随机世界
// 【修复版】generateRandomWorld
async generateRandomWorld(theme) {
    this.showTeleportScreen(`正在前往${theme}`, 'dark');
    
    try {
        const { url, key, model } = db.apiSettings;
        if (!url || !key || !model) {
            this.hideTeleportScreen();
            showToast('请先配置API');
            this.resume();
            return;
        }
        
        // 1. 【核心修复】清除旧的随机地图访问记录
        // 这样新生成的 random0 才会被视为“初次探索”
        // 我们保留 'lv1', 'home' 等固定地图的记录，只删 'random' 开头的
        const keptVisits = Array.from(this.visitedLevels).filter(id => !id.startsWith('random'));
        this.visitedLevels = new Set(keptVisits);

        // 2. 清理内存中的地图列表 (保留固定地图，移除旧随机地图)
        // 防止上一局的 random1 留在数组里干扰
        this.LEVELS = this.LEVELS.filter(lv => lv.type !== 'random');

        // 3. 重置随机地图数据
        this.randomMapData = {
            worldTheme: theme,
            currentMapIndex: 0,
            mapStories: [],
            storyPoints: [],
            triggeredPoints: new Set(),
            mapStates: {} // 【确保这行存在】
        };
        
        // 4. 生成第一张地图
        await this.generateNextRandomMap();
        
        setTimeout(() => {
            this.hideTeleportScreen();
        }, 800);
        
    } catch (e) {
        console.error('生成世界失败:', e);
        this.hideTeleportScreen();
        showToast('生成失败: ' + e.message);
        this.resume();
    }
}




// 【修复版】确保地图连通性 (Dijkstra 权重版)
ensureMapConnectivity(mapLines) {
    // 1. 转为二维数组
    let grid = mapLines.map(line => line.split(''));
    const h = grid.length;
    const w = grid[0].length;

    // 2. 找到起点和所有目标
    let start = null;
    let targets = []; 

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const char = grid[y][x];
            if (char === 'S' || char === 'P') start = { x, y };
            // 记录目标，同时记录它是干嘛的，方便后续处理
            if (char === 'E' || char === 'T') targets.push({ x, y, id: `${x},${y}` });
        }
    }

    if (!start) return mapLines; 

    // 3. 定义带权重的寻路凿墙函数
    // 原理：优先走平地，实在没路了才凿墙
    const carvePathToTarget = (target) => {
        // 优先队列 (按消耗排序)
        // 结构: { x, y, cost, parent }
        let queue = [{ x: start.x, y: start.y, cost: 0, parent: null }];
        let visited = new Map(); // key: "x,y", value: minCost

        while (queue.length > 0) {
            // 取出消耗最小的节点 (模拟优先队列)
            queue.sort((a, b) => a.cost - b.cost);
            const curr = queue.shift();
            const key = `${curr.x},${curr.y}`;

            // 如果已经访问过且之前的路径代价更小，跳过
            if (visited.has(key) && visited.get(key) <= curr.cost) continue;
            visited.set(key, curr.cost);

            // 到达目标？开始回溯凿墙
            if (curr.x === target.x && curr.y === target.y) {
                let node = curr;
                while (node) {
                    const tile = grid[node.y][node.x];
                    // 只凿墙，不覆盖其他特殊物体(如 M, B, T)
                    if (tile === '#') {
                        grid[node.y][node.x] = '.';
                    }
                    node = node.parent;
                }
                return; // 搞定一个目标，退出
            }

            // 探索四周
            const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
            for (let d of dirs) {
                const nx = curr.x + d[0];
                const ny = curr.y + d[1];

                // 【修复核心】范围检查放宽：允许访问边缘 (0 和 w-1)
                // 这样如果出口在边缘，也能找得到
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    const nextTile = grid[ny][nx];
                    
                    // 计算代价
                    // 如果是普通路或者目标点，代价小 (走正道)
                    // 如果是墙，代价极大 (除非逼不得已，否则不走墙)
                    let moveCost = 1; 
                    if (nextTile === '#') moveCost = 50; // 凿墙代价高
                    
                    // 将新节点加入队列
                    const newCost = curr.cost + moveCost;
                    const nextKey = `${nx},${ny}`;
                    
                    if (!visited.has(nextKey) || visited.get(nextKey) > newCost) {
                        queue.push({ 
                            x: nx, y: ny, 
                            cost: newCost, 
                            parent: curr 
                        });
                    }
                }
            }
        }
    };

    // 4. 对每个目标分别执行寻路
    targets.forEach(t => {
        carvePathToTarget(t);
    });
    
    // 5. 额外清理：防止 T 或 E 被死角卡住
    // 如果目标点四周全是障碍物，强制打通上方或左方
    targets.forEach(t => {
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        const isBlocked = dirs.every(d => {
            const nx = t.x + d[0];
            const ny = t.y + d[1];
            // 超出边界算通，或者不是墙算通
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) return true; 
            return grid[ny][nx] === '#'; 
        });

        if (isBlocked) {
            // 优先打通上方，如果上方是边界则打通左方
            if (t.y > 0) grid[t.y - 1][t.x] = '.';
            else if (t.x > 0) grid[t.y][t.x - 1] = '.';
        }
    });

    return grid.map(row => row.join(''));
}



// 【重构版 V5】生成下一张随机地图 (按标点自动断句 + 智能补全发言人)
async generateNextRandomMap() {
    const idx = this.randomMapData.currentMapIndex;

    if (idx >= 5) {
        showToast('冒险结束！');
        const homeIdx = this.LEVELS.findIndex(lv => lv.type === 'home');
        this.loadLevel(homeIdx, 'start');
        return;
    }

    try {
        const { url, key, model } = db.apiSettings;
        if (!url || !key) throw new Error("请先配置API");

        // ==========================================
        // 1. 角色资料准备 (修复版逻辑)
        // ==========================================
        
        // --- P1 (玩家) ---
        // 游戏名：绝对以当前实例的 name 为准 (玩家输入的名字)
        const p1GameName = this.p1.name; 
        
        // 真名/人设：尝试通过 sourceId 回溯 DB，否则兜底
        let p1RealName = p1GameName; 
        let p1PersonaText = this.p1.persona; 

        if (this.p1.sourceId) {
            const userProfile = db.userPersonas.find(u => u.id === this.p1.sourceId);
            if (userProfile) {
                // 如果有人设档案，取档案里的名字作为真名
                p1RealName = userProfile.realName; 
                // 确保人设文本是最新的
                p1PersonaText = userProfile.persona;
            }
        }
        if (!p1PersonaText) p1PersonaText = "勇敢的冒险者。";

        // --- P2 (伙伴) ---
        // 游戏名：绝对以当前实例的 name 为准
        const p2GameName = this.p2.name;
        
        // 真名/人设：优先取 customData (存档里的)，其次回溯 DB
        let p2RealName = this.p2.customData?.realName || p2GameName;
        let p2PersonaText = this.p2.customData?.persona;

        if (!p2PersonaText && this.p2.sourceId) {
            const char = db.characters.find(c => c.id === this.p2.sourceId);
            if (char) {
                p2RealName = char.realName;
                p2PersonaText = char.persona;
            }
        }
        if (!p2PersonaText) p2PersonaText = "忠诚的伙伴。";

        // ==========================================
        // 2. 世界书内容准备
        // ==========================================
        const currentWbIds = this.worldBookIds || [];
        
        // 辅助函数：根据位置提取内容
        const getWbContent = (pos) => currentWbIds
            .map(id => db.worldBooks.find(wb => wb.id === id && wb.position === pos))
            .filter(Boolean)
            .map(wb => wb.content)
            .join('\n');

        const wbBefore = getWbContent('before');
        const wbAfter = getWbContent('after');
        const wbWriting = getWbContent('writing');

        // ==========================================
        // 3. 构建 Prompt (条件拼接版)
        // ==========================================
        const theme = this.randomMapData.worldTheme;
        
        let prompt = `你是一个游戏剧本作家，你正在撰写一个天马行空的冒险故事。请根据以下要求生成纯文本内容。请直接输出内容，不要添加任何解释或总结。\n\n`;
        
        prompt += `【冒险世界名称】: ${theme}\n`;

        // 只有当内容存在时才拼接入 prompt
        if (wbBefore) {
            prompt += `【世界观设定(核心)】\n${wbBefore}\n\n`;
        }
        
        prompt += `【角色资料】
勇者: 游戏名是${p1GameName}(真名: ${p1RealName})
勇者设定: ${p1PersonaText}

冒险伙伴: 游戏名是${p2GameName}](真名: ${p2RealName})
冒险伙伴设定: ${p2PersonaText}\n\n`;

        if (wbAfter) {
            prompt += `【重要事项】\n${wbAfter}\n\n`;
        }
        
        if (wbWriting) {
            prompt += `【你的写作风格】\n${wbWriting}\n\n`;
        }

prompt += `【对话规则 - 绝对执行】
1. **勇者在开场剧情中始终保持沉默**，不要生成勇者的台词。
2. 开场剧情只能由 **冒险伙伴** 发言，或者使用 **旁白** 描写。
3. **冒险伙伴** 的语气必须符合人设。
\n`;



        // --- 场景 A: 第1关 ---
        if (idx === 0) {
            prompt += `
【任务】
1.首先，请你设计世界入口处的**地图配色** (Hex颜色代码)，定下故事场景基调。
2. 然后请你先撰写整个故事的5章节大纲，情节天马行空、跌宕起伏，要有反转。
3. 接着，请生成第1章开场对话（**仅伙伴发言或旁白**）。


【格式指令 - 必须使用标签】
#META_DATA#
墙壁颜色: [Hex代码, 如 #1e824c]
地面颜色: [Hex代码, 如 #27ae60]

#GRAND_PLOT#
第1章: [50字故事内容]
...
第5章: [结局]

#STORY_OPENING#
旁白
${p2GameName}：伙伴的台词
...


`;
        }
        
        // --- 场景 B: 第5关 (决战) ---
        else if (idx === 4) {
            const grandPlot = this.randomMapData.grandPlot || [];
            const summary = grandPlot[4] || "最终决战。";
            
            prompt += `
【进度】第5章(最终章)
【大纲】${summary}

【任务】
1. 请你设计最终战斗场景的配色和最终boss的名称。
2. 请你撰写决战前开场白（**仅伙伴发言或旁白**）。
3. 请撰写战胜BOSS后的结局剧情（由伙伴主导）。

【格式指令】
#META_DATA#
BOSS名称: [霸气的名字]
墙壁颜色: [Hex]
地面颜色: [Hex]

#STORY_OPENING#
旁白
${p2GameName}：战前发言
……

#STORY_ENDING#
旁白例如BOSS倒下
${p2GameName}：结局台词
……
`;
        }
        
        // --- 场景 C: 中间关卡 ---
        else {
            const grandPlot = this.randomMapData.grandPlot || [];
            const summary = grandPlot[idx] || "探索中。";
            
            prompt += `

【大纲】${summary}
【进度】现在你正在撰写第${idx+1}章

【任务】
1. 请你设计本关的 **怪物名称** 和 **地图配色** (Hex颜色代码)，需符合主题氛围。
2. 撰写本章节的开场剧情（**仅伙伴发言或旁白**）。
3. 撰写3个冒险中的突发剧情，可有Npc参与，也可以没有（**剧情仅伙伴、Npc发言或旁白**），这些剧情发生后，这个地图的出口才会解锁。
4. 11x11地图矩阵(由你生成，禁止照搬示例)。包含：#(墙壁), P(入口), E(出口), 3个T(剧情触发点), 2-4个M(怪物)。P和E要离得远一点。

【格式指令】
#META_DATA#
小怪名称: [例如: 森林史莱姆]
墙壁颜色: [Hex代码, 如 #1e824c]
地面颜色: [Hex代码, 如 #27ae60]

#STORY_OPENING#
旁白
${p2GameName}：台词...
……

#STORY_POINTS#
旁白
${p2GameName}：台词...
某怪物：台词
……
===SEP===
旁白
小女孩：台词
${p2GameName}：台词...
……
===SEP===
旁白
${p2GameName}：台词...
……

#MAP_BLOCK#
###########
#P.#...M..#
……
#M......T.#
###########
`;
        }

        // --- API 请求 ---
        const response = await fetch(`${url}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({
                model: model,
                messages: [{ role: "user", content: prompt }],
                temperature: 1.0
            })
        });

        if (!response.ok) throw new Error(`API请求失败`);
        const data = await response.json();
        let rawContent = data.choices[0].message.content;

// ==========================================
// ★★★ 修复版：智能切割 + 杜绝空对话框 ★★★
// ==========================================
const splitDialogueByPunctuation = (lines) => {
    let result = [];
    lines.forEach(line => {
        line = line.trim();
        if (!line) return; // 过滤空行

        let speakerPrefix = "";
        let content = line;

        // 1. 尝试提取发言人
        if (line.match(/[:：]/)) {
            const parts = line.split(/[:：]/);
            // 只有当前缀较短时才认为是名字
            if (parts[0].length < 10) {
                const potentialName = parts[0].trim();
                const potentialContent = parts.slice(1).join("：").trim();
                
                // 【核心修复】只有当冒号后面真的有内容时，才提取名字
                // 如果是 "伙伴：" 这种空内容，直接视为无效行或纯旁白
                if (potentialContent.length > 0) {
                    speakerPrefix = potentialName + "：";
                    content = potentialContent;
                } else {
                    // 只有名字没有内容，跳过此行，防止出现“只有名字的空框”
                    return;
                }
            }
        }

        // 2. 按标点符号切分
        // 解释：将 句号/感叹号/问号/省略号 及其紧跟的闭合符号 视为一个整体
        const segments = content
            .replace(/([。！？…]+)([”’"'\)\]】）]*)/g, "$1$2<SPLIT>") 
            .split('<SPLIT>')
            .map(s => s.trim())
            .filter(s => s.length > 0); // 【核心修复】过滤切分后产生的空字符串

        // 3. 重组
        if (segments.length === 0) {
            // 如果没有标点（比如一句话没说完），保留原样
            if (content) result.push(speakerPrefix + content);
        } else {
            segments.forEach(seg => {
                // 确保每一小段都带上名字
                result.push(speakerPrefix + seg);
            });
        }
    });
    return result;
};

        // 过滤玩家发言工具
        const filterPlayerLines = (lines) => {
            return lines.filter(line => {
                if (line.includes(':') || line.includes('：')) {
                    const parts = line.split(/[:：]/);
                    const speaker = parts[0].trim();
                    if (speaker === p1RealName || speaker === p1GameName || speaker === '我' || speaker === '玩家') {
                        return false; 
                    }
                }
                return true;
            });
        };

        // ==========================================
        // 4. 清洗与解析
        // ==========================================
        let content = rawContent
            .replace(/\*\*/g, '')
            .replace(/```\w*/g, '')
            .replace(/[\[\]【】]/g, '') 
            .trim();

        console.log(`第${idx+1}关生成原文:`, content);

        const getSection = (tag) => {
            if (!content.includes(tag)) return null;
            let parts = content.split(tag);
            if (parts.length < 2) return null;
            let section = parts[1];
            const knownTags = ['#META_DATA#',
  '#GRAND_PLOT#', '#STORY_OPENING#', '#STORY_POINTS#', '#STORY_ENDING#', '#MAP_BLOCK#'];
            let minIndex = section.length;
            knownTags.forEach(t => {
                if (t === tag) return;
                let idx = section.indexOf(t);
                if (idx !== -1 && idx < minIndex) minIndex = idx;
            });
            return section.substring(0, minIndex).trim();
        };
        
                // --- 解析元数据 (新功能) ---
        let aiMonsterName = null;
        let aiBossName = null;
        let aiColors = null;

        const metaText = getSection('#META_DATA#');
        if (metaText) {
            const lines = metaText.split('\n');
            lines.forEach(line => {
                if (line.includes('小怪名称')) aiMonsterName = line.split(/[:：]/)[1]?.trim();
                if (line.includes('BOSS名称')) aiBossName = line.split(/[:：]/)[1]?.trim();
                
                // 颜色解析
                if (!aiColors) aiColors = {};
                if (line.includes('墙壁颜色')) aiColors.wall = line.match(/#[0-9a-fA-F]{3,6}/)?.[0];
                if (line.includes('地面颜色')) aiColors.floor = line.match(/#[0-9a-fA-F]{3,6}/)?.[0];
            });
        }
        
        // 校验颜色，如果 AI 没生成有效的，则设为 null 以触发兜底
        if (aiColors && (!aiColors.wall || !aiColors.floor)) aiColors = null;

        // --- 解析大纲 ---
        const plotText = getSection('#GRAND_PLOT#');
        if (plotText) {
            this.randomMapData.grandPlot = plotText.split('\n').filter(l => l.trim().length > 2);
        }

        // --- 解析开场 (应用断句 + 过滤) ---
        let openingText = getSection('#STORY_OPENING#');
        if (!openingText && !content.includes('#')) openingText = content; 
        
        let openingStories = openingText 
            ? openingText.split(/\n|\|/).map(s => s.trim()).filter(s => s.length > 1) 
            : ["(周围很安静...)"];

        // 1. 先按标点细分
        openingStories = splitDialogueByPunctuation(openingStories);
        // 2. 再过滤玩家发言 (这样如果玩家说了三句话，三句都会被删掉)
        openingStories = filterPlayerLines(openingStories);
        
        if (openingStories.length === 0) openingStories.push("(你们静静地看着前方...)");

        // --- 解析剧情点 (不应用断句，因为剧情点通常只需一句话) ---
        const pointsText = getSection('#STORY_POINTS#');
        let pointStories = [];
        if (pointsText) {
        const rawPoints = pointsText.split('===SEP===')
                .map(s => s.trim())
                .filter(s => s.length > 2);
        pointStories = rawPoints.map(rawText => {
                // 先按换行符拆一下，防止AI没用标点但用了换行
                let lines = rawText.split(/\n|\|/);
                // 应用智能切分
                let processed = splitDialogueByPunctuation(lines);
                // 应用玩家禁言过滤 (保持一致性)
              return filterPlayerLines(processed);
            });          
        }

        // --- 解析结局 (应用断句) ---
        const endingText = getSection('#STORY_ENDING#');
        let endingStories = [];
        if (endingText) {
            let rawEnding = endingText.split(/\n|\|/).map(s => s.trim()).filter(s => s.length > 1);
            // 结局应用断句
            endingStories = splitDialogueByPunctuation(rawEnding);
        }

        // --- 解析地图 (不变) ---
        let mapLines = [];
        const mapText = getSection('#MAP_BLOCK#');
        
        if (idx === 0) {
            mapLines = ["#######","#S....#","#.....#","#.....#","#.....#","#.....#","#.....#","#....E#","#######"];
        } else if (idx === 4) {
            mapLines = ["#################","#...............#","#P..............#","#...............#","#...............#","#......B........#","#...............#","#...............#","#...............#","#################"];
        } else {
            // 解析 AI 地图
            if (mapText) mapLines = mapText.split('\n').map(l => l.trim()).filter(l => l.length >= 5);
            
// ★质量检测（加强版）★
let isValid = true;
if (mapLines.length < 9) { // 至少要有 9 行
    console.warn("地图行数不足，丢弃");
    isValid = false;
} else {
    const fullStr = mapLines.join('');
    
    // 1. 检查必要元素是否存在
    if (!fullStr.includes('E') || !fullStr.includes('P')) {
        console.warn("缺少出口(E)或入口(P)，丢弃");
        isValid = false;
    }
    
    // 2. 检查 T 点数量（必须有至少 3 个）
    const tCount = (fullStr.match(/T/g) || []).length;
    if (tCount < 3) {
        console.warn(`剧情点不足(${tCount}/3)，丢弃`);
        isValid = false;
    }
    
    // 3. 检查墙壁数量（防止空房间）
    const wallCount = (fullStr.match(/#/g) || []).length;
    const totalCells = mapLines.length * (mapLines[0]?.length || 0);
    const wallRatio = wallCount / totalCells;
    
    // 墙壁占比应该在 35%-60% 之间（既不能太空，也不能太挤）
    if (wallRatio < 0.35 || wallRatio > 0.6) {
        console.warn(`墙壁占比异常(${(wallRatio*100).toFixed(1)}%)，丢弃`);
        isValid = false;
    }
    
    // 4. 检查是否有内部墙壁（不是纯空房间）
    // 去掉四周边框后，内部还应该有墙
    const innerLines = mapLines.slice(1, -1).map(line => line.slice(1, -1));
    const innerWalls = innerLines.join('').split('#').length - 1;
    if (innerWalls < 10) {
        console.warn("内部结构太简单（空房间），丢弃");
        isValid = false;
    }
}

// 如果无效，使用默认地图
if (!isValid) {
    console.warn("使用默认备用地图");
    mapLines = this.getDefaultRandomMap(idx);
}
            // 确保连通性 (防止AI画了墙把路堵死)
            try { mapLines = this.ensureMapConnectivity(mapLines); } catch (e) {}
        }

        // ==========================================
        // 5. 应用数据并加载 (不变)
        // ==========================================
        this.randomMapData.mapStories[idx] = {
            opening: openingStories,
            points: pointStories,
            ending: endingStories
        };
        this.randomMapData.usedPointIndices = [];

        // 决定怪物名字 (优先 AI，失败则回退)
        const fallbackNames = this.getThemeMonsterName(theme, idx);
        const finalMonsterName = aiMonsterName || fallbackNames.normal;
        const finalBossName = aiBossName || fallbackNames.boss;

        // 决定颜色 (优先 AI，失败则回退)
        const finalColors = aiColors || this.getRandomColors();
                const newLevel = {
            id: `random${idx}`,
            name: (idx === 4) ? `${theme}·终` : (idx === 0 ? `${theme}·序` : `${theme}·${idx+1}`),
            type: 'random',
            intro: openingStories[0], 
            colors: finalColors, // 应用颜色
            enemyPool: (idx === 0) ? null : { 
                name: finalMonsterName, // 应用小怪名
                hp: 50 + idx * 20, atk: 10 + idx * 5, lv: 2 + idx * 2, xp: 50 
            },
            map: mapLines
        };

        if (idx === 4) {
            newLevel.boss = { 
                name: finalBossName, // 应用BOSS名
                hp: 800, atk: 45, lv: 15 
            };
        }

        const homeIdx = this.LEVELS.findIndex(lv => lv.type === 'home');
        let insertIdx = (homeIdx !== -1) ? homeIdx + 1 : this.LEVELS.length;
        for (let i = this.LEVELS.length - 1; i > homeIdx; i--) {
            if (this.LEVELS[i].type === 'random') { insertIdx = i + 1; break; }
        }
        
        const existingIdx = this.LEVELS.findIndex(lv => lv.id === `random${idx}`);
        if (existingIdx !== -1) this.LEVELS[existingIdx] = newLevel;
        else this.LEVELS.splice(insertIdx, 0, newLevel);

        this.loadLevel(this.LEVELS.findIndex(lv => lv.id === `random${idx}`), 'start');
        this.resize(); this.updateCamera(true); this.draw(); 
        if (!this.isRunning) this.start();

    } catch (e) {
        console.error('地图生成错误:', e);
        this.hideTeleportScreen();
        showToast('生成失败: ' + e.message);
        throw e;
    }
}

// 【修复3】新增：随机获取地图配色方案
getRandomColors() {
    const palettes = [
        { floor: "#27ae60", wall: "#1e824c" }, // 森林绿
        { floor: "#95a5a6", wall: "#7f8c8d" }, // 废墟灰
        { floor: "#e67e22", wall: "#d35400" }, // 火焰红
        { floor: "#3498db", wall: "#2980b9" }, // 冰霜蓝
        { floor: "#9b59b6", wall: "#8e44ad" }, // 毒沼紫
        { floor: "#f1c40f", wall: "#f39c12" }, // 沙漠黄
        { floor: "#1abc9c", wall: "#16a085" }, // 翡翠青
        { floor: "#34495e", wall: "#2c3e50" }  // 深渊黑
    ];
    return palettes[Math.floor(Math.random() * palettes.length)];
}




// 【修复5】新增：根据主题获取怪物名称
getThemeMonsterName(theme, idx) {
    // 简单的关键词映射
    const suffix = ["团", "球", "羽毛", "花", "琉璃"];
    const bossSuffix = ["领主", "魔龙", "巨神", "女王", "霸主"];
    
    // 如果没有主题，给个默认
    if (!theme) theme = "迷之";
    
    // 截取前两个字作为前缀，防止名字太长
    const prefix = theme.substring(0, 2);
    
    // 伪随机选择后缀
    const nIdx = (theme.length + idx) % suffix.length;
    const bIdx = (theme.length + idx + 1) % bossSuffix.length;
    
    return {
        normal: `${prefix}${suffix[nIdx]}`,
        boss: `${prefix}${bossSuffix[bIdx]}`
    };
}



// 【修复2】支持自定义文本和主题（light=白底, dark=黑底）
showTeleportScreen(customText, theme = 'dark') {
    const screen = document.getElementById('rpg-teleport-screen');
    if (!screen) return;
    
    screen.classList.add('active');
    
    // 设置主题类
    if (theme === 'light') {
        screen.classList.add('light-theme');
    } else {
        screen.classList.remove('light-theme');
    }
    
    // 设置提示文本
    const textEl = screen.querySelector('.rpg-teleport-text');
    if (textEl) {
        const msg = customText || "正在传送进入新世界";
        textEl.innerHTML = `${msg}<span class="rpg-teleport-dots" id="rpg-teleport-dots">...</span>`;
    }

    // 粒子效果（仅在 dark 模式下显示，CSS控制）
    const particlesContainer = document.getElementById('rpg-teleport-particles');
    if (particlesContainer && theme === 'dark') {
        particlesContainer.innerHTML = ''; 
        for (let i = 0; i < 30; i++) {
            const particle = document.createElement('div');
            particle.className = 'rpg-particle';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.animationDelay = Math.random() * 3 + 's';
            particle.style.animationDuration = (2 + Math.random() * 2) + 's';
            particlesContainer.appendChild(particle);
        }
    } else if (particlesContainer) {
        particlesContainer.innerHTML = ''; // light 模式清空粒子
    }
    
    // 动画点
    let dotCount = 0;
    const dotsEl = document.getElementById('rpg-teleport-dots');
    if (dotsEl) {
        if (this.teleportInterval) clearInterval(this.teleportInterval);
        this.teleportInterval = setInterval(() => {
            dotCount = (dotCount + 1) % 4;
            dotsEl.textContent = '.'.repeat(dotCount || 1);
        }, 500);
    }
}

// 【新增】隐藏传送黑屏
hideTeleportScreen() {
    const screen = document.getElementById('rpg-teleport-screen');
    if (screen) {
        screen.classList.remove('active');
    }
    
    // 清除动画定时器
    if (this.teleportInterval) {
        clearInterval(this.teleportInterval);
        this.teleportInterval = null;
    }
}

// 【新增】获取默认随机地图（备用方案）
getDefaultRandomMap(idx) {
    const maps = [
        ["###########",
            "#P.......E#",
            "#...M.T...#",
            "#.........#",
            "#..T.M....#",
            "#.........#",
            "#.........#",
            "#.....T...#",
            "#.........#",
            "#.........#",
            "###########"],
        [
            "###########",
            "#P.......E#",
            "#...M.T...#",
            "#.........#",
            "#..T.M....#",
            "#.........#",
            "#.........#",
            "#.....T...#",
            "#.........#",
            "#.........#",
            "###########"
        ],
        [
            "###########",
            "#P.......E#",
            "#.M.T.M...#",
            "#.........#",
            "#..T......#",
            "#...T.....#",
            "#.........#",
            "#.........#",
            "#.........#",
            "#.........#",
            "###########"
        ],
        [
            "###########",
            "#P.......E#",
            "#.M...M...#",
            "#...T.T...#",
            "#.........#",
            "#.........#",
            "#.........#",
            "#.......T.#",
            "#.........#",
            "#.........#",
            "###########"
        ],
        [
            "###########",
            "#P.......E#",
            "#...M.....#",
            "#....B....#",
            "#...M.....#",
            "#.........#",
            "#.........#",
            "#.........#",
            "#.........#",
            "#.........#",
            "###########"
        ]
    ];
    return maps[Math.min(idx, maps.length - 1)];
}

// 【修复】进入下一张随机地图
// 【修复版】进入下一张随机地图 (带锁、回滚、推人逻辑)
async proceedToNextRandomMap() {
    // 1. 【锁】如果正在生成中，直接无视后续触发
    if (this.isGenerating) return;
    this.isGenerating = true;

    // 2. 乐观更新索引
    this.randomMapData.currentMapIndex++;
    
    
    // 检查是否全部通关
    if (this.randomMapData.currentMapIndex >= 5) {
        showToast('冒险圆满结束！');
        const homeIdx = this.LEVELS.findIndex(lv => lv.type === 'home');
        this.loadLevel(homeIdx, 'start');
        this.isGenerating = false;
        return;
    }

    try {
        // 3. 显示传送特效
        this.showTeleportScreen("正在进入下一个区域", 'light');
        
        // 4. 执行生成 (等待结果)
        await this.generateNextRandomMap();
        
        // 5. 成功后延迟关闭特效
        setTimeout(() => {
            this.hideTeleportScreen();
            this.isGenerating = false;
        }, 800);

    } catch (e) {
        // ==========================================
        // 【核心修复】失败回滚机制
        // ==========================================
        console.warn("生成失败，执行回滚操作");
        
        // 1. 索引回退 (恢复到上一关)
        this.randomMapData.currentMapIndex--;
        
        // 2. 关闭特效
        this.hideTeleportScreen();
        
        // 3. 玩家后退一步 (防止站在出口上无限触发)
        // 假设出口是 E，玩家在 E 上。简单的处理是根据朝向反向移动，或者固定 x-1
        // 这里简单粗暴地让玩家 x-1 (通常迷宫出口在右边，往左推一步通常是安全的)
        if (this.p1.x > 1) this.p1.x -= 1;
        this.p2.x = this.p1.x;
        this.p2.y = this.p1.y;
        
        // 4. 更新画面
        this.updateCamera(true);
        this.draw();
        
        // 5. 恢复游戏循环
        this.isGenerating = false;
        this.resume();
        
        showToast('生成失败，请稍后重试');
    }
}

// 【新增】触发剧情点
triggerStoryPoint(point) {
    if (this.curLv.type !== 'random') return;
    
    const mapId = this.curLv.id;
    const mapState = this.randomMapData.mapStates[mapId];
    const pointKey = `${point.x},${point.y}`;
    
    // 【关键】防止重复触发
    if (!mapState || mapState.triggered.has(pointKey)) return;

    // 1. 记录触发状态（只记录在当前地图的 Set 里）
    mapState.triggered.add(pointKey);

    // 2. 计算当前地图的触发进度
    const currentMapCount = mapState.triggered.size;

    // 3. 停止移动和隐藏UI
    rpgInput.x = 0; rpgInput.y = 0;
    this.p1.step = 0; this.p2.step = 0;
    const controls = document.getElementById('rpg-controls');
    const menuBtn = document.getElementById('rpg-menu-toggle-btn');
    if (controls) controls.style.display = 'none';
    if (menuBtn) menuBtn.style.display = 'none';

    // 4. 准备剧情播放
    this.state = this.STATE.STORY;
    this.storyQueue = []; 
    
    const idx = this.randomMapData.currentMapIndex;
    const storyData = this.randomMapData.mapStories[idx];
    const pointStories = storyData?.points || [];
    
    let linesToPlay = [];

    if (pointStories.length === 0) {
        linesToPlay = ["发现了奇怪的痕迹..."];
    } else {
        if (!this.randomMapData.usedPointIndices) this.randomMapData.usedPointIndices = [];
        let storyIndex = this.randomMapData.usedPointIndices.length;
        if (storyIndex >= pointStories.length) storyIndex = Math.floor(Math.random() * pointStories.length);
        else this.randomMapData.usedPointIndices.push(storyIndex);
        
        const content = pointStories[storyIndex];
        linesToPlay = Array.isArray(content) ? content : [content];
    }
    
    linesToPlay.forEach(line => {
        let speaker = "";
        let content = line;
        if (line.includes('：') || line.includes(':')) {
            const parts = line.split(/[：:]/);
            if (parts.length >= 2 && parts[0].length < 10) {
                speaker = parts[0].trim();
                content = parts.slice(1).join('：').trim();
            }
        }
        this.storyQueue.push({ name: speaker, text: content });
    });

    // 5. 【核心】如果集齐3个，追加解锁提示
    if (currentMapCount === 3) {
        this.storyQueue.push({ name: "", text: "（随着光芒汇聚，通往下一区域的入口出现了！）" });
        this.storyQueue.push({ name: "", text: "出口好像打开了！" });
    } else {
        this.storyQueue.push({ name: "", text: `（已收集线索 ${currentMapCount}/3）` });
    }
    
    // 6. 开始播放
    this.nextStory(); 
}


// 【修复1】新增：检查剧情点特殊事件（防止未定义报错导致卡死）
checkStoryPointEvent(point) {
    // 暂时留空，防止报错
    // 这里未来可以扩展：比如踩到特定点获得道具、回血等
    console.log(`触发剧情点坐标: ${point.x}, ${point.y}`);
}



    startBattle(mapEntity) {
    if (mapEntity.isDefeated) return;
    
    // 1. 强制关闭自动战斗状态
    this.isAutoBattle = false;
    
    // 2. 隐藏“停止自动”按钮
    const stopBtn = document.getElementById('rpg-auto-battle-btn');
    if (stopBtn) stopBtn.style.display = 'none';
        this.state = this.STATE.BATTLE_CMD;
        this.battleEnemies = [];
        this.battleMapEntity = mapEntity; // 记录触发战斗的地图实体，用于胜利后删除
        
        let count = mapEntity.type === 'boss' ? 1 : Math.floor(Math.random() * 3) + 1;
        let template = mapEntity.type === 'boss' ? this.curLv.boss : this.curLv.enemyPool;
        
        // 确定怪物贴图类型
        let mType = 0;
        if (template.name === '石像鬼') mType = 1;
        if (template.name === '魔王' || template.name === '黑骑士') mType = 2;

        for(let i=0; i<count; i++) {
            let e = new RpgEntity(template.name, { monsterType: mType }, "enemy");
            // 如果是BOSS，强制类型设为 boss，方便掉落表识别
            if (mapEntity.type === 'boss') e.type = 'boss'; 
            
            e.hp = template.hp; e.maxHp = template.hp;
            e.atk = template.atk; e.xp = 20; e.lv = template.lv || 1;
            this.battleEnemies.push(e);
        }

        // 【关键修复】创建一份敌人列表的备份，用于结算掉落
        // 因为战斗中 battleEnemies 里的怪死一个少一个，结算时就没了
        this.allBattleEnemiesCache = [...this.battleEnemies];
        
         // 隐藏地图UI
    document.getElementById('rpg-controls').style.display = 'none';
    const menuBtn = document.getElementById('rpg-menu-toggle-btn');
    if(menuBtn) menuBtn.style.display = 'none';

    
    const titleEl = document.getElementById('rpg-header-title');
    if (titleEl) {
        // 如果是多个怪物，显示 "怪物名 x数量"，如果是单个则显示 "怪物名 LV.xx"
        if (count > 1) {
            titleEl.innerText = `${template.name} x${count} (LV.${template.lv})`;
        } else {
            titleEl.innerText = `${template.name} LV.${template.lv}`;
        }
        // 可选：战斗时标题变红，增加紧张感
        
    }

    this.showBottomDialog("", `遭遇了 ${this.battleEnemies.length} 个敌人！`);
    
    // 1秒后开始玩家回合
    setTimeout(() => this.playerTurn(), 1000);
}
    
// 【修改版】绘制战斗模式：稳重的墙壁背景 + 动感倾斜地面
drawBattleMode() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const TILE_SIZE = 64;

    // 获取颜色
    const wallColor = this.curLv?.colors?.wall || "#222";
    const floorColor = this.curLv?.colors?.floor || "#333";

    // 定义分界线 (左低右高)
    const leftY = h * 0.45;
    const rightY = h * 0.10;

    // 计算倾斜角度
    const angle = Math.atan2(rightY - leftY, w);

    // ==========================================
    // 1. 绘制墙壁 (静态背景，不旋转)
    // ==========================================
    // 直接填充全屏作为底色，这就相当于墙壁
    this.ctx.fillStyle = wallColor;
    this.ctx.fillRect(0, 0, w, h);

    // 可选：给墙壁加一个简单的渐变阴影，让它像一面墙而不是纯色块
    // 从上到下变暗一点，模拟室内光照
    const gradient = this.ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(0.6, "rgba(0,0,0,0.3)"); // 接近地面处变暗
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, w, h);

    // ==========================================
    // 2. 绘制地面 (旋转坐标系)
    // ==========================================
    this.ctx.save();

    // A. 设置旋转支点 (分界线左侧)
    this.ctx.translate(0, leftY);
    this.ctx.rotate(angle);

    // B. 计算覆盖范围
    const extra = 4; 
    const rotatedCols = Math.ceil(w / TILE_SIZE) + extra;
    const rotatedRowsBot = Math.ceil(h / TILE_SIZE) + extra;

    const totalW = (rotatedCols + extra) * TILE_SIZE;
    const startX = -extra * TILE_SIZE;

    // C. 地面“底漆” (填补旋转产生的缝隙)
    this.ctx.fillStyle = floorColor;
    // 只画 y >= 0 的部分 (即分界线以下)
    this.ctx.fillRect(startX, 0, totalW, rotatedRowsBot * TILE_SIZE);

    // D. 地面纹理 (只画地面！)
    for (let r = 0; r < rotatedRowsBot; r++) {
        for (let c = -extra; c < rotatedCols; c++) {
            // 绘制地面纹理
            this.drawTexturedTile(this.ctx, c * TILE_SIZE, r * TILE_SIZE, c + 10, r + 10, TILE_SIZE, 'floor', floorColor);
        }
    }

    // E. 绘制分界线 (加强地面和墙壁的分割感)
    this.ctx.lineWidth = 4;
    this.ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    this.ctx.beginPath();
    this.ctx.moveTo(-TILE_SIZE * extra, 0); // 在旋转坐标系里，这是水平线
    this.ctx.lineTo(w + TILE_SIZE * extra, 0);
    this.ctx.stroke();

    this.ctx.restore(); // 恢复坐标系

    // ==========================================
    // 3. 绘制角色 (带透视位置)
    // ==========================================
    
    const enemyStartX = w * 0.65;
    const enemyStartY = h * 0.30; 
    
    const p1X = w * 0.25;      
    const p1Y = h * 0.60; 
    
    const p2X = w * 0.10;      
    const p2Y = h * 0.55; 

    let renderList = [];

    this.battleEnemies.forEach((e, i) => {
        let ex = enemyStartX + (i % 2) * 50; 
        let ey = enemyStartY + Math.floor(i / 2) * 60 + (i * 10);
        renderList.push({ type: 'unit', entity: e, x: ex, y: ey });
    });

    renderList.push({ type: 'unit', entity: this.p1, x: p1X, y: p1Y });
    renderList.push({ type: 'unit', entity: this.p2, x: p2X, y: p2Y });

    renderList.sort((a, b) => a.y - b.y);

    renderList.forEach(item => {
        this.drawBattleUnit(item.entity, item.x, item.y);
    });
    
    // ==========================================
    // 4. 绘制光标
    // ==========================================
    if (this.state === this.STATE.BATTLE_TARGET) {
        let t = this.targets[this.targetIndex];
        let tx = 0, ty = 0;
        
        if (this.battleEnemies.includes(t)) {
            let i = this.battleEnemies.indexOf(t);
            tx = enemyStartX + (i % 2) * 50 + 32; 
            ty = enemyStartY + Math.floor(i / 2) * 60 + (i * 10);
        } else {
            if (t === this.p1) { tx = p1X + 32; ty = p1Y; } 
            else { tx = p2X + 32; ty = p2Y; }
        }
        this.drawMarker(tx, ty - 20);
    }
}

// 【修复1】切换自动战斗逻辑更新
toggleAutoBattle(enable) {
    this.isAutoBattle = enable;
    
    const stopBtn = document.getElementById('rpg-auto-battle-btn');
    const battleMenu = document.getElementById('rpg-battle-menu');
    const targetPanel = document.getElementById('rpg-battle-target-panel');
    
    if (this.isAutoBattle) {
        // 开启自动
        if (stopBtn) stopBtn.style.display = 'block';
        if (battleMenu) battleMenu.style.display = 'none';
        if (targetPanel) targetPanel.style.display = 'none';
        
        
        
        // 如果是等待指令状态，立即触发
        if (this.state === this.STATE.BATTLE_CMD) {
            this.playerTurn();
        }
    } else {
        // 关闭自动
        if (stopBtn) stopBtn.style.display = 'none';
        
        
        // 【关键】如果当前处于 AI 思考或等待状态，强制切回手动命令状态
        if (this.state === this.STATE.BATTLE_ANIM && this.activeUnit === this.p1) {
            // 这里配合 playerTurn 里的检查生效
        } else if (this.state === this.STATE.BATTLE_CMD) {
            // 恢复菜单显示
             if (battleMenu) battleMenu.style.display = 'flex';
        }
    }
}

    playerTurn() {
        // 1. 必须先标记当前行动者
        this.activeUnit = this.p1;

        // 2. 执行状态检查，获取报告
        const statusReport = this.checkStatusEffect(this.p1);
        
        // --- 定义一个辅助函数：按顺序播放消息 ---
        const playStatusMessages = (messages, onComplete) => {
            if (messages.length === 0) {
                onComplete();
                return;
            }
            
            // 取出第一条消息
            const msg = messages.shift();
            this.showBottomDialog("", msg); // 使用底部对话框
            
            // 1.5秒后播放下一条，或者结束
            setTimeout(() => {
                playStatusMessages(messages, onComplete);
            }, 800);
        };

        // --- 开始执行回合逻辑 ---
        
        // 先播放状态消息（如果有）
        playStatusMessages(statusReport.msgs, () => {
            
            // 消息播放完毕后的回调...
            
            // 情况A: 被状态弄死了
            if (statusReport.isDead) {
                this.nextTurn();
                return;
            }

            // 情况B: 被眩晕（无法行动）
            if (statusReport.skip) {
                // 这里不需要再弹窗了，因为刚才的消息里已经包含了 "无法行动"
                // 直接延迟一下进入下一回合，给玩家一点反应时间
                setTimeout(() => {
                    
                    this.nextTurn();
                }, 500);
                return;
            }
            


            // === 下面是原本的手动/自动战斗逻辑 ===
            
            if (this.isAutoBattle) {
                this.state = this.STATE.BATTLE_ANIM;
                document.getElementById('rpg-battle-menu').style.display = 'none';
                document.getElementById('rpg-battle-target-panel').style.display = 'none';
                
                setTimeout(() => {
                    if (!this.isAutoBattle) {
                         this.state = this.STATE.BATTLE_CMD;
                         document.getElementById('rpg-battle-menu').style.display = 'flex';
                         this.showBottomDialog(this.p1.name, "自动已停止，请指示。");
                         return;
                    }
                    
                    let target = null;
                    let action = 'attack';
                    const lowHpAlly = this.battleTeam.find(a => a.hp > 0 && a.hp < a.maxHp * 0.4);
                    const canHeal = this.p1.mp >= 5;
                    
                    if (lowHpAlly && canHeal && Math.random() < 0.3) {
                        action = 'heal'; target = lowHpAlly;
                    } else {
                        action = 'attack';
                        const enemies = this.battleEnemies.sort((a,b) => a.hp - b.hp);
                        if (enemies.length > 0) target = enemies[0];
                    }
                    
                    if (target) this.executeAction(this.p1, target, action);
                    else this.nextTurn();
                }, 800);
                return;
            }
            
            // 手动操作界面
            this.showBottomDialog(this.p1.name, "该我行动了。");
            this.state = this.STATE.BATTLE_CMD;
            document.getElementById('rpg-battle-menu').style.display = 'flex';
            document.getElementById('rpg-battle-target-panel').style.display = 'none';
        });
    }

// 【重写】检查状态（返回是否跳过回合，并处理视觉效果）
    checkStatusEffect(actor) {
        let skipTurn = false;
        let messages = []; // 存储这一轮状态结算的所有文本

        // 复制一份 keys 防止遍历时修改出错
        const statusIds = Object.keys(actor.status || {});
        
        statusIds.forEach(statusId => {
            const turns = actor.status[statusId];
            const config = RPG_STATUS_CONFIG[statusId];
            
            if (!config) {
                delete actor.status[statusId];
                return;
            }

            const effect = config.effect;
            let subMsgs = [];

            // 1. 处理伤害/治疗
            let damage = 0;
            if (effect.damage_pct) damage += Math.floor(actor.maxHp * effect.damage_pct);
            if (effect.damage_val) damage += effect.damage_val;

            if (damage > 0) {
                actor.hp -= damage;
                if (effect.shake) actor.shake = 20;
                subMsgs.push(`受到${damage}伤害`);
            }

            // 2. 处理行动限制
            if (effect.can_move === false) {
                skipTurn = true;
                subMsgs.push("无法行动！");
            }

            // 生成第一条消息：例如 "勇者 中毒 受到10伤害"
            if (subMsgs.length > 0) {
                messages.push(`${actor.name} ${config.name} ${subMsgs.join('，')}`);
            }

            // 3. 扣减回合数
            actor.status[statusId]--;
            
            // 4. 处理状态解除
            if (actor.status[statusId] <= 0) {
                delete actor.status[statusId];
                 if (effect.can_move === false) {
                    actor.pendingRecovery.push(config.name);
                } else {
                messages.push(`${actor.name} 的 ${config.name} 状态解除了。`);
                }
            }
        });
        


        // 如果状态导致死亡，强制跳过
        if (actor.hp <= 0) return { skip: true, msgs: messages, isDead: true };

        return { skip: skipTurn, msgs: messages, isDead: false };
    }



    inputBattleCommand(cmd) {
        this.currentAction = cmd;
        this.state = this.STATE.BATTLE_TARGET;
        document.getElementById('rpg-battle-menu').style.display = 'none';
        document.getElementById('rpg-battle-target-panel').style.display = 'flex';
        this.targets = (cmd === 'attack') ? this.battleEnemies : this.battleTeam;
        this.targetIndex = 0;
        this.showBottomDialog(this.p1.name, cmd === 'attack' ? "攻击谁？" : "治疗谁？");
    }

    moveTargetCursor(dir) {
        if (this.state !== this.STATE.BATTLE_TARGET) return;
        this.targetIndex += dir;
        if (this.targetIndex < 0) this.targetIndex = this.targets.length - 1;
        if (this.targetIndex >= this.targets.length) this.targetIndex = 0;
    }
    
    confirmTarget() {
        if (this.state !== this.STATE.BATTLE_TARGET) return;
        let target = this.targets[this.targetIndex];

        if (this.currentAction === 'heal' && target.hp <= 0) {
            this.showBottomDialog(this.p1.name, "没救了...");
            return;
        }

        this.executeAction(this.p1, target, this.currentAction);
        document.getElementById('rpg-battle-target-panel').style.display = 'none';
    }
    
    cancelTarget() {
        if (this.state !== this.STATE.BATTLE_TARGET) return;
        
        // 【新增】如果取消了物品使用，清空 pendingItemId
        if (this.currentAction === 'item') {
            this.pendingItemId = null;
        }

        this.state = this.STATE.BATTLE_CMD;
        document.getElementById('rpg-battle-target-panel').style.display = 'none';
        document.getElementById('rpg-battle-menu').style.display = 'flex';
        this.showBottomDialog(this.p1.name, "请下达指令。");
    }

    // 辅助函数：随机获取一句战斗台词
    getBattleBark(type) {
        if (!this.p2.customData || !this.p2.customData.dialogues) return null;
        const lines = this.p2.customData.dialogues[type];
        if (lines && lines.length > 0) {
            return lines[Math.floor(Math.random() * lines.length)];
        }
        return null;
    }

    executeAction(actor, target, action) {
        this.state = this.STATE.BATTLE_ANIM;
        
        // MP 检查 (保持不变)
        if (action === 'heal' && actor.mp < 5) {
            this.showBottomDialog(actor.name, "MP不足！");
            setTimeout(() => this.nextTurn(), 1000);
            return;
        }

        // --- 1. 决定台词与时机 (保持不变) ---
        let bark = null;
        let timing = 'after'; 

        if (this.p2.customData && this.p2.customData.dialogues) {
            const dialogs = this.p2.customData.dialogues;
            if (actor === this.p2) {
                timing = 'before';
                if (action === 'attack') bark = this.getRandomLine(dialogs.atk);
                if (action === 'heal') bark = this.getRandomLine(dialogs.heal);
                // 物品台词暂时复用治疗的
                if (action === 'item') bark = this.getRandomLine(dialogs.heal); 
            } else if (target === this.p2) {
                timing = 'after';
                if (action === 'heal' || action === 'item') bark = this.getRandomLine(dialogs.healed);
            }
        }

        // --- 2. 封装动作逻辑 (修改这里) ---
        const performAction = () => {
            let msg = "";
            
            if (action === 'attack') {
                // ... (攻击逻辑保持不变)
                let dmg = Math.floor(actor.atk * (1 + Math.random()*0.2));
                target.hp -= dmg; target.shake = 20; 
                msg = `造成 ${dmg} 点伤害！`;
                if(actor.type === 'enemy') this.showTopDialog(actor.name, "攻击！");
                else this.showBottomDialog(actor.name, msg);

            } else if (action === 'heal') {
                // ... (治疗逻辑保持不变)
                actor.mp -= 5;
                let heal = 30 + actor.lv * 10;
                target.hp = Math.min(target.maxHp, target.hp + heal);
                msg = `恢复 ${heal} 点HP！`;
                this.showBottomDialog(actor.name, msg);

            // ... (前略，在 performAction 函数内部)

            } else if (action === 'item') {
                const itemId = this.pendingItemId;
                const item = RPG_ITEMS[itemId];
                
                if (this.inventory[itemId] > 0) {
                    this.inventory[itemId]--; 
                    
                    msg = `使用了 ${item.name}`;
                    
                    if (item.effect) {
                        switch (item.effect.type) {
                            case 'heal_hp':
                                // 确保数值被正确更新
                                target.hp = Math.min(target.maxHp, target.hp + item.effect.val);
                                msg += `，恢复了${item.effect.val}HP`;
                                break;
                            case 'heal_mp':
                                target.mp = Math.min(target.maxMp, target.mp + item.effect.val);
                                msg += `，恢复了${item.effect.val}MP`;
                                break;
                            case 'revive':
                                if (target.hp <= 0) {
                                    target.hp = Math.floor(target.maxHp * item.effect.val);
                                    msg = `复活了 ${target.name}!`;
                                } else {
                                    msg += " (没有效果)";
                                }
                                break;
                            case 'flee':
                                this.showBottomDialog(actor.name, "溜了溜了！");
                                this.pendingItemId = null;
                                setTimeout(() => this.battleWin(), 1000); 
                                return; 
                            case 'cure_all':
                                target.status = {};
                                msg += "，状态已净化！";
                                break;
                        }
                    }
                    this.showBottomDialog(actor.name, msg);
                    this.pendingItemId = null; 
                    
                    // 【关键修复】物品使用完必须调用 finishTurn，否则游戏会卡住！
                    setTimeout(finishTurn, 1000); 
                } else {
                    // 理论上不会进这里，但为了保险
                    this.showBottomDialog(actor.name, "物品不足！");
                    setTimeout(finishTurn, 1000);
                }
            }
            
            
        };




        // --- 3. 封装结束逻辑 ---
        const finishTurn = () => {
            // 【修正】无论是 enemy 还是 boss，死后都从战斗列表中移除，以触发胜利判断
            if (target.hp <= 0 && (target.type === 'enemy' || target.type === 'boss')) {
                this.battleEnemies = this.battleEnemies.filter(e => e !== target);
            }
            this.nextTurn(); 
        };

        // --- 4. 执行流程 (保持不变) ---
        if (bark && timing === 'before') {
            this.showBottomDialog(this.p2.name, bark);
            setTimeout(() => {
                performAction();
                setTimeout(finishTurn, 1000);
            }, 1200); 
        } else if (bark && timing === 'after') {
            performAction();
            setTimeout(() => {
                this.showBottomDialog(this.p2.name, bark);
                setTimeout(finishTurn, 1200); 
            }, 1000);
        } else {
            performAction();
            setTimeout(finishTurn, 1000);
        }
    }







// --- 辅助工具：从数组中随机取一个 (防止报错卡死) ---
    getRandomLine(arr) {
        if (!arr || !Array.isArray(arr) || arr.length === 0) return null;
        return arr[Math.floor(Math.random() * arr.length)];
    }




    nextTurn() {
        // 1. 检查胜负
        if (this.battleEnemies.length === 0) { this.battleWin(); return; }
        if (this.p1.hp <= 0 && this.p2.hp <= 0) { this.gameOver(); return; }

        // 2. 流程流转逻辑
        if (this.activeUnit === this.p1) {
            // --- P1 回合结束，轮到 P2 ---
            
            // ... inside nextTurn ...
            if (this.p2.hp > 0) {
                this.activeUnit = this.p2; 
                
                // 1. 检查状态
                const statusReport = this.checkStatusEffect(this.p2);
                
                // 2. 播放消息辅助函数 (同上)
                const playMsgs = (msgs, cb) => {
                    if (msgs.length === 0) { cb(); return; }
                    this.showBottomDialog("", msgs.shift());
                    setTimeout(() => playMsgs(msgs, cb), 1000);
                };
                
                // 3. 执行流程
                playMsgs(statusReport.msgs, () => {
                    if (statusReport.isDead || statusReport.skip) {
                        this.activeUnit = null; 
                        setTimeout(() => {
                            
                            this.enemyTurn(0);
                        }, 500);
                        return;
                    }
                    
                    // 正常行动
                    
                    let target = this.battleEnemies[0];
                    let lowHpAlly = this.battleTeam.find(a => a.hp > 0 && a.hp < a.maxHp * 0.4);
                    let action = (lowHpAlly && this.p2.mp >= 5) ? 'heal' : 'attack';
                    if (action === 'heal') target = lowHpAlly;
                    else target = this.battleEnemies[Math.floor(Math.random() * this.battleEnemies.length)];
                    
                    this.executeAction(this.p2, target, action);
                });

            } else {
                // P2 死了
                this.activeUnit = null;
                this.enemyTurn(0);
            }

        } else if (this.activeUnit === this.p2) {
            // --- P2 回合结束，轮到敌人 ---
            this.activeUnit = null; 
            this.enemyTurn(0);
        } 
        // 注意：敌人回合结束切回 P1 的逻辑通常在 enemyTurn 的末尾调用 playerTurn()，不在这里写
    }

    enemyTurn(idx) {
        // 所有敌人行动完毕，切回玩家回合
        if (idx >= this.battleEnemies.length) { 
            if (this.p1.hp > 0) this.playerTurn();
            else if (this.p2.hp > 0) { this.activeUnit = this.p1; this.nextTurn(); }
            return; 
        }
        
        let enemy = this.battleEnemies[idx];
        let aliveTeam = this.battleTeam.filter(t => t.hp > 0);
        if (aliveTeam.length === 0) { this.gameOver(); return; }

        let target = aliveTeam[Math.floor(Math.random() * aliveTeam.length)];
        
        // --- 1. 先显示攻击前摇 (喊话) ---
        this.showTopDialog(enemy.name, "攻击！");
        
        setTimeout(() => {
            // --- 2. 计算伤害并执行抖动 (先受伤) ---
            let dmg = Math.floor(enemy.atk * (0.8 + Math.random()*0.4));
            target.hp -= dmg; 
            target.shake = 20; // <--- 角色在这里抖动

            // --- 3. 施加异常状态 (移到了这里，受伤后才判断) ---
            let statusMsg = ""; // 用来收集触发了什么状态
            Object.keys(RPG_STATUS_CONFIG).forEach(statusId => {
                const config = RPG_STATUS_CONFIG[statusId];
                if (config.apply) {
                    // 概率判定
                    if (Math.random() < config.apply.rate) {
                        // 施加状态 (如果已有该状态，则刷新持续时间)
                        if (!target.status) target.status = {}; // 防止 undefined
                        target.status[statusId] = config.apply.duration;
                        
                        // 记录状态提示语 (如果有的话)
                        if (config.apply.msg) statusMsg += " " + config.apply.msg;
                    }
                }
            });

            // 4. 显示伤害数字 (加上状态提示)
            let displayMsg = "受到 " + dmg + " 伤害。";
            if (statusMsg) displayMsg += statusMsg; // 例如：受到 10 伤害。 中毒了！

            this.showBottomDialog(target.name, displayMsg);
            
            // 5. 检查是否触发 P2 受击台词
            let hurtBark = null;
            if (target === this.p2 && target.hp > 0) { // 没死才说话
                if (this.p2.customData && this.p2.customData.dialogues) {
                    hurtBark = this.getRandomLine(this.p2.customData.dialogues.hurt);
                }
            }

            // 6. 流程控制：下一个敌人
            const proceed = () => {
                if (this.p1.hp <= 0 && this.p2.hp <= 0) { 
                    setTimeout(()=>this.gameOver(), 1000); 
                } else {
                    setTimeout(() => this.enemyTurn(idx+1), 1000);
                }
            };

            if (hurtBark) {
                // 如果有惨叫，延迟显示
                setTimeout(() => {
                    this.showBottomDialog(this.p2.name, hurtBark);
                    setTimeout(proceed, 1200); // 读完惨叫再继续
                }, 1000); // 读完伤害数字
            } else {
                proceed();
            }

        }, 1000); // 攻击前摇结束
    }

    gameOver() {
        this.state = this.STATE.GAME_OVER;
        
        // --- 新增：死亡台词 ---
        const deadLines = this.p2.customData?.dialogues?.dead || [];
        if (deadLines.length > 0) {
            this.showBottomDialog(this.p2.name, this.getRandomLine(deadLines));
        } else {
            this.showBottomDialog("", "全军覆没...");
        }

        // 延迟显示黑屏，让玩家看到遗言
        setTimeout(() => {
            document.getElementById('rpg-game-over-screen').style.display = 'flex';
            this.closeDialogs(); // 关掉对话框
        }, 2000);
    }

// 【新增】新手教程结局（打完魔王后）
triggerTutorialEnding() {
    this.state = this.STATE.STORY;
    this.storyQueue = [];

    // 系统旁白
    this.storyQueue.push({name: "", text: "随着一声巨响，魔王倒下了。"});
    this.storyQueue.push({name: "", text: "笼罩在世界的阴云终于消散。"});

    // 伙伴台词
    const aiEnding = this.p2.customData?.dialogues?.ending || [];
    const fallbackEnding = [
        "呼... 终于结束了。",
        "我们做到了，搭档！",
        "这真是一场伟大的冒险。",
        "不过，冒险才刚刚开始呢。",
        "我们回家吧！"
    ];

    const linesToUse = aiEnding.length >= 5 ? aiEnding : fallbackEnding;

    linesToUse.forEach(text => {
        this.storyQueue.push({name: this.p2.name, text: text});
    });

    // 最终提示
    this.storyQueue.push({name: "", text: "新手教程完成！"});
    this.storyQueue.push({name: "", text: "现在可以探索更多世界了..."});

    // 隐藏战斗UI
    
    document.getElementById('rpg-battle-menu').style.display = 'none';
    document.getElementById('rpg-battle-target-panel').style.display = 'none';
    
    const titleEl = document.getElementById('rpg-header-title');
    if (titleEl) {
        titleEl.innerText = this.curLv.name;
        
    }
    
    // 标记进入家园
    this.isGoingHome = true;
    
    this.nextStory();
}


// --- 新增：触发通关结局 ---
    triggerEnding() {
        this.state = this.STATE.STORY;
        this.isGameClear = true; // 标记当前为通关状态
        this.storyQueue = [];

        // 1. 系统旁白
        this.storyQueue.push({name: "", text: "随着一声巨响，魔王倒下了。"});
        this.storyQueue.push({name: "", text: "笼罩在世界的阴云终于消散。"});

        // 2. 伙伴台词 (优先用AI生成的，如果没有则用默认的)
        const aiEnding = this.p2.customData?.dialogues?.ending || [];
        
        // 默认兜底台词 (5句)
        const fallbackEnding = [
            "呼... 终于结束了。",
            "我们做到了，搭档！",
            "这就去把这个好消息告诉大家。",
            "谢谢你一直保护我。",
            "这真是一场伟大的冒险，我永远不会忘记。",
            "那么... 我们回家吧？"
        ];

        // 如果AI生成的少于5句，就用默认的，保证长度
        const linesToUse = aiEnding.length >= 5 ? aiEnding : fallbackEnding;

        linesToUse.forEach(text => {
            this.storyQueue.push({name: this.p2.name, text: text});
        });

        // 3. 最终系统感谢
        this.storyQueue.push({name: "", text: "【THE END】"});
        this.storyQueue.push({name: "", text: "感谢游玩 Eternal Legend！"});

        // 隐藏战斗UI，开始播放剧情
        document.getElementById('rpg-battle-info').style.display = 'none';
        document.getElementById('rpg-battle-menu').style.display = 'none';
        document.getElementById('rpg-battle-target-panel').style.display = 'none';
        
        this.nextStory();
    }



battleWin() {
    // 1. 强制关闭自动战斗
    this.isAutoBattle = false;
    document.getElementById('rpg-auto-battle-btn').style.display = 'none';
    
    if (this.battleMapEntity) {
        this.battleMapEntity.isDefeated = true;
    }
        
    const entityToRemove = this.battleMapEntity;    
    let totalXp = 0;
    
    if (this.battleMapEntity) {
        totalXp = this.battleMapEntity.xp || 30;
    }

    // 结算经验
    if (this.p1.hp > 0) this.p1.xp += totalXp; 
    if (this.p2.hp > 0) this.p2.xp += totalXp;
    
    let msg = `获得 ${totalXp} 经验。`;
    let leveledUp = false;

    if(this.p1.hp > 0 && this.p1.xp >= this.p1.nextXp) { 
        this.p1.levelUp(); 
        msg += " 勇者升级！"; 
        leveledUp = true; 
    }
    if(this.p2.hp > 0 && this.p2.xp >= this.p2.nextXp) { 
        this.p2.levelUp(); 
        msg += " 伙伴升级！"; 
        leveledUp = true; 
    }
    
    // 【步骤 1】立即显示经验值/升级信息
    this.showBottomDialog("", msg);
    
    // --- 定义一个时间累加器，用于控制后续消息的播放顺序 ---
    let stepDelay = 0; 

    // 掉落处理
    let lootMsgItems = []; 
    let totalCoins = 0;    
    const enemiesToLoot = this.allBattleEnemiesCache || [];

    enemiesToLoot.forEach(e => {
        const dropList = (e.type === 'boss') ? RPG_DROP_CONFIG.boss : RPG_DROP_CONFIG.normal;
        dropList.forEach(itemConfig => {
            if (Math.random() < itemConfig.rate) {
                const qty = Math.floor(Math.random() * (itemConfig.max - itemConfig.min + 1)) + itemConfig.min;
                if (qty > 0) {
                    if (itemConfig.id === 'currency' || itemConfig.id === 'points') { 
                            this.currency += qty;
                            totalCoins += qty;
                        } else {
                            this.gainItem(itemConfig.id, qty);
                            lootMsgItems.push(itemConfig.name);
                    }
                }
            }
        });
    });
    
    // 生成最终掉落文本
    let finalMsg = "";
    if (lootMsgItems.length > 0) finalMsg += "获得: " + lootMsgItems.join("！");
    if (totalCoins > 0) {
            // 【修改】不需要判断BOSS了，统称为金币
            finalMsg += ` 获得 ${totalCoins} 金币！`;
    }
    
    // 【步骤 2】如果有掉落，延迟 1.5秒 后显示
    if (finalMsg) {
        stepDelay += 1500; // 增加延迟
        setTimeout(() => {
            this.showBottomDialog("", finalMsg);
        }, stepDelay);
    }

    // 移除地图上的敌人实体
    this.mapEnemies = this.mapEnemies.filter(e => e !== this.battleMapEntity);

    // 【步骤 3】如果有升级台词，在掉落显示完 1.5秒 后显示
    if (leveledUp) {
        const lvLines = this.p2.customData?.dialogues?.lvup || [];
        if (lvLines.length > 0) {
            stepDelay += 1500; // 再增加延迟
            setTimeout(() => {
                this.showBottomDialog(this.p2.name, this.getRandomLine(lvLines));
            }, stepDelay);
        }
    }
    
    // 【步骤 4】所有消息播放完毕后，再过 2秒 结束战斗
    // 注意：这里的基础时间是 stepDelay，保证前面的消息都播完了
    setTimeout(() => {
        this.closeDialogs();
        
        // 检查 BOSS 战结局
        const isTutorialBoss = (this.curLv.type === 'tutorial' && this.curLv.id === 'lv3' && this.battleMapEntity?.type === 'boss');
        const isRandomBoss = (this.curLv.type === 'random' && this.randomMapData.currentMapIndex === 4 && this.battleMapEntity?.type === 'boss');

        if (isTutorialBoss) {
            this.triggerTutorialEnding();
        } else if (isRandomBoss) {
            this.triggerRandomEnding();
        } else {
            if (entityToRemove) {
                this.mapEnemies = this.mapEnemies.filter(e => e !== entityToRemove);
            }
            // 恢复地图状态
            this.state = this.STATE.MAP;
            
            // 恢复头部标题
            const titleEl = document.getElementById('rpg-header-title');
            if (titleEl && this.curLv) {
                titleEl.innerText = this.curLv.name;
                titleEl.style.color = 'var(--text-color)';
            }
            // 恢复 UI
            document.getElementById('rpg-controls').style.display = 'block';
            document.getElementById('rpg-battle-menu').style.display = 'none';
            document.getElementById('rpg-battle-target-panel').style.display = 'none';
            
            const menuBtn = document.getElementById('rpg-menu-toggle-btn');
            if(menuBtn) menuBtn.style.display = 'flex';
        }
    }, stepDelay + 2000); // 这里的延迟是 累积时间 + 2秒阅读时间
}




gainItem(id, count) {
        if (!this.inventory[id]) this.inventory[id] = 0;
        this.inventory[id] += count;
    }


   // === 打开背包 (修复版：带Tab过滤) ===
    // 在 RpgGame 类中找到 openInventory 方法并替换
    openInventory(context = 'map') {

        
        // 2. 设置暂停状态
        this.isPaused = true;
        this.stop(); // 彻底停止循环，防止后台跑动

        // 3. 获取并准备 DOM
        const modal = document.getElementById('rpg-common-modal');
        const list = document.getElementById('rpg-modal-body');
        const tabsContainer = document.getElementById('rpg-modal-tabs');

        document.getElementById('rpg-modal-title').innerText = context === 'battle' ? '战斗背包' : '行囊';

        // 渲染 Tab
        if (context === 'battle') {
            tabsContainer.style.display = 'none';
            this.renderInventoryList(list, 'battle', 'battle'); 
        } else {
            tabsContainer.style.display = 'flex';
            this.renderInventoryList(list, 'all', 'map'); 
            
            const tabs = tabsContainer.querySelectorAll('.rpg-tab-btn');
            tabs.forEach(tab => {
                tab.onclick = (e) => {
                    tabs.forEach(t => t.classList.remove('active'));
                    e.target.classList.add('active');
                    this.renderInventoryList(list, e.target.dataset.type, 'map');
                };
            });
            tabs.forEach(t => t.classList.remove('active'));
            if(tabs[0]) tabs[0].classList.add('active');
        }

        // 4. 显示模态框
        modal.classList.add('visible');

           // 5. 【关键修复】定义关闭逻辑
        const handleClose = () => {
            modal.classList.remove('visible');
            
            // 【修正】无论在地图还是战斗，关闭背包后都必须恢复游戏运行
            // 否则战斗画面会静止，点击按钮无反应
            this.isPaused = false;
            this.resume(); // 恢复游戏循环 (requestAnimationFrame)
        };

        // 绑定关闭事件 (先解绑旧的，防止多次绑定)
        const closeBtn = document.getElementById('rpg-modal-close-btn');
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
        newCloseBtn.onclick = handleClose;

        // 点击遮罩层关闭 (同样重新绑定)
        modal.onclick = (e) => {
            if (e.target === modal) handleClose();
        };
    }
    
// === 辅助：渲染列表 (修复版) ===
    renderInventoryList(container, filterCategory, usageContext) {
        container.innerHTML = '';
        
        // 显示金币
        const currencyDiv = document.createElement('div');
        currencyDiv.style.cssText = "padding:10px; font-weight:bold; color:#e67e22; background:#fff8e1; border-radius:8px; margin-bottom:10px; text-align:right;";
        currencyDiv.innerText = `持有金币: ${this.currency || 0}`;
        container.appendChild(currencyDiv);

        let hasItem = false;

        for (let [id, count] of Object.entries(this.inventory)) {
            if (count <= 0) continue;
            
            const itemDef = RPG_ITEMS[id];
            if (!itemDef) continue;

            // 【修复点1】属性名修正：使用 itemDef.use 而不是 category
            // 如果道具没有 use 属性（如金币），且过滤条件不是 all，则跳过
            if (filterCategory !== 'all' && itemDef.use !== filterCategory) continue;

            // 判断“使用”按钮是否可用
            let canUse = false;
            let btnText = "使用";

            // 【修复点2】属性名修正：使用 itemDef.use 判断类型
            if (usageContext === 'battle') {
                // 战斗状态下：只有 use='battle' 的道具可用
                if (itemDef.use === 'battle') canUse = true;
                else btnText = "不可用";
            } else {
                // 地图状态下：
                if (itemDef.use === 'map') {
                    canUse = true; // 地图道具（回城、帐篷）可用
                } else if (itemDef.use === 'home') {
                    btnText = "家园可用"; // 材料类
                } else if (itemDef.use === 'battle') {
                    btnText = "战斗可用"; // 战斗药水在平时不能喝（或者你可以改为能喝，看需求）
                }
            }

            const row = document.createElement('div');
            row.className = 'rpg-item-row';
            row.innerHTML = `
                <div class="rpg-item-icon">${itemDef.icon}</div>
                <div class="rpg-item-info">
                    <div class="rpg-item-name">${itemDef.name} <span style="color:var(--primary-color)">x${count}</span></div>
                    <div class="rpg-item-desc">${itemDef.desc}</div>
                </div>
            `;

            const btn = document.createElement('button');
            btn.className = 'rpg-use-btn';
            btn.innerText = btnText;
            btn.disabled = !canUse;
            
            btn.onclick = () => {
                if (usageContext === 'battle') {
                    this.useItemInBattle(id);
                    // 战斗中使用后通常直接关闭背包去选人
                    // (已经在 useItemInBattle 里处理了关闭逻辑)
                } else {
                    this.useItemInMap(id);
                    // 地图中使用后刷新列表（例如数量减少）
                    this.renderInventoryList(container, filterCategory, usageContext);
                }
            };

            row.appendChild(btn);
            container.appendChild(row);
            hasItem = true;
        }

        if (!hasItem) {
            let catName = filterCategory === 'all' ? '' : 
                          (filterCategory === 'battle' ? '战斗' : 
                          (filterCategory === 'map' ? '地图' : '家园'));
            
            container.innerHTML += `<div style="text-align:center; color:#999; margin-top:20px;">没有${catName}道具</div>`;
        }
    }

    // 地图使用物品
    useItemInMap(id) {
        const item = RPG_ITEMS[id];
        if (this.inventory[id] > 0) {
            this.inventory[id]--;
            
            if (id === 'return_scroll') {
                this.isGoingHome = true;
                this.showTeleportScreen("正在传送回家...", 'light');
                setTimeout(() => {
                    document.getElementById('rpg-common-modal').classList.remove('visible');
                    this.hideTeleportScreen();
                    this.resume();
                    // 触发回家逻辑
                    const homeIdx = this.LEVELS.findIndex(lv => lv.type === 'home');
                    this.loadLevel(homeIdx, 'start');
                }, 1000);
            } else if (id === 'tent') {
                this.showTeleportScreen("正在生火休息...", 'dark');
                this.p1.hp = this.p1.maxHp; this.p1.mp = this.p1.maxMp;
                this.p2.hp = this.p2.maxHp; this.p2.mp = this.p2.maxMp;
                
                setTimeout(() => {
                    this.hideTeleportScreen();
                    showToast("体力完全恢复！");
                }, 2000);
            }
        }
    }

    // 战斗使用物品
useItemInBattle(id) {
        if (this.inventory[id] <= 0) return;

        // 1. 记录当前待使用的物品
        this.pendingItemId = id;
        this.currentAction = 'item'; 

        // 2. 关闭背包模态框
        document.getElementById('rpg-common-modal').classList.remove('visible');
        
        // 【关键修复】必须在这里恢复游戏循环！
        // 之前打开背包时游戏被 stop() 了，如果不 resume()，
        // 即使状态切到了 BATTLE_TARGET，画面也不会刷新，导致看不见HP变化，也看不见箭头。
        this.isPaused = false;
        this.resume(); 
        
        // 3. 进入目标选择状态
        this.state = this.STATE.BATTLE_TARGET;
        document.getElementById('rpg-battle-menu').style.display = 'none';
        document.getElementById('rpg-battle-target-panel').style.display = 'flex';

        // 4. 设置可选目标
        const itemDef = RPG_ITEMS[id];
        
        if (itemDef.effect && itemDef.effect.type === 'flee') {
            this.executeAction(this.p1, this.p1, 'item');
        } else {
            this.targets = this.battleTeam;
            this.targetIndex = 0; 
            this.showBottomDialog(this.p1.name, `对谁使用 ${itemDef.name}？`);
        }
    }





// 【新增】随机地图结局（打完随机世界BOSS后）
// 【重构版】触发随机地图结局 (优先读取AI生成的战后剧情)
triggerRandomEnding() {
    this.state = this.STATE.STORY;
    this.storyQueue = [];

    // 1. 尝试获取 AI 生成的第5关“战后结局” (idx=4)
    const finalMapStory = this.randomMapData.mapStories[4];
    let endingLines = [];

    if (finalMapStory && finalMapStory.ending && finalMapStory.ending.length > 0) {
        // 如果有 AI 生成的专属结局，直接使用
        endingLines = finalMapStory.ending;
    } else {
        // 兜底方案：如果没有生成结局，使用大纲摘要或默认文本
        const grandPlot = this.randomMapData.grandPlot || [];
        const finalSummary = grandPlot[4] || "冒险结束，英雄凯旋。";
        
        endingLines.push("随着一声巨响，强敌倒下了。");
        endingLines.push("【结局篇】");
        endingLines.push(finalSummary);
        endingLines.push(`${this.p2.name}：一切都结束了...`);
        endingLines.push(`${this.p2.name}：谢谢你，最好的搭档。`);
    }

    // 2. 将内容加入播放队列
    endingLines.forEach(text => {
        // 简单判断是否包含冒号来区分名字
        let name = "";
        let content = text;
        
        if (text.includes("：") || text.includes(":")) {
            const parts = text.split(/[：:]/);
            if (parts.length >= 2) {
                name = parts[0].trim();
                content = parts.slice(1).join("：").trim();
            }
        }
        
        this.storyQueue.push({ name: name, text: content });
    });

    // 3. 添加系统提示
    this.storyQueue.push({ name: "", text: "（冒险已完成，即将返回家园）" });

    // 4. 隐藏战斗UI
    document.getElementById('rpg-battle-menu').style.display = 'none';
    document.getElementById('rpg-battle-target-panel').style.display = 'none';
    
    // 恢复标题
    const titleEl = document.getElementById('rpg-header-title');
    if (titleEl) titleEl.innerText = this.curLv.name; 
    
    // 标记回城
    this.isGoingHome = true;
    this.nextStory();
}


// 【新增方法】触发单句对话（用于家具交互、简单提示）
    triggerSimpleDialog(name, text) {
        // 1. 切换到剧情状态，暂停地图操作
        this.state = this.STATE.STORY;
        
        // 2. 构造只有一句话的剧情队列
        this.storyQueue = [{ name: name, text: text }];
        
        // 3. 启动剧情（显示对话框，隐藏方向键）
        this.nextStory();
    }



    // 在 RpgGame 类中替换这两个方法

    // 【修改版】显示底部对话框 (支持隐藏旁白名字框)
showBottomDialog(name, text) {
    const dialogBox = document.getElementById('rpg-bottom-dialog');
    const nameBox = document.getElementById('rpg-dialog-name');
    const textBox = document.getElementById('rpg-dialog-text');
    
    dialogBox.style.display = 'flex';
    
    // 隐藏顶部对话框（防止冲突）
    document.getElementById('rpg-top-dialog').style.display = 'none';

    // 逻辑：如果名字为空，或者名字是"旁白"，则隐藏名字框
    if (!name || name.trim() === "" || name === "旁白") {
        nameBox.style.display = 'none'; // 彻底隐藏名字框
        nameBox.innerText = "";
        
        // 可选：如果是旁白，可以将文本设为居中或斜体，增加区分度
        // textBox.style.fontStyle = 'italic'; 
    } else {
        nameBox.style.display = 'block'; // 显示名字框
        nameBox.innerText = name;
        // textBox.style.fontStyle = 'normal';
    }

    textBox.innerText = text;
    
    // 对话时隐藏方向键和交互按钮
    const controls = document.getElementById('rpg-controls');
    if (controls) controls.style.display = 'none';
    
    const interactBtn = document.getElementById('rpg-interact-btn');
    if (interactBtn) interactBtn.style.display = 'none';
}

showTopDialog(name, text) {
        let box = document.getElementById('rpg-top-dialog');
        box.style.display = 'block'; box.innerText = `${name}: ${text}`;
    }



    closeDialogs() {
        document.getElementById('rpg-bottom-dialog').style.display = 'none';
        document.getElementById('rpg-top-dialog').style.display = 'none';
        
        // 【新增】对话结束，如果是在地图模式，恢复方向键
        if (this.state === this.STATE.MAP) {
            const controls = document.getElementById('rpg-controls');
            if (controls) controls.style.display = 'block';
            
            // 恢复交互按钮（如果有待交互对象）
            if (this.pendingInteraction) {
                 const interactBtn = document.getElementById('rpg-interact-btn');
                 if (interactBtn) interactBtn.style.display = 'flex';
            }
        }
    }

    draw() {
        this.ctx.fillStyle = "#111";
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        if (this.curLv && this.curLv.type === 'prologue') {
        return; 
    }
        // 只有在 random0 且 是开场剧情时，才隐藏地图
        if (this.curLv && this.curLv.id === 'random0' && this.isOpeningStory) {
            return;
        }
        if (this.state === this.STATE.MAP || this.state === this.STATE.STORY) this.drawMapMode();
        else if (this.state >= this.STATE.BATTLE_CMD && this.state !== this.STATE.GAME_OVER) this.drawBattleMode();
    }

    // --- 辅助：绘制带噪点的方块 (模拟材质) ---
    // --- 修复版：基于地图坐标的确定性纹理 ---
    // ctx: 画布
    // dx, dy: 屏幕上的绘制坐标 (用于画图)
    // mapX, mapY: 地图网格坐标 (用于生成固定的随机数)
    // size: 格子大小
    // type: 'floor' 或 'wall'
    drawTexturedTile(ctx, dx, dy, mapX, mapY, size, type, baseColor) {
        // 1. 绘制底色
        ctx.fillStyle = baseColor;
        ctx.fillRect(dx, dy, size, size);

        // 2. 伪随机数生成器 (核心修复：只要 mapX 和 mapY 不变，算出来的 rand 永远不变)
        // 这是一个简单的哈希算法，避免使用 Math.random()
        const pseudoRandom = (x, y) => {
            let n = x * 331 + y * 433; // 任意质数
            n = (n << 13) ^ n;
            return (n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff;
        };
        
        const randVal = pseudoRandom(mapX, mapY);
        const variant = randVal % 10; // 生成 0-9 的变种编号

        // 3. 根据变种绘制装饰 (降低密度，只有特定编号才画东西，就不会花了)
        
        if (type === 'floor') {
            // --- 地板/草地模式 ---
            // 只有 30% 的格子有装饰，剩下 70% 是干净的底色
            if (variant === 0 || variant === 1) { 
                // 变种A: 画两根小草 (深色一点点)
                ctx.fillStyle = "rgba(0, 0, 0, 0.1)"; 
                ctx.fillRect(dx + size * 0.3, dy + size * 0.4, 2, 4);
                ctx.fillRect(dx + size * 0.4, dy + size * 0.3, 2, 5);
            } else if (variant === 2) {
                // 变种B: 画一个小石子/亮斑 (亮色)
                ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
                ctx.fillRect(dx + size * 0.7, dy + size * 0.7, 4, 4);
            }
            // variant 3-9 什么都不画，保持干净
        } 
        else if (type === 'wall') {
            // --- 墙壁模式 ---
            // 墙壁加一点砖缝纹理
            ctx.fillStyle = "rgba(0, 0, 0, 0.15)"; // 阴影色
            
            if (variant < 3) {
                // 样式1：横向砖缝
                ctx.fillRect(dx, dy + size * 0.5, size, 2);
                ctx.fillRect(dx + size * 0.5, dy + size * 0.5, 2, size * 0.5);
            } else if (variant < 6) {
                // 样式2：裂纹
                ctx.fillRect(dx + size * 0.2, dy + size * 0.2, 2, 6);
                ctx.fillRect(dx + size * 0.2, dy + size * 0.4, 6, 2);
            }
            
            // 统一加一个顶部高光，增加立体感
            ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
            ctx.fillRect(dx, dy, size, 2);
        }
    }

drawMapMode() {
    // 1. 计算可视区域 (多画一圈防止边缘闪烁)
    let startCol = Math.floor(this.cam.x / RPG_CONFIG.TILE) - 1;
    let endCol = startCol + Math.ceil(this.canvas.width / RPG_CONFIG.TILE) + 2;
    let startRow = Math.floor(this.cam.y / RPG_CONFIG.TILE) - 1;
    let endRow = startRow + Math.ceil(this.canvas.height / RPG_CONFIG.TILE) + 2;

    const tileSize = RPG_CONFIG.TILE;

    // 安全获取已触发点集合
    const triggeredSet = (this.randomMapData && this.randomMapData.triggeredPoints instanceof Set) 
        ? this.randomMapData.triggeredPoints 
        : new Set();

    // 统计解锁进度 (用于出口判断)
    let unlockedPoints = 0;
    if (this.curLv.type === 'random') {
        const mapId = this.curLv.id;
        const mapState = this.randomMapData?.mapStates?.[mapId];
        if (mapState) {
            unlockedPoints = mapState.triggered.size;
        }
    }
    const isExitOpen = (this.curLv.type !== 'random' || this.curLv.id === 'random0' || unlockedPoints >= 3);

    // 准备家具拥有数量
    let ownedCounts = {};
    this.homeState.furniture.forEach(id => {
        ownedCounts[id] = (ownedCounts[id] || 0) + 1;
    });

    // ===============================================
    // 第一层 (Pass 1): 地面与静态环境
    // ===============================================
    for (let y = startRow; y <= endRow; y++) {
        for (let x = startCol; x <= endCol; x++) {
            if (y >= 0 && y < this.h && x >= 0 && x < this.w) {
                let dx = Math.floor(x * tileSize - this.cam.x);
                let dy = Math.floor(y * tileSize - this.cam.y);
                let tile = this.mapData[y][x];

                // 画地板 (打底)
                this.drawTexturedTile(this.ctx, dx, dy, x, y, tileSize, 'floor', this.curLv.colors.floor);

                // 画墙壁 (#)
                if (tile === '#') {
                    this.drawTexturedTile(this.ctx, dx, dy, x, y, tileSize, 'wall', this.curLv.colors.wall);
                    this.ctx.fillStyle = "rgba(0,0,0,0.3)";
                    this.ctx.fillRect(dx, dy + tileSize - 8, tileSize, 8);
                }
                // 画栅栏左 (F)
                else if (tile === 'F') {
                    if (loadedImages['fence_l']) {
                        this.ctx.drawImage(loadedImages['fence_l'], dx, dy, tileSize, tileSize);
                    } else {
                        this.ctx.fillStyle = "#8d6e63";
                        this.ctx.fillRect(dx + 5, dy + 20, tileSize - 10, 24);
                    }
                }
                // 画栅栏右 (f)
                else if (tile === 'f') {
                    if (loadedImages['fence_r']) {
                        this.ctx.drawImage(loadedImages['fence_r'], dx, dy, tileSize, tileSize);
                    } else {
                        this.ctx.fillStyle = "#8d6e63";
                        this.ctx.fillRect(dx + 5, dy + 20, tileSize - 10, 24);
                    }
                }

                // 画剧情点 T
                if (tile === 'T') {
                    let isTriggered = false;
                    if (this.curLv.type === 'random') {
                        const mapId = this.curLv.id;
                        const mapState = this.randomMapData?.mapStates?.[mapId];
                        if (mapState) {
                            isTriggered = mapState.triggered.has(`${x},${y}`);
                        }
                    } else {
                        isTriggered = true; // 非随机地图不显示剧情点图标
                    }

                    if (!isTriggered) {
                        this.ctx.save();
                        const alpha = 0.6 + Math.sin(Date.now() / 200) * 0.4;
                        this.ctx.shadowBlur = 20;
                        this.ctx.shadowColor = "#f1c40f";
                        this.ctx.fillStyle = `rgba(241, 196, 15, ${alpha})`;
                        this.ctx.beginPath();
                        this.ctx.arc(dx + tileSize / 2, dy + tileSize / 2, 12, 0, Math.PI * 2);
                        this.ctx.fill();
                        this.ctx.shadowBlur = 0;
                        this.ctx.fillStyle = "#fff";
                        this.ctx.font = "bold 20px Arial";
                        this.ctx.textAlign = "center";
                        this.ctx.textBaseline = "middle";
                        this.ctx.fillText("?", dx + tileSize / 2, dy + tileSize / 2 + 1);
                        this.ctx.restore();
                    }
                }

                // 画入口 P
                if (tile === 'P') {
                    this.drawExitOrEntry(dx, dy, tileSize, "#fff", true);
                }

                // 画出口 E
                if (tile === 'E') {
                    if (this.curLv.type !== 'random' || isExitOpen) {
                        this.drawExitOrEntry(dx, dy, tileSize, "#fff", true);
                    } else {
                        this.ctx.save();
                        this.ctx.fillStyle = "rgba(231, 76, 60, 0.6)";
                        this.ctx.beginPath();
                        this.ctx.arc(dx + tileSize / 2, dy + tileSize / 2, 14, 0, Math.PI * 2);
                        this.ctx.fill();
                        this.ctx.fillStyle = "#fff";
                        this.ctx.font = "16px Arial";
                        this.ctx.textAlign = "center";
                        this.ctx.textBaseline = "middle";
                        this.ctx.fillText("🔒", dx + tileSize / 2, dy + tileSize / 2);
                        this.ctx.restore();
                    }
                }

                // 画家园传送门 G
                if (this.curLv.type === 'home' && this.gatePos && x === this.gatePos.x && y === this.gatePos.y) {
                    this.drawMagicGate(dx, dy, tileSize);
                }
            }
        }
    }

    // ===============================================
    // 第二层 (Pass 2): 家具 + 角色，按 Y 轴排序绘制
    // ===============================================
    let renderList = [];

    // A. 收集可见区域内的家具 (使用 mapCache，解决树跳动和穿墙问题)
    for (let y = startRow; y <= endRow; y++) {
        for (let x = startCol; x <= endCol; x++) {
            if (y >= 0 && y < this.h && x >= 0 && x < this.w) {
                const cache = this.mapCache?.[y]?.[x];
                if (!cache) continue;

                if (cache.furniture) {
                    const info = cache.furniture; // { key, index, w, h }
const tileChar = this.mapData[y][x];
                    const mapItemKey = Object.keys(RPG_FURNITURE).find(k => RPG_FURNITURE[k].mapChar === tileChar);
                                        if (mapItemKey) {
                        // 这就是锚点！
                        // 重新获取 info (为了拿到 index)
                        // 注意：这里要确保 mapCache 里的 index 和我们现在算的一致
                        // 或者直接信任 cache.furniture.index
                        
                        const itemConf = RPG_FURNITURE[mapItemKey];
                        const isDefault = itemConf.cost === 0;
                        const ownedNum = ownedCounts[mapItemKey] || 0;
                        
                        if (isDefault || ownedNum >= info.index) {
renderList.push({
                                type: 'furniture',
                                key: mapItemKey,
                                x: x, y: y,
                                w: info.w, h: info.h,
                                sortY: y * tileSize + tileSize
                            });
                      
                    } 
                    }
                }

                // 收集商店告示牌 s
                
            }
        }
    }

    // 家园房子外观 (在家具和角色之前画)
    if (this.curLv.id === 'home') this.drawHomeBuildings();

    // B. 收集实体 (怪物、队友、主角)
    [...this.mapEnemies, this.p2, this.p1].forEach(e => {
        renderList.push({
            type: 'entity',
            entity: e,
            sortY: e.y * tileSize + tileSize
        });
    });

    // C. 按 Y 轴排序 (Y小的先画，Y大的后画，实现遮挡)
    renderList.sort((a, b) => a.sortY - b.sortY);

// D. 统一绘制
    renderList.forEach(obj => {
        if (obj.type === 'furniture') {
            let dx = Math.floor(obj.x * tileSize - this.cam.x);
            let dy = Math.floor(obj.y * tileSize - this.cam.y);
            const offsetY = obj.h - tileSize; // 底部对齐
            const offsetX = (obj.w - tileSize) / 2; // 水平居中

            // 【将这里的 if 替换成下面这行，增加安全检查】
            if (loadedImages[obj.key] && loadedImages[obj.key].complete && loadedImages[obj.key].naturalWidth > 0) {
                this.ctx.drawImage(loadedImages[obj.key], dx - offsetX, dy - offsetY, obj.w, obj.h);
            } else {
                const itemConf = RPG_FURNITURE[obj.key];
                this.ctx.font = "30px Arial";
                this.ctx.fillText(itemConf?.icon || "?", dx + 10, dy + 40);
            }
        }
        else if (obj.type === 'sign') {
            let dx = Math.floor(obj.x * tileSize - this.cam.x);
            let dy = Math.floor(obj.y * tileSize - this.cam.y);
            
            // 【将这里的 if 替换成下面这行，增加安全检查】
            if (loadedImages['shop_sign'] && loadedImages['shop_sign'].complete && loadedImages['shop_sign'].naturalWidth > 0) {
                this.ctx.drawImage(loadedImages['shop_sign'], dx, dy, tileSize, tileSize);
            } else {
                this.ctx.fillStyle = "#e67e22";
                this.ctx.fillRect(dx + 10, dy + 10, 44, 44);
                this.ctx.fillStyle = "#fff";
                this.ctx.fillText("SHOP", dx + 12, dy + 35);
            }
        }
        else if (obj.type === 'entity') {
            this.drawEntityOnMap(obj.entity);
        }
    });

    // （屋顶层已移除）
}


// 辅助方法：绘制出入口圈圈
drawExitOrEntry(dx, dy, size, color, glow) {
    this.ctx.save();
    this.ctx.fillStyle = color; 
    if (glow) {
        this.ctx.globalAlpha = 0.3 + Math.sin(Date.now()/200)*0.1;
    }
    this.ctx.beginPath(); 
    this.ctx.arc(dx+size/2, dy+size/2, 12, 0, 6.28); 
    this.ctx.fill();
    this.ctx.restore();
}

// 【新增辅助】绘制时空之门特效
drawMagicGate(dx, dy, tileSize) {
    this.ctx.save();
    const time = Date.now() / 1000;
    const pulse = 0.5 + Math.sin(time * 2) * 0.3;
    const gradient = this.ctx.createRadialGradient(
        dx + tileSize/2, dy + tileSize/2, 0,
        dx + tileSize/2, dy + tileSize/2, tileSize/2 * pulse
    );
    gradient.addColorStop(0, 'rgba(138, 43, 226, 0.8)');
    gradient.addColorStop(0.5, 'rgba(75, 0, 130, 0.5)');
    gradient.addColorStop(1, 'rgba(138, 43, 226, 0)');
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(dx, dy, tileSize, tileSize);
    this.ctx.fillStyle = '#fff';
    this.ctx.globalAlpha = 0.8 + Math.sin(time * 3) * 0.2;
    this.ctx.font = 'bold 32px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText('✦', dx + tileSize/2, dy + tileSize/2);
    this.ctx.restore();
}

// 【新增辅助】绘制家园建筑结构
drawHomeBuildings() {
    // 1. 绘制房子 (使用大图)
    if (this.curLv.houseImgPos && loadedImages['house_exterior']) {
        const hx = this.curLv.houseImgPos.x * 64 - this.cam.x;
        const hy = this.curLv.houseImgPos.y * 64 - this.cam.y;
        
        // 假设房子图片比较大 (例如 300x300)，根据实际图片调整宽高
        // 这里假设图片宽度覆盖 5 个格子 (320px)，高度覆盖 4 个格子 (256px)
        // 你需要根据你的 PNG 图片实际比例调整下面两个数字 320, 256
        this.ctx.drawImage(loadedImages['house_exterior'], hx, hy, 320, 320);
    } else {
        // 没图时的兜底方块 (旧逻辑)
        this.ctx.fillStyle = "#ecf0f1";
        this.ctx.fillRect((13 * 64) - this.cam.x, (3 * 64) - this.cam.y, 5*64, 4*64);
    }

    // 2. 绘制商店告示牌 (S点)
    // 我们需要在 map 循环里记录 S 的位置，或者直接硬编码
    // 这里我们直接查找当前视口内的 'S' 字符或者使用硬编码坐标 (10, 6)
    // 但为了更精准，建议你在 updateMap 类似的逻辑里解析 S，或者简单点，直接用坐标：
    let signX = (1 * 64) - this.cam.x + 10; // 假设 S 在 x=1, y=7
    let signY = (7 * 64) - this.cam.y + 10;
    
    // 实际上我们在 map 数组里把 S 放在了 x=1, y=7 (看上面的 map 配置)
    // 为了更灵活，我们可以遍历一下地图找 S (但为了性能，这里假设你记得 S 的坐标)
    // 或者我们在 drawMapMode 的循环里画 S 也可以。
    
    // 让我们用更简单的方法：在 drawMapMode 循环里判断 tile === 'S'
    // 所以这里我们可以把告示牌的绘制逻辑删掉，移到 drawMapMode 里去
}

// 【新增辅助】绘制屋顶
drawHomeRoof() {

}

   // 绘制家具 Helper
    drawFurniture(layer) {

    }


// 修改 getFurnitureAt 方法
// 修改 getFurnitureAt 方法
getFurnitureAt(x, y) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return null;

    // 直接读取 mapCache (现在所有占用的格子都有 furniture 数据了)
    const cache = this.mapCache[y][x];
    if (!cache || !cache.furniture) return null;

    const info = cache.furniture;
    const furnitureKey = info.key;
    const item = RPG_FURNITURE[furnitureKey];

    // 检查拥有权
    const ownedCount = this.homeState.furniture.filter(fid => fid === furnitureKey).length;
    const isDefault = item.cost === 0;

    // 【关键修复】如果没买，直接返回 null
    // 这样就不会显示交互按钮，也无法进行操作
    if (!isDefault && ownedCount < info.index) {
        return null; 
    }

    return {
        id: furnitureKey,
        type: item.type || furnitureKey,
        name: item.name,
        data: item
    };
}

    

    async interactWithFurniture(f) {
        if (f.type === 'wardrobe') {
            // 衣柜逻辑
            if (this.inventory['dye'] > 0) {
                 // confirm 是浏览器原生弹窗，不受游戏状态影响，这里保持原样即可
                 // 或者也可以改成游戏内的对话逻辑，为了简单先保留 confirm
                 if(await AppUI.confirm("消耗1个染料随机改变衣服颜色？", "衣柜", "确定", "取消")) {
                     this.inventory['dye']--;
                     this.p1.bodyColor = '#' + Math.floor(Math.random()*16777215).toString(16);
                     this.p1.styleData.top = this.p1.bodyColor; 
                     this.p1.sprite = generateCharaSprite(this.p1.styleData);
                     
                     // 成功后的提示也改为点击关闭
                     this.triggerSimpleDialog("", "衣服焕然一新！(颜色已改变)");
                 }
            } else {
                // 【修复】改为触发单句剧情
                this.triggerSimpleDialog("", "衣柜里只有旧衣服... (需要'神奇染料'才能染色)");
            }
        } else if (f.id === 'bed') {
            // 床逻辑
            this.p1.hp = this.p1.maxHp; this.p1.mp = this.p1.maxMp;
            this.p2.hp = this.p2.maxHp; this.p2.mp = this.p2.maxMp;
            
            
            // 【修复】改为触发单句剧情
            this.triggerSimpleDialog("", "好舒服的床... Zzz (全员HP/MP已恢复)");
            
        } else if (f.id === 'log') {
            // 冒险日志逻辑
            const visitedCount = this.visitedLevels.size;
            const text = `冒险日志：\n我们已经探索了 ${visitedCount} 个区域。\n当前持有金币：${this.currency}`;
            this.triggerSimpleDialog("", text);
            
        } else {
            // 通用家具描述
            // 【修复】改为触发单句剧情
            this.triggerSimpleDialog("", `这是 ${f.name}。`);
        }
    }
    
    // 商店系统
        // === 打开商店 (修复版) ===
    // === 打开商店 (逻辑修复版) ===
    openShop() {
        // 1. 设置暂停
        this.toggleMenu(false); // 确保暂停菜单关闭
        this.isPaused = true;
        this.stop(); // 停止循环
        
        const modal = document.getElementById('rpg-common-modal');
        const list = document.getElementById('rpg-modal-body');
        const tabs = document.getElementById('rpg-modal-tabs');
        
        if (!modal) return;

        document.getElementById('rpg-modal-title').innerText = '家具商店';
        if(tabs) tabs.style.display = 'none'; // 商店不需要分类Tab
        
        list.innerHTML = '';
        
        // 余额显示
        const currencyDiv = document.createElement('div');
        currencyDiv.style.cssText = "padding:10px; font-weight:bold; color:#e67e22; background:#fff8e1; border-radius:8px; margin-bottom:10px; text-align:right;";
        currencyDiv.innerText = `持有金币: ${this.currency}`;
        list.appendChild(currencyDiv);

        // 填充列表
let ownedCounts = {};
        this.homeState.furniture.forEach(id => {
            ownedCounts[id] = (ownedCounts[id] || 0) + 1;
        });

        Object.entries(RPG_FURNITURE).forEach(([id, item]) => {
            if (item.cost <= 0) return; 

            // 【修改】获取当前拥有数量 和 最大限制
            const count = ownedCounts[id] || 0;
            const max = item.max || 1;
            const isMaxed = count >= max;
            
            const row = document.createElement('div');
            row.className = 'rpg-item-row';
            row.innerHTML = `
                <div class="rpg-item-icon">${item.icon}</div>
                <div class="rpg-item-info">
                    <div class="rpg-item-name">${item.name} <span style="font-size:12px;color:#666">(${count}/${max})</span></div>
                    <div class="rpg-item-desc" style="color:#e67e22; font-weight:bold;">${item.cost} 金币</div>
                </div>
            `;
            
            const btn = document.createElement('button');
            btn.className = 'rpg-use-btn';
            btn.innerText = isMaxed ? '已售空' : '购买';
            btn.disabled = isMaxed || this.currency < item.cost;
            if (isMaxed) btn.style.background = '#ccc';
            
            btn.onclick = () => {
                if (this.currency >= item.cost && !isMaxed) {
                    this.currency -= item.cost;
                    // 【关键】直接 push，允许重复 ID 存在数组里
                    this.homeState.furniture.push(id); 
                    
                    this.triggerSimpleDialog("", `购买了第 ${count + 1} 个 ${item.name}！`);
                    this.openShop(); 
                }
            };
            
            row.appendChild(btn);
            list.appendChild(row);
        });
        
        modal.classList.add('visible');
        
        // 【关键修复】定义恢复游戏的关闭逻辑
        const handleClose = () => {
            modal.classList.remove('visible');
            this.isPaused = false; // 必须重置
            this.resume();         // 必须恢复
        };
        
        // 绑定关闭事件
        const closeBtn = document.getElementById('rpg-modal-close-btn');
        // 克隆节点以移除旧监听器
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
        newCloseBtn.onclick = handleClose;

        modal.onclick = (e) => {
             if (e.target === modal) handleClose();
        };
    }



drawEntityOnMap(e) {
    let rawDx = e.x * RPG_CONFIG.TILE - this.cam.x;
    let rawDy = e.y * RPG_CONFIG.TILE - this.cam.y;
    
    let dx = Math.floor(rawDx);
    let dy = Math.floor(rawDy);
    
    if (e.sprite) {
        // 【新增】确保抗锯齿关闭
        this.ctx.imageSmoothingEnabled = false;
        
        const spriteSize = 64; 
        const sx = e.step * spriteSize;
        const sy = (e.direction || 0) * spriteSize;
        const drawSize = RPG_CONFIG.TILE; 
        const destY = Math.floor(dy - 16); 

        if (e.type === 'enemy' || e.type === 'boss') {
            const bounce = Math.floor(Math.sin(Date.now() / 200) * 3);
            this.ctx.drawImage(e.sprite, sx, sy, spriteSize, spriteSize, dx, dy + bounce, drawSize, drawSize);
            
            this.ctx.fillStyle = "#fff"; 
            this.ctx.font = "bold 20px Arial";
            this.ctx.fillText("!", dx + drawSize/2 - 4, dy);
        } else {
            this.ctx.drawImage(
                e.sprite, 
                sx, sy, spriteSize, spriteSize,
                dx, destY, drawSize, drawSize
            );
        }
    } else {
        let size = RPG_CONFIG.TILE;
        let bodySize = size * 0.8;
        this.ctx.fillStyle = e.bodyColor;
        this.ctx.fillRect(dx + (size-bodySize)/2, dy + size - bodySize, bodySize, bodySize);
    }
}

// 【优化版】绘制战斗单位：使用 source-atop 实现完美贴合的染色
    drawBattleUnit(e, x, y) {
        let drawX = Math.floor(x);
        
        // 状态抖动效果
        if(e.shake > 0) { 
            drawX += Math.floor((Math.random()-0.5)*10);
            e.shake--; 
        }
        
        let size = 64; 
        let isDead = e.hp <= 0;

        if (e.sprite) {
            this.ctx.save();
            this.ctx.imageSmoothingEnabled = false;

            // 死亡灰阶效果
            if (isDead) {
                this.ctx.globalAlpha = 0.5;
                this.ctx.filter = 'grayscale(100%)';
            }

            // === 1. 清空并准备缓冲区 ===
            this.bufferCtx.clearRect(0, 0, 64, 64);
            
            // === 2. 将角色绘制到缓冲区 ===
            if (e.type === 'player' || e.type === 'partner') {
                const spriteSize = 64;
                const dir = 2; // 战斗时朝向
                // 绘制到缓冲区的 (0,0)
                this.bufferCtx.drawImage(e.sprite, 0, dir * spriteSize, spriteSize, spriteSize, 0, 0, 64, 64);
            } else {
                const monsterSize = 48;
                // 怪物较小，绘制到缓冲区中心 (8,8) 位置，使其居中
                this.bufferCtx.drawImage(e.sprite, 0, 0, 48, 48, 8, 8, 48, 48);
            }

            // === 3. 应用状态颜色遮罩 (关键步骤) ===
            if (!isDead && e.status) {
                // 切换混合模式：后续绘制的内容只会出现在已有像素的区域
                this.bufferCtx.globalCompositeOperation = 'source-atop';
                
                Object.keys(e.status).forEach(statusId => {
                    const config = RPG_STATUS_CONFIG[statusId];
                    if (config && config.overlay) {
                        this.bufferCtx.fillStyle = config.overlay;
                        // 填满整个缓冲区，但因为 source-atop，只会染到人物身上
                        this.bufferCtx.fillRect(0, 0, 64, 64);
                    }
                });
                
                // 恢复默认混合模式，以免影响下一次绘制
                this.bufferCtx.globalCompositeOperation = 'source-over';
            }

            // === 4. 将处理好的缓冲区绘制到主屏幕 ===
            this.ctx.drawImage(this.bufferCanvas, drawX, y, size, size);

            this.ctx.restore();
        } else {
            // 兜底：如果没有 sprite 图片，画方块
            this.ctx.fillStyle = isDead ? "#555" : (e.bodyColor || "#888");
            this.ctx.fillRect(drawX, y, size, size);
        }

        // 绘制血条 (保持不变)
        const hasMp = (e.type !== 'enemy' && e.type !== 'boss');
        const barHeight = 6;
        const gap = 4;
        let mpY = y - 10 - barHeight;
        let hpY = hasMp ? (mpY - gap - barHeight) : (y - 10 - barHeight);

        this.drawBarWithNum(drawX, hpY, size, e.hp, e.maxHp, isDead ? "#555" : "#e74c3c");
        if (hasMp) {
            this.drawBarWithNum(drawX, mpY, size, e.mp, e.maxMp, isDead ? "#555" : "#3498db");
        }

        // 绘制头顶状态图标
        if (!isDead && e.status) {
            let iconOffsetX = 0;
            const iconY = hpY - 15; 

            Object.keys(e.status).forEach(statusId => {
                const config = RPG_STATUS_CONFIG[statusId];
                if (config && config.icon) {
                    this.ctx.font = "16px Arial";
                    this.ctx.textAlign = "center";
                    this.ctx.fillStyle = "#fff"; // 确保文字白色
                    // 加上黑色描边，防止在浅色背景看不清
                    this.ctx.strokeStyle = "rgba(0,0,0,0.5)";
                    this.ctx.lineWidth = 2;
                    this.ctx.strokeText(config.icon, drawX + size/2 + iconOffsetX, iconY);
                    this.ctx.fillText(config.icon, drawX + size/2 + iconOffsetX, iconY);
                    
                    iconOffsetX += 20; 
                }
            });
        }
    }


    drawBarWithNum(x, y, w, val, max, color) {
        let h = 8;
        this.ctx.fillStyle = "#444"; this.ctx.fillRect(x, y, w, h);
        this.ctx.fillStyle = color; this.ctx.fillRect(x, y, w * (Math.max(0,val)/max), h);
        this.ctx.fillStyle = "#fff"; this.ctx.font = "10px Arial"; this.ctx.fillText(`${Math.max(0,val)}`, x + w + 5, y + 8);
    }

    drawMarker(x, y) {
        this.ctx.fillStyle = "#f1c40f"; this.ctx.beginPath();
        let bounce = Math.sin(Date.now()/100) * 5;
        this.ctx.moveTo(x - 10, y + bounce); this.ctx.lineTo(x + 10, y + bounce); this.ctx.lineTo(x, y + 10 + bounce); this.ctx.fill();
    }
}

// 【全局函数】游戏初始化与事件绑定
// 请确保此函数在 RpgGame 类的闭合大括号 } 之后！
function setupRpgGame() {
    console.log("正在初始化 RPG 按钮事件..."); // 控制台看到这就说明 JS 没崩

    if(!window.rpgGameInstance) {
        window.rpgGameInstance = new RpgGame();
    }
    
    // ================= 1. 标题画面按钮 =================
    const newGameBtn = document.getElementById('rpg-new-game-btn');
    if (newGameBtn) newGameBtn.onclick = () => {
        switchScreen('rpg-create-screen');
        // 隐藏不需要的UI
        const partnerCard = document.getElementById('rpg-partner-card');
        if (partnerCard) partnerCard.style.display = 'none';
        
        const aiInitBtn = document.getElementById('rpg-ai-init-btn');
        if (aiInitBtn) aiInitBtn.style.display = 'none';
        
        // 禁用开始按钮
        const startBtn = document.getElementById('rpg-start-adventure-btn');
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.innerText = "请先选择冒险伙伴";
        }
        
        // 触发一次P1颜色预览 (模拟 input 事件)
        const hairInput = document.getElementById('p1-color-hair');
        if(hairInput) hairInput.dispatchEvent(new Event('input'));
        
        selectedPartnerCharId = null;
    };
    
    const loadGameBtn = document.getElementById('rpg-load-game-btn');
    if (loadGameBtn) loadGameBtn.onclick = () => {
        switchScreen('rpg-profile-screen');
        renderProfileList();
    };

    const exitGameBtn = document.getElementById('rpg-exit-game-btn');
    if (exitGameBtn) exitGameBtn.onclick = () => switchScreen('home-screen');

    // ================= 2. 档案与存档/读档页按钮 =================
    const profileBackBtn = document.getElementById('rpg-profile-back-btn');
    if (profileBackBtn) profileBackBtn.onclick = () => switchScreen('rpg-title-screen');

    // 【修正】存档/读档页的返回按钮
    const loadBackBtn = document.getElementById('rpg-save-back-btn');
    if (loadBackBtn) loadBackBtn.onclick = (e) => {
        e.preventDefault();
        rpgHandleSaveBack(); // 调用智能返回函数
    };

    // ================= 3. 角色创建页按钮 =================
    const startAdvBtn = document.getElementById('rpg-start-adventure-btn');
    if (startAdvBtn) startAdvBtn.onclick = () => rpgStartNewGame();
    
    // 初始化角色创建页的逻辑 (颜色选择器等)
    if (typeof setupRpgCreateScreenLogic === 'function') setupRpgCreateScreenLogic();

    // ================= 4. 游戏内 HUD 按钮 =================
    const backToTitleBtn = document.getElementById('rpg-back-to-title-btn');
    if (backToTitleBtn) backToTitleBtn.onclick = () => rpgBackToTitle();
    
    const menuToggleBtn = document.getElementById('rpg-menu-toggle-btn');
    if (menuToggleBtn) menuToggleBtn.onclick = (e) => {
        e.stopPropagation();
        if (window.rpgGameInstance) window.rpgGameInstance.toggleMenu(true);
    };

    // ================= 5. 暂停页面按钮 (新版) =================
    const pauseBackBtn = document.getElementById('rpg-pause-back-btn');
    if (pauseBackBtn) pauseBackBtn.onclick = () => {
        if (window.rpgGameInstance) window.rpgGameInstance.toggleMenu(false);
    };

    const menuStatusBtn = document.getElementById('rpg-menu-status-btn');
    if (menuStatusBtn) menuStatusBtn.onclick = () => {
        if (window.rpgGameInstance) window.rpgGameInstance.openStatus();
    };

    const menuBagBtn = document.getElementById('rpg-menu-bag-btn');
    if (menuBagBtn) menuBagBtn.onclick = () => {
        if (window.rpgGameInstance) window.rpgGameInstance.openInventory('map');
    };

    const menuSaveBtn = document.getElementById('rpg-menu-save-btn');
    if (menuSaveBtn) menuSaveBtn.onclick = () => {
        rpgSaveContext = 'pause_save';
        rpgShowSaveScreen();
    };

    const menuLoadBtn = document.getElementById('rpg-menu-load-btn');
    if (menuLoadBtn) menuLoadBtn.onclick = () => {
        rpgSaveContext = 'pause_load';
        rpgShowLoadScreen();
    };

    const menuQuitBtn = document.getElementById('rpg-menu-quit-btn');
    if (menuQuitBtn) menuQuitBtn.onclick = async() => {
        if(await AppUI.confirm("确定要放弃当前进度返回标题吗？", "返回标题", "确认", "取消")) {
            switchScreen('rpg-title-screen');
        }
    };

    // ================= 6. 战斗相关按钮 =================
    document.querySelectorAll('.rpg-battle-btn').forEach(btn => {
        btn.onclick = (e) => {
            const action = e.target.dataset.action;
            if (window.rpgGameInstance && action) {
                window.rpgGameInstance.inputBattleCommand(action);
            }
        };
    });

    const battleBagBtn = document.getElementById('rpg-battle-bag-btn');
    if (battleBagBtn) battleBagBtn.onclick = (e) => {
        e.stopPropagation();
        if (window.rpgGameInstance) window.rpgGameInstance.openInventory('battle');
    };

    const stopAutoBtn = document.getElementById('rpg-auto-battle-btn');
    if (stopAutoBtn) stopAutoBtn.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (window.rpgGameInstance) window.rpgGameInstance.toggleAutoBattle(false);
    };

    const startAutoBtn = document.getElementById('rpg-start-auto-btn');
    if (startAutoBtn) startAutoBtn.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (window.rpgGameInstance) window.rpgGameInstance.toggleAutoBattle(true);
    };
    
    // ================= 7. 交互与控制按钮 =================
    const interactBtn = document.getElementById('rpg-interact-btn');
    if (interactBtn) interactBtn.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (window.rpgGameInstance) window.rpgGameInstance.triggerInteraction();
    };

    // 绑定对话框点击 (推进剧情)
    const dialogBox = document.getElementById('rpg-bottom-dialog');
    if (dialogBox) dialogBox.onclick = () => {
        if (window.rpgGameInstance) window.rpgGameInstance.nextStory();
    };
    
    // 绑定方向键与确认键
    document.querySelectorAll('.rpg-ctrl-btn').forEach(btn => {
        btn.onclick = (e) => {
            if (!window.rpgGameInstance) return;
            const key = e.target.dataset.key;
            if (key === 'left') window.rpgGameInstance.moveTargetCursor(-1);
            else if (key === 'right') window.rpgGameInstance.moveTargetCursor(1);
            else if (key === 'confirm') window.rpgGameInstance.confirmTarget();
            else if (key === 'cancel') window.rpgGameInstance.cancelTarget();
        };
    });

    // ================= 8. 页面可见性监听 (自动暂停) =================
    const gameScreen = document.getElementById('rpg-game-screen');
    if (gameScreen) {
        // 先断开旧的 observer (如果有) 防止重复监听，这里简单重新创建
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.target.id === 'rpg-game-screen') {
                    // 如果游戏屏幕不再包含 active 类（即被隐藏了）
                    if (!mutation.target.classList.contains('active')) {
                        if (window.rpgGameInstance) window.rpgGameInstance.stop();
                    }
                }
            });
        });
        observer.observe(gameScreen, { attributes: true, attributeFilter: ['class'] });
    }
}