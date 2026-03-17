const appVersion = "Q.1.3"; // Current app version
            const updateLog = [
                {
                    version: "Q.1.3",
                    date: "2026-03-17",
                    notes: [
                        "1.聊天增加了char【主动发消息】的功能。入口在“+”扩展菜单。切换到主动模式可设置消息发送频率和每日最大调用次数，用于调整char的发言频率。如果完全不需要收到角色消息，请设置为“免打扰模式”。默认是“随机模式”，不额外调用api随机发送消息。",
                        "2.修改了【偷看手机】功能，聊天、备忘录、购物车、中转站、浏览器、相册、unlock改为增量生成，长按可进入多选模式批量删除。",
                        "3.修改了时间感知功能的【时间显示方式】，用于适配主动发消息功能的时间戳。",
                        "4.增加【系统日志】查看功能，路径：设置-系统日志。",
                        "5.增加主页面聊天图标【未读消息角标】。",
                        "6.壁纸设置中新增【主页底部导航栏颜色适配】，只在网页直接打开中生效。",
                        "7.修复了一些已知问题：(1)修复群聊保存会触发时间感知的问题。(2)部分解决了发送按钮卡顿的问题。(3)修复论坛切换页面滚动位置错误问题。(4)修复消息列表不显示未读消息红点的问题。(5)修复壁纸设置中，修改主页顶部状态栏颜色时，会实时改变设置页面顶部状态颜色的问题。"
                    ]
                },
                {
                    version: "Q.1.2",
                    date: "2026-03-07",
                    notes: [
                        "1.聊天功能增加【外观】页面。可在这个页面查看自定义聊天室美化情况，支持自定义css，并可以通过基础面板按钮进一步修改。更换气泡请在原聊天设置中的气泡选框选择。",
                        "2.增加【屏幕自适应】功能，主要用于屏幕上的要素适应大屏幕。初始默认关闭，如果需要开启，请在主屏幕-底部设置图标-启用滑动返回-开启。",
                        "3.增加了【手势滑动返回】功能。初始默认关闭，如果需要开启，请在主屏幕-底部设置图标-启用滑动返回-开启。",
                        "4.【线下模式开启弹窗修改】，改为确认弹窗，原线下模式气泡css可在外观功能中直接修改。",
                        "5.修复了一些已知bug。"
                    ]
                },
                {
                    version: "Q.1.1",
                    date: "2026-02-28",
                    notes: [
                        "1.尝试适配了ios。可在设置界面选择是否需要上下避让。(这个功能对安卓没有用)",
                        "2.优化表情包功能。",
                        "(1)增加了分类，长按可以修改分类名字，一键关联，一键删除。",
                        "(2)增加了表情包关联，可以在char私聊窗口点击表情包，点击【关联】选择这个角色可以使用的表情包；群聊不支持单独关联，直接使用char私聊中关联的表情包。"
                    ]
                },
                {
                    version: "Q.1.0",
                    date: "2026-02-23",
                    notes: [
                        "【聊天】1.新增线下模式（仅限私聊）及全局搜索功能。",
                        "2.User人设现改为全局绑定模式，需先前往“我”页面新增和修改人设，其他所有涉及读取User人设的功能将统一采用此模式。",
                        "3.在群聊中修改昵称时，现会触发系统消息推送提示。",
                        "【世界书】新增“写作”分类。该分类不会作用于线上聊天，专用于线下模式、记忆档案、论坛等涉及长文字段落的场景。注意：“写作”分类在线下模式的提示词层级非常靠后，对生成结果的影响力显著高于“世界书（后）”。",
                        "【记忆档案】原“日记”功能修改为“记忆档案”。",
                        "1.新增“短期总结”与“长期总结”。角色日记不再直接加入聊天记忆，替换为总结内容为角色提供长时记忆。",
                        "2.日记与总结可分别关联不同的世界书，请前往界面重新设置关联。",
                        "3.支持“短期总结”与“日记”一键同步生成（注意：此操作需调用两次API，耗时较长，请耐心等待）。",
                        "【论坛】1.增加发帖与评论功能，并支持匿名互动。匿名默认用户名为“喵叽+四位数字”（数字可在“我”界面自定义修改，方便大家精分扮演不同人设调戏角色）。",
                        "2.发帖支持关联角色聊天记录，可自定义关联条数（建议适量，关联过多可能影响生成速度）。",
                        "3.新增【收藏】与【在看】功能，统一在底栏“收藏”页管理。【收藏】为私密仅自己可见；点亮【在看】则角色可见。提醒：与角色讨论完毕后记得取消【在看】，否则在你和其他角色聊天时，容易被意外翻旧账哦。",
                        "💡 论坛小贴士：建议在世界书或角色人设中明确写明“该角色网名是xxx”，以固定角色或NPC的回帖用户名。",
                        "【游戏】新增仿RPG游戏互动功能，带来更丰富的沉浸式体验。",
                        "【主页】把一些功能都整合到了底部“设置”中。",
                        "【其他】进行了大量零散细节的修改，因为比较零碎就不在日志里写了_(:з」∠)_"
                    ]
                },
                {
                    version: "1.3.0",
                    date: "2025-11-11",
                    notes: [
                        "务必仔细观看！重复观看指路→主屏幕的教程app→更新说明！",
                        "新增：双语模式，位于聊天界面的侧边栏内，当char为外国人而你想要更沉浸式的对话时，可按需开启，开启后会将“外文（中文）”的消息识别成双语消息气泡，注意！中文翻译必须在括号内，点击气泡后展开翻译。",
                        "↑补充：如果掉格式如何修改？编辑窗口将翻译括号内的其他括号删掉，比如带括号的颜文字、(笑)等。如果还有bug就先别开这个吧！",
                        "新增：流式传输开关，位于api设置界面，开跟不开不知道有什么区别，总之做了嗯嗯。没改之前默认是流式传输，如果非流出不来就开流式，流式出不来就关流式，都出不来我也没招了！",
                        "新增：拓展css美化代码，指路→主屏幕的自定义app→全局美化css中，下滑。有隐藏头像、底部变简洁、隐藏表情包背景之类的，可自行复制需要的部分放到全局美化中。",
                        "补充教学：发现有些宝宝还有地方不太清楚怎么使用，补充一下",
                        "1. 偷看手机：存储为临时存储，离开char手机页面后，偷看的相关内容将会清空，有喜欢的内容请及时截图",
                        "2. 回忆日记：生成日记后，需点亮该篇日记右上角的☆按钮收藏，收藏后该篇日记才会作为char的回忆加入聊天上下文中",
                        "3. 日记使用拓展方法：日记内容可编辑，当日记篇数过多/char被日记内的主观形容影响性格较大时，可以将你需要保留的日记内容复制给某个ai（豆包、deepseek、哈吉米都行）进行大总结，指令参考：以全客观的、不参杂任何主观情绪，以第三人称视角按照时间顺序总结发生过的事件和关键语句。然后将返回的总结塞进日记收藏加入上下文即可。",
                    ]
                },
                {
                    version: "1.2.0",
                    date: "2025-10-15",
                    notes: [
                        "新增：猫箱图床 (Catbox) 渲染机制，在当前绑定的表情包世界书中包含 'catbox' 关键词即可切换到猫箱模式，注意！iposting图床表情包和猫箱表情包不可同时渲染，只能选择一方。如：绑定了猫箱表情包世界书，就无法渲染过往iposting图床的表情包，不绑定则反之。",
                        "新增：世界书批量删除功能，长按条目即可进入多选删除模式，支持分类全选。",
                    ]
                },
                {
                    version: "1.1.0",
                    date: "2025-10-13",
                    notes: [
                        "重要！！已更换存储方式，请尽快导出原网址的备份并清理浏览器内该网址的数据，并重新在此网址导入备份",
                        "新增：番茄钟，可以创建专注任务并绑定char和自己的人设预设（仅可从预设中选择），在列表中左滑删除任务。专注期间想摸鱼了可以戳一戳头像，ta会对你做出回复。每个专注界面的设置键可以自定义鼓励频率和限制自己戳一戳的次数，超过次数则ta不会再理你，请补药偷懒，努力专注吧！",
                        "新增：两个桌面小组件，现所有小组件都可以通过点击来自定义图片和文字",
                        "优化：修复了存储膨胀的问题，现为测试阶段不确定是否有bug，请勤备份！唯有备份才是安全的！",
                        "优化：修复了一些使用体验上的小问题",
                        "画饼（未来可能会做的）：1.第二页的布局美化 2.日记本、存钱罐、音乐",
                    ]
                }
            ];
              
                                          // --- NEW: Update Log Functions ---
                function renderUpdateLog() {
                    const tutorialContent = document.getElementById('tutorial-content-area');
                    if (!tutorialContent) return;

                    const updateSection = document.createElement('div');
                    updateSection.className = 'tutorial-item'; // Use tutorial-item class, default open

                    let notesHtml = '';
                    updateLog.forEach((log, index) => {
                        notesHtml += `
                        <div style="margin-bottom: 15px; ${index < updateLog.length - 1 ? 'padding-bottom: 10px; border-bottom: 1px solid #f0f0f0;' : ''}">
                            <h4 style="font-size: 15px; color: #333; margin: 0 0 5px 0;">版本 ${log.version} (${log.date})</h4>
                            <ul style="padding-left: 20px; margin: 0; list-style-type: '› ';">
                                ${log.notes.map(note => `<li style="margin-bottom: 5px; color: #666;">${note}</li>`).join('')}
                            </ul>
                        </div>
                    `;
                    });

                    updateSection.innerHTML = `
                    <div class="tutorial-header">更新日志</div>
                    <div class="tutorial-content" style="padding-top: 15px;">
                        ${notesHtml}
                    </div>
                `;

                    tutorialContent.appendChild(updateSection);
                }

                function showUpdateModal() {
                    const modal = document.getElementById('update-log-modal');
                    const contentEl = document.getElementById('update-log-modal-content');
                    const closeBtn = document.getElementById('close-update-log-modal');

                    const latestLog = updateLog[0];
                    if (!latestLog) return;

                    contentEl.innerHTML = `
                    <h4>版本 ${latestLog.version} (${latestLog.date})</h4>
                    <ul>
                        ${latestLog.notes.map(note => `<li>${note}</li>`).join('')}
                    </ul>
                    <p style="font-size: 12px; color: #888; text-align: center; margin-top: 15px; border-top: 1px solid #eee; padding-top: 10px;">过往更新说明可在“教程”应用内查看。</p>
                `;

                    modal.classList.add('visible');

                    closeBtn.onclick = () => {
                        modal.classList.remove('visible');
                        localStorage.setItem('lastSeenVersion', appVersion);
                    };
                }

                function checkForUpdates() {
                    const lastSeenVersion = localStorage.getItem('lastSeenVersion');
                    if (lastSeenVersion !== appVersion) {
                        // Use a small delay to ensure the main UI has rendered
                        setTimeout(showUpdateModal, 500);
                    }
                }
                
  let loadingBtn = false;