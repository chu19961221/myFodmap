import { DataStore } from './data.js';
import { DriveService } from './drive.js';

const app = {
    // UI State
    collapsedCategories: new Set(),

    init() {
        // Load Local Data
        DataStore.load();
        this.render();

        // Listen for updates
        window.addEventListener('data-updated', () => this.render());

        // Drive Integration
        this.initDrive();

        // UI Listeners
        this.bindEvents();
    },

    async initDrive() {
        // Show loading state in blocker
        const blocker = document.getElementById('loginBlocker');
        const loading = document.getElementById('loginLoading');
        const actions = document.getElementById('loginActions');

        if (loading && actions && blocker) {
            loading.style.display = 'block';
            actions.style.display = 'none';
        }

        // Init usually restores token from local storage now
        // This might fail if gapi not loaded yet, DriveService.init waits for it.
        const connected = await DriveService.init();

        if (DriveService.isConnected) {
            this.updateAuthStatus(true);
            // Hide blocker immediately
            if (blocker) blocker.classList.add('hidden');

            this.syncFromDrive();

            // Background: refresh token
            if (DriveService.tokenClient) {
                try {
                    DriveService.tokenClient.requestAccessToken({ prompt: '' });
                } catch (e) { console.log("Silent refresh skipped"); }
            }
        } else {
            this.updateAuthStatus(false);
            // Show Prompt in Blocker
            if (loading && actions && blocker) {
                loading.style.display = 'none';
                actions.style.display = 'block';
                blocker.classList.remove('hidden');
            }
        }

        // Listen for disconnects
        window.addEventListener('drive-disconnected', () => {
            this.updateAuthStatus(false);
            // Re-show blocker
            if (blocker && loading && actions) {
                blocker.classList.remove('hidden');
                loading.style.display = 'none';
                actions.style.display = 'block';
            }
            this.showToast("Session Expired", "error");
        });
    },

    bindEvents() {
        // FAB
        document.getElementById('fabBtn').onclick = () => {
            document.getElementById('choiceModal').classList.add('active');
        };

        // Settings (In App)
        document.getElementById('settingsBtn').onclick = () => {
            document.getElementById('settingsPanel').classList.toggle('hidden');
            this.loadSettingsValues();
        };

        // Login Blocker Buttons
        const mainConnectBtn = document.getElementById('mainConnectBtn');
        if (mainConnectBtn) {
            mainConnectBtn.onclick = () => {
                const clientId = localStorage.getItem('g_client_id');
                const apiKey = localStorage.getItem('g_api_key');

                if (!clientId || !apiKey) {
                    // Force open settings above blocker
                    const panel = document.getElementById('settingsPanel');
                    panel.classList.remove('hidden');
                    panel.style.zIndex = '10000';
                    panel.style.position = 'relative';
                    this.loadSettingsValues();

                    const blocker = document.getElementById('loginBlocker');
                    if (blocker) blocker.style.display = 'none';

                    this.showToast("Please configure API Keys first", "error");
                    return;
                }
                DriveService.signIn();
            };
        }

        document.getElementById('saveSettingsBtn').onclick = () => {
            const clientId = document.getElementById('clientIdInput').value.trim();
            const apiKey = document.getElementById('apiKeyInput').value.trim();
            if (clientId && apiKey) {
                localStorage.setItem('g_client_id', clientId);
                localStorage.setItem('g_api_key', apiKey);

                const blocker = document.getElementById('loginBlocker');
                if (blocker) blocker.style.display = 'flex';

                const panel = document.getElementById('settingsPanel');
                panel.style.zIndex = '';
                panel.style.position = '';
                panel.classList.add('hidden');

                this.showToast("Settings Saved. Connecting...");
                this.initDrive();
            }
        };

        // Reset App
        document.getElementById('resetAppBtn').onclick = async () => {
            if (confirm('This will delete all local data and reset the app. Are you sure?')) {
                // Unregister SW
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (let registration of registrations) {
                        await registration.unregister();
                    }
                }
                // Clear Storage
                localStorage.clear();
                // Reload
                window.location.reload();
            }
        };

        // Listen for drive connection
        window.addEventListener('drive-connected', () => {
            this.updateAuthStatus(true);
            this.syncFromDrive();
        });

        // Listen for sync needed
        window.addEventListener('data-sync-needed', () => {
            this.syncToDrive();
        });

        // Listen for detailed errors from DriveService
        window.addEventListener('toast', (e) => {
            if (e.detail) {
                this.showToast(e.detail.message, e.detail.type || 'success');
            }
        });
    },


    loadSettingsValues() {
        document.getElementById('clientIdInput').value = localStorage.getItem('g_client_id') || '';
        document.getElementById('apiKeyInput').value = localStorage.getItem('g_api_key') || '';
    },


    updateAuthStatus(isConnected) {
        const text = document.getElementById('statusText');
        const indicator = document.getElementById('statusIndicator');
        if (isConnected) {
            text.textContent = "Synced with Drive";
            indicator.classList.add('connected');
        } else {
            text.textContent = "Not Connected";
            indicator.classList.remove('connected');
        }
    },

    async syncFromDrive() {
        const cloudData = await DriveService.downloadFile();
        if (cloudData) {
            if (typeof cloudData === 'string') {
                DataStore.importJSON(cloudData);
            } else {
                DataStore.importJSON(JSON.stringify(cloudData));
            }
            this.showToast("Data Imported from Cloud");
        }
    },

    syncToDrive() {
        if (DriveService.isConnected) {
            DriveService.saveFile(DataStore.exportJSON());
            // console.log("Syncing to drive...");
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

        // Populate Categories
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

    // Menu Logic
    toggleMenu(foodName, event) {
        event.stopPropagation();
        const existing = document.getElementById(`menu-${foodName}`);

        // If this menu is already open, close it
        if (existing && existing.classList.contains('active')) {
            existing.classList.remove('active');
            return;
        }

        // Close all other menus
        document.querySelectorAll('.menu-dropdown').forEach(el => el.classList.remove('active'));

        // Open this one
        if (existing) {
            existing.classList.add('active');
        }

        // Add click listener to body to close menu when clicking outside
        const closeMenu = (e) => {
            if (!e.target.closest(`#menu-${foodName}`) && !e.target.closest(`.more-btn`)) {
                if (existing) existing.classList.remove('active');
                document.body.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.body.addEventListener('click', closeMenu), 0);
    },

    openEditFoodModal(foodName) {
        this.closeModals();
        // Determine values
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
            // Click to toggle
            header.onclick = () => this.toggleCategory(cat.category_name);

            header.innerHTML = `
                <h2 class="category-title">${this.escapeHtml(cat.category_name)}</h2>
                <svg class="category-toggle-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
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
        // Ensure relative positioning
        card.style.position = 'relative';

        const safeName = this.escapeHtml(food.food_name);
        // Star Calculation
        const rating = food.food_star;
        const starHtml = this.getStarHtml(rating);
        const percent = Math.round((food.food_no_lactose_count / (food.food_count || 1)) * 100);

        card.innerHTML = `
            <button class="btn-icon more-btn" onclick="app.toggleMenu('${safeName}', event)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
            </button>
            <div id="menu-${safeName}" class="menu-dropdown">
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
            <div class="food-actions">
                <button class="btn btn-good" onclick="event.stopPropagation(); app.logGood('${safeName}')">
                    <span>👍</span> GOOD
                </button>
                <button class="btn btn-bad" onclick="event.stopPropagation(); app.logBad('${safeName}')">
                    <span>👎</span> BAD
                </button>
            </div>
        `;
        return card;
    },

    getStarHtml(rating) {
        let stars = '';
        for (let i = 1; i <= 5; i++) {
            if (rating >= i) {
                // Full Star
                stars += `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
            } else if (rating > i - 1) {
                // Dim partial
                stars += `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="opacity: 0.3"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
            } else {
                // Empty Star
                stars += `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="opacity: 0.1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
            }
        }
        return stars;
    },

    logGood(name) {
        DataStore.logFood(name, true);
        this.showToast(`Recorded: ${name} (Good)`);
    },

    logBad(name) {
        DataStore.logFood(name, false);
        this.showToast(`Recorded: ${name} (Bad)`, "error");
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
