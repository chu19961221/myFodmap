export const DataStore = {
    state: {
        food_category: []
    },

    load() {
        const stored = localStorage.getItem('myFodmap');
        if (stored) {
            try {
                this.state = JSON.parse(stored);
            } catch (e) {
                console.error("Failed to parse local data", e);
            }
        }
    },

    save() {
        localStorage.setItem('myFodmap', JSON.stringify(this.state));
        window.dispatchEvent(new CustomEvent('data-updated'));
        window.dispatchEvent(new CustomEvent('data-sync-needed'));
    },

    exportJSON() {
        return JSON.stringify(this.state, null, 2);
    },

    importJSON(jsonString) {
        try {
            const data = JSON.parse(jsonString);
            if (data && Array.isArray(data.food_category)) {
                this.state = data;
                this.save(); // Will trigger update and sync (but sync should handle "incoming" vs "outgoing" loop)
                return true;
            }
        } catch (e) {
            console.error("Import failed", e);
        }
        return false;
    },

    // --- Actions ---

    addCategory(name) {
        if (!name.trim()) return { success: false, message: "Name cannot be empty" };
        const exists = this.state.food_category.some(c => c.category_name === name);
        if (exists) return { success: false, message: "Category already exists" };

        this.state.food_category.push({
            category_name: name,
            food: []
        });
        this.save();
        return { success: true };
    },

    addFood(name, categoryName) {
        if (!name.trim()) return { success: false, message: "Name cannot be empty" };

        // Check global duplicate
        for (const cat of this.state.food_category) {
            if (cat.food.some(f => f.food_name === name)) {
                return { success: false, message: `Food '${name}' already exists in '${cat.category_name}'` };
            }
        }

        const category = this.state.food_category.find(c => c.category_name === categoryName);
        if (!category) return { success: false, message: "Category not found" };

        category.food.push({
            food_name: name,
            food_count: 0,
            food_no_lactose_count: 0,
            food_star: 0.0
        });
        this.save();
        return { success: true };
    },

    logFood(foodName, isGood) {
        let found = false;
        for (const cat of this.state.food_category) {
            const food = cat.food.find(f => f.food_name === foodName);
            if (food) {
                food.food_count += 1;
                if (isGood) {
                    food.food_no_lactose_count += 1;
                }

                // Recalculate stars
                if (food.food_count > 0) {
                    const ratio = food.food_no_lactose_count / food.food_count;
                    food.food_star = parseFloat((ratio * 5).toFixed(3)); // Example uses 3 decimals
                } else {
                    food.food_star = 0.0;
                }

                found = true;
                break;
            }
        }
        if (found) this.save();
    },


    updateFoodStats(foodName, count, safeCount) {
        let found = false;
        for (const cat of this.state.food_category) {
            const food = cat.food.find(f => f.food_name === foodName);
            if (food) {
                food.food_count = parseInt(count);
                food.food_no_lactose_count = parseInt(safeCount);

                // Recalculate stars
                if (food.food_count > 0) {
                    const ratio = food.food_no_lactose_count / food.food_count;
                    food.food_star = parseFloat((ratio * 5).toFixed(3));
                } else {
                    food.food_star = 0.0;
                }

                found = true;
                break;
            }
        }
        if (found) this.save();
        return found;
    },

    deleteFood(foodName) {
        let found = false;
        for (const cat of this.state.food_category) {
            const index = cat.food.findIndex(f => f.food_name === foodName);
            if (index !== -1) {
                cat.food.splice(index, 1);
                found = true;
                break;
            }
        }
        if (found) this.save();
        return found;
    },

    renameFood(oldName, newName) {
        if (!newName.trim()) return { success: false, message: "Name cannot be empty" };
        if (oldName === newName) return { success: true };

        // Check if new name already exists in any category
        for (const cat of this.state.food_category) {
            if (cat.food.some(f => f.food_name === newName)) {
                return { success: false, message: `Food '${newName}' already exists` };
            }
        }

        // Find and rename the food
        for (const cat of this.state.food_category) {
            const food = cat.food.find(f => f.food_name === oldName);
            if (food) {
                food.food_name = newName;
                this.save();
                return { success: true };
            }
        }

        return { success: false, message: "Food not found" };
    },

    // Helper to get all categories for dropdown
    getCategories() {
        return this.state.food_category.map(c => c.category_name);
    },

    renameCategory(oldName, newName) {
        if (!newName.trim()) return { success: false, message: "Name cannot be empty" };
        if (oldName === newName) return { success: true };

        // Check if new name already exists
        const exists = this.state.food_category.some(c => c.category_name === newName);
        if (exists) return { success: false, message: "Category with this name already exists" };

        const category = this.state.food_category.find(c => c.category_name === oldName);
        if (!category) return { success: false, message: "Category not found" };

        category.category_name = newName;
        this.save();
        return { success: true };
    },

    deleteCategory(categoryName) {
        const index = this.state.food_category.findIndex(c => c.category_name === categoryName);
        if (index === -1) return { success: false, message: "Category not found" };

        this.state.food_category.splice(index, 1);
        this.save();
        return { success: true };
    }
};
