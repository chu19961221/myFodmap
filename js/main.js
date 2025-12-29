import { DataStore } from './data.js';
import { DriveService } from './drive.js';

const app = {
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

        document.getElementById('saveSettingsBtn').onclick = () => {
            const clientId = document.getElementById('clientIdInput').value.trim();
            const apiKey = document.getElementById('apiKeyInput').value.trim();
            if (clientId && apiKey) {
                localStorage.setItem('g_client_id', clientId);
                localStorage.setItem('g_api_key', apiKey);
                this.showToast("Settings Saved. Connecting...");
                this.initDrive(); // Re-init
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
    },

    loadSettingsValues() {
        document.getElementById('clientIdInput').value = localStorage.getItem('g_client_id') || '';
        document.getElementById('apiKeyInput').value = localStorage.getItem('g_api_key') || '';
    },

    async initDrive() {
        const connected = await DriveService.init();
        if (connected) {
            // Try silent sign-in or check status
            // DriveService.signIn(); // This might trigger popup, usually we wait for user action
            // But requirement says "Auto import... on open". This implies we are already authorized or silent auth.
            // We will attempt immediate sign in if token exists? GIS handles this.
            DriveService.signIn();
        } else {
            this.updateAuthStatus(false);
        }
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
            console.log("Syncing to drive...");
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
            const section = document.createElement('div');
            section.className = 'category-section';

            const header = document.createElement('div');
            header.className = 'category-header';
            header.innerHTML = `<h2 class="category-title">${this.escapeHtml(cat.category_name)}</h2>`;
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

        const safeName = this.escapeHtml(food.food_name);
        // Star Calculation
        const rating = food.food_star;
        const starHtml = this.getStarHtml(rating);
        const percent = Math.round((food.food_no_lactose_count / (food.food_count || 1)) * 100);

        card.innerHTML = `
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
                <button class="btn btn-good" onclick="app.logGood('${safeName}')">
                    <span>👍</span> GOOD
                </button>
                <button class="btn btn-bad" onclick="app.logBad('${safeName}')">
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
                // Partial Star (Simulate with opacity or smaller polygon? CSS gradients are better but SVG is okay)
                // Let's just show an empty star for now to keep it simple, or a different color?
                // Actually, let's use a simple opacity for the 'empty' part.
                // Better: SVG defs. 
                // Simplest premium look: Full stars for integer, and maybe a dim star for empty.
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
