
            
           
                                 // ==================================================================================================================
            // ========================================== 角色卡导入 (CHARACTER IMPORT) ==========================================
            // ==================================================================================================================

            /**
             * 处理角色卡文件导入
             * @param {File} file - 用户选择的文件
             */
                             // --- 新增：导入角色卡按钮事件 ---
                const importBtn = document.getElementById('import-character-card-btn');
                const cardInput = document.getElementById('character-card-input');
                importBtn.addEventListener('click', () => {
                    cardInput.click();
                });
                cardInput.addEventListener('change', (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        handleCharacterImport(file);
                    }
                    // 重置输入框，以便可以再次选择相同的文件
                    e.target.value = null;
                });
                
                
            async function handleCharacterImport(file) {
                if (!file) return;

                showToast('正在导入角色卡...');

                try {
                    if (file.name.endsWith('.png')) {
                        await parseCharPng(file);
                    } else if (file.name.endsWith('.json')) {
                        await parseCharJson(file);
                    } else {
                        throw new Error('不支持的文件格式。请选择 .png 或 .json 文件。');
                    }
                } catch (error) {
                    console.error('角色卡导入失败:', error);
                    showToast(`导入失败: ${error.message}`);
                }
            }

            /**
             * 解析PNG角色卡
             * @param {File} file - PNG文件
             */
            function parseCharPng(file) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.readAsArrayBuffer(file);
                    reader.onload = (e) => {
                        try {
                            const buffer = e.target.result;
                            const view = new DataView(buffer);

                            // 1. 验证PNG文件签名 (PNG signature)
                            const signature = [137, 80, 78, 71, 13, 10, 26, 10];
                            for (let i = 0; i < signature.length; i++) {
                                if (view.getUint8(i) !== signature[i]) {
                                    return reject(new Error('文件不是一个有效的PNG。'));
                                }
                            }

                            let offset = 8; // 跳过8字节的签名
                            let charaData = null;

                            // 2. 遍历PNG数据块 (chunks)
                            while (offset < view.byteLength) {
                                const length = view.getUint32(offset); // 数据块内容的长度
                                const type = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));

                                // 3. 寻找tEXt文本块
                                if (type === 'tEXt') {
                                    const textChunk = new Uint8Array(buffer, offset + 8, length);

                                    // 寻找关键字和数据之间的空字符分隔符
                                    let separatorIndex = -1;
                                    for (let i = 0; i < textChunk.length; i++) {
                                        if (textChunk[i] === 0) {
                                            separatorIndex = i;
                                            break;
                                        }
                                    }

                                    if (separatorIndex !== -1) {
                                        const keyword = new TextDecoder('utf-8').decode(textChunk.slice(0, separatorIndex));

                                        // 4. 检查关键字是否为 'chara'
                                        if (keyword === 'chara') {
                                            const base64Data = new TextDecoder('utf-8').decode(textChunk.slice(separatorIndex + 1));

                                            // 5. 解码Base64数据
                                            try {
                                                const decodedString = atob(base64Data);
                                                const bytes = new Uint8Array(decodedString.length);
                                                for (let i = 0; i < decodedString.length; i++) {
                                                    bytes[i] = decodedString.charCodeAt(i);
                                                }
                                                const utf8Decoder = new TextDecoder('utf-8');
                                                charaData = JSON.parse(utf8Decoder.decode(bytes));
                                                break; // 找到数据后就停止遍历
                                            } catch (decodeError) {
                                                return reject(new Error(`解析角色数据失败: ${decodeError.message}`));
                                            }
                                        }
                                    }
                                }

                                // 移动到下一个数据块 (长度 + 类型 + 内容 + CRC校验 = 4 + 4 + length + 4)
                                offset += 12 + length;
                            }

                            if (charaData) {
                                // 6. 将PNG文件本身转换为头像的Data URL
                                const imageReader = new FileReader();
                                imageReader.readAsDataURL(file);
                                imageReader.onload = (imgEvent) => {
                                    createCharacterFromData(charaData, imgEvent.target.result);
                                    resolve();
                                };
                                imageReader.onerror = () => {
                                    // 即使头像转换失败，也用默认头像创建角色
                                    createCharacterFromData(charaData, 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg');
                                    resolve();
                                };
                            } else {
                                reject(new Error('在PNG中未找到有效的角色数据 (tEXt chunk not found or invalid)。'));
                            }
                        } catch (error) {
                            reject(new Error(`解析PNG失败: ${error.message}`));
                        }
                    };
                    reader.onerror = () => reject(new Error('读取PNG文件失败。'));
                });
            }

            /**
             * 解析JSON角色卡
             * @param {File} file - JSON文件
             */
            function parseCharJson(file) {
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    // 强制使用UTF-8解码
                    reader.readAsText(file, 'UTF-8');
                    reader.onload = (e) => {
                        try {
                            const data = JSON.parse(e.target.result);
                            // JSON卡没有内置头像，使用默认头像
                            createCharacterFromData(data, 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg');
                            resolve();
                        } catch (error) {
                            reject(new Error(`解析JSON失败: ${error.message}`));
                        }
                    };
                    reader.onerror = () => reject(new Error('读取JSON文件失败。'));
                });
            }

            /**
             * 根据导入的数据创建新角色
             * @param {object} data - 从卡片解析出的角色数据
             * @param {string} avatar - Base64格式的头像数据
             */
            async function createCharacterFromData(data, avatar) {
                // 优先使用 data.data 结构（针对哈基米.json格式），同时保留对根级别数据的兼容
                const charData = data.data || data;

                if (!charData || !charData.name) {
                    throw new Error('角色卡数据无效，缺少角色名称。');
                }

                // 数据映射：将导入卡片的字段映射到本应用的字段
                const newChar = {
                    id: `char_${Date.now()}`,
                    realName: charData.name || '未命名',
                    remarkName: charData.name || '未命名',
                    persona: charData.description || charData.persona || '',
                    avatar: avatar || 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg',
                    myName: '',
                    myNickname: '',
                    myPersona: '',
                    myAvatar: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg',
                    boundPersonaId: null,
                    theme: 'white_blue',
                    maxMemory: 10,
                    chatBg: '',
                    history: [],
                    isPinned: false,
                    status: '在线',
                    worldBookIds: [],
                    useCustomBubbleCss: false,
                    customBubbleCss: '',
                    unreadCount: 0,
                    memoryJournals: [],
                    journalWorldBookIds: [],
                    peekScreenSettings: { wallpaper: '', customIcons: {}, unlockAvatar: '' },
                    lastUserMessageTimestamp: null,
                };

                // --- 新增：处理世界书 (兼容两种格式) ---
                const importedWorldBookIds = [];

                // 格式一：处理哈基米.json中的 character_book
                if (charData.character_book && Array.isArray(charData.character_book.entries)) {
                    const categoryName = data.name || charData.name; // 优先使用根级的name作为分类名
                    charData.character_book.entries.forEach(entry => {
                        const name = entry.comment;
                        const content = entry.content;
                        if (name && content) {
                            const existingBook = db.worldBooks.find(wb => wb.name.toLowerCase() === name.toLowerCase());
                            if (existingBook) {
                                if (!importedWorldBookIds.includes(existingBook.id)) {
                                    importedWorldBookIds.push(existingBook.id);
                                }
                            } else {
                                const newBook = {
                                    id: `wb_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                    name: name,
                                    content: content,
                                    position: 'after',
                                    category: categoryName
                                };
                                db.worldBooks.push(newBook);
                                importedWorldBookIds.push(newBook.id);
                            }
                        }
                    });
                }
                // 格式二：处理通用格式的 world_info / wi
                else {
                    const worldInfo = charData.world_info || charData.wi || '';
                    if (worldInfo && typeof worldInfo === 'string' && worldInfo.trim() !== '') {
                        const entries = worldInfo.split(/\n\s*\n/).filter(entry => entry.trim() !== '');
                        entries.forEach(entryText => {
                            const lines = entryText.trim().split('\n');
                            if (lines.length > 0) {
                                const name = lines[0].trim();
                                const content = lines.slice(1).join('\n').trim();
                                if (name && content) {
                                    const existingBook = db.worldBooks.find(wb => wb.name.toLowerCase() === name.toLowerCase());
                                    if (existingBook) {
                                        if (!importedWorldBookIds.includes(existingBook.id)) {
                                            importedWorldBookIds.push(existingBook.id);
                                        }
                                    } else {
                                        const newBook = {
                                            id: `wb_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                                            name: name,
                                            content: content,
                                            position: 'after',
                                            category: '导入的角色设定'
                                        };
                                        db.worldBooks.push(newBook);
                                        importedWorldBookIds.push(newBook.id);
                                    }
                                }
                            }
                        });
                    }
                }

                if (importedWorldBookIds.length > 0) {
                    newChar.worldBookIds = importedWorldBookIds;
                    setTimeout(() => {
                        showToast(`同时导入了 ${importedWorldBookIds.length} 条世界书设定。`);
                    }, 1600);
                }
                // --- 新增逻辑结束 ---

                db.characters.push(newChar);
// 1. 保存新角色到角色表
await dexieDB.characters.put(newChar);
// 2. 如果导入了世界书，保存整个世界书表（因为 unshift 了新条目）
if (importedWorldBookIds.length > 0) {
    await saveWorldBookTable();
}
                renderChatList();
                showToast(`角色“${newChar.remarkName}”导入成功！`);
            }

            // ==================================================================================================================
            // ========================================== END CHARACTER IMPORT ==================================================
            // ==================================================================================================================