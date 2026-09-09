import { useState, useMemo, useEffect, useCallback } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { calculateRemainingTime, calculateAccountReminder } from '../utils/dataRepair';
import { sheetsAPI, usersAPI } from '../services/api';
import { SHEETS_CHANGED } from '../services/sheetSync';

const DEFAULT_SHEETS = [
    { id: 'client_data', label: 'بيانات العميل', icon: 'fa-user-tie', color: 'text-blue-400', activeBg: 'bg-blue-600' },
    { id: 'merchant_data', label: 'بيانات التاجر', icon: 'fa-store', color: 'text-emerald-400', activeBg: 'bg-emerald-600' },
    { id: 'account_data', label: 'بيانات الحساب', icon: 'fa-shield-halved', color: 'text-purple-400', activeBg: 'bg-purple-600' },
    { id: 'reminders_data', label: 'تذكيرات عامة', icon: 'fa-bell', color: 'text-amber-400', activeBg: 'bg-amber-600' },
    { id: 'trash_data', label: 'سلة المهملات', icon: 'fa-trash-can', color: 'text-rose-400', activeBg: 'bg-rose-600' },
];

export default function Sidebar ({ isOpen, onClose }) {
    const { activeTab, setActiveTab } = useData();
    const { user, logout, hasPermission } = useAuth();
    const [sheetCounts, setSheetCounts] = useState({});
    const [totalAlertsCount, setTotalAlertsCount] = useState(0);
    const [sheetItems, setSheetItems] = useState(DEFAULT_SHEETS);

    const [isDark, setIsDark] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('sv_dark_mode') === 'true' || document.documentElement.classList.contains('dark');
        }
        return false;
    });

    // Password change modal state
    const [showChangePwd, setShowChangePwd] = useState(false);
    const [pwdForm, setPwdForm] = useState({ current: '', newPwd: '', confirm: '' });
    const [pwdError, setPwdError] = useState('');
    const [pwdSuccess, setPwdSuccess] = useState('');
    const [pwdSaving, setPwdSaving] = useState(false);

    const handleChangePassword = async (e) => {
        e.preventDefault();
        setPwdError('');
        setPwdSuccess('');
        if (!pwdForm.current.trim()) return setPwdError('يرجى إدخال كلمة المرور الحالية');
        if (pwdForm.newPwd.length < 6) return setPwdError('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
        if (pwdForm.newPwd !== pwdForm.confirm) return setPwdError('كلمة المرور الجديدة وتأكيدها غير متطابقتين');
        setPwdSaving(true);
        try {
            await usersAPI.changePassword(user.id, pwdForm.current, pwdForm.newPwd);
            setPwdSuccess('تم تغيير كلمة المرور بنجاح ✓');
            setPwdForm({ current: '', newPwd: '', confirm: '' });
            setTimeout(() => { setShowChangePwd(false); setPwdSuccess(''); }, 2000);
        } catch (err) {
            setPwdError(err.message || 'حدث خطأ أثناء تغيير كلمة المرور');
        } finally {
            setPwdSaving(false);
        }
    };

    // Apply dark mode on mount
    useEffect(() => {
        const saved = localStorage.getItem('sv_dark_mode');
        if (saved === 'true') {
            document.documentElement.classList.add('dark');
            setIsDark(true);
        }
    }, []);

    const toggleDarkMode = () => {
        const newVal = !isDark;
        setIsDark(newVal);
        document.documentElement.classList.toggle('dark', newVal);
        localStorage.setItem('sv_dark_mode', String(newVal));
    };

    // Filter sheets according to user permissions
    const visibleSheets = useMemo(() => {
        if (!user) return [];
        if (user.role === 'admin') return sheetItems;
        return sheetItems.filter(item => {
            return hasPermission('sheet_' + item.id) || hasPermission(item.id);
        });
    }, [sheetItems, user, hasPermission]);

    // Load sheet labels, counts, and alerts
    const loadSheetInfo = useCallback(async () => {
        try {
            const [config, recordsMap] = await Promise.all([
                sheetsAPI.getSheetsConfig(),
                sheetsAPI.getAllSheetsData()
            ]);

            if (Array.isArray(config) && config.length > 0) {
                const nextItems = DEFAULT_SHEETS.map(ds => {
                    const found = config.find(p => p.id === ds.id);
                    return found ? { ...ds, label: found.name || found.label || ds.label } : ds;
                });
                setSheetItems(prev => (
                    JSON.stringify(prev) === JSON.stringify(nextItems) ? prev : nextItems
                ));
            }

            const counts = {};
            DEFAULT_SHEETS.forEach(s => {
                const data = recordsMap?.[s.id];
                counts[s.id] = Array.isArray(data) ? data.length : 0;
            });
            setSheetCounts(prev => (
                JSON.stringify(prev) === JSON.stringify(counts) ? prev : counts
            ));

            let alertsTotal = 0;
            const permittedSheets = user?.role === 'admin'
                ? DEFAULT_SHEETS
                : DEFAULT_SHEETS.filter(item => hasPermission('sheet_' + item.id) || hasPermission(item.id));

            permittedSheets.forEach(s => {
                if (s.id === 'trash_data') return;
                const parsed = recordsMap?.[s.id];
                if (!Array.isArray(parsed)) return;

                if (s.id === 'account_data' || s.id === 'reminders_data') {
                    parsed.forEach(r => {
                        if (r.offerActivated) return;
                        const rem = calculateAccountReminder(r.accountCreatedDate, r.reminderDays, r.created_at);
                        if (rem && rem.days !== null && rem.days <= 3) alertsTotal++;
                    });
                    return;
                }

                parsed.forEach(r => {
                    const rem = calculateRemainingTime(r.startDate, r.duration, r.created_at);
                    if (!rem || rem.status === 'none' || rem.status === 'lifetime') return;
                    if (rem.days !== null && rem.days <= 3) alertsTotal++;
                });
            });
            setTotalAlertsCount(prev => prev === alertsTotal ? prev : alertsTotal);
        } catch (error) {
            console.error('Failed loading sidebar sheet info:', error);
        }
    }, [user?.role, hasPermission]);

    useEffect(() => {
        loadSheetInfo();
        window.addEventListener(SHEETS_CHANGED, loadSheetInfo);
        const interval = setInterval(loadSheetInfo, 30000);
        return () => {
            clearInterval(interval);
            window.removeEventListener(SHEETS_CHANGED, loadSheetInfo);
        };
    }, [activeTab, loadSheetInfo]);

    return (
        <>
            {isOpen && (
                <div onClick={onClose} className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"></div>
            )}

            <aside className={`fixed top-0 bottom-0 right-0 w-64 bg-slate-900 text-white z-50 flex flex-col shadow-2xl overflow-hidden font-sans transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}>

                {/* Sidebar Header */}
                <div className="p-5 border-b border-slate-800 relative">
                    <button onClick={onClose} className="absolute top-4 left-4 text-slate-400 hover:text-white lg:hidden cursor-pointer">
                        <i className="fa-solid fa-xmark text-xl"></i>
                    </button>

                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-500 rounded-xl flex items-center justify-center flex-shrink-0 vip-logo-badge border border-white/25 shadow-lg">
                            <span className="text-white font-black text-2xl tracking-tight select-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] font-sans -mt-0.5">H</span>
                            <div className="logo-shine-sweep"></div>
                        </div>
                        <div className="overflow-hidden">
                            <h1 className="text-lg font-black tracking-tight truncate vip-animated-text">Service Hub</h1>
                            <p className="text-[10px] text-indigo-300 font-bold tracking-wider uppercase block truncate">Subscription Management</p>
                        </div>
                    </div>
                </div>

                {/* Single Unified Navigation List */}
                <nav className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-1.5">
                    {/* Dashboard Button (الرئيسية) */}
                    {(user?.role === 'admin' || hasPermission('dashboard')) && (
                        <button
                            onClick={() => { setActiveTab('dashboard'); onClose(); }}
                            className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl transition-all duration-200 group relative cursor-pointer ${
                                activeTab === 'dashboard'
                                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg font-black scale-[1.02]'
                                    : 'text-slate-300 hover:bg-slate-800 hover:text-white font-bold'
                            }`}
                        >
                            <div className="flex items-center gap-3.5 min-w-0">
                                <i className={`fa-solid fa-house w-5 text-center text-base transition-transform group-hover:scale-110 ${
                                    activeTab === 'dashboard' ? 'text-white' : 'text-blue-400'
                                }`}></i>
                                <span className="text-sm truncate">الرئيسية</span>
                            </div>
                        </button>
                    )}

                    {/* Reports Button */}
                    <button
                        onClick={() => { setActiveTab('reports'); onClose(); }}
                        className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl transition-all duration-200 group relative cursor-pointer ${
                            activeTab === 'reports'
                                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg font-black scale-[1.02]'
                                : 'text-slate-300 hover:bg-slate-800 hover:text-white font-bold'
                        }`}
                    >
                        <div className="flex items-center gap-3.5 min-w-0">
                            <i className={`fa-solid fa-chart-pie w-5 text-center text-base transition-transform group-hover:scale-110 ${
                                activeTab === 'reports' ? 'text-white' : 'text-indigo-400'
                            }`}></i>
                            <span className="text-sm truncate">التقارير</span>
                        </div>
                    </button>

                    {/* Users Management Button - Admin Only */}
                    {user?.role === 'admin' && (
                        <button
                            onClick={() => { setActiveTab('users'); onClose(); }}
                            className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl transition-all duration-200 group relative cursor-pointer ${
                                activeTab === 'users'
                                    ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg font-black scale-[1.02]'
                                    : 'text-slate-300 hover:bg-slate-800 hover:text-white font-bold'
                            }`}
                        >
                            <div className="flex items-center gap-3.5 min-w-0">
                                <i className={`fa-solid fa-users-gear w-5 text-center text-base transition-transform group-hover:scale-110 ${
                                    activeTab === 'users' ? 'text-white' : 'text-purple-400'
                                }`}></i>
                                <span className="text-sm truncate">المستخدمين</span>
                            </div>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${
                                activeTab === 'users' ? 'bg-white/20 text-white' : 'bg-purple-950 text-purple-300 border border-purple-800'
                            }`}>
                                أدمن
                            </span>
                        </button>
                    )}
                    {visibleSheets.map(item => {
                        const isCurrentActive = activeTab === item.id;
                        const count = sheetCounts[item.id] || 0;

                        return (
                            <button
                                key={item.id}
                                onClick={() => { setActiveTab(item.id); onClose(); }}
                                className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl transition-all duration-200 group relative cursor-pointer ${
                                    isCurrentActive
                                        ? `${item.activeBg || 'bg-indigo-600'} text-white shadow-lg font-bold scale-[1.02]`
                                        : 'text-slate-300 hover:bg-slate-800 hover:text-white font-medium'
                                }`}
                            >
                                <div className="flex items-center gap-3.5 min-w-0">
                                    <i className={`fa-solid ${item.icon} w-5 text-center text-base transition-transform group-hover:scale-110 ${
                                        isCurrentActive ? 'text-white' : item.color
                                    }`}></i>
                                    <span className="text-sm truncate">{item.label}</span>
                                </div>

                                <span className={`text-xs px-2.5 py-0.5 rounded-full font-black flex-shrink-0 ${
                                    isCurrentActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400 group-hover:bg-slate-700 group-hover:text-slate-200'
                                }`}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}

                    {/* Alerts item (التنبيهات لوحدها مع قائمة الشيت) */}
                    {(user?.role === 'admin' || hasPermission('dashboard') || hasPermission('alerts')) && (
                        <button
                            onClick={() => { setActiveTab('alerts'); onClose(); }}
                            className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl transition-all duration-200 group relative cursor-pointer ${
                                activeTab === 'alerts'
                                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg font-black scale-[1.02]'
                                    : 'text-slate-300 hover:bg-slate-800 hover:text-white font-medium'
                            }`}
                        >
                            <div className="flex items-center gap-3.5 min-w-0">
                                <i className={`fa-solid fa-bell w-5 text-center text-base transition-transform group-hover:scale-110 ${
                                    activeTab === 'alerts' ? 'text-white' : 'text-amber-400'
                                }`}></i>
                                <span className="text-sm truncate">التنبيهات</span>
                            </div>

                            {totalAlertsCount > 0 ? (
                                <span className={`text-xs px-2.5 py-0.5 rounded-full font-black flex items-center gap-1 ${
                                    activeTab === 'alerts' ? 'bg-white text-orange-600 shadow-sm' : 'bg-amber-500 text-white animate-pulse'
                                }`}>
                                    <i className="fa-solid fa-bell text-[9px]"></i>
                                    <span>{totalAlertsCount}</span>
                                </span>
                            ) : (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-black">
                                    0
                                </span>
                            )}
                        </button>
                    )}
                </nav>



                {/* User Profile & Dark Mode & Logout */}
                <div className="p-4 border-t border-slate-800 bg-slate-900">
                    <div className="flex items-center gap-3 mb-3 px-1">
                        {/* Avatar with first letter of username */}
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white font-black text-sm shadow-lg flex-shrink-0 uppercase">
                            {user?.username ? user.username.slice(0, 1).toUpperCase() : <i className="fa-solid fa-user text-xs" />}
                        </div>
                        <div className="overflow-hidden flex-1 min-w-0">
                            <h4 className="text-sm font-bold text-white truncate leading-tight" title={user?.username}>
                                {user?.username || 'مستخدم'}
                            </h4>
                            <div className="flex items-center gap-1.5 mt-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block flex-shrink-0" />
                                <span className={`text-[10px] font-bold tracking-wide truncate ${user?.role === 'admin' ? 'text-amber-400' : 'text-emerald-400'}`}>
                                    {user?.role === 'admin' ? 'مدير النظام' : 'مشرف'}
                                </span>
                            </div>
                        </div>
                        {/* Dark Mode Toggle */}
                        <button
                            onClick={toggleDarkMode}
                            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-yellow-400 transition-all border border-slate-700 flex-shrink-0"
                            title={isDark ? 'الوضع الفاتح' : 'الوضع المظلم'}
                            aria-label={isDark ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع المظلم'}
                        >
                            <i className={`fa-solid ${isDark ? 'fa-sun' : 'fa-moon'} text-sm`} aria-hidden="true" />
                        </button>
                    </div>

                    {user && (
                        <div className="space-y-2">
                            <button
                                onClick={() => setShowChangePwd(true)}
                                className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-indigo-500/10 hover:text-indigo-400 text-slate-400 py-2 rounded-xl transition-all border border-slate-700 hover:border-indigo-500/50 font-bold text-xs"
                            >
                                <i className="fa-solid fa-key"></i> تغيير كلمة المرور
                            </button>
                            <button
                                onClick={logout}
                                className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-red-500/10 hover:text-red-400 text-slate-400 py-2.5 rounded-xl transition-all border border-slate-700 hover:border-red-500/50 font-bold text-xs"
                            >
                                <i className="fa-solid fa-right-from-bracket"></i> تسجيل خروج
                            </button>
                        </div>
                    )}
                </div>
            </aside>

            {showChangePwd && (
                <ChangePasswordModal onClose={() => { setShowChangePwd(false); }} />
            )}
        </>
    );
}

// Password Change Modal - standalone component that gets rendered in App
export function ChangePasswordModal({ onClose }) {
    const { user } = useAuth();
    const [pwdForm, setPwdForm] = useState({ current: '', newPwd: '', confirm: '' });
    const [pwdError, setPwdError] = useState('');
    const [pwdSuccess, setPwdSuccess] = useState('');
    const [pwdSaving, setPwdSaving] = useState(false);
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setPwdError('');
        setPwdSuccess('');
        if (!pwdForm.current.trim()) return setPwdError('يرجى إدخال كلمة المرور الحالية');
        if (pwdForm.newPwd.length < 6) return setPwdError('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
        if (pwdForm.newPwd !== pwdForm.confirm) return setPwdError('كلمة المرور الجديدة وتأكيدها غير متطابقتين');
        setPwdSaving(true);
        try {
            await usersAPI.changePassword(user.id, pwdForm.current, pwdForm.newPwd);
            setPwdSuccess('تم تغيير كلمة المرور بنجاح ✓');
            setPwdForm({ current: '', newPwd: '', confirm: '' });
            setTimeout(onClose, 2000);
        } catch (err) {
            setPwdError(err.message || 'حدث خطأ أثناء تغيير كلمة المرور');
        } finally {
            setPwdSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200/80 dark:border-slate-700 overflow-hidden">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-md">
                            <i className="fa-solid fa-key text-sm"></i>
                        </div>
                        <div>
                            <h3 className="font-black text-slate-800 dark:text-white text-sm">تغيير كلمة المرور</h3>
                            <p className="text-xs text-slate-400">{user?.username}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    {pwdError && (
                        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl px-4 py-3 text-xs font-bold flex items-center gap-2">
                            <i className="fa-solid fa-circle-exclamation"></i> {pwdError}
                        </div>
                    )}
                    {pwdSuccess && (
                        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-xl px-4 py-3 text-xs font-bold flex items-center gap-2">
                            <i className="fa-solid fa-circle-check"></i> {pwdSuccess}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">كلمة المرور الحالية</label>
                        <div className="relative">
                            <input
                                type={showCurrent ? 'text' : 'password'}
                                value={pwdForm.current}
                                onChange={e => setPwdForm(p => ({ ...p, current: e.target.value }))}
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 pr-10"
                                placeholder="••••••••"
                                required
                            />
                            <button type="button" onClick={() => setShowCurrent(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                <i className={`fa-solid ${showCurrent ? 'fa-eye-slash' : 'fa-eye'} text-xs`}></i>
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">كلمة المرور الجديدة</label>
                        <div className="relative">
                            <input
                                type={showNew ? 'text' : 'password'}
                                value={pwdForm.newPwd}
                                onChange={e => setPwdForm(p => ({ ...p, newPwd: e.target.value }))}
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 pr-10"
                                placeholder="6 أحرف على الأقل"
                                required
                            />
                            <button type="button" onClick={() => setShowNew(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                <i className={`fa-solid ${showNew ? 'fa-eye-slash' : 'fa-eye'} text-xs`}></i>
                            </button>
                        </div>
                        {pwdForm.newPwd && (
                            <div className="mt-2 flex gap-1">
                                {[1,2,3,4].map(i => (
                                    <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${
                                        pwdForm.newPwd.length >= i * 3
                                            ? i <= 1 ? 'bg-red-400' : i <= 2 ? 'bg-amber-400' : i <= 3 ? 'bg-blue-400' : 'bg-emerald-500'
                                            : 'bg-slate-200 dark:bg-slate-700'
                                    }`} />
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1.5">تأكيد كلمة المرور الجديدة</label>
                        <input
                            type="password"
                            value={pwdForm.confirm}
                            onChange={e => setPwdForm(p => ({ ...p, confirm: e.target.value }))}
                            className={`w-full bg-slate-50 dark:bg-slate-800 border rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/50 ${
                                pwdForm.confirm && pwdForm.newPwd !== pwdForm.confirm
                                    ? 'border-red-300 dark:border-red-700 text-red-700'
                                    : 'border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                            }`}
                            placeholder="••••••••"
                            required
                        />
                        {pwdForm.confirm && pwdForm.newPwd !== pwdForm.confirm && (
                            <p className="text-red-500 text-[10px] mt-1 font-bold">كلمتا المرور غير متطابقتين</p>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={pwdSaving}
                        className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/30 transition disabled:opacity-60"
                    >
                        {pwdSaving ? <><i className="fa-solid fa-spinner fa-spin"></i> جارٍ الحفظ...</> : <><i className="fa-solid fa-lock"></i> تغيير كلمة المرور</>}
                    </button>
                </form>
            </div>
        </div>
    );
}
