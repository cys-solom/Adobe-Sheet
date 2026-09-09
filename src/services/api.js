import { supabase, isConfigured } from '../lib/supabase';
import telegram from './telegram';
import { writeCloudSheet } from './sheetSync';

// ==========================================
// API Service - Supabase only for business data
// ==========================================

// ============ AUTH ============
export const authAPI = {
    async login(username, password) {
        const cleanUsername = (username || '').trim();
        const cleanPassword = (password || '').trim();

        if (!cleanUsername || !cleanPassword) {
            return { status: 'error', message: 'يرجى إدخال اسم المستخدم وكلمة المرور' };
        }

        if (!isConfigured) {
            return { status: 'error', message: 'قاعدة البيانات غير متصلة' };
        }

        const { data, error } = await supabase
            .from('users')
            .select('*')
            .or(`username.ilike.${cleanUsername},email.ilike.${cleanUsername}`)
            .maybeSingle();

        if (error) {
            console.error('Supabase login error:', error);
            return { status: 'error', message: 'تعذر الاتصال بقاعدة البيانات' };
        }

        if (!data) {
            return { status: 'error', message: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
        }

        // Smart password comparison: supports both plain text and bcrypt hashes
        let isValid = false;
        const isHashed = typeof data.password === 'string' && data.password.startsWith('$2');

        if (isHashed) {
            // Try bcrypt comparison
            try {
                const bcrypt = await import('bcryptjs');
                const bcryptLib = bcrypt.default || bcrypt;
                isValid = await bcryptLib.compare(cleanPassword, data.password);
            } catch (e) {
                console.warn('Bcrypt comparison failed, falling back to plain text:', e);
                isValid = cleanPassword === data.password;
            }
        } else {
            // Plain text comparison (legacy)
            isValid = cleanPassword === data.password;
        }

        if (!isValid) {
            console.error('[LOGIN DEBUG] Password mismatch for user:', cleanUsername, '| isHashed:', isHashed, '| dbPass length:', data.password?.length);
            return { status: 'error', message: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
        }

        console.log('[LOGIN DEBUG] Password valid! Generating token...');

        const token = crypto.randomUUID() + '-' + Date.now();
        // Token update is non-fatal — if column missing, login still works
        try {
            await supabase.from('users').update({ token }).eq('id', data.id);
        } catch (e) {
            console.warn('[LOGIN DEBUG] Token update failed (non-fatal):', e);
        }

        console.log('[LOGIN DEBUG] Login success for:', cleanUsername, 'role:', data.role);

        return {
            status: 'success',
            token,
            user: {
                id: data.id,
                username: data.username,
                role: data.role,
                permissions: data.permissions || [],
                base_salary: data.base_salary,
                vodafone_cash: data.vodafone_cash
            }
        };
    },

    async checkAuth(token) {
        if (!token) return null;
        if (!isConfigured) return null;
        try {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('token', token)
                .maybeSingle();
            if (!error && data) {
                return {
                    id: data.id,
                    username: data.username,
                    role: data.role,
                    permissions: data.permissions || [],
                    base_salary: data.base_salary,
                    vodafone_cash: data.vodafone_cash
                };
            }
        } catch (e) {
            console.error('Auth check failed:', e);
        }
        return null;
    },

    async logout(token) {
        if (!token || !isConfigured) return;
        try {
            await supabase.from('users').update({ token: null }).eq('token', token);
        } catch (e) {
            console.error('Logout failed:', e);
        }
    }
};


// ============ PRODUCTS ============
export const productsAPI = {
    async getAll() {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) console.error('Products fetch error:', error);
        return data || [];
    },

    async create(product) {
        const id = 'PRD-' + Date.now();
        const row = {
            id,
            name: product.name,
            price: product.price,
            duration: product.duration || 30,
            description: product.description || '',
            category: product.category || '',
            inventory_product: product.inventoryProduct || '',
            fulfillment_type: product.fulfillmentType || 'client_account',
        };
        const { error } = await supabase.from('products').insert(row);
        if (error) throw error;
        return id;
    },

    async update(id, product) {
        const updates = {
            name: product.name,
            price: product.price,
            duration: product.duration || 30,
            description: product.description || '',
            category: product.category || '',
            inventory_product: product.inventoryProduct || '',
            fulfillment_type: product.fulfillmentType || 'client_account',
        };
        const { error } = await supabase.from('products').update(updates).eq('id', id);
        if (error) throw error;
    },

    async updateSortOrder(items) {
        // items = [{ id, sort_order }]
        // هذه العملية اختيارية — لو عمود sort_order مش موجود مش هتعمل مشكلة
        try {
            for (const item of items) {
                await supabase.from('products').update({ sort_order: item.sort_order }).eq('id', item.id);
            }
        } catch (e) {
            console.warn('sort_order column may not exist yet:', e.message);
        }
    },

    async delete(id) {
        const { error } = await supabase.from('products').delete().eq('id', id);
        if (error) throw error;
    },

    // Sync name changes across related tables
    async syncNameChange(oldName, newName) {
        await supabase.from('accounts').update({ product_name: newName }).eq('product_name', oldName);
        await supabase.from('sales').update({ product_name: newName }).eq('product_name', oldName);
        await supabase.from('products').update({ inventory_product: newName }).eq('inventory_product', oldName);
    }
};

// ============ INVENTORY SECTIONS ============
export const sectionsAPI = {
    async getAll() {
        const { data } = await supabase
            .from('inventory_sections')
            .select('*')
            .order('created_at', { ascending: false });
        return data || [];
    },

    async create(section) {
        const id = 'SEC-' + Date.now();
        const { error } = await supabase.from('inventory_sections').insert({
            id,
            name: section.name,
            type: section.type || 'accounts',
        });
        if (error) throw error;
        return id;
    },

    async delete(id, sectionName) {
        await supabase.from('accounts').delete().eq('product_name', sectionName);
        await supabase.from('inventory_sections').delete().eq('id', id);
    }
};

// ============ ACCOUNTS (Inventory) ============
export const accountsAPI = {
    async getAll() {
        const { data } = await supabase
            .from('accounts')
            .select('*')
            .order('created_at', { ascending: false });
        return (data || []).map(a => ({
            ...a,
            productName: a.product_name,
            twoFA: a.two_fa,
            createdBy: a.created_by,
            createdAt: a.created_at,
            isWorkspace: a.is_workspace || false,
            workspaceMembers: a.workspace_members || 0,
            workspaceCost: a.workspace_cost || 0,
        }));
    },

    async create(account) {
        const { data, error } = await supabase.from('accounts').insert({
            email: account.email,
            password: account.password || '',
            two_fa: account.twoFA || '',
            product_name: account.productName,
            status: account.status || 'available',
            allowed_uses: account.allowed_uses,
            current_uses: account.current_uses || 0,
            created_by: account.createdBy || 'Admin',
            is_workspace: account.isWorkspace || false,
            workspace_members: account.workspaceMembers || 0,
            workspace_cost: account.workspaceCost || 0,
        }).select().single();
        if (error) throw error;
        telegram.stockAdded(account.productName, 1, account.isWorkspace ? 'accounts' : 'accounts');
        return data;
    },

    async createBulk(accounts) {
        const rows = accounts.map(a => ({
            email: a.email,
            password: a.password || '',
            two_fa: a.twoFA || '',
            product_name: a.productName,
            status: 'available',
            allowed_uses: a.allowed_uses,
            current_uses: 0,
            created_by: a.createdBy || 'Admin',
            is_workspace: a.isWorkspace || false,
            workspace_members: a.workspaceMembers || 0,
            workspace_cost: a.workspaceCost || 0,
        }));
        const { error } = await supabase.from('accounts').insert(rows);
        if (error) throw error;
        telegram.stockAdded(accounts[0]?.productName || 'غير محدد', rows.length);
    },

    async update(id, updates) {
        const dbUpdates = {};
        if (updates.email !== undefined) dbUpdates.email = updates.email;
        if (updates.password !== undefined) dbUpdates.password = updates.password;
        if (updates.twoFA !== undefined) dbUpdates.two_fa = updates.twoFA;
        if (updates.status !== undefined) dbUpdates.status = updates.status;
        if (updates.allowed_uses !== undefined) dbUpdates.allowed_uses = updates.allowed_uses;
        if (updates.current_uses !== undefined) dbUpdates.current_uses = updates.current_uses;
        if (updates.productName !== undefined) dbUpdates.product_name = updates.productName;
        if (updates.isWorkspace !== undefined) dbUpdates.is_workspace = updates.isWorkspace;
        if (updates.workspaceMembers !== undefined) dbUpdates.workspace_members = updates.workspaceMembers;
        if (updates.workspaceCost !== undefined) dbUpdates.workspace_cost = updates.workspaceCost;

        const { error } = await supabase.from('accounts').update(dbUpdates).eq('id', id);
        if (error) throw error;
    },

    async delete(id) {
        await supabase.from('accounts').delete().eq('id', id);
    },

    async pullNext(sectionName) {
        // Get next available account for a section
        const { data } = await supabase
            .from('accounts')
            .select('*')
            .eq('product_name', sectionName)
            .in('status', ['available', 'used'])
            .order('created_at', { ascending: true });

        const available = (data || []).filter(a =>
            a.status === 'available' || (a.status === 'used' && (a.allowed_uses === -1 || a.current_uses < a.allowed_uses))
        );

        if (available.length === 0) return { empty: true };

        const target = available[0];
        const newUses = target.current_uses + 1;
        const newStatus = (target.allowed_uses !== -1 && newUses >= target.allowed_uses) ? 'completed' : 'used';

        await supabase.from('accounts').update({
            current_uses: newUses,
            status: newStatus
        }).eq('id', target.id);

        const result = {
            ...target,
            current_uses: newUses,
            status: newStatus,
            productName: target.product_name,
            twoFA: target.two_fa,
        };
        telegram.inventoryPulled(sectionName, target.email);
        return result;
    }
};

// ============ CUSTOMERS ============
export const customersAPI = {
    async getAll() {
        const { data } = await supabase
            .from('customers')
            .select('*')
            .order('last_order_date', { ascending: false });
        return (data || []).map(c => ({
            ...c,
            contactChannel: c.contact_channel,
            createdAt: c.created_at,
            lastOrderDate: c.last_order_date,
        }));
    },

    async upsert(customer) {
        // Check if exists by name+phone
        const { data: existing } = await supabase
            .from('customers')
            .select('*')
            .eq('name', customer.name)
            .eq('phone', customer.phone || '')
            .maybeSingle();

        if (existing) {
            await supabase.from('customers').update({
                email: customer.email || existing.email,
                contact_channel: customer.contactChannel || existing.contact_channel,
                last_order_date: new Date().toISOString()
            }).eq('id', existing.id);
            return existing.id;
        }

        const id = 'CUS-' + Date.now();
        await supabase.from('customers').insert({
            id,
            name: customer.name,
            phone: customer.phone || '',
            email: customer.email || '',
            contact_channel: customer.contactChannel || 'واتساب',
        });
        return id;
    },

    async updateLastOrder(id, email) {
        const updates = { last_order_date: new Date().toISOString() };
        if (email) updates.email = email;
        await supabase.from('customers').update(updates).eq('id', id);
    }
};

// ============ SALES ============
export const salesAPI = {
    async getAll() {
        const { data } = await supabase
            .from('sales')
            .select('*')
            .order('date', { ascending: false });
        return (data || []).map(s => ({
            ...s,
            productName: s.product_name,
            originalPrice: s.original_price,
            finalPrice: s.final_price,
            customerId: s.customer_id,
            customerName: s.customer_name,
            customerPhone: s.customer_phone,
            customerEmail: s.customer_email,
            contactChannel: s.contact_channel,
            isPaid: s.is_paid,
            remainingAmount: s.remaining_amount,
            paymentMethod: s.payment_method,
            walletId: s.wallet_id,
            walletName: s.wallet_name,
            expiryDate: s.expiry_date,
            assignedAccountEmail: s.assigned_account_email,
            assignedAccountId: s.assigned_account_id,
            fromInventory: s.from_inventory,
            saleType: s.sale_type || 'personal',
            workspaceEmail: s.workspace_email || '',
            isActivated: s.is_activated || false,
            customerPassword: s.customer_password || '',
        }));
    },

    async create(sale) {
        const insertData = {
            product_name: sale.productName,
            original_price: sale.originalPrice,
            discount: sale.discount || 0,
            final_price: sale.finalPrice,
            duration: sale.duration || 30,
            expiry_date: sale.expiryDate,
            customer_id: sale.customerId || null,
            customer_name: sale.customerName || '',
            customer_phone: sale.customerPhone || '',
            customer_email: sale.customerEmail || '',
            contact_channel: sale.contactChannel || 'واتساب',
            is_paid: sale.isPaid,
            remaining_amount: sale.remainingAmount || 0,
            payment_method: sale.paymentMethod || '',
            wallet_id: sale.walletId || null,
            wallet_name: sale.walletName || '',
            notes: sale.notes || '',
            moderator: sale.moderator || 'Admin',
            assigned_account_email: sale.assignedAccountEmail || '',
            assigned_account_id: sale.assignedAccountId || null,
            from_inventory: sale.fromInventory || false,
            sale_type: sale.saleType || 'personal',
            workspace_email: sale.workspaceEmail || '',
            is_activated: sale.isActivated || false,
            customer_password: sale.customerPassword || '',
        };
        // لو فيه تاريخ مخصوص (تسجيل بتاريخ قديم)
        if (sale.date) {
            insertData.date = sale.date;
        }
        const { data, error } = await supabase.from('sales').insert(insertData).select().single();
        if (error) throw error;
        telegram.newSale(sale);
        return data;
    },

    async update(id, sale) {
        const { error } = await supabase.from('sales').update({
            product_name: sale.productName,
            original_price: sale.originalPrice,
            discount: sale.discount || 0,
            final_price: sale.finalPrice,
            duration: sale.duration,
            expiry_date: sale.expiryDate,
            customer_id: sale.customerId || null,
            customer_name: sale.customerName || '',
            customer_phone: sale.customerPhone || '',
            customer_email: sale.customerEmail || '',
            contact_channel: sale.contactChannel || 'واتساب',
            is_paid: sale.isPaid,
            remaining_amount: sale.remainingAmount || 0,
            payment_method: sale.paymentMethod || '',
            wallet_id: sale.walletId || null,
            wallet_name: sale.walletName || '',
            notes: sale.notes || '',
            sale_type: sale.saleType || 'personal',
            workspace_email: sale.workspaceEmail || '',
            is_activated: sale.isActivated !== undefined ? sale.isActivated : false,
            customer_password: sale.customerPassword || '',
        }).eq('id', id);
        if (error) throw error;
    },

    async delete(id) {
        await supabase.from('sales').delete().eq('id', id);
    },

    async togglePaid(id, isPaid, finalPrice, saleInfo) {
        await supabase.from('sales').update({
            is_paid: isPaid,
            remaining_amount: isPaid ? 0 : finalPrice
        }).eq('id', id);
        if (isPaid && saleInfo) telegram.debtPaid(saleInfo);
    },

    async toggleActivated(id, isActivated, saleInfo) {
        await supabase.from('sales').update({
            is_activated: isActivated,
        }).eq('id', id);
        if (isActivated && saleInfo) telegram.saleActivated(saleInfo);
    }
};

// ============ EXPENSES ============
export const expensesAPI = {
    async getAll() {
        const { data } = await supabase
            .from('expenses')
            .select('*')
            .order('created_at', { ascending: false });
        return (data || []).map(e => ({
            ...e,
            walletId: e.wallet_id,
            walletName: e.wallet_name,
            expenseCategory: e.expense_category || 'daily',
        }));
    },

    async create(expense) {
        const { data, error } = await supabase.from('expenses').insert({
            type: expense.type,
            amount: expense.amount,
            description: expense.description || '',
            date: expense.date,
            wallet_id: expense.walletId || '',
            wallet_name: expense.walletName || '',
            expense_category: expense.expenseCategory || 'daily',
        }).select().single();
        if (error) throw error;
        return data;
    },

    async update(id, expense) {
        const updates = {
            type: expense.type,
            amount: expense.amount,
            description: expense.description || '',
            date: expense.date,
        };
        if (expense.expenseCategory !== undefined) updates.expense_category = expense.expenseCategory;
        const { error } = await supabase.from('expenses').update(updates).eq('id', id);
        if (error) throw error;
    },

    async delete(id) {
        await supabase.from('expenses').delete().eq('id', id);
    }
};

// ============ WALLETS ============
export const walletsAPI = {
    async getAll() {
        const { data } = await supabase
            .from('wallets')
            .select('*')
            .order('created_at', { ascending: false });
        return (data || []).map(w => ({
            ...w,
            initialBalance: w.initial_balance,
            createdBy: w.created_by,
            createdAt: w.created_at,
        }));
    },

    async create(wallet) {
        const { data, error } = await supabase.from('wallets').insert({
            name: wallet.name,
            currency: wallet.currency || 'EGP',
            initial_balance: wallet.initialBalance || 0,
            balance: wallet.initialBalance || 0,
            created_by: wallet.createdBy || 'Admin',
        }).select().single();
        if (error) throw error;
        return data;
    },

    async update(id, updates) {
        const dbUpdates = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.currency !== undefined) dbUpdates.currency = updates.currency;
        if (updates.balance !== undefined) dbUpdates.balance = updates.balance;
        const { error } = await supabase.from('wallets').update(dbUpdates).eq('id', id);
        if (error) throw error;
    },

    async delete(id) {
        await supabase.from('wallet_transactions').delete().eq('wallet_id', id);
        await supabase.from('wallets').delete().eq('id', id);
    },

    async deposit(walletId, amount, description, source, by) {
        // Get current wallet
        const { data: wallet } = await supabase.from('wallets').select('*').eq('id', walletId).single();
        if (!wallet) return;

        const newBalance = Number(wallet.balance) + Number(amount);
        await supabase.from('wallets').update({ balance: newBalance }).eq('id', walletId);

        await supabase.from('wallet_transactions').insert({
            wallet_id: walletId,
            type: 'deposit',
            amount: Number(amount),
            description,
            source: source || 'يدوي',
            balance_after: newBalance,
            created_by: by || 'System',
        });

        return newBalance;
    },

    async withdraw(walletId, amount, description, source, by) {
        const { data: wallet } = await supabase.from('wallets').select('*').eq('id', walletId).single();
        if (!wallet) return;

        const newBalance = Number(wallet.balance) - Number(amount);
        await supabase.from('wallets').update({ balance: newBalance }).eq('id', walletId);

        await supabase.from('wallet_transactions').insert({
            wallet_id: walletId,
            type: 'withdraw',
            amount: Number(amount),
            description,
            source: source || 'يدوي',
            balance_after: newBalance,
            created_by: by || 'System',
        });

        return newBalance;
    },

    async getTransactions(walletId) {
        const query = supabase.from('wallet_transactions').select('*').order('date', { ascending: false });
        if (walletId) query.eq('wallet_id', walletId);
        const { data } = await query;
        return (data || []).map(t => ({
            ...t,
            walletId: t.wallet_id,
            balanceAfter: t.balance_after,
            by: t.created_by,
        }));
    },

    async deleteTransaction(txn) {
        // Reverse the transaction
        const { data: wallet } = await supabase.from('wallets').select('*').eq('id', txn.wallet_id || txn.walletId).single();
        if (wallet) {
            const newBalance = txn.type === 'deposit'
                ? Number(wallet.balance) - Number(txn.amount)
                : Number(wallet.balance) + Number(txn.amount);
            await supabase.from('wallets').update({ balance: newBalance }).eq('id', wallet.id);
        }
        await supabase.from('wallet_transactions').delete().eq('id', txn.id);
    }
};

// ============ USERS MANAGEMENT ============
export const usersAPI = {
    async getAll() {
        if (!isConfigured) throw new Error('قاعدة البيانات غير متصلة');
        const { data, error } = await supabase
            .from('users')
            .select('id, username, role, permissions, base_salary, vodafone_cash, created_at')
            .order('id', { ascending: true });
        if (error) throw error;
        return (data || []).map(u => ({
            ...u,
            permissions: Array.isArray(u.permissions) ? u.permissions : (typeof u.permissions === 'string' ? JSON.parse(u.permissions || '[]') : [])
        }));
    },

    async save(userData) {
        if (!isConfigured) throw new Error('قاعدة البيانات غير متصلة');

        // If updating existing user
        if (userData.id) {
            const updates = {
                username: userData.username,
                role: userData.role || 'moderator',
                permissions: userData.permissions || [],
                base_salary: userData.base_salary || 0,
                vodafone_cash: userData.vodafone_cash || '',
            };
            if (userData.password) {
                const bcrypt = await import('bcryptjs');
                updates.password = await bcrypt.hash(userData.password, 10);
            }
            const { error } = await supabase.from('users').update(updates).eq('id', userData.id);
            if (error) throw error;
            return;
        }

        // If creating new user
        const bcrypt = await import('bcryptjs');
        const hashedPassword = await bcrypt.hash(userData.password || '123456', 10);
        const { error } = await supabase.from('users').insert({
            username: userData.username.trim(),
            password: hashedPassword,
            role: userData.role || 'moderator',
            permissions: userData.permissions || [],
            base_salary: userData.base_salary || 0,
            vodafone_cash: userData.vodafone_cash || '',
        });
        if (error) {
            if (error.code === '23505') {
                throw new Error('اسم المستخدم مستخدم بالفعل! يرجى اختيار اسم مستخدم آخر.');
            }
            throw error;
        }
    },

    async delete(id) {
        if (!isConfigured) throw new Error('قاعدة البيانات غير متصلة');
        const { error } = await supabase.from('users').delete().eq('id', id);
        if (error) throw error;
    },

    async changePassword(userId, currentPassword, newPassword) {
        if (!isConfigured) throw new Error('قاعدة البيانات غير متصلة');
        // Fetch user to verify current password
        const { data, error } = await supabase
            .from('users')
            .select('id, password')
            .eq('id', userId)
            .maybeSingle();
        if (error || !data) throw new Error('تعذر التحقق من البيانات');

        const isHashed = typeof data.password === 'string' && data.password.startsWith('$2');
        let isValid = false;
        if (isHashed) {
            const bcrypt = await import('bcryptjs');
            const bcryptLib = bcrypt.default || bcrypt;
            isValid = await bcryptLib.compare(currentPassword, data.password);
        } else {
            isValid = currentPassword === data.password;
        }

        if (!isValid) throw new Error('كلمة المرور الحالية غير صحيحة');

        const bcrypt = await import('bcryptjs');
        const bcryptLib = bcrypt.default || bcrypt;
        const hashedNew = await bcryptLib.hash(newPassword, 10);
        const { error: updateError } = await supabase
            .from('users')
            .update({ password: hashedNew })
            .eq('id', userId);
        if (updateError) throw updateError;
    }
};

// ============ ATTENDANCE ============
export const attendanceAPI = {
    async getByMonth(month) {
        const { data } = await supabase
            .from('attendance')
            .select('*')
            .like('date', `${month}%`)
            .order('date', { ascending: false });
        return (data || []).map(a => ({
            ...a,
            user_id: a.user_id,
            check_in: a.check_in,
            bonus: a.bonus,
        }));
    },

    async checkIn(userId, date, time) {
        // Check if already checked in
        const { data: existing } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .eq('date', date)
            .maybeSingle();

        if (existing && existing.check_in) return { alreadyExists: true };

        if (existing) {
            // Update existing record
            await supabase.from('attendance').update({ check_in: time }).eq('id', existing.id);
        } else {
            await supabase.from('attendance').insert({
                user_id: userId,
                date,
                check_in: time,
                bonus: 0,
            });
        }
        return { success: true };
    },

    async addBonus(userId, date, amount) {
        const { data: existing } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .eq('date', date)
            .maybeSingle();

        if (existing) {
            const newBonus = Number(existing.bonus || 0) + Number(amount);
            await supabase.from('attendance').update({ bonus: newBonus }).eq('id', existing.id);
        } else {
            await supabase.from('attendance').insert({
                user_id: userId,
                date,
                check_in: null,
                bonus: Number(amount),
            });
        }
    },

    async getUserHistory(userId, from, to) {
        const { data } = await supabase
            .from('attendance')
            .select('*')
            .eq('user_id', userId)
            .gte('date', from)
            .lte('date', to)
            .order('date', { ascending: false });
        return data || [];
    }
};

// ============ PROBLEMS ============
export const problemsAPI = {
    async getAll() {
        const { data } = await supabase
            .from('problems')
            .select('*')
            .order('created_at', { ascending: false });
        return (data || []).map(p => ({
            ...p,
            customerName: p.customer_name,
            phoneNumber: p.phone_number,
            productName: p.product_name,
            isResolved: p.is_resolved || false,
            resolvedAt: p.resolved_at || null,
        }));
    },

    async create(problem) {
        const { data, error } = await supabase.from('problems').insert({
            sale_id: problem.saleId,
            customer_name: problem.customerName || '',
            phone_number: problem.phoneNumber || '',
            product_name: problem.productName || '',
            description: problem.description,
            replacement_account_id: problem.replacementAccountId || null,
            is_resolved: false,
        }).select().single();
        if (error) throw error;
        telegram.newProblem({ accountEmail: problem.customerName, description: problem.description });
        return data;
    },

    async markResolved(id, problemInfo) {
        const { error } = await supabase.from('problems').update({
            is_resolved: true,
            resolved_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) throw error;
        if (problemInfo) telegram.problemResolved({ accountEmail: problemInfo.customerName, description: problemInfo.description });
    },

    async delete(id) {
        const { error } = await supabase.from('problems').delete().eq('id', id);
        if (error) throw error;
    },
};

// ============ QUICK LINKS ============
export const quickLinksAPI = {
    async getAll() {
        const { data } = await supabase
            .from('quick_links')
            .select('*')
            .order('created_at', { ascending: true });
        return (data || []).map(l => ({
            id: l.id,
            label: l.label,
            url: l.url,
            createdBy: l.created_by,
            createdAt: l.created_at,
        }));
    },

    async create(link) {
        const { error } = await supabase.from('quick_links').insert({
            label: link.label,
            url: link.url,
            created_by: link.createdBy || 'Admin',
        });
        if (error) throw error;
    },

    async delete(id) {
        const { error } = await supabase.from('quick_links').delete().eq('id', id);
        if (error) throw error;
    },
};

// ============ EMPLOYEES ============
export const employeesAPI = {
    async getAll() {
        const { data } = await supabase
            .from('employees')
            .select('*')
            .order('created_at', { ascending: false });
        return (data || []).map(e => ({
            ...e,
            baseSalary: e.base_salary,
            absenceDays: e.absence_days,
            absenceDeductionPerDay: e.absence_deduction_per_day,
            isActive: e.is_active,
            joinDate: e.join_date,
            payDay: e.pay_day || 'thursday',
        }));
    },

    async create(emp) {
        const { data, error } = await supabase.from('employees').insert({
            name: emp.name,
            phone: emp.phone || '',
            role: emp.role || '',
            base_salary: emp.baseSalary || 0,
            bonus: emp.bonus || 0,
            deductions: emp.deductions || 0,
            absence_days: emp.absenceDays || 0,
            absence_deduction_per_day: emp.absenceDeductionPerDay || 0,
            notes: emp.notes || '',
            is_active: emp.isActive !== false,
            join_date: emp.joinDate || new Date().toISOString().split('T')[0],
            pay_day: emp.payDay || 'thursday',
        }).select().single();
        if (error) throw error;
        return data;
    },

    async update(id, emp) {
        const updates = {};
        if (emp.name !== undefined) updates.name = emp.name;
        if (emp.phone !== undefined) updates.phone = emp.phone;
        if (emp.role !== undefined) updates.role = emp.role;
        if (emp.baseSalary !== undefined) updates.base_salary = emp.baseSalary;
        if (emp.bonus !== undefined) updates.bonus = emp.bonus;
        if (emp.deductions !== undefined) updates.deductions = emp.deductions;
        if (emp.absenceDays !== undefined) updates.absence_days = emp.absenceDays;
        if (emp.absenceDeductionPerDay !== undefined) updates.absence_deduction_per_day = emp.absenceDeductionPerDay;
        if (emp.notes !== undefined) updates.notes = emp.notes;
        if (emp.isActive !== undefined) updates.is_active = emp.isActive;
        if (emp.payDay !== undefined) updates.pay_day = emp.payDay;
        const { error } = await supabase.from('employees').update(updates).eq('id', id);
        if (error) throw error;
    },

    async delete(id) {
        const { error } = await supabase.from('employees').delete().eq('id', id);
        if (error) throw error;
    },
};

// ============ SALARY PAYMENTS ============
export const salaryPaymentsAPI = {
    async getAll() {
        const { data } = await supabase.from('salary_payments').select('*').order('payment_date', { ascending: false });
        return (data || []).map(p => ({ ...p, employeeId: p.employee_id, paymentDate: p.payment_date }));
    },
    async getByEmployee(employeeId) {
        const { data } = await supabase.from('salary_payments').select('*').eq('employee_id', employeeId).order('payment_date', { ascending: false });
        return (data || []).map(p => ({ ...p, employeeId: p.employee_id, paymentDate: p.payment_date }));
    },
    async create(payment) {
        const { data, error } = await supabase.from('salary_payments').insert({
            employee_id: payment.employeeId, amount: payment.amount,
            payment_date: payment.paymentDate || new Date().toISOString().split('T')[0],
            notes: payment.notes || '',
        }).select().single();
        if (error) throw error;
        return data;
    },
    async delete(id) {
        const { error } = await supabase.from('salary_payments').delete().eq('id', id);
        if (error) throw error;
    },
};

// ============ EMPLOYEE ACTIONS ============
export const employeeActionsAPI = {
    async getByEmployee(employeeId) {
        const { data } = await supabase.from('employee_actions').select('*').eq('employee_id', employeeId).order('action_date', { ascending: false });
        return (data || []).map(a => ({ ...a, employeeId: a.employee_id, actionType: a.action_type, actionDate: a.action_date }));
    },
    async create(action) {
        const { data, error } = await supabase.from('employee_actions').insert({
            employee_id: action.employeeId, action_type: action.actionType,
            amount: action.amount || 0, description: action.description || '',
            action_date: action.actionDate || new Date().toISOString().split('T')[0],
        }).select().single();
        if (error) throw error;
        return data;
    },
    async delete(id) {
        const { error } = await supabase.from('employee_actions').delete().eq('id', id);
        if (error) throw error;
    },
};

export const sheetsAPI = {
    async getSheetRecords(sheetId) {
        if (!isConfigured) throw new Error('قاعدة البيانات غير متصلة');
        const { data, error } = await supabase
            .from('custom_sheets_data')
            .select('records')
            .eq('sheet_id', sheetId)
            .maybeSingle();
        if (error) throw error;
        return Array.isArray(data?.records) ? data.records : [];
    },

    async saveSheetRecords(sheetId, records) {
        await writeCloudSheet(sheetId, records);
    },

    async getAllSheetsData() {
        if (!isConfigured) throw new Error('قاعدة البيانات غير متصلة');
        const { data, error } = await supabase.from('custom_sheets_data').select('*');
        if (error) throw error;
        const map = {};
        if (Array.isArray(data)) {
            data.forEach(row => {
                if (row.sheet_id && Array.isArray(row.records)) {
                    map[row.sheet_id] = row.records;
                }
            });
        }
        return map;
    },

    async getAllSheetCounts() {
        const sheets = await this.getAllSheetsData();
        return Object.fromEntries(
            Object.entries(sheets).map(([id, records]) => [id, Array.isArray(records) ? records.length : 0])
        );
    },

    async getSheetsConfig() {
        if (!isConfigured) throw new Error('قاعدة البيانات غير متصلة');
        const { data, error } = await supabase
            .from('custom_sheets_config')
            .select('config')
            .eq('id', 'main_config')
            .maybeSingle();
        if (error) throw error;
        return Array.isArray(data?.config) ? data.config : [];
    },

    async saveSheetsConfig(config) {
        if (!isConfigured) throw new Error('قاعدة البيانات غير متصلة');
        const { error } = await supabase.from('custom_sheets_config').upsert({
            id: 'main_config',
            config,
            updated_at: new Date().toISOString()
        });
        if (error) throw error;
    }
};
