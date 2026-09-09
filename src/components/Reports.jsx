import { useState, useMemo, useEffect } from 'react';
import { useData } from '../context/DataContext';
import { sheetsAPI } from '../services/api';
import { calculateRemainingTime } from '../utils/dataRepair';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Title,
    Tooltip,
    Legend
);

export default function Reports() {
    const { sales, expenses, products, refreshData } = useData();
    const [activeSubTab, setActiveSubTab] = useState('overview'); // 'overview' | 'adobe' | 'products'
    const [selectedProduct, setSelectedProduct] = useState(null);
    const [sheetsData, setSheetsData] = useState({ client_data: [], merchant_data: [], account_data: [] });
    const [timeFilter, setTimeFilter] = useState('all'); // 'all', 'month', 'quarter', 'year'

    useEffect(() => {
        window.scrollTo(0, 0);
        loadSheets();
    }, []);

    const loadSheets = async () => {
        try {
            const allData = await sheetsAPI.getAllSheetsData();
            setSheetsData({
                client_data: Array.isArray(allData?.client_data) ? allData.client_data : [],
                merchant_data: Array.isArray(allData?.merchant_data) ? allData.merchant_data : [],
                account_data: Array.isArray(allData?.account_data) ? allData.account_data : [],
                reminders_data: Array.isArray(allData?.reminders_data) ? allData.reminders_data : []
            });
        } catch (err) {
            console.error('Failed to load sheets data for reports:', err);
        }
    };

    // Filter sales and expenses according to timeFilter
    const filteredSales = useMemo(() => {
        if (!sales || sales.length === 0) return [];
        const now = new Date();
        return sales.filter(s => {
            if (!s.date) return true;
            const saleDate = new Date(s.date);
            if (timeFilter === 'month') {
                return saleDate.getMonth() === now.getMonth() && saleDate.getFullYear() === now.getFullYear();
            }
            if (timeFilter === 'quarter') {
                const threeMonthsAgo = new Date();
                threeMonthsAgo.setMonth(now.getMonth() - 3);
                return saleDate >= threeMonthsAgo;
            }
            if (timeFilter === 'year') {
                return saleDate.getFullYear() === now.getFullYear();
            }
            return true;
        });
    }, [sales, timeFilter]);

    const filteredExpenses = useMemo(() => {
        if (!expenses || expenses.length === 0) return [];
        const now = new Date();
        return expenses.filter(e => {
            if (!e.date) return true;
            const expDate = new Date(e.date);
            if (timeFilter === 'month') {
                return expDate.getMonth() === now.getMonth() && expDate.getFullYear() === now.getFullYear();
            }
            if (timeFilter === 'quarter') {
                const threeMonthsAgo = new Date();
                threeMonthsAgo.setMonth(now.getMonth() - 3);
                return expDate >= threeMonthsAgo;
            }
            if (timeFilter === 'year') {
                return expDate.getFullYear() === now.getFullYear();
            }
            return true;
        });
    }, [expenses, timeFilter]);

    // Financial KPIs
    const financialStats = useMemo(() => {
        const totalRevenue = filteredSales.reduce((acc, s) => acc + Number(s.finalPrice || s.sellingPrice || 0), 0);
        const totalExpenses = filteredExpenses.reduce((acc, e) => acc + Number(e.amount || 0), 0);
        const netProfit = totalRevenue - totalExpenses;
        const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : 0;
        const salesCount = filteredSales.length;
        const avgOrderValue = salesCount > 0 ? Math.round(totalRevenue / salesCount) : 0;

        return { totalRevenue, totalExpenses, netProfit, profitMargin, salesCount, avgOrderValue };
    }, [filteredSales, filteredExpenses]);

    // Adobe Subscriptions Stats (Clients + Merchants)
    const adobeStats = useMemo(() => {
        const allClientRecords = [...sheetsData.client_data, ...sheetsData.merchant_data];
        let totalActive = 0;
        let totalExpiring = 0;
        let totalExpired = 0;
        let totalPaid = 0;
        let totalUnpaid = 0;
        const durationMap = {};
        const deviceMap = { 'جهاز': 0, 'جهازين': 0, 'أخرى': 0 };
        const urgentRenewals = [];

        allClientRecords.forEach(r => {
            const rem = calculateRemainingTime(r.startDate, r.duration, r.created_at);
            if (rem) {
                if (rem.status === 'expired') {
                    totalExpired++;
                } else if (rem.status === 'urgent' || (rem.days !== null && rem.days <= 3)) {
                    totalExpiring++;
                    urgentRenewals.push({ ...r, remainingDays: rem.days, remainingText: rem.text });
                } else {
                    totalActive++;
                }
            }

            // Payment status
            const pStatus = String(r.paymentStatus || 'مدفوع').toLowerCase();
            if (pStatus === 'مدفوع' || pStatus === 'paid') {
                totalPaid++;
            } else {
                totalUnpaid++;
            }

            // Duration stats
            const dur = String(r.duration || 'غير محدد').trim();
            durationMap[dur] = (durationMap[dur] || 0) + 1;

            // Device stats
            const dev = String(r.deviceType || '').trim();
            if (dev === 'جهاز') deviceMap['جهاز']++;
            else if (dev === 'جهازين') deviceMap['جهازين']++;
            else deviceMap['أخرى']++;
        });

        // Account inventory stats
        const accountRecords = sheetsData.account_data || [];
        let readyAccounts = 0;
        let fullAccounts = 0;
        accountRecords.forEach(acc => {
            const currentUses = Number(acc.currentUses || acc.current_uses || 0);
            const maxUses = Number(acc.maxUses || acc.allowedUses || 2);
            if (currentUses < maxUses) {
                readyAccounts++;
            } else {
                fullAccounts++;
            }
        });

        return {
            totalAccounts: allClientRecords.length,
            totalActive,
            totalExpiring,
            totalExpired,
            totalPaid,
            totalUnpaid,
            durationMap,
            deviceMap,
            urgentRenewals: urgentRenewals.slice(0, 10),
            inventoryTotal: accountRecords.length,
            readyAccounts,
            fullAccounts
        };
    }, [sheetsData]);

    // Monthly Line Chart Data
    const monthlyData = useMemo(() => {
        const dataMap = {};
        filteredSales.forEach(sale => {
            const date = new Date(sale.date);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!dataMap[key]) dataMap[key] = { revenue: 0, expense: 0 };
            dataMap[key].revenue += Number(sale.finalPrice || sale.sellingPrice || 0);
        });
        filteredExpenses.forEach(exp => {
            const date = new Date(exp.date);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!dataMap[key]) dataMap[key] = { revenue: 0, expense: 0 };
            dataMap[key].expense += Number(exp.amount);
        });
        const sortedKeys = Object.keys(dataMap).sort();
        return {
            labels: sortedKeys,
            datasets: [
                {
                    label: 'الدخل (الإيرادات)',
                    data: sortedKeys.map(k => dataMap[k].revenue),
                    borderColor: '#4f46e5',
                    backgroundColor: 'rgba(79, 70, 229, 0.1)',
                    tension: 0.35,
                    fill: true
                },
                {
                    label: 'المصروفات',
                    data: sortedKeys.map(k => dataMap[k].expense),
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.08)',
                    tension: 0.35,
                    fill: true
                },
                {
                    label: 'صافي الربح',
                    data: sortedKeys.map(k => dataMap[k].revenue - dataMap[k].expense),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.15)',
                    tension: 0.35,
                    fill: true
                }
            ]
        };
    }, [filteredSales, filteredExpenses]);

    // Top Products Bar Chart Data
    const productProfitData = useMemo(() => {
        const profitMap = {};
        filteredSales.forEach(sale => {
            const profit = Number(sale.finalPrice || sale.sellingPrice || 0);
            const name = sale.productName || 'غير محدد';
            profitMap[name] = (profitMap[name] || 0) + profit;
        });
        const sortedProducts = Object.entries(profitMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
        return {
            labels: sortedProducts.map(p => p[0]),
            datasets: [{
                label: 'الإيرادات (EGP)',
                data: sortedProducts.map(p => p[1]),
                backgroundColor: 'rgba(99, 102, 241, 0.85)',
                hoverBackgroundColor: '#4f46e5',
                borderRadius: 8
            }]
        };
    }, [filteredSales]);

    // Expenses Doughnut Chart Data
    const expensesTypeData = useMemo(() => {
        const typeMap = {};
        filteredExpenses.forEach(exp => {
            const type = exp.type || exp.category || 'أخرى';
            typeMap[type] = (typeMap[type] || 0) + Number(exp.amount);
        });
        return {
            labels: Object.keys(typeMap).length ? Object.keys(typeMap) : ['لا توجد مصروفات'],
            datasets: [{
                data: Object.values(typeMap).length ? Object.values(typeMap) : [1],
                backgroundColor: ['#ef4444', '#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4'],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        };
    }, [filteredExpenses]);

    // Adobe Duration Doughnut Chart
    const durationChartData = useMemo(() => {
        const labels = Object.keys(adobeStats.durationMap);
        const data = Object.values(adobeStats.durationMap);
        return {
            labels: labels.length ? labels : ['لا توجد بيانات'],
            datasets: [{
                data: data.length ? data : [1],
                backgroundColor: ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        };
    }, [adobeStats.durationMap]);

    // Adobe Devices Chart Data
    const deviceChartData = useMemo(() => {
        return {
            labels: ['💻 جهاز واحد', '🖥️ جهازين', '📱 أخرى'],
            datasets: [{
                data: [adobeStats.deviceMap['جهاز'], adobeStats.deviceMap['جهازين'], adobeStats.deviceMap['أخرى']],
                backgroundColor: ['#3b82f6', '#8b5cf6', '#94a3b8'],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        };
    }, [adobeStats.deviceMap]);

    // Products Summary Grid
    const productsSummary = useMemo(() => {
        if (!products || products.length === 0) return [];
        return products.map(product => {
            const productSales = filteredSales.filter(s => s.productName === product.name);
            const revenue = productSales.reduce((sum, s) => sum + Number(s.finalPrice || s.sellingPrice || 0), 0);
            const count = productSales.length;
            return {
                id: product.id,
                name: product.name,
                count,
                revenue,
                price: product.price || 0
            };
        }).sort((a, b) => b.revenue - a.revenue);
    }, [products, filteredSales]);

    return (
        <div className="space-y-6 pb-20 font-sans animate-fade-in">
            {/* Top Header & Controls */}
            <div className="bg-white dark:bg-slate-900 p-5 sm:p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 text-xl">
                        <i className="fa-solid fa-chart-pie"></i>
                    </div>
                    <div>
                        <h1 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                            التقارير والإحصائيات
                            <span className="text-[10px] bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold px-2.5 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-800">
                                Realtime Analytics
                            </span>
                        </h1>
                        <p className="text-xs font-bold text-slate-400 dark:text-slate-500 mt-0.5">
                            لوحة بيانات مركزية لمتابعة الأداء المالي واشتراكات Adobe
                        </p>
                    </div>
                </div>

                {/* Controls: Time Filter & Refresh */}
                <div className="flex items-center gap-2 self-stretch sm:self-auto">
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold w-full sm:w-auto">
                        {[
                            { id: 'all', label: 'الكل' },
                            { id: 'month', label: 'هذا الشهر' },
                            { id: 'quarter', label: 'آخر 3 أشهر' },
                            { id: 'year', label: 'هذا العام' }
                        ].map(tf => (
                            <button
                                key={tf.id}
                                onClick={() => setTimeFilter(tf.id)}
                                className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg transition text-[11px] ${
                                    timeFilter === tf.id
                                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm font-black'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                }`}
                            >
                                {tf.label}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={() => { refreshData(); loadSheets(); }}
                        className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition"
                        title="تحديث البيانات"
                    >
                        <i className="fa-solid fa-arrows-rotate text-sm"></i>
                    </button>
                </div>
            </div>

            {/* Main Navigation Tabs */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-2xl p-1.5 shadow-sm">
                {[
                    { id: 'overview', label: '📊 الملخص المالي ومؤشرات الأداء', count: null },
                    { id: 'adobe', label: '🎨 حسابات واشتراكات Adobe', count: adobeStats.totalAccounts },
                    { id: 'products', label: '📦 تحليلات البرامج والمصروفات', count: productsSummary.length }
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveSubTab(tab.id)}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-xs sm:text-sm transition-all ${
                            activeSubTab === tab.id
                                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md shadow-indigo-500/20 font-black'
                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                    >
                        <span>{tab.label}</span>
                        {tab.count !== null && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                                activeSubTab === tab.id ? 'bg-white/25 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                            }`}>
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* TAB 1: OVERVIEW */}
            {activeSubTab === 'overview' && (
                <div className="space-y-6 animate-fade-in">
                    {/* KPI Cards */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {/* Revenue Card */}
                        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">إجمالي الإيرادات</span>
                                <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-lg">
                                    <i className="fa-solid fa-coins"></i>
                                </div>
                            </div>
                            <div className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-slate-100 dir-ltr text-right">
                                {financialStats.totalRevenue.toLocaleString()} <span className="text-xs font-bold text-slate-400">ج.م</span>
                            </div>
                            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold mt-2 flex items-center gap-1">
                                <i className="fa-solid fa-arrow-trend-up"></i>
                                {financialStats.salesCount} عملية بيع
                            </p>
                        </div>

                        {/* Expenses Card */}
                        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">إجمالي المصروفات</span>
                                <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center text-lg">
                                    <i className="fa-solid fa-receipt"></i>
                                </div>
                            </div>
                            <div className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-slate-100 dir-ltr text-right">
                                {financialStats.totalExpenses.toLocaleString()} <span className="text-xs font-bold text-slate-400">ج.م</span>
                            </div>
                            <p className="text-[10px] text-slate-400 font-bold mt-2 flex items-center gap-1">
                                <i className="fa-solid fa-wallet"></i>
                                {filteredExpenses.length} بند مصروف
                            </p>
                        </div>

                        {/* Net Profit Card */}
                        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">صافي الأرباح</span>
                                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-lg">
                                    <i className="fa-solid fa-sack-dollar"></i>
                                </div>
                            </div>
                            <div className={`text-2xl sm:text-3xl font-black dir-ltr text-right ${
                                financialStats.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                            }`}>
                                {financialStats.netProfit.toLocaleString()} <span className="text-xs font-bold text-slate-400">ج.م</span>
                            </div>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold mt-2">
                                هامش الربح: <span className="text-emerald-600 dark:text-emerald-400 font-black">{financialStats.profitMargin}%</span>
                            </p>
                        </div>

                        {/* Average Order Value */}
                        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden group">
                            <div className="flex items-center justify-between mb-3">
                                <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider">متوسط الطلب</span>
                                <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center text-lg">
                                    <i className="fa-solid fa-cart-shopping"></i>
                                </div>
                            </div>
                            <div className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-slate-100 dir-ltr text-right">
                                {financialStats.avgOrderValue.toLocaleString()} <span className="text-xs font-bold text-slate-400">ج.م</span>
                            </div>
                            <p className="text-[10px] text-blue-600 dark:text-blue-400 font-bold mt-2">
                                متوسط قيمة المعاملة
                            </p>
                        </div>
                    </div>

                    {/* Monthly Trend Chart */}
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-6">
                            <div>
                                <h3 className="text-base font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                    <i className="fa-solid fa-chart-line text-indigo-500"></i>
                                    المسار المالي الشهري (الدخل - المصروفات - الأرباح)
                                </h3>
                                <p className="text-xs text-slate-400 font-medium">متابعة دقيقة لتدفقات الأموال على مدار الأشهر</p>
                            </div>
                            <div className="flex items-center gap-3 text-xs font-bold">
                                <span className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                                    <span className="w-3 h-3 rounded-full bg-indigo-500"></span> الدخل
                                </span>
                                <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                                    <span className="w-3 h-3 rounded-full bg-red-500"></span> المصروفات
                                </span>
                                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                                    <span className="w-3 h-3 rounded-full bg-emerald-500"></span> صافي الربح
                                </span>
                            </div>
                        </div>

                        {monthlyData.labels.length === 0 ? (
                            <div className="py-16 text-center text-slate-400">
                                <i className="fa-solid fa-chart-line text-4xl mb-3 opacity-30"></i>
                                <p className="font-bold">لا توجد بيانات مالية مسجلة بعد</p>
                            </div>
                        ) : (
                            <div className="h-80">
                                <Line
                                    data={monthlyData}
                                    options={{
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        plugins: { legend: { display: false } },
                                        scales: {
                                            y: {
                                                grid: { color: 'rgba(148, 163, 184, 0.1)' },
                                                ticks: { font: { family: 'sans-serif', size: 11 } }
                                            },
                                            x: {
                                                grid: { display: false },
                                                ticks: { font: { family: 'sans-serif', size: 11 } }
                                            }
                                        }
                                    }}
                                />
                            </div>
                        )}
                    </div>

                    {/* Quick Stats Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-gradient-to-br from-indigo-500 to-purple-700 p-6 rounded-2xl text-white shadow-lg shadow-indigo-500/20">
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-xs font-bold text-indigo-200 uppercase tracking-wider">نشاط الاشتراكات</span>
                                <i className="fa-solid fa-users text-2xl text-indigo-200"></i>
                            </div>
                            <div className="text-3xl font-black mb-2">{adobeStats.totalActive}</div>
                            <p className="text-xs text-indigo-100 font-medium">اشتراك نشط حالياً يعمل بكفاءة</p>
                        </div>

                        <div className="bg-gradient-to-br from-amber-500 to-orange-600 p-6 rounded-2xl text-white shadow-lg shadow-amber-500/20">
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-xs font-bold text-amber-200 uppercase tracking-wider">تنبيهات التجديد</span>
                                <i className="fa-solid fa-clock text-2xl text-amber-200"></i>
                            </div>
                            <div className="text-3xl font-black mb-2">{adobeStats.totalExpiring}</div>
                            <p className="text-xs text-amber-100 font-medium">اشتراكات تقترب من الانتهاء خلال 3 أيام</p>
                        </div>

                        <div className="bg-gradient-to-br from-emerald-500 to-teal-700 p-6 rounded-2xl text-white shadow-lg shadow-emerald-500/20">
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-xs font-bold text-emerald-200 uppercase tracking-wider">المخزون المتاح</span>
                                <i className="fa-solid fa-shield-halved text-2xl text-emerald-200"></i>
                            </div>
                            <div className="text-3xl font-black mb-2">{adobeStats.readyAccounts}</div>
                            <p className="text-xs text-emerald-100 font-medium">حساب أدوبي جاهز للربط والبيع فوراً</p>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB 2: ADOBE ACCOUNTS */}
            {activeSubTab === 'adobe' && (
                <div className="space-y-6 animate-fade-in">
                    {/* Adobe Summary Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                            <span className="text-[11px] font-black text-slate-400 block mb-1">إجمالي الحسابات المسجلة</span>
                            <div className="text-3xl font-black text-slate-800 dark:text-slate-100">{adobeStats.totalAccounts}</div>
                            <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">
                                <span>عملاء: {sheetsData.client_data.length}</span>
                                <span>•</span>
                                <span>تجار: {sheetsData.merchant_data.length}</span>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                            <span className="text-[11px] font-black text-slate-400 block mb-1">اشتراكات نشطة</span>
                            <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{adobeStats.totalActive}</div>
                            <div className="mt-2 text-[10px] font-bold text-slate-400">سارية وغير منتهية</div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                            <span className="text-[11px] font-black text-slate-400 block mb-1">تنبيهات قرب الانتهاء</span>
                            <div className="text-3xl font-black text-amber-500">{adobeStats.totalExpiring}</div>
                            <div className="mt-2 text-[10px] font-bold text-amber-600 dark:text-amber-400">متبقي 3 أيام أو أقل</div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                            <span className="text-[11px] font-black text-slate-400 block mb-1">اشتراكات منتهية</span>
                            <div className="text-3xl font-black text-rose-600 dark:text-rose-400">{adobeStats.totalExpired}</div>
                            <div className="mt-2 text-[10px] font-bold text-rose-500">تحتاج إلى تجديد أو نقل</div>
                        </div>
                    </div>

                    {/* Adobe Charts Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Duration Distribution */}
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                                <i className="fa-solid fa-calendar-days text-indigo-500"></i>
                                توزيع مدد الاشتراكات (شهور / سنوي)
                            </h3>
                            <div className="h-64 flex justify-center items-center">
                                <Doughnut
                                    data={durationChartData}
                                    options={{
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } }
                                    }}
                                />
                            </div>
                        </div>

                        {/* Device Types */}
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                                <i className="fa-solid fa-desktop text-blue-500"></i>
                                توزيع نوع الأجهزة
                            </h3>
                            <div className="h-64 flex justify-center items-center">
                                <Doughnut
                                    data={deviceChartData}
                                    options={{
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } }
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Urgent Renewals Table */}
                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                            <div>
                                <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                                    <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>
                                    تنبيهات التجديد العاجلة (خلال 3 أيام)
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">حسابات تحتاج للتواصل مع العميل لتجديد الاشتراك</p>
                            </div>
                            <span className="bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-xs font-black px-3 py-1 rounded-full border border-amber-200 dark:border-amber-800">
                                {adobeStats.urgentRenewals.length} حساب
                            </span>
                        </div>

                        {adobeStats.urgentRenewals.length === 0 ? (
                            <div className="p-10 text-center text-slate-400">
                                <i className="fa-solid fa-circle-check text-4xl text-emerald-400 mb-2"></i>
                                <p className="font-bold text-sm">ممتاز! لا توجد اشتراكات قاربت على الانتهاء حالياً</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs text-right">
                                    <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-black">
                                        <tr>
                                            <th className="p-3.5">العميل</th>
                                            <th className="p-3.5">البريد</th>
                                            <th className="p-3.5">الهاتف</th>
                                            <th className="p-3.5">المدة</th>
                                            <th className="p-3.5">المتبقي</th>
                                            <th className="p-3.5">تاريخ البداية</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {adobeStats.urgentRenewals.map((r, i) => (
                                            <tr key={r.id || i} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition">
                                                <td className="p-3.5 font-black text-slate-800 dark:text-slate-200">{r.name || 'عميل'}</td>
                                                <td className="p-3.5 font-mono text-slate-600 dark:text-slate-400 dir-ltr text-right">{r.email || '-'}</td>
                                                <td className="p-3.5 font-mono text-slate-600 dark:text-slate-400 dir-ltr text-right">{r.phone || '-'}</td>
                                                <td className="p-3.5 font-bold text-indigo-600 dark:text-indigo-400">{r.duration || '-'}</td>
                                                <td className="p-3.5">
                                                    <span className="bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 px-2.5 py-1 rounded-lg font-black text-[10px]">
                                                        {r.remainingText}
                                                    </span>
                                                </td>
                                                <td className="p-3.5 font-mono text-slate-500">{r.startDate || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 3: PRODUCTS & EXPENSES */}
            {activeSubTab === 'products' && (
                <div className="space-y-6 animate-fade-in">
                    {/* Charts Row */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Top Products Bar Chart */}
                        <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                                <i className="fa-solid fa-ranking-star text-amber-500"></i>
                                أكثر البرامج تحقيقاً للإيرادات
                            </h3>
                            <div className="h-64">
                                <Bar
                                    data={productProfitData}
                                    options={{
                                        indexAxis: 'y',
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        plugins: { legend: { display: false } },
                                        scales: {
                                            x: { grid: { display: false } },
                                            y: { grid: { display: false } }
                                        }
                                    }}
                                />
                            </div>
                        </div>

                        {/* Expenses Breakdown Doughnut */}
                        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                            <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                                <i className="fa-solid fa-wallet text-red-500"></i>
                                توزيع بنود المصروفات
                            </h3>
                            <div className="h-64 flex justify-center items-center">
                                <Doughnut
                                    data={expensesTypeData}
                                    options={{
                                        responsive: true,
                                        maintainAspectRatio: false,
                                        cutout: '70%',
                                        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Products Grid */}
                    <div>
                        <h3 className="text-sm font-black text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                            <i className="fa-solid fa-layer-group text-indigo-500"></i>
                            تحليل تفصيلي لكل برنامج (اضغط على البرنامج لعرض التفاصيل)
                        </h3>

                        {productsSummary.length === 0 ? (
                            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center text-slate-400">
                                <i className="fa-solid fa-box-open text-4xl mb-3 opacity-30"></i>
                                <p className="font-bold">لا توجد منتجات مسجلة في النظام</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {productsSummary.map(prod => (
                                    <div
                                        key={prod.id}
                                        onClick={() => setSelectedProduct(prod.name)}
                                        className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-lg hover:border-indigo-400 dark:hover:border-indigo-600 hover:-translate-y-1 cursor-pointer transition-all duration-200 group"
                                    >
                                        <div className="flex justify-between items-center mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-11 h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-black text-lg flex items-center justify-center border border-indigo-100 dark:border-indigo-800 group-hover:bg-indigo-600 group-hover:text-white transition">
                                                    {prod.name.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <h4 className="font-black text-slate-800 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">
                                                        {prod.name}
                                                    </h4>
                                                    <span className="text-[11px] font-bold text-slate-400">
                                                        السعر: {Number(prod.price).toLocaleString()} ج.م
                                                    </span>
                                                </div>
                                            </div>
                                            <i className="fa-solid fa-arrow-left text-slate-300 group-hover:text-indigo-500 group-hover:-translate-x-1 transition-all"></i>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 dark:border-slate-800 pt-3 text-center">
                                            <div>
                                                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">العمليات</span>
                                                <span className="text-lg font-black text-slate-800 dark:text-slate-100">{prod.count}</span>
                                            </div>
                                            <div>
                                                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">الإيرادات</span>
                                                <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 dir-ltr block">
                                                    {Number(prod.revenue).toLocaleString()} ج.م
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modal for Detailed Product Analysis */}
            {selectedProduct && (
                <ProductAnalysisModal
                    productName={selectedProduct}
                    sales={sales}
                    onClose={() => setSelectedProduct(null)}
                />
            )}
        </div>
    );
}

// Modal Component for Detailed Product Sales
function ProductAnalysisModal({ productName, sales, onClose }) {
    const [dateRange, setDateRange] = useState({ start: '', end: '' });

    const filteredData = useMemo(() => {
        return (sales || []).filter(s => {
            if (s.productName !== productName) return false;
            if (dateRange.start && new Date(s.date) < new Date(dateRange.start)) return false;
            if (dateRange.end) {
                const end = new Date(dateRange.end);
                end.setHours(23, 59, 59);
                if (new Date(s.date) > end) return false;
            }
            return true;
        });
    }, [sales, productName, dateRange]);

    const stats = useMemo(() => {
        const count = filteredData.length;
        const revenue = filteredData.reduce((sum, s) => sum + Number(s.finalPrice || s.sellingPrice || 0), 0);
        const paid = filteredData.filter(s => s.isPaid).length;
        const unpaid = count - paid;
        return { count, revenue, paid, unpaid };
    }, [filteredData]);

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
            <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-lg">
                            {productName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-slate-800 dark:text-slate-100">تحليل مبيعات: {productName}</h2>
                            <p className="text-xs text-slate-400">تقرير تفصيلي لعمليات بيع هذا البرنامج</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                    >
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="p-6 overflow-y-auto space-y-5 custom-scrollbar">
                    {/* Date filter */}
                    <div className="flex gap-3">
                        <input
                            type="date"
                            value={dateRange.start}
                            onChange={e => setDateRange(d => ({ ...d, start: e.target.value }))}
                            className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none"
                            placeholder="من تاريخ"
                        />
                        <input
                            type="date"
                            value={dateRange.end}
                            onChange={e => setDateRange(d => ({ ...d, end: e.target.value }))}
                            className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none"
                            placeholder="إلى تاريخ"
                        />
                        <button
                            onClick={() => setDateRange({ start: '', end: '' })}
                            className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl hover:bg-slate-200"
                        >
                            <i className="fa-solid fa-rotate-right text-xs"></i>
                        </button>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-4 gap-3">
                        <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl text-center">
                            <span className="text-[10px] font-bold text-slate-400 block mb-1">العمليات</span>
                            <span className="text-xl font-black text-slate-800 dark:text-slate-100">{stats.count}</span>
                        </div>
                        <div className="bg-emerald-50 dark:bg-emerald-950/40 p-3.5 rounded-xl text-center">
                            <span className="text-[10px] font-bold text-emerald-600 block mb-1">الإيرادات</span>
                            <span className="text-base font-black text-emerald-700 dark:text-emerald-400 dir-ltr block">{stats.revenue.toLocaleString()}</span>
                        </div>
                        <div className="bg-blue-50 dark:bg-blue-950/40 p-3.5 rounded-xl text-center">
                            <span className="text-[10px] font-bold text-blue-600 block mb-1">مدفوع</span>
                            <span className="text-xl font-black text-blue-700 dark:text-blue-400">{stats.paid}</span>
                        </div>
                        <div className="bg-red-50 dark:bg-red-950/40 p-3.5 rounded-xl text-center">
                            <span className="text-[10px] font-bold text-red-600 block mb-1">غير مدفوع</span>
                            <span className="text-xl font-black text-red-700 dark:text-red-400">{stats.unpaid}</span>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                        <table className="w-full text-xs text-right">
                            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-black">
                                <tr>
                                    <th className="p-3">التاريخ</th>
                                    <th className="p-3">العميل</th>
                                    <th className="p-3">الحالة</th>
                                    <th className="p-3">المبلغ</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {filteredData.length === 0 ? (
                                    <tr>
                                        <td colSpan="4" className="p-6 text-center text-slate-400">لا توجد مبيعات تطابق الفلتر</td>
                                    </tr>
                                ) : (
                                    filteredData.map(s => (
                                        <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                                            <td className="p-3 font-mono text-slate-500">{new Date(s.date).toLocaleDateString('en-GB')}</td>
                                            <td className="p-3 font-bold text-slate-700 dark:text-slate-300">{s.customerEmail || s.customerName || '-'}</td>
                                            <td className="p-3">
                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                    s.isPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                                                }`}>
                                                    {s.isPaid ? 'مدفوع' : 'غير مدفوع'}
                                                </span>
                                            </td>
                                            <td className="p-3 font-black text-slate-800 dark:text-slate-100 dir-ltr text-right">
                                                {Number(s.finalPrice || s.sellingPrice || 0).toLocaleString()} ج.م
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}