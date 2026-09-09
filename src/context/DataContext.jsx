import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import {
    productsAPI,
    salesAPI,
    accountsAPI,
    customersAPI,
    sectionsAPI,
    problemsAPI,
    expensesAPI,
    walletsAPI
} from '../services/api';

const DataContext = createContext();
const SORT_KEY = 'service-vip_product_order';
const TAB_STORAGE_KEY = 'service_vip_active_tab';

const getInitialActiveTab = () => {
    try {
        if (typeof window !== 'undefined' && window.location.hash) {
            const hashTab = window.location.hash.replace('#', '').trim();
            if (hashTab) return hashTab;
        }
        const saved = localStorage.getItem(TAB_STORAGE_KEY);
        if (saved && saved.trim()) return saved.trim();
    } catch (e) {
        console.warn('Error retrieving saved active tab:', e);
    }
    return 'client_data';
};

const getSavedOrder = () => {
    try { return JSON.parse(localStorage.getItem(SORT_KEY) || '{}'); } catch { return {}; }
};

const sortProducts = (products, orderMap) => {
    return [...products].sort((a, b) => {
        const catA = (a.category || 'بدون تصنيف').toLowerCase();
        const catB = (b.category || 'بدون تصنيف').toLowerCase();
        if (catA !== catB) return catA.localeCompare(catB);
        return (orderMap[a.id] ?? 999) - (orderMap[b.id] ?? 999);
    });
};

// الجداول اللي هنراقبها في الوقت الحقيقي
const REALTIME_TABLES = [
    'sales',
    'products',
    'accounts',
    'customers',
    'inventory_sections',
    'problems',
    'users',
    'custom_sheets_data',
    'custom_sheets_config'
];

export const DataProvider = ({ children }) => {
    const { user } = useAuth();

    // --- Data States ---
    const [sales, setSales] = useState([]);
    const [accounts, setAccounts] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [rawProducts, setRawProducts] = useState([]);
    const [products, setProducts] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [wallets, setWallets] = useState([]);
    const [transactions, setTransactions] = useState([]);
    const [sections, setSections] = useState([]);
    const [problems, setProblems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [productSortOrder, setProductSortOrder] = useState(getSavedOrder);

    // --- Stats State ---
    const [stats, setStats] = useState({
        revenue: 0,
        netProfit: 0,
        expenses: 0,
        final: 0
    });

    // --- Control States (Persisted across page reload / F5) ---
    const [activeTab, setActiveTabState] = useState(getInitialActiveTab);
    const [renewalTarget, setRenewalTarget] = useState(null);

    const setActiveTab = useCallback((tab) => {
        if (!tab) return;
        setActiveTabState(tab);
        try {
            localStorage.setItem(TAB_STORAGE_KEY, tab);
            if (typeof window !== 'undefined' && window.history?.replaceState) {
                window.history.replaceState(null, '', `#${tab}`);
            }
        } catch (e) {
            console.warn('Error saving active tab:', e);
        }
    }, []);

    // Listen to hash changes (browser back/forward navigation)
    useEffect(() => {
        const onHashChange = () => {
            try {
                const currentHash = window.location.hash.replace('#', '').trim();
                if (currentHash && currentHash !== activeTab) {
                    setActiveTabState(currentHash);
                    localStorage.setItem(TAB_STORAGE_KEY, currentHash);
                }
            } catch (e) {
                console.warn(e);
            }
        };
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, [activeTab]);

    // Ensure URL hash stays synced on initial mount
    useEffect(() => {
        try {
            if (activeTab && typeof window !== 'undefined' && window.history?.replaceState) {
                const cur = window.location.hash.replace('#', '').trim();
                if (cur !== activeTab) {
                    window.history.replaceState(null, '', `#${activeTab}`);
                }
            }
        } catch (e) {
            // ignore
        }
    }, [activeTab]);

    // --- Realtime refs ---
    const realtimeTimerRef = useRef(null);
    const syncChannelRef = useRef(null);

    // إعادة ترتيب المنتجات عند تغيير الترتيب أو البيانات
    useEffect(() => {
        setProducts(sortProducts(rawProducts, productSortOrder));
    }, [rawProducts, productSortOrder]);

    // تحريك منتج — متاحة لكل الكومبوننتس
    const reorderProducts = (productId, direction) => {
        const sorted = sortProducts(rawProducts, productSortOrder);
        const product = sorted.find(p => p.id === productId);
        if (!product) return;

        const cat = product.category || 'بدون تصنيف';
        const catProducts = sorted.filter(p => (p.category || 'بدون تصنيف') === cat);
        const idx = catProducts.findIndex(p => p.id === productId);
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= catProducts.length) return;

        const newOrder = { ...productSortOrder };
        catProducts.forEach((p, i) => { newOrder[p.id] = i; });
        newOrder[catProducts[idx].id] = swapIdx;
        newOrder[catProducts[swapIdx].id] = idx;

        localStorage.setItem(SORT_KEY, JSON.stringify(newOrder));
        setProductSortOrder(newOrder);

        // محاولة حفظ في الداتابيز (اختياري)
        productsAPI.updateSortOrder([
            { id: catProducts[idx].id, sort_order: swapIdx },
            { id: catProducts[swapIdx].id, sort_order: idx },
        ]).catch(() => {});
    };

    // ============ DATA FETCHING ============

    // جلب البيانات من الداتابيز (داخلي — بدون بث)
    const _fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);

        try {
            const [
                salesData,
                accountsData,
                productsData,
                customersData,
                sectionsData,
                problemsData,
                expensesData,
                walletsData,
            ] = await Promise.allSettled([
                salesAPI.getAll(),
                accountsAPI.getAll(),
                productsAPI.getAll(),
                customersAPI.getAll(),
                sectionsAPI.getAll(),
                problemsAPI.getAll(),
                expensesAPI.getAll(),
                walletsAPI.getAll(),
            ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : []));

            setSales(salesData);
            setAccounts(accountsData);
            setExpenses(expensesData);
            setRawProducts(productsData.map(p => ({
                ...p,
                inventoryProduct: p.inventory_product,
                fulfillmentType: p.fulfillment_type,
            })));
            setCustomers(customersData);
            setWallets(walletsData);
            setSections(sectionsData);
            setProblems(problemsData);

            // جلب المعاملات لكل المحافظ
            if (walletsData.length > 0) {
                try {
                    const txData = await walletsAPI.getTransactions(null);
                    setTransactions(txData);
                } catch (e) {
                    console.warn('Wallet transactions fetch error:', e);
                    setTransactions([]);
                }
            } else {
                setTransactions([]);
            }

            // حساب الإحصائيات
            const totalRevenue = salesData.reduce((a, b) => a + (Number(b.finalPrice || b.final_price) || 0), 0);
            const totalExpensesAmt = expensesData.reduce((a, b) => a + (Number(b.amount) || 0), 0);
            const netProfit = totalRevenue - totalExpensesAmt;

            setStats({
                revenue: totalRevenue,
                netProfit,
                expenses: totalExpensesAmt,
                final: netProfit
            });

        } catch (error) {
            console.error('Data fetch error', error);
        }
        setLoading(false);
    }, [user]);

    // تحديث البيانات + بث إشارة لباقي الأجهزة المتصلة
    const refreshData = useCallback(async () => {
        await _fetchData();
        // بث إشارة تحديث لكل الأجهزة الثانية
        try {
            if (syncChannelRef.current) {
                syncChannelRef.current.send({
                    type: 'broadcast',
                    event: 'data_changed',
                    payload: { ts: Date.now() }
                });
            }
        } catch (e) {
            // تجاهل أخطاء البث
        }
    }, [_fetchData]);

    // تحميل البيانات أول مرة لما المستخدم يسجل دخول
    useEffect(() => {
        _fetchData();
    }, [user, _fetchData]);

    // ============ SUPABASE REALTIME (DUAL APPROACH) ============
    // 1) postgres_changes — يراقب تغييرات الداتابيز مباشرة (محتاج تفعيل Replication)
    // 2) broadcast — بث من جهاز لجهاز (يشتغل دايماً بدون إعدادات إضافية)
    useEffect(() => {
        if (!user) return;

        // Debounced fetch — عشان لو في تغييرات كتير في نفس الوقت ميعملش fetch كل مرة
        const debouncedFetch = () => {
            if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
            realtimeTimerRef.current = setTimeout(() => {
                _fetchData();
            }, 500);
        };

        // ========= Channel 1: postgres_changes =========
        const pgChannel = supabase.channel('realtime-pg-changes');
        REALTIME_TABLES.forEach(table => {
            pgChannel.on(
                'postgres_changes',
                { event: '*', schema: 'public', table },
                (payload) => {
                    console.log(`🔄 DB change [${table}]:`, payload.eventType);
                    debouncedFetch();
                }
            );
        });
        pgChannel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('✅ Postgres changes: subscribed');
            }
        });

        // ========= Channel 2: Broadcast (client-to-client sync) =========
        // self: false — عشان اللي بيبث ميستقبلش رسالته التانية ومتعملش loop
        const syncChannel = supabase.channel('service-vip-sync', {
            config: { broadcast: { self: false } }
        });
        syncChannel.on('broadcast', { event: 'data_changed' }, () => {
            console.log('📡 Broadcast received: data changed by another client');
            debouncedFetch();
        });
        syncChannel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('✅ Broadcast sync: subscribed');
                syncChannelRef.current = syncChannel;
            }
        });

        // تنظيف عند الخروج
        return () => {
            if (realtimeTimerRef.current) clearTimeout(realtimeTimerRef.current);
            syncChannelRef.current = null;
            supabase.removeChannel(pgChannel);
            supabase.removeChannel(syncChannel);
            console.log('🔌 Realtime: unsubscribed from all channels');
        };
    }, [user, _fetchData]);

    return (
        <DataContext.Provider value={{
            sales, accounts, expenses, products, customers, wallets, transactions, sections, problems, stats,
            activeTab, setActiveTab,
            renewalTarget, setRenewalTarget,
            refreshData, reorderProducts,
            loading
        }}>
            {children}
        </DataContext.Provider>
    );
};

export const useData = () => useContext(DataContext);
