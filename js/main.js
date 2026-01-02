import { DataStore } from './data.js';
import { DriveService } from './drive.js';

const app = {
    // UI State
    collapsedCategories: new Set(),
    isSyncing: false,  // Prevent concurrent syncs
    currentPage: 'home', // 'home' or 'tempFood'

    init() {
        // Load Local Data first (Offline-First)
        DataStore.load();
        this.sortFoodsAndRender();

        // Listen for updates
        window.addEventListener('data-updated', () => this.sortFoodsAndRender());

        // Drive Integration
        this.initDrive();

        // UI Listeners
        this.bindEvents();

        // Sync on page refresh/visibility change
        this.setupPageLifecycleSync();
    },

    // Sort foods by star rating and render
    sortFoodsAndRender() {
        const sortingChanged = this.sortFoodsByRating();
        if (sortingChanged) {
            // Save sorted data to trigger sync
            DataStore.save();
        }
        this.render();
    },

    // Sort foods within each category by star rating (high to low)
    // Returns true if order changed
    sortFoodsByRating() {
        let changed = false;
        for (const cat of DataStore.state.food_category) {
            const originalOrder = cat.food.map(f => f.food_name).join(',');
            cat.food.sort((a, b) => b.food_star - a.food_star);
            const newOrder = cat.food.map(f => f.food_name).join(',');
            if (originalOrder !== newOrder) {
                changed = true;
            }
        }
        return changed;
    },

    setupPageLifecycleSync() {
        // Sync when page becomes visible again
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && DriveService.isConnected) {
                this.performSync();
            }
        });

        // Sync before page unload (best effort)
        window.addEventListener('beforeunload', () => {
            if (DriveService.isConnected && navigator.onLine) {
                this.syncToDrive();
            }
        });

        // Listen for online status changes
        window.addEventListener('online', () => {
            if (DriveService.isConnected) {
                this.showToast("Back online, syncing...");
                this.performSync();
            }
        });
    },

    async initDrive() {
        const blocker = document.getElementById('loginBlocker');
        const loading = document.getElementById('loginLoading');
        const actions = document.getElementById('loginActions');

        if (loading && actions && blocker) {
            loading.style.display = 'block';
            actions.style.display = 'none';
        }

        const connected = await DriveService.init();

        if (DriveService.isConnected) {
            this.updateAuthStatus(true);
            if (blocker) blocker.classList.add('hidden');
            await this.performInitialSync();
        } else {
            this.updateAuthStatus(false);
            if (loading && actions && blocker) {
                loading.style.display = 'none';
                actions.style.display = 'block';
                blocker.classList.remove('hidden');

                const loginClientId = document.getElementById('loginClientId');
                const loginApiKey = document.getElementById('loginApiKey');
                if (loginClientId) loginClientId.value = localStorage.getItem('g_client_id') || '';
                if (loginApiKey) loginApiKey.value = localStorage.getItem('g_api_key') || '';

                const autoLogin = localStorage.getItem('g_auto_login');
                if (autoLogin === 'true') {
                    localStorage.removeItem('g_auto_login');
                    setTimeout(() => {
                        DriveService.signIn();
                    }, 500);
                }
            }
        }

        window.addEventListener('drive-disconnected', () => {
            this.updateAuthStatus(false);
            this.showToast("Connection lost, working offline", "error");
        });
    },

    bindEvents() {
        // FAB
        document.getElementById('fabBtn').onclick = () => {
            document.getElementById('choiceModal').classList.add('active');
        };

        // Settings
        document.getElementById('settingsBtn').onclick = () => {
            document.getElementById('settingsPanel').classList.toggle('hidden');
            this.loadSettingsValues();
        };

        // Temp Food Page Button
        document.getElementById('tempFoodBtn').onclick = () => {
            this.showTempFoodPage();
        };

        // Temp Food Back Button
        document.getElementById('tempFoodBackBtn').onclick = () => {
            this.showHomePage();
        };

        // Add Temp Food Button
        document.getElementById('addTempFoodBtn').onclick = () => {
            this.openFoodPickerModal();
        };

        // Food Search Input
        document.getElementById('foodSearchInput').oninput = (e) => {
            this.renderFoodPicker(e.target.value);
        };

        // Login Blocker Buttons
        const loginBtn = document.getElementById('loginConnectBtn');
        if (loginBtn) {
            loginBtn.onclick = () => {
                const clientId = document.getElementById('loginClientId').value.trim();
                const apiKey = document.getElementById('loginApiKey').value.trim();

                if (!clientId || !apiKey) {
                    this.showToast("Please enter Client ID and API Key", "error");
                    return;
                }

                localStorage.setItem('g_client_id', clientId);
                localStorage.setItem('g_api_key', apiKey);

                this.showToast("Saving keys...");
                localStorage.setItem('g_auto_login', 'true');
                setTimeout(() => window.location.reload(), 500);
            };
        }

        // Update from Drive
        document.getElementById('updateBtn').onclick = async () => {
            if (!DriveService.isConnected) {
                this.showToast("Not connected to Google Drive", "error");
                return;
            }

            this.showToast("Syncing with Google Drive...");
            await this.performSync();
            document.getElementById('settingsPanel').classList.add('hidden');
        };

        // Logout
        document.getElementById('logoutBtn').onclick = () => {
            if (confirm('Logout and return to login page?')) {
                DriveService._clearStoredToken();
                localStorage.removeItem('g_auto_login');
                localStorage.removeItem('myFodmap');
                window.location.reload();
            }
        };

        // Listen for drive connection
        window.addEventListener('drive-connected', async () => {
            this.updateAuthStatus(true);
            const blocker = document.getElementById('loginBlocker');
            if (blocker) blocker.classList.add('hidden');
            await this.performInitialSync();
        });

        // Listen for sync needed
        window.addEventListener('data-sync-needed', () => {
            this.performSync();
        });

        // Listen for sync completed
        window.addEventListener('sync-completed', (e) => {
            this.updateAuthStatus(true, e.detail?.time);
        });

        // Listen for toast events
        window.addEventListener('toast', (e) => {
            if (e.detail) {
                this.showToast(e.detail.message, e.detail.type || 'success');
            }
        });
    },

    // --- Page Navigation ---

    showTempFoodPage() {
        this.currentPage = 'tempFood';
        document.getElementById('categoriesContainer').classList.add('hidden');
        document.getElementById('settingsPanel').classList.add('hidden');
        document.getElementById('tempFoodPage').classList.remove('hidden');
        document.body.classList.add('temp-food-page-active');
        this.renderTempFoods();
    },

    showHomePage() {
        this.currentPage = 'home';
        document.getElementById('tempFoodPage').classList.add('hidden');
        document.getElementById('categoriesContainer').classList.remove('hidden');
        document.body.classList.remove('temp-food-page-active');
    },

    // --- Temp Food Logic ---

    openFoodPickerModal() {
        document.getElementById('foodSearchInput').value = '';
        this.renderFoodPicker('');
        document.getElementById('selectFoodModal').classList.add('active');
    },

    renderFoodPicker(searchTerm = '') {
        const container = document.getElementById('foodPickerList');
        container.innerHTML = '';

        const search = searchTerm.toLowerCase().trim();

        for (const cat of DataStore.state.food_category) {
            const filteredFoods = cat.food.filter(f =>
                f.food_name.toLowerCase().includes(search)
            );

            if (filteredFoods.length === 0) continue;

            // Category Header
            const catHeader = document.createElement('div');
            catHeader.className = 'food-picker-category';
            catHeader.textContent = cat.category_name;
            container.appendChild(catHeader);

            // Food Items
            for (const food of filteredFoods) {
                const item = document.createElement('div');
                item.className = 'food-picker-item';
                item.onclick = () => this.addTempFood(food.food_name, cat.category_name);

                const starHtml = this.getStarHtml(food.food_star);
                item.innerHTML = `
                    <div class="star-rating">${starHtml}</div>
                    <span class="food-name">${this.escapeHtml(food.food_name)}</span>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                `;
                container.appendChild(item);
            }
        }

        if (container.children.length === 0) {
            container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No foods found</div>`;
        }
    },

    addTempFood(foodName, categoryName) {
        DataStore.addTempFood(foodName);
        this.closeModals();
        this.showToast(`Added: ${foodName}`);
        this.renderTempFoods();
    },

    removeTempFood(index) {
        DataStore.removeTempFood(index);
        this.renderTempFoods();
    },

    logTempFoodGood(index) {
        const tempFoods = DataStore.getTempFoods();
        if (index >= 0 && index < tempFoods.length) {
            const foodName = tempFoods[index].food_name;
            DataStore.logFood(foodName, true);
            this.showToast(`Recorded: ${foodName} (Good)`);
            DataStore.removeTempFood(index);
            this.renderTempFoods();
        }
    },

    logTempFoodBad(index) {
        const tempFoods = DataStore.getTempFoods();
        if (index >= 0 && index < tempFoods.length) {
            const foodName = tempFoods[index].food_name;
            DataStore.logFood(foodName, false);
            this.showToast(`Recorded: ${foodName} (Bad)`, "error");
            DataStore.removeTempFood(index);
            this.renderTempFoods();
        }
    },

    renderTempFoods() {
        const list = document.getElementById('tempFoodList');
        const empty = document.getElementById('tempFoodEmpty');
        const tempFoods = DataStore.getTempFoods();

        if (tempFoods.length === 0) {
            list.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        empty.style.display = 'none';
        list.innerHTML = '';

        tempFoods.forEach((tempFood, index) => {
            const item = document.createElement('div');
            item.className = 'temp-food-item';

            const safeName = this.escapeHtml(tempFood.food_name);

            // Find category for this food
            let categoryName = '';
            for (const cat of DataStore.state.food_category) {
                if (cat.food.some(f => f.food_name === tempFood.food_name)) {
                    categoryName = cat.category_name;
                    break;
                }
            }
            const safeCat = this.escapeHtml(categoryName);

            item.innerHTML = `
                <div class="food-info">
                    <div class="food-name">${safeName}</div>
                    <div class="food-category">${safeCat}</div>
                </div>
                <div class="food-actions">
                    <button class="btn btn-good" onclick="app.logTempFoodGood(${index})">
                        👍 Good
                    </button>
                    <button class="btn btn-bad" onclick="app.logTempFoodBad(${index})">
                        👎 Bad
                    </button>
                    <button class="btn btn-remove" onclick="app.removeTempFood(${index})" title="Remove">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            `;
            list.appendChild(item);
        });
    },

    // --- Settings & Auth ---

    loadSettingsValues() {
        document.getElementById('clientIdInput').value = localStorage.getItem('g_client_id') || '';
        document.getElementById('apiKeyInput').value = localStorage.getItem('g_api_key') || '';
    },

    updateAuthStatus(isConnected, syncTime = null) {
        const text = document.getElementById('statusText');
        const indicator = document.getElementById('statusIndicator');

        if (isConnected) {
            const formattedTime = syncTime
                ? new Date(syncTime).toLocaleString()
                : DriveService.getFormattedSyncTime();

            if (formattedTime) {
                text.textContent = `Synced with Drive (${formattedTime})`;
            } else {
                text.textContent = "Synced with Drive";
            }
            indicator.classList.add('connected');
        } else {
            text.textContent = "Not Connected";
            indicator.classList.remove('connected');
        }
    },

    // --- Sync Logic ---

    async performInitialSync() {
        if (!DriveService.isConnected || !navigator.onLine) {
            return;
        }

        try {
            const cloudResult = await DriveService.getCloudDataWithTimestamp();

            if (cloudResult && cloudResult.data) {
                const localTimestamp = DataStore.getLastModified();
                const cloudTimestamp = cloudResult.timestamp;

                console.log("Initial sync - Local:", localTimestamp, "Cloud:", cloudTimestamp);

                if (!localTimestamp || (cloudTimestamp && new Date(cloudTimestamp) >= new Date(localTimestamp))) {
                    DataStore.importJSON(JSON.stringify(cloudResult.data), true);
                    DriveService.lastSyncTime = new Date().toISOString();
                    this.updateAuthStatus(true, DriveService.lastSyncTime);
                    this.sortFoodsAndRender();
                    this.showToast("Data loaded from Cloud");
                } else {
                    await DriveService.saveFile(DataStore.exportJSON());
                    this.showToast("Local data synced to Cloud");
                }
            } else {
                if (DataStore.state.food_category.length > 0) {
                    await DriveService.saveFile(DataStore.exportJSON());
                    this.showToast("Local data uploaded to Cloud");
                }
            }
        } catch (err) {
            console.error("Initial sync failed:", err);
            if (err.message === 'AUTH_EXPIRED') {
                this.handleTokenExpired();
            } else {
                this.showToast("Sync failed, working offline", "error");
            }
        }
    },

    async performSync() {
        if (this.isSyncing) {
            console.log("Sync already in progress, skipping");
            return;
        }

        if (!DriveService.isConnected) {
            console.log("Not connected, skipping sync");
            return;
        }

        if (!navigator.onLine) {
            console.log("Offline, skipping sync");
            return;
        }

        this.isSyncing = true;

        try {
            const cloudResult = await DriveService.getCloudDataWithTimestamp();
            const localTimestamp = DataStore.getLastModified();

            if (cloudResult && cloudResult.timestamp) {
                const cloudTimestamp = cloudResult.timestamp;

                console.log("Sync comparison - Local:", localTimestamp, "Cloud:", cloudTimestamp);

                if (new Date(cloudTimestamp) > new Date(localTimestamp)) {
                    DataStore.importJSON(JSON.stringify(cloudResult.data), true);
                    DriveService.lastSyncTime = new Date().toISOString();
                    this.updateAuthStatus(true, DriveService.lastSyncTime);
                    this.sortFoodsAndRender();
                    console.log("Downloaded newer data from cloud");
                } else if (new Date(localTimestamp) > new Date(cloudTimestamp)) {
                    await DriveService.saveFile(DataStore.exportJSON());
                    console.log("Uploaded newer local data to cloud");
                } else {
                    DriveService.lastSyncTime = new Date().toISOString();
                    this.updateAuthStatus(true, DriveService.lastSyncTime);
                    console.log("Data already in sync");
                }
            } else {
                if (DataStore.state.food_category.length > 0 || localTimestamp) {
                    await DriveService.saveFile(DataStore.exportJSON());
                    console.log("Uploaded local data (no cloud data found)");
                }
            }
        } catch (err) {
            console.error("Sync failed:", err);
            if (err.message === 'AUTH_EXPIRED') {
                this.handleTokenExpired();
            }
        } finally {
            this.isSyncing = false;
        }
    },

    handleTokenExpired() {
        // Use DriveService's method to clear all token data
        DriveService._clearStoredToken();
        DriveService.isConnected = false;

        this.updateAuthStatus(false);
        this.showToast("Session expired. Please login again.", "error");

        const blocker = document.getElementById('loginBlocker');
        const loading = document.getElementById('loginLoading');
        const actions = document.getElementById('loginActions');

        if (blocker && loading && actions) {
            blocker.classList.remove('hidden');
            loading.style.display = 'none';
            actions.style.display = 'block';

            const loginClientId = document.getElementById('loginClientId');
            const loginApiKey = document.getElementById('loginApiKey');
            if (loginClientId) loginClientId.value = localStorage.getItem('g_client_id') || '';
            if (loginApiKey) loginApiKey.value = localStorage.getItem('g_api_key') || '';
        }
    },

    syncToDrive() {
        if (DriveService.isConnected && navigator.onLine) {
            DriveService.saveFile(DataStore.exportJSON());
        }
    },

    // --- Modal Logic ---

    closeModals() {
        document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
    },

    openAddCategoryModal() {
        this.closeModals();
        document.getElementById('newCategoryName').value = '';
        document.getElementById('addCategoryModal').classList.add('active');
    },

    openAddFoodModal() {
        this.closeModals();

        const cats = DataStore.getCategories();
        const select = document.getElementById('newFoodCategory');
        select.innerHTML = cats.length ? '' : '<option disabled>No Categories</option>';
        cats.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            select.appendChild(opt);
        });

        if (cats.length === 0) {
            this.showToast("Create a category first!", "error");
            setTimeout(() => this.openAddCategoryModal(), 1000);
            return;
        }

        document.getElementById('newFoodName').value = '';
        document.getElementById('addFoodModal').classList.add('active');
    },

    saveCategory() {
        const name = document.getElementById('newCategoryName').value;
        const result = DataStore.addCategory(name);
        if (result.success) {
            this.closeModals();
            this.showToast("Category Created");
        } else {
            this.showToast(result.message, "error");
        }
    },

    saveFood() {
        const name = document.getElementById('newFoodName').value;
        const cat = document.getElementById('newFoodCategory').value;
        const result = DataStore.addFood(name, cat);
        if (result.success) {
            this.closeModals();
            this.showToast("Food Added");
        } else {
            this.showToast(result.message, "error");
        }
    },

    // --- Render Logic ---

    toggleCategory(categoryName) {
        if (this.collapsedCategories.has(categoryName)) {
            this.collapsedCategories.delete(categoryName);
        } else {
            this.collapsedCategories.add(categoryName);
        }
        this.render();
    },

    toggleMenu(foodName, event) {
        event.stopPropagation();
        const existing = document.getElementById(`menu-${foodName}`);

        if (existing && existing.classList.contains('active')) {
            existing.classList.remove('active');
            return;
        }

        document.querySelectorAll('.menu-dropdown').forEach(el => el.classList.remove('active'));

        if (existing) {
            existing.classList.add('active');
        }

        const closeMenu = (e) => {
            if (!e.target.closest(`#menu-${foodName}`) && !e.target.closest(`.more-btn`)) {
                if (existing) existing.classList.remove('active');
                document.body.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.body.addEventListener('click', closeMenu), 0);
    },

    toggleCategoryMenu(categoryName, event) {
        event.stopPropagation();
        const existing = document.getElementById(`cat-menu-${categoryName}`);

        if (existing && existing.classList.contains('active')) {
            existing.classList.remove('active');
            return;
        }

        document.querySelectorAll('.menu-dropdown').forEach(el => el.classList.remove('active'));

        if (existing) {
            existing.classList.add('active');
        }

        const closeMenu = (e) => {
            if (!e.target.closest(`#cat-menu-${categoryName}`) && !e.target.closest(`.more-btn`)) {
                if (existing) existing.classList.remove('active');
                document.body.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.body.addEventListener('click', closeMenu), 0);
    },

    openEditCategoryModal(categoryName) {
        document.querySelectorAll('.menu-dropdown').forEach(el => el.classList.remove('active'));
        const newName = prompt("Enter new name for category:", categoryName);
        if (newName !== null && newName.trim() !== '') {
            const result = DataStore.renameCategory(categoryName, newName.trim());
            if (result.success) {
                this.showToast("Category renamed");
            } else {
                this.showToast(result.message, "error");
            }
        }
    },

    deleteCategory(categoryName) {
        document.querySelectorAll('.menu-dropdown').forEach(el => el.classList.remove('active'));
        const category = DataStore.state.food_category.find(c => c.category_name === categoryName);
        const foodCount = category ? category.food.length : 0;

        const msg = foodCount > 0
            ? `Delete category "${categoryName}" and its ${foodCount} food item(s)? This cannot be undone.`
            : `Delete empty category "${categoryName}"?`;

        if (confirm(msg)) {
            const result = DataStore.deleteCategory(categoryName);
            if (result.success) {
                this.showToast("Category deleted");
            } else {
                this.showToast(result.message, "error");
            }
        }
    },

    renameFood(foodName) {
        document.querySelectorAll('.menu-dropdown').forEach(el => el.classList.remove('active'));
        const newName = prompt("Enter new name for food:", foodName);
        if (newName !== null && newName.trim() !== '') {
            const result = DataStore.renameFood(foodName, newName.trim());
            if (result.success) {
                this.showToast("Food renamed");
            } else {
                this.showToast(result.message, "error");
            }
        }
    },

    openEditFoodModal(foodName) {
        this.closeModals();
        let targetFood = null;
        for (const cat of DataStore.state.food_category) {
            const f = cat.food.find(item => item.food_name === foodName);
            if (f) {
                targetFood = f;
                break;
            }
        }

        if (!targetFood) return;

        document.getElementById('editFoodName').value = targetFood.food_name;
        document.getElementById('editFoodCount').value = targetFood.food_count;
        document.getElementById('editFoodSafeCount').value = targetFood.food_no_lactose_count;

        document.getElementById('editFoodModal').classList.add('active');
    },

    saveEditedFood() {
        const name = document.getElementById('editFoodName').value;
        const count = parseInt(document.getElementById('editFoodCount').value) || 0;
        const safeCount = parseInt(document.getElementById('editFoodSafeCount').value) || 0;

        if (safeCount > count) {
            this.showToast("Safe count cannot exceed total count", "error");
            return;
        }

        const success = DataStore.updateFoodStats(name, count, safeCount);
        if (success) {
            this.closeModals();
            this.showToast("Data Updated");
        } else {
            this.showToast("Update Failed", "error");
        }
    },

    deleteFood(foodName) {
        if (confirm(`Are you sure you want to delete '${foodName}'? This cannot be undone.`)) {
            const success = DataStore.deleteFood(foodName);
            if (success) {
                this.showToast("Food Deleted");
            } else {
                this.showToast("Delete Failed", "error");
            }
        }
    },

    render() {
        const container = document.getElementById('categoriesContainer');
        container.innerHTML = '';

        if (DataStore.state.food_category.length === 0) {
            container.innerHTML = `<div style="text-align:center; color: var(--text-muted); margin-top: 4rem;">
                <h2>Welcome!</h2>
                <p>Start by adding a category.</p>
            </div>`;
            return;
        }

        DataStore.state.food_category.forEach(cat => {
            const isCollapsed = this.collapsedCategories.has(cat.category_name);

            const section = document.createElement('div');
            section.className = `category-section ${isCollapsed ? 'collapsed' : ''}`;

            const header = document.createElement('div');
            header.className = 'category-header';
            header.style.position = 'relative';

            const safeCatName = this.escapeHtml(cat.category_name);

            header.innerHTML = `
                <div class="category-header-left" onclick="app.toggleCategory('${safeCatName}')">
                    <h2 class="category-title">${safeCatName}</h2>
                    <svg class="category-toggle-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <button class="btn-icon more-btn category-more-btn" onclick="event.stopPropagation(); app.toggleCategoryMenu('${safeCatName}', event)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
                </button>
                <div id="cat-menu-${safeCatName}" class="menu-dropdown category-menu-dropdown">
                    <button class="menu-item" onclick="app.openEditCategoryModal('${safeCatName}')">
                        ✏️ Rename
                    </button>
                    <button class="menu-item" style="color: var(--danger-color);" onclick="app.deleteCategory('${safeCatName}')">
                        🗑️ Delete Category
                    </button>
                </div>
            `;
            section.appendChild(header);

            const list = document.createElement('div');
            list.className = 'food-list';

            if (cat.food.length === 0) {
                list.innerHTML = `<div style="grid-column: 1/-1; text-align:center; color: var(--text-muted); padding: 1rem;">No food items yet.</div>`;
            } else {
                cat.food.forEach(food => {
                    list.appendChild(this.renderFoodCard(food));
                });
            }

            section.appendChild(list);
            container.appendChild(section);
        });
    },

    renderFoodCard(food) {
        const card = document.createElement('div');
        card.className = 'food-card';
        card.style.position = 'relative';

        const safeName = this.escapeHtml(food.food_name);
        const rating = food.food_star;
        const starHtml = this.getStarHtml(rating);
        const percent = Math.round((food.food_no_lactose_count / (food.food_count || 1)) * 100);

        // Removed good/bad buttons from food card - now only in temp food page
        card.innerHTML = `
            <button class="btn-icon more-btn" onclick="app.toggleMenu('${safeName}', event)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
            </button>
            <div id="menu-${safeName}" class="menu-dropdown">
                <button class="menu-item" onclick="app.renameFood('${safeName}')">
                    ✏️ Rename
                </button>
                <button class="menu-item" onclick="app.openEditFoodModal('${safeName}')">
                    ✏️ Edit Data
                </button>
                <button class="menu-item" style="color: var(--danger-color);" onclick="app.deleteFood('${safeName}')">
                    🗑️ Delete Food
                </button>
            </div>
            
            <div class="food-header">
                <div class="food-name">${safeName}</div>
                <div class="star-rating" title="Rating: ${rating}">
                    ${starHtml}
                </div>
            </div>
            <div class="food-stats">
                <span>🍽️ ${food.food_count}</span>
                <span>✨ ${percent}% Safe</span>
            </div>
        `;
        return card;
    },

    getStarHtml(rating) {
        let stars = '';
        for (let i = 1; i <= 5; i++) {
            if (rating >= i) {
                stars += `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
            } else if (rating > i - 1) {
                stars += `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="opacity: 0.3"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
            } else {
                stars += `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="opacity: 0.1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
            }
        }
        return stars;
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast active ${type}`;
        setTimeout(() => toast.classList.remove('active'), 3000);
    }
};

// Global Exposure for OnClick Handlers
window.app = app;

// Init
document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
