import { useState, useMemo, useEffect } from 'react';
import { DEFAULT_SHEETS, calculateRemainingTime, calculateAccountReminder } from '../utils/dataRepair';
import { useAuth } from '../context/AuthContext';
import { SHEETS_CHANGED } from '../services/sheetSync';
import { sheetsAPI } from '../services/api';

export default function DashboardAlerts({ onNavigateSheet, mode = 'dashboard' }) {
    const { user, hasPermission } = useAuth();

    // Helper: check if user has permission for a specific sheet
    const canAccessSheet = (sheetId) => {
        if (!user) return false;
        if (user.role === 'admin' || (Array.isArray(user.permissions) && user.permissions.includes('all'))) return true;
        return hasPermission('sheet_' + sheetId) || hasPermission(sheetId);
    };
    const [sheetsConfig, setSheetsConfig] = useState(DEFAULT_SHEETS);
    const [allRecordsBySheet, setAllRecordsBySheet] = useState({});
    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all'); // 'all', 'near', 'expired'
    const [sheetFilter, setSheetFilter] = useState('all'); // 'all', 'client_data', 'merchant_data'
    const [visibleSecrets, setVisibleSecrets] = useState({});
    const [copiedField, setCopiedField] = useState(null);

    // Copy helper
    const handleCopy = (text, fieldKey) => {
        if (!text) return;
        navigator.clipboard.writeText(String(text));
        setCopiedField(fieldKey);
        setTimeout(() => setCopiedField(null), 1500);
    };

    const toggleSecret = (id, field) => {
        const key = `${id}_${field}`;
        setVisibleSecrets(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Load data from all sheets
    const loadAllData = async () => {
        try {
            const [config, recordsMap] = await Promise.all([
                sheetsAPI.getSheetsConfig(),
                sheetsAPI.getAllSheetsData()
            ]);

            if (Array.isArray(config) && config.length > 0) {
                setSheetsConfig(config);
            }

            const nextRecords = {};
            DEFAULT_SHEETS.forEach(sheet => {
                nextRecords[sheet.id] = Array.isArray(recordsMap?.[sheet.id]) ? recordsMap[sheet.id] : [];
            });
            setAllRecordsBySheet(nextRecords);
        } catch (error) {
            console.error('Failed loading dashboard alerts:', error);
            setAllRecordsBySheet({});
        }
    };

    useEffect(() => {
        loadAllData();
        window.addEventListener(SHEETS_CHANGED, loadAllData);
        const interval = setInterval(loadAllData, 30000);
        return () => { clearInterval(interval); window.removeEventListener(SHEETS_CHANGED, loadAllData); };
    }, []);

    // Get sheet metadata helper
    const getSheetMeta = (sheetId) => {
        return sheetsConfig.find(s => s.id === sheetId) || DEFAULT_SHEETS.find(s => s.id === sheetId) || {
            id: sheetId,
            name: sheetId,
            color: 'from-blue-600 to-indigo-600',
            icon: 'fa-table'
        };
    };

    // Aggregate all alerts across all subscription sheets (Client and Merchant)
    const { allAlerts, totalStats } = useMemo(() => {
        let totalCount = 0;
        let totalSubscriptions = 0;
        const alertsList = [];

        Object.entries(allRecordsBySheet).forEach(([sheetId, records]) => {
            if (sheetId === 'trash_data' || sheetId === 'account_data') return;
            if (!canAccessSheet(sheetId)) return; // Only process sheets the user is permitted to access
            totalCount += records.length;
            const sheetMeta = getSheetMeta(sheetId);

            records.forEach(rec => {
                if (rec.duration) totalSubscriptions++;
                const rem = calculateRemainingTime(rec.startDate, rec.duration, rec.created_at);

                if (!rem || rem.status === 'none') return;

                const isNear = rem.days !== null && rem.days >= 0 && rem.days <= 3 && rem.status !== 'lifetime';
                const isExpired = rem.days !== null && rem.days < 0;

                if (isNear || isExpired) {
                    alertsList.push({
                        ...rec,
                        sheetId,
                        sheetName: sheetMeta.name || sheetMeta.label || sheetId,
                        sheetColor: sheetMeta.color || 'from-indigo-600 to-blue-600',
                        sheetIcon: sheetMeta.icon || 'fa-table',
                        remInfo: rem,
                        alertType: isNear ? 'near' : 'expired'
                    });
                }
            });
        });

        // Sort alerts: near renewal with least days first, then expired with most recent
        alertsList.sort((a, b) => {
            if (a.alertType === 'near' && b.alertType !== 'near') return -1;
            if (a.alertType !== 'near' && b.alertType === 'near') return 1;
            return (a.remInfo.days ?? 0) - (b.remInfo.days ?? 0);
        });

        const nearCount = alertsList.filter(a => a.alertType === 'near').length;
        const expiredCount = alertsList.filter(a => a.alertType === 'expired').length;

        return {
            allAlerts: alertsList,
            totalStats: {
                totalCount,
                totalSubscriptions,
                nearCount,
                expiredCount
            }
        };
    }, [allRecordsBySheet, sheetsConfig, user, hasPermission]);

    // Filter alerts list by search query and type tabs
    const filteredAlerts = useMemo(() => {
        return allAlerts.filter(item => {
            // Type filter
            if (filterType === 'near' && item.alertType !== 'near') return false;
            if (filterType === 'expired' && item.alertType !== 'expired') return false;

            // Sheet filter
            if (sheetFilter !== 'all' && item.sheetId !== sheetFilter) return false;

            // Search query
            if (searchTerm.trim()) {
                const q = searchTerm.toLowerCase().trim();
                const matches = (
                    String(item.email || '').toLowerCase().includes(q) ||
                    String(item.sheetName || '').toLowerCase().includes(q) ||
                    String(item.duration || '').toLowerCase().includes(q) ||
                    String(item.remInfo.text || '').toLowerCase().includes(q) ||
                    String(item.notes || '').toLowerCase().includes(q)
                );
                if (!matches) return false;
            }

            return true;
        });
    }, [allAlerts, filterType, sheetFilter, searchTerm]);

    const currentDateFormatted = new Date().toLocaleDateString('ar-EG', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    return (
        <div className="space-y-6 animate-fade-in font-sans pb-12">
            {/* Top Welcome & Navigation Header */}
            <div className="workspace-heading text-slate-800 dark:text-white p-4 border-b border-slate-200 relative">

                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                        {mode === 'alerts' ? (
                            <>
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold mb-2">
                                    <i className="fa-solid fa-bell text-xs"></i>
                                    <span>مركز التنبيهات</span>
                                </div>
                                <h2 className="text-2xl md:text-3xl font-black tracking-tight">
                                    تنبيهات تجديد الاشتراكات
                                </h2>
                                <p className="text-slate-300 text-xs md:text-sm">
                                    {currentDateFormatted} • متابعة الاشتراكات التي أوشكت على الانتهاء أو انتهت في كل الشيتات
                                </p>
                            </>
                        ) : (
                            <>
                                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-bold mb-2">
                                    <i className="fa-solid fa-house text-xs"></i>
                                    <span>اللوحة الرئيسية</span>
                                </div>
                                <h2 className="text-2xl md:text-3xl font-black tracking-tight">
                                    نظرة عامة على البيانات
                                </h2>
                                <p className="text-slate-300 text-xs md:text-sm">
                                    {currentDateFormatted} • إحصائيات عامة ومتابعة سريعة لجميع الجداول والشيتات
                                </p>
                            </>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={loadAllData}
                            className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/15 transition flex items-center gap-2"
                        >
                            <i className="fa-solid fa-arrows-rotate text-xs"></i>
                            <span>تحديث البيانات</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Quick KPI Stats Bar */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {/* Total Records */}
                <div className="bg-white dark:bg-slate-900 p-4 md:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-bold text-slate-400 dark:text-slate-500">إجمالي كل السجلات</p>
                        <h4 className="text-2xl md:text-3xl font-black text-slate-800 dark:text-white mt-1">
                            {totalStats.totalCount}
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-1">عبر جميع الشيتات الأربعة</p>
                    </div>
                    <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xl shadow-sm">
                        <i className="fa-solid fa-database"></i>
                    </div>
                </div>

                {/* Subscriptions */}
                <div className="bg-white dark:bg-slate-900 p-4 md:p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-bold text-slate-400 dark:text-slate-500">إجمالي الاشتراكات</p>
                        <h4 className="text-2xl md:text-3xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
                            {totalStats.totalSubscriptions}
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-1">اشتراك مسجل بالمدة</p>
                    </div>
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xl shadow-sm">
                        <i className="fa-regular fa-clock"></i>
                    </div>
                </div>

                {/* Approaching Renewal (3 days) */}
                <div
                    onClick={() => onNavigateSheet && onNavigateSheet('alerts')}
                    className="bg-white dark:bg-slate-900 p-4 md:p-5 rounded-2xl border border-amber-200 dark:border-amber-900/50 shadow-sm flex items-center justify-between relative overflow-hidden cursor-pointer hover:border-amber-400 dark:hover:border-amber-700 transition"
                    title="انقر للانتقال إلى مركز التنبيهات"
                >
                    <div className="relative z-10">
                        <div className="flex items-center gap-1.5">
                            <p className="text-xs font-bold text-amber-600 dark:text-amber-400">قرب التجديد</p>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 font-bold">آخر 3 أيام</span>
                        </div>
                        <h4 className="text-2xl md:text-3xl font-black text-amber-600 dark:text-amber-400 mt-1">
                            {totalStats.nearCount}
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-1">بحاجة لمتابعة التجديد</p>
                    </div>
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl shadow-sm">
                        <i className="fa-solid fa-triangle-exclamation"></i>
                    </div>
                </div>

                {/* Expired */}
                <div
                    onClick={() => onNavigateSheet && onNavigateSheet('alerts')}
                    className="bg-white dark:bg-slate-900 p-4 md:p-5 rounded-2xl border border-rose-200 dark:border-rose-900/50 shadow-sm flex items-center justify-between cursor-pointer hover:border-rose-400 dark:hover:border-rose-700 transition"
                    title="انقر للانتقال إلى مركز التنبيهات"
                >
                    <div>
                        <p className="text-xs font-bold text-rose-600 dark:text-rose-400">اشتراكات منتهية</p>
                        <h4 className="text-2xl md:text-3xl font-black text-rose-600 dark:text-rose-400 mt-1">
                            {totalStats.expiredCount}
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-1">انتهت مدة اشتراكها</p>
                    </div>
                    <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center text-xl shadow-sm">
                        <i className="fa-solid fa-circle-xmark"></i>
                    </div>
                </div>
            </div>

            {/* Quick Access to Sheets Cards - Only visible in Dashboard mode, hidden in Alerts */}
            {mode === 'dashboard' && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between px-1">
                        <h3 className="text-sm font-black text-slate-700 dark:text-slate-200 flex items-center gap-2">
                            <i className="fa-solid fa-folder-open text-indigo-500"></i>
                            <span>قائمة الشيتات الرئيسية (انقر للفتح الفوري)</span>
                        </h3>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {DEFAULT_SHEETS.filter(ds => canAccessSheet(ds.id)).map(ds => {
                            const meta = getSheetMeta(ds.id);
                            const count = (allRecordsBySheet[ds.id] || []).length;

                            return (
                                <button
                                    key={ds.id}
                                    onClick={() => onNavigateSheet && onNavigateSheet(ds.id)}
                                    className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 hover:border-indigo-500/50 dark:hover:border-indigo-500/50 shadow-sm hover:shadow-md transition-all duration-200 text-right group flex flex-col justify-between"
                                >
                                    <div className="flex items-center justify-between w-full mb-3">
                                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${meta.color || ds.color} text-white flex items-center justify-center text-lg shadow-md group-hover:scale-110 transition`}>
                                            <i className={`fa-solid ${meta.icon || ds.icon}`}></i>
                                        </div>
                                        <span className="text-slate-400 group-hover:text-indigo-600 transition text-xs">
                                            <i className="fa-solid fa-arrow-left"></i>
                                        </span>
                                    </div>

                                    <div>
                                        <h4 className="font-bold text-sm text-slate-800 dark:text-white group-hover:text-indigo-600 transition truncate">
                                            {meta.name || ds.label}
                                        </h4>
                                        <p className="text-xs font-mono text-slate-400 mt-1">
                                            {count} سجل مسجل
                                        </p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* In Dashboard mode: gentle notice banner if alerts exist */}
            {mode === 'dashboard' && allAlerts.length > 0 && (
                <div className="p-4 md:p-5 rounded-2xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-transparent border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center text-lg shadow-md shadow-amber-500/30 flex-shrink-0">
                            <i className="fa-solid fa-bell"></i>
                        </div>
                        <div>
                            <h4 className="font-black text-sm text-slate-800 dark:text-white">
                                يوجد {allAlerts.length} تنبيه نشط للاشتراكات
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                تم فصل التنبيهات في قسم مستقل خاص بها تحت قائمة الشيتات في القائمة الجانبية.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => onNavigateSheet && onNavigateSheet('alerts')}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl shadow-md shadow-amber-500/25 transition flex items-center justify-center gap-2 cursor-pointer flex-shrink-0"
                    >
                        <span>فتح قسم التنبيهات</span>
                        <i className="fa-solid fa-arrow-left text-[10px]"></i>
                    </button>
                </div>
            )}

            {/* Central Alerts Center (مركز التنبيهات الموحد) - Only visible when mode === 'alerts' */}
            {mode === 'alerts' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden space-y-4 p-4 md:p-6">
                {/* Alerts Hub Header */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-orange-500 text-white flex items-center justify-center text-xl shadow-lg shadow-amber-500/25">
                            <i className="fa-solid fa-bell"></i>
                        </div>
                        <div>
                            <div className="flex items-center gap-2.5">
                                <h3 className="text-lg md:text-xl font-black text-slate-800 dark:text-white">
                                    مركز تنبيهات الاشتراكات والتجديد
                                </h3>
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500 text-white">
                                    {allAlerts.length} تنبيه نشط
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                                تجميع فوري لكل الإيميلات التي قاربت على التجديد في آخر 3 أيام والمنتهية عبر الشيتات
                            </p>
                        </div>
                    </div>

                    {/* Filter Type Pills */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold">
                            <button
                                onClick={() => setFilterType('all')}
                                className={`px-3 py-1.5 rounded-lg transition ${
                                    filterType === 'all'
                                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                }`}
                            >
                                كل التنبيهات ({allAlerts.length})
                            </button>
                            <button
                                onClick={() => setFilterType('near')}
                                className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                                    filterType === 'near'
                                        ? 'bg-amber-500 text-white shadow-sm'
                                        : 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                                }`}
                            >
                                <i className="fa-solid fa-triangle-exclamation text-[10px]"></i>
                                <span>قرب التجديد ({totalStats.nearCount})</span>
                            </button>
                            <button
                                onClick={() => setFilterType('expired')}
                                className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                                    filterType === 'expired'
                                        ? 'bg-rose-600 text-white shadow-sm'
                                        : 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                                }`}
                            >
                                <i className="fa-solid fa-circle-xmark text-[10px]"></i>
                                <span>منتهي ({totalStats.expiredCount})</span>
                            </button>
                        </div>

                        {/* Sheet Selection Filter */}
                        <select
                            value={sheetFilter}
                            onChange={(e) => setSheetFilter(e.target.value)}
                            className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="all">جميع الشيتات المتاحة</option>
                            {DEFAULT_SHEETS.filter(ds => ds.id !== 'trash_data' && ds.id !== 'account_data' && canAccessSheet(ds.id)).map(ds => {
                                const meta = getSheetMeta(ds.id);
                                return (
                                    <option key={ds.id} value={ds.id}>
                                        {meta.name || ds.label}
                                    </option>
                                );
                            })}
                        </select>
                    </div>
                </div>

                {/* Search Bar inside Alerts */}
                <div className="relative">
                    <i className="fa-solid fa-magnifying-glass absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="ابحث في الإيميلات، مدة الاشتراك، الشيت، أو الملاحظات..."
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-10 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                    />
                </div>

                {/* Alerts List */}
                {filteredAlerts.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 dark:text-slate-500 flex flex-col items-center justify-center gap-2">
                        <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-2xl mb-2">
                            <i className="fa-solid fa-circle-check"></i>
                        </div>
                        <h4 className="font-bold text-base text-slate-700 dark:text-slate-200">
                            لا توجد تنبيهات اشتراكات حالياً!
                        </h4>
                        <p className="text-xs max-w-sm text-slate-400">
                            جميع الاشتراكات سارية، أو لا توجد حسابات تنتهي خلال الـ 3 أيام القادمة في هذا التحديد.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-2">
                        {filteredAlerts.map(item => {
                            const isPassVisible = visibleSecrets[`${item.id}_pass`];
                            const isPass2Visible = visibleSecrets[`${item.id}_pass2`];

                            return (
                                <div
                                    key={`${item.sheetId}_${item.id}`}
                                    className={`p-4 rounded-2xl border transition-all duration-200 flex flex-col justify-between gap-3 shadow-sm hover:shadow-md ${
                                        item.alertType === 'near'
                                            ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-800/60 hover:border-amber-400'
                                            : 'bg-rose-50/40 dark:bg-rose-950/20 border-rose-200/80 dark:border-rose-800/60 hover:border-rose-400'
                                    }`}
                                >
                                    {/* Top Row: Sheet Badge + Status Badge */}
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 shadow-xs">
                                                <i className={`fa-solid ${item.sheetIcon} text-indigo-500`}></i>
                                                <span>{item.sheetName}</span>
                                            </span>
                                        </div>

                                        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                                            item.remInfo.status === 'expiring-today'
                                                ? 'bg-red-500 text-white border-red-600 animate-pulse shadow-sm'
                                                : item.alertType === 'near'
                                                ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                                                : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-300 dark:border-rose-800'
                                        }`}>
                                            <i className={`fa-solid ${item.alertType === 'near' ? 'fa-clock' : 'fa-triangle-exclamation'} ml-1 text-[10px]`}></i>
                                            {item.remInfo.text}
                                        </span>
                                    </div>

                                    {/* Middle: Email & Duration Details */}
                                    <div className="space-y-2 bg-white dark:bg-slate-850 p-3 rounded-xl border border-slate-200/70 dark:border-slate-700/60">
                                        {/* Email */}
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-[11px] text-slate-400 font-bold">البريد:</span>
                                            <div className="flex items-center gap-1.5 dir-ltr min-w-0">
                                                <span className="font-mono text-xs font-black text-slate-800 dark:text-slate-100 truncate select-all">
                                                    {item.email || 'بدون إيميل'}
                                                </span>
                                                <button
                                                    onClick={() => handleCopy(item.email, `dash_em_${item.id}`)}
                                                    className="text-slate-400 hover:text-indigo-600 p-1 transition"
                                                    title="نسخ الإيميل"
                                                >
                                                    <i className={`fa-solid ${copiedField === `dash_em_${item.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-xs`}></i>
                                                </button>
                                            </div>
                                        </div>

                                        {/* Passwords (if available) */}
                                        {(item.password || item.password2) && (
                                            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                                                {item.password && (
                                                    <div className="flex items-center justify-between dir-ltr">
                                                        <span className="font-mono text-slate-700 dark:text-slate-300 truncate">
                                                            {isPassVisible ? item.password : '••••••'}
                                                        </span>
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={() => toggleSecret(item.id, 'pass')}
                                                                className="text-slate-400 hover:text-slate-600 p-0.5"
                                                                title={isPassVisible ? 'إخفاء' : 'إظهار'}
                                                            >
                                                                <i className={`fa-solid ${isPassVisible ? 'fa-eye-slash' : 'fa-eye'} text-[10px]`}></i>
                                                            </button>
                                                            <button
                                                                onClick={() => handleCopy(item.password, `dash_p1_${item.id}`)}
                                                                className="text-slate-400 hover:text-indigo-600 p-0.5"
                                                                title="نسخ الباسورد"
                                                            >
                                                                <i className={`fa-solid ${copiedField === `dash_p1_${item.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[10px]`}></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                                {item.password2 && (
                                                    <div className="flex items-center justify-between dir-ltr">
                                                        <span className="font-mono text-slate-700 dark:text-slate-300 truncate">
                                                            {isPass2Visible ? item.password2 : '••••••'}
                                                        </span>
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={() => toggleSecret(item.id, 'pass2')}
                                                                className="text-slate-400 hover:text-slate-600 p-0.5"
                                                                title={isPass2Visible ? 'إخفاء' : 'إظهار'}
                                                            >
                                                                <i className={`fa-solid ${isPass2Visible ? 'fa-eye-slash' : 'fa-eye'} text-[10px]`}></i>
                                                            </button>
                                                            <button
                                                                onClick={() => handleCopy(item.password2, `dash_p2_${item.id}`)}
                                                                className="text-slate-400 hover:text-indigo-600 p-0.5"
                                                                title="نسخ الباسورد 2"
                                                            >
                                                                <i className={`fa-solid ${copiedField === `dash_p2_${item.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[10px]`}></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Duration & Dates & Device Type */}
                                        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                                            <div className="flex items-center gap-1.5">
                                                <span>{item.sheetId === 'account_data' ? 'فترة التذكير: ' : 'المدة الأصلية: '}<b className="text-slate-800 dark:text-slate-200">{item.duration || (item.reminderDays ? `${item.reminderDays} يوم` : '-')}</b></span>
                                                {item.deviceType && (
                                                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                                        item.deviceType === 'جهازين'
                                                            ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200/70 dark:border-purple-800/60'
                                                            : 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200/70 dark:border-blue-800/60'
                                                    }`}>
                                                        <i className={`fa-solid ${item.deviceType === 'جهازين' ? 'fa-laptop' : 'fa-mobile-screen'} ml-1 text-[9px]`}></i>
                                                        {item.deviceType}
                                                    </span>
                                                )}
                                                {item.paymentStatus && (
                                                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                                                        item.paymentStatus === 'غير مدفوع'
                                                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200/70 dark:border-rose-800/60'
                                                            : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-800/60'
                                                    }`}>
                                                        <i className={`fa-solid ${item.paymentStatus === 'غير مدفوع' ? 'fa-circle-xmark' : 'fa-circle-check'} ml-1 text-[9px]`}></i>
                                                        {item.paymentStatus}
                                                    </span>
                                                )}
                                            </div>
                                            {(item.remInfo.targetDate || item.remInfo.endDate) && (
                                                <span>{item.sheetId === 'account_data' ? 'موعد التذكير: ' : 'تاريخ الانتهاء: '}<b className="font-mono text-slate-800 dark:text-slate-200">{item.remInfo.targetDate || item.remInfo.endDate}</b></span>
                                            )}
                                        </div>

                                        {/* Linked Account info if available (hidden for client and merchant data) */}
                                        {item.selectedAccount && item.sheetId !== 'client_data' && item.sheetId !== 'merchant_data' && (
                                            <div className="flex items-center justify-between text-[11px] bg-purple-50/70 dark:bg-purple-950/40 border border-purple-200/70 dark:border-purple-800/60 rounded-lg px-2.5 py-1 text-purple-800 dark:text-purple-300">
                                                <div className="flex items-center gap-1.5 font-bold truncate">
                                                    <i className="fa-solid fa-shield-halved text-purple-600 dark:text-purple-400 text-[10px]"></i>
                                                    <span>بيانات الحساب:</span>
                                                    <span className="font-mono text-xs truncate">{item.selectedAccount}</span>
                                                </div>
                                                <button
                                                    onClick={() => handleCopy(item.selectedAccount, `dash_acc_${item.id}`)}
                                                    className="text-purple-400 hover:text-purple-700 dark:hover:text-purple-200 p-0.5"
                                                    title="نسخ بيانات الحساب"
                                                >
                                                    <i className={`fa-solid ${copiedField === `dash_acc_${item.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[10px]`}></i>
                                                </button>
                                            </div>
                                        )}

                                        {item.notes && (
                                            <p className="text-[11px] text-slate-400 italic truncate pt-1">
                                                ملاحظات: {item.notes}
                                            </p>
                                        )}
                                    </div>

                                    {/* Action Row */}
                                    <div className="flex items-center justify-between gap-2 pt-1">
                                        <span className="text-[10px] text-slate-400">
                                            معرّف السجل: <span className="font-mono">{String(item.id).slice(-8)}</span>
                                        </span>

                                        <button
                                            onClick={() => onNavigateSheet && onNavigateSheet(item.sheetId)}
                                            className={`px-3 py-1.5 rounded-xl text-xs font-bold text-white shadow-sm transition flex items-center gap-1.5 ${
                                                item.alertType === 'near'
                                                    ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/30'
                                                    : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/30'
                                            }`}
                                        >
                                            <i className="fa-solid fa-rotate-right text-xs"></i>
                                            <span>فتح وتجديد في {item.sheetName}</span>
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            )}
        </div>
    );
}
