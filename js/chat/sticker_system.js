// --- js/sticker_system.js ---
// ==========================================
// 表情包管理系统 (独立模块)
// ==========================================

// 用于管理表情界面的专属状态 (原先散落在系统各处)
let isStickerManageMode = false;
let selectedStickerIds = new Set();
let currentStickerActionTarget = null;

// 重名处理函数
function getUniqueStickerName(baseName, excludeId = null) {
    let name = baseName;
    let counter = 1;
    while (db.myStickers.some(s => s.name === name && s.id !== excludeId)) {
        name = `${baseName}(${counter})`;
        counter++;
    }
    return name;
}

async function setupStickerSystem() {
    const batchAddStickerBtn = document.getElementById('batch-add-sticker-btn');
    const batchAddStickerModal = document.getElementById('batch-add-sticker-modal');
    const batchAddStickerForm = document.getElementById('batch-add-sticker-form');
    const stickerUrlsTextarea = document.getElementById('sticker-urls-textarea');
    const manageStickersBtn = document.getElementById('manage-stickers-btn');
    const stickerManageBar = document.getElementById('sticker-manage-bar');
    const deleteSelectedStickersBtn = document.getElementById('delete-selected-stickers-btn');
    
    const linkStickerBtn = document.getElementById('link-sticker-btn');
    const linkStickerModal = document.getElementById('link-sticker-modal');
    const cancelLinkBtn = document.getElementById('cancel-link-sticker-btn');
    const confirmLinkBtn = document.getElementById('confirm-link-sticker-btn');
    const linkSelectAllBtn = document.getElementById('link-sticker-select-all-btn'); 

    // ==========================================
    // 1. 关联表情包及【全选】逻辑
    // ==========================================
    linkStickerBtn.addEventListener('click', () => {
        selectedLinkStickerIds.clear();
        const chat = db.characters.find(c => c.id === currentChatId);
        const charIds = chat.stickerIds ||[];
        charIds.forEach(id => selectedLinkStickerIds.add(id)); 
        
        currentLinkStickerCategory = '全部'; 
        renderLinkStickerGrid();
        linkStickerModal.classList.add('visible');
    });

    cancelLinkBtn.addEventListener('click', () => {
        linkStickerModal.classList.remove('visible');
    });

    confirmLinkBtn.addEventListener('click', async () => {
        const chat = db.characters.find(c => c.id === currentChatId);
        chat.stickerIds = Array.from(selectedLinkStickerIds);
        await saveData();
        showToast('关联成功');
        linkStickerModal.classList.remove('visible');
    });

    linkSelectAllBtn.addEventListener('click', () => {
        let stickersInView = db.myStickers;
        if (currentLinkStickerCategory !== '全部') {
            stickersInView = db.myStickers.filter(s => (s.category || '默认') === currentLinkStickerCategory);
        }
        
        const allSelected = stickersInView.every(s => selectedLinkStickerIds.has(s.id));
        
        if (allSelected) {
            stickersInView.forEach(s => selectedLinkStickerIds.delete(s.id));
        } else {
            stickersInView.forEach(s => selectedLinkStickerIds.add(s.id));
        }
        renderLinkStickerGrid(); 
    });

    // ==========================================
    // 2. 分类标签长按管理菜单逻辑
    // ==========================================
    const categoryActionSheet = document.getElementById('category-actionsheet');
    const renameCategoryBtn = document.getElementById('rename-category-btn');
    const linkCategoryBtn = document.getElementById('link-category-btn');
    const deleteCategoryBtn = document.getElementById('delete-category-btn');

    categoryActionSheet.addEventListener('click', (e) => {
        if (e.target === categoryActionSheet) {
            categoryActionSheet.classList.remove('visible');
        }
    });

    renameCategoryBtn.addEventListener('click', () => {
        categoryActionSheet.classList.remove('visible');
        if (!currentActionCategory || currentActionCategory === '默认') return; 
        
        const bar = document.getElementById('sticker-category-bar');
        const btns = Array.from(bar.querySelectorAll('.category-btn'));
        const targetBtn = btns.find(b => b.textContent === currentActionCategory);
        if (!targetBtn) return;
        
        targetBtn.style.userSelect = 'text';
        targetBtn.style.webkitUserSelect = 'text';
        targetBtn.style.webkitTouchCallout = 'default';
        targetBtn.contentEditable = "true";
        targetBtn.focus();
        const range = document.createRange();
        range.selectNodeContents(targetBtn);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        
        const finishEditing = async () => {
            targetBtn.contentEditable = "false";
            targetBtn.style.userSelect = 'none';
            targetBtn.style.webkitUserSelect = 'none';
            targetBtn.style.webkitTouchCallout = 'none';

            const newName = targetBtn.textContent.trim();
            targetBtn.removeEventListener('blur', finishEditing);
            targetBtn.removeEventListener('keydown', keydownHandler);
            
            if (!newName || newName === '全部' || newName === '默认') { 
                showToast('分类名称无效');
                renderStickerGrid(); 
                return;
            }
            
            if (newName !== currentActionCategory) {
                db.myStickers.forEach(s => {
                    const sCat = s.category || '默认';
                    if (sCat === currentActionCategory) s.category = newName;
                });
                await saveData();
                if (currentStickerCategory === currentActionCategory) {
                    currentStickerCategory = newName;
                }
                showToast(`分类已重命名为 ${newName}`);
            }
            renderStickerGrid();
        };

        const keydownHandler = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                targetBtn.blur(); 
            }
        };
        
        targetBtn.addEventListener('blur', finishEditing);
        targetBtn.addEventListener('keydown', keydownHandler);
    });

    linkCategoryBtn.addEventListener('click', async () => {
        categoryActionSheet.classList.remove('visible');
        if (!currentActionCategory || currentChatType !== 'private') return;
        
        const chat = db.characters.find(c => c.id === currentChatId);
        if (!chat) return;

        const stickersInCat = db.myStickers.filter(s => (s.category || '默认') === currentActionCategory);
        const idsToLink = stickersInCat.map(s => s.id);
        
        const currentSet = new Set(chat.stickerIds ||[]);
        idsToLink.forEach(id => currentSet.add(id));
        chat.stickerIds = Array.from(currentSet);
        
        await saveData();
        showToast(`已将该分类的 ${idsToLink.length} 个表情关联到角色`);
    });

    deleteCategoryBtn.addEventListener('click', async () => {
        categoryActionSheet.classList.remove('visible');
        if (!currentActionCategory || currentActionCategory === '默认') return;

        const stickersInCat = db.myStickers.filter(s => (s.category || '默认') === currentActionCategory);
        
        if (await AppUI.confirm(`确定要彻底删除【${currentActionCategory}】分类下的所有 ${stickersInCat.length} 个表情包吗？此操作不可恢复！`)) {
            const idsToDelete = new Set(stickersInCat.map(s => s.id));
            
            db.myStickers = db.myStickers.filter(s => !idsToDelete.has(s.id));
            db.characters.forEach(c => {
                if (c.stickerIds) {
                    c.stickerIds = c.stickerIds.filter(id => !idsToDelete.has(id));
                }
            });
            
            await dexieDB.myStickers.bulkDelete(Array.from(idsToDelete));
            await saveData();
            
            if (currentStickerCategory === currentActionCategory) {
                currentStickerCategory = '全部';
            }
            showToast(`已删除整个分类`);
            renderStickerGrid();
        }
    });

    // ==========================================
    // 3. 批量管理与彻底删除
    // ==========================================
    manageStickersBtn.addEventListener('click', () => {
        isStickerManageMode = !isStickerManageMode;
        if (isStickerManageMode) {
            manageStickersBtn.textContent = '取消';
            manageStickersBtn.classList.replace('btn-primary', 'btn-neutral');
            stickerManageBar.style.display = 'flex';
        } else {
            manageStickersBtn.textContent = '管理';
            manageStickersBtn.classList.replace('btn-neutral', 'btn-primary');
            stickerManageBar.style.display = 'none';
            selectedStickerIds.clear();
        }
        deleteSelectedStickersBtn.textContent = `删除已选 (${selectedStickerIds.size})`;
        deleteSelectedStickersBtn.disabled = selectedStickerIds.size === 0;
        renderStickerGrid();
    });

    deleteSelectedStickersBtn.addEventListener('click', async () => {
        if (selectedStickerIds.size === 0) return showToast('请先选择');
        
        if (await AppUI.confirm(`将彻底从库中删除这 ${selectedStickerIds.size} 个表情，是否继续？`)) {
            db.myStickers = db.myStickers.filter(s => !selectedStickerIds.has(s.id));
            db.characters.forEach(c => {
                if (c.stickerIds) {
                    c.stickerIds = c.stickerIds.filter(id => !selectedStickerIds.has(id));
                }
            });
            await dexieDB.myStickers.bulkDelete(Array.from(selectedStickerIds));
            await saveData();
            
            showToast('删除成功');
            isStickerManageMode = false;
            manageStickersBtn.textContent = '管理';
            manageStickersBtn.classList.replace('btn-neutral', 'btn-primary');
            stickerManageBar.style.display = 'none';
            selectedStickerIds.clear();
            renderStickerGrid();
        }
    });

    // ==========================================
    // 4. 面板打开控制及上传功能
    // ==========================================
    stickerToggleBtn.addEventListener('click', () => {
        const chatExpansionPanel = document.getElementById('chat-expansion-panel');
        if (chatExpansionPanel.classList.contains('visible')) {
            chatExpansionPanel.classList.remove('visible');
        }
        if (currentChatType === 'group') {
            linkStickerBtn.style.display = 'none';
        } else {
            linkStickerBtn.style.display = 'inline-block';
        }
        
        stickerModal.classList.toggle('visible');
        if (stickerModal.classList.contains('visible')) {
            renderStickerGrid();
        }
    });
    
    addNewStickerBtn.addEventListener('click', () => {
        addStickerModalTitle.textContent = '添加新表情';
        addStickerForm.reset();
        stickerEditIdInput.value = '';
        document.getElementById('sticker-category-input').value = currentStickerCategory === '全部' ? '' : currentStickerCategory;
        stickerPreview.innerHTML = '<span>预览</span>';
        stickerUrlInput.disabled = false;
        addStickerModal.classList.add('visible');
    });
    
    addStickerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        let name = stickerNameInput.value.trim();
        let category = document.getElementById('sticker-category-input').value.trim() || '默认';
        const id = stickerEditIdInput.value;
        const previewImg = stickerPreview.querySelector('img');
        const data = previewImg ? previewImg.src : null;
        if (!name || !data) return showToast('请填写表情名称并提供图片');
        
        name = getUniqueStickerName(name, id);
        const stickerData = { name, data, category };
        if (id) {
            const index = db.myStickers.findIndex(s => s.id === id);
            if (index > -1) db.myStickers[index] = { ...db.myStickers[index], ...stickerData };
        } else {
            stickerData.id = `sticker_${Date.now()}`;
            db.myStickers.push(stickerData);
        }
        await saveData();
        renderStickerGrid();
        addStickerModal.classList.remove('visible');
        showToast('表情包已保存');
    });
    
    stickerUrlInput.addEventListener('input', (e) => {
        stickerPreview.innerHTML = `<img src="${e.target.value}" alt="预览">`;
        stickerFileUpload.value = '';
    });
    
    stickerFileUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const compressedUrl = await compressImage(file, { quality: 0.8, maxWidth: 200, maxHeight: 200 });
                stickerPreview.innerHTML = `<img src="${compressedUrl}" alt="预览">`;
                stickerUrlInput.value = '';
                stickerUrlInput.disabled = true;
            } catch (error) {
                showToast('表情包压缩失败，请重试');
            }
        }
    });

    // ==========================================
    // 5. 批量导入 (已优化：支持空格与中英文冒号)
    // ==========================================
    batchAddStickerBtn.addEventListener('click', () => {
        batchAddStickerModal.classList.add('visible');
        stickerUrlsTextarea.value = ''; 
    });
    
    batchAddStickerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const textInput = stickerUrlsTextarea.value.trim();
        const category = document.getElementById('batch-category-input').value.trim() || '默认';
        
        if (!textInput) return showToast('请输入表情包数据');
        const lines = textInput.split('\n');
        const newStickers =[];
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue; 
            
            // ⭐️ 核心修改点：利用 'http' 的位置进行精确分割
            // 这意味着前面无论用的是 ":"、"：" 还是纯空格，甚至名字里本身带空格，都不会出错
            const httpIndex = trimmedLine.indexOf('http');
            if (httpIndex <= 0) continue; 
            
            let nameRaw = trimmedLine.substring(0, httpIndex).trim();
            // 剥离掉名称末尾附带的中英文冒号或空格
            let name = nameRaw.replace(/[:：\s]+$/, '');
            const url = trimmedLine.substring(httpIndex).trim();
            
            if (name && url.startsWith('http')) {
                name = getUniqueStickerName(name); 
                db.myStickers.push({id:'temp', name}); 
                newStickers.push({ 
                    id: `sticker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, 
                    name, 
                    data: url,
                    category
                });
            }
        }
        db.myStickers = db.myStickers.filter(s => s.id !== 'temp');
        
        if (newStickers.length > 0) {
            db.myStickers.push(...newStickers); 
            await saveData();
            renderStickerGrid();
            batchAddStickerModal.classList.remove('visible');
            showToast(`成功导入 ${newStickers.length} 个新表情！`);
        } else {
            showToast('没有识别到合法的表情格式');
        }
    });

    // ==========================================
    // 6. 编辑和彻底删除(单张长按菜单)
    // ==========================================
    editStickerBtn.addEventListener('click', () => {
        if (!currentStickerActionTarget) return;
        const sticker = db.myStickers.find(s => s.id === currentStickerActionTarget);
        if (sticker) {
            addStickerModalTitle.textContent = '编辑表情';
            stickerEditIdInput.value = sticker.id;
            stickerNameInput.value = sticker.name;
            document.getElementById('sticker-category-input').value = sticker.category || '默认';
            stickerPreview.innerHTML = `<img src="${sticker.data}" alt="预览">`;
            if (sticker.data.startsWith('http')) {
                stickerUrlInput.value = sticker.data;
                stickerUrlInput.disabled = false;
            } else {
                stickerUrlInput.value = '';
                stickerUrlInput.disabled = true;
            }
            addStickerModal.classList.add('visible');
        }
        stickerActionSheet.classList.remove('visible');
        currentStickerActionTarget = null;
    });
    
    deleteStickerBtn.addEventListener('click', async () => {
        if (!currentStickerActionTarget) return;
        const sticker = db.myStickers.find(s => s.id === currentStickerActionTarget);
        if (sticker) {
            if (await AppUI.confirm(`确定要彻底删除表情“${sticker.name}”吗？`)) {
                db.myStickers = db.myStickers.filter(s => s.id !== currentStickerActionTarget);
                db.characters.forEach(c => {
                    if (c.stickerIds) c.stickerIds = c.stickerIds.filter(id => id !== currentStickerActionTarget);
                });
                await dexieDB.myStickers.delete(currentStickerActionTarget);
                await saveData();
                renderStickerGrid();
                showToast('表情已彻底删除');
            }
        }
        stickerActionSheet.classList.remove('visible');
        currentStickerActionTarget = null;
    });
}

// ==========================================================
// ======================= 渲染函数 =========================
// ==========================================================

function renderCategoryBar() {
    const bar = document.getElementById('sticker-category-bar');
    const datalist = document.getElementById('category-datalist');
    if (!bar) return;

    const categories = new Set(['全部', '默认']);
    db.myStickers.forEach(s => { if (s.category) categories.add(s.category); });

    bar.innerHTML = '';
    categories.forEach(cat => {
        const btn = document.createElement('div');
        btn.className = `category-btn ${cat === currentStickerCategory ? 'active' : ''}`;
        btn.textContent = cat;
        
        btn.style.userSelect = 'none';
        btn.style.webkitUserSelect = 'none';
        btn.style.webkitTouchCallout = 'none';
        
        btn.onclick = (e) => {
            if (btn.isContentEditable) return; 
            currentStickerCategory = cat;
            renderStickerGrid();
        };

        const handleCategoryLongPress = () => {
            if (cat === '全部' || btn.isContentEditable) return;
            currentActionCategory = cat;
            
            const linkBtn = document.getElementById('link-category-btn');
            const renameBtn = document.getElementById('rename-category-btn');
            const deleteBtn = document.getElementById('delete-category-btn');

            if (currentChatType === 'private') {
                linkBtn.style.display = 'block';
            } else {
                linkBtn.style.display = 'none';
            }
            
            if (cat === '默认') {
                renameBtn.style.display = 'none';
                deleteBtn.style.display = 'none';
            } else {
                renameBtn.style.display = 'block';
                deleteBtn.style.display = 'block';
            }
            
            if (linkBtn.style.display === 'none' && renameBtn.style.display === 'none') {
                return;
            }
            
            document.getElementById('category-actionsheet').classList.add('visible');
        };

        btn.addEventListener('contextmenu', (e) => {
            if (cat === '全部' || btn.isContentEditable) return;
            e.preventDefault(); 
            e.stopPropagation();
            handleCategoryLongPress();
        });

        let catPressTimer;
        btn.addEventListener('touchstart', (e) => {
            if (cat === '全部' || btn.isContentEditable) return;
            e.stopPropagation();
            catPressTimer = setTimeout(() => handleCategoryLongPress(), 500);
        });
        btn.addEventListener('touchend', () => clearTimeout(catPressTimer));
        btn.addEventListener('touchmove', () => clearTimeout(catPressTimer)); 

        bar.appendChild(btn);
    });

    if (datalist) {
        datalist.innerHTML = '';
        categories.forEach(cat => {
            if (cat !== '全部' && cat !== '默认') {
                const opt = document.createElement('option');
                opt.value = cat;
                datalist.appendChild(opt);
            }
        });
    }
}

function renderStickerGrid() {
    stickerGridContainer.innerHTML = '';
    renderCategoryBar();
    
    let stickersToRender = db.myStickers;
    if (currentStickerCategory !== '全部') {
        stickersToRender = db.myStickers.filter(s => (s.category || '默认') === currentStickerCategory);
    }

    if (stickersToRender.length === 0) {
        const emptyMsg = currentStickerCategory === '全部' ? '还没有表情包，快去添加吧！' : `该分类下没有表情`;
        stickerGridContainer.innerHTML = `<p style="color:#aaa; text-align:center; margin-top: 20px; width: 100%;">${emptyMsg}</p>`;
        return;
    }

    stickersToRender.forEach(sticker => {
        const item = document.createElement('div');
        item.className = 'sticker-item';
        item.innerHTML = `<img src="${sticker.data}" alt="${sticker.name}"><span title="${sticker.name}">${sticker.name}</span>`;

        if (isStickerManageMode) {
            item.classList.add('is-managing');
            if (selectedStickerIds.has(sticker.id)) item.classList.add('is-selected');
            item.addEventListener('click', () => {
                if (selectedStickerIds.has(sticker.id)) {
                    selectedStickerIds.delete(sticker.id);
                    item.classList.remove('is-selected');
                } else {
                    selectedStickerIds.add(sticker.id);
                    item.classList.add('is-selected');
                }
                const deleteBtn = document.getElementById('delete-selected-stickers-btn');
                deleteBtn.textContent = `删除已选 (${selectedStickerIds.size})`;
                deleteBtn.disabled = selectedStickerIds.size === 0;
            });
        } else {
            // sendSticker 函数依旧由 chat_room.js 提供
            item.addEventListener('click', () => sendSticker(sticker));
            
            item.addEventListener('contextmenu', (e) => { 
                e.preventDefault(); e.stopPropagation();
                handleStickerLongPress(sticker.id);
            });
            item.addEventListener('touchstart', (e) => {
                e.stopPropagation();
                longPressTimer = setTimeout(() => handleStickerLongPress(sticker.id), 500);
            });
            item.addEventListener('touchend', () => clearTimeout(longPressTimer));
            item.addEventListener('touchmove', () => clearTimeout(longPressTimer));
        }
        stickerGridContainer.appendChild(item);
    });
}

function renderLinkStickerGrid() {
    const grid = document.getElementById('link-sticker-grid');
    const catBar = document.getElementById('link-sticker-category-bar');
    const selectAllBtn = document.getElementById('link-sticker-select-all-btn');
    
    const categories = new Set(['全部', '默认']);
    db.myStickers.forEach(s => { if (s.category) categories.add(s.category); });
    
    catBar.innerHTML = '';
    categories.forEach(cat => {
        const btn = document.createElement('div');
        btn.className = `category-btn ${cat === currentLinkStickerCategory ? 'active' : ''}`;
        btn.textContent = cat;
        btn.onclick = () => {
            currentLinkStickerCategory = cat;
            renderLinkStickerGrid(); 
        };
        catBar.appendChild(btn);
    });

    grid.innerHTML = '';
    let stickersToRender = db.myStickers;
    if (currentLinkStickerCategory !== '全部') {
        stickersToRender = db.myStickers.filter(s => (s.category || '默认') === currentLinkStickerCategory);
    }

    if (stickersToRender.length === 0) {
        grid.innerHTML = '<p style="color:#aaa; text-align:center; width: 100%;">该分类下没有表情。</p>';
        selectAllBtn.style.display = 'hidden';
        return;
    }
    selectAllBtn.style.display = 'visible';
    const allSelected = stickersToRender.every(s => selectedLinkStickerIds.has(s.id));
    selectAllBtn.textContent = allSelected ? '☑ 全选' : '☐ 全选';

    stickersToRender.forEach(sticker => {
        const item = document.createElement('div');
        item.className = 'sticker-item is-managing'; 
        item.innerHTML = `<img src="${sticker.data}" alt="${sticker.name}"><span>${sticker.name}</span>`;
        
        if (selectedLinkStickerIds.has(sticker.id)) {
            item.classList.add('is-selected');
        }

        item.addEventListener('click', () => {
            if (selectedLinkStickerIds.has(sticker.id)) {
                selectedLinkStickerIds.delete(sticker.id);
                item.classList.remove('is-selected');
            } else {
                selectedLinkStickerIds.add(sticker.id);
                item.classList.add('is-selected');
            }
            const nowAllSelected = stickersToRender.every(s => selectedLinkStickerIds.has(s.id));
            selectAllBtn.textContent = nowAllSelected ? '取消全选' : '全选';
        });
        grid.appendChild(item);
    });
}

function handleStickerLongPress(stickerId) {
    if (isStickerManageMode) return;
    clearTimeout(longPressTimer);
    currentStickerActionTarget = stickerId;
    stickerActionSheet.classList.add('visible');
}