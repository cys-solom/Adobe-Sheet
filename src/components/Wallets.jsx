import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { walletsAPI } from '../services/api';
import { useConfirm } from './ConfirmDialog';

const USD_RATE_KEY = 'service_hub_usd_rate';
const USD_RATE_TIMESTAMP_KEY = 'service_hub_usd_rate_timestamp';
const RATE_CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 hours

const getUsdRate = () => Number(localStorage.getItem(USD_RATE_KEY) || '50');
const saveUsdRate = (r) => { localStorage.setItem(USD_RATE_KEY, String(r)); localStorage.setItem(USD_RATE_TIMESTAMP_KEY, String(Date.now())); };

const CURRENCIES = [
    { code: 'EGP', label: 'جنيه مصري', symbol: 'ج.م', flag: '🇪🇬' },
    { code: 'USD', label: 'دولار أمريكي', symbol: '$', flag: '🇺🇸' },
    { code: 'SAR', label: 'ريال سعودي', symbol: 'ر.س', flag: '🇸🇦' },
    { code: 'AED', label: 'درهم إماراتي', symbol: 'د.إ', flag: '🇦🇪' },
    { code: 'EUR', label: 'يورو', symbol: '€', flag: '🇪🇺' },
];

export default function Wallets() {
    useEffect(() => { window.scrollTo(0, 0); }, []);
    const { user } = useAuth();
    const { wallets: ctxWallets, transactions: ctxTransactions, refreshData } = useData();

    const [wallets, setWallets] = useState([]);
    const [transactions, setTransactions] = useState([]);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingWallet, setEditingWallet] = useState(null);
    const [showTxnModal, setShowTxnModal] = useState(null);
    const [txnType, setTxnType] = useState('deposit');
    const [selectedWallet, setSelectedWallet] = useState(null);
    const [adjustBalanceWallet, setAdjustBalanceWallet] = useState(null); // direct balance edit
    const [usdRate, setUsdRate] = useState(getUsdRate());
    const [rateLoading, setRateLoading] = useState(false);
    const [rateLastUpdate, setRateLastUpdate] = useState(null);
    const { showConfirm, showAlert } = useConfirm();

    // Sync from context
    useEffect(() => {
        setWallets(ctxWallets);
        setTransactions(ctxTransactions);
        if (selectedWallet) {
            const updated = ctxWallets.find(w => w.id === selectedWallet.id);
            if (updated) setSelectedWallet(updated);
        }
    }, [ctxWallets, ctxTransactions]);

    // Auto-fetch USD rate (stays in localStorage - it's just a cache)
    const fetchUsdRate = async (force = false) => {
        const lastTimestamp = Number(localStorage.getItem(USD_RATE_TIMESTAMP_KEY) || '0');
        const now = Date.now();
        if (!force && lastTimestamp && (now - lastTimestamp) < RATE_CACHE_DURATION) {
            setRateLastUpdate(new Date(lastTimestamp));
            return;
        }
        setRateLoading(true);
        try {
            let rate = null;
            try {
                const res = await fetch('https://open.er-api.com/v6/latest/USD');
                const data = await res.json();
                if (data && data.rates && data.rates.EGP) rate = data.rates.EGP;
            } catch (e) { /* Primary API unavailable, trying fallback */ }
            if (!rate) {
                try {
                    const res2 = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
                    const data2 = await res2.json();
                    if (data2 && data2.rates && data2.rates.EGP) rate = data2.rates.EGP;
                } catch (e2) { /* Fallback API also unavailable */ }
            }
            if (rate) {
                const roundedRate = Math.round(rate * 100) / 100;
                saveUsdRate(roundedRate);
                setUsdRate(roundedRate);
                setRateLastUpdate(new Date());
            }
        } catch (error) { console.error('Failed to fetch USD rate:', error); }
        finally { setRateLoading(false); }
    };

    useEffect(() => { fetchUsdRate(); }, []);

    const getCurrencyInfo = (code) => CURRENCIES.find(c => c.code === code) || CURRENCIES[0];

    const { totalEGP, totalUSD } = useMemo(() => {
        let egp = 0;
        wallets.forEach(w => {
            const bal = Number(w.balance) || 0;
            const curr = w.currency || 'EGP';
            if (curr === 'EGP') egp += bal;
            else if (curr === 'USD') egp += bal * usdRate;
            else if (curr === 'EUR') egp += bal * (usdRate * 1.1);
            else if (curr === 'SAR') egp += bal * (usdRate / 3.75);
            else if (curr === 'AED') egp += bal * (usdRate / 3.67);
            else egp += bal;
        });
        return { totalEGP: egp, totalUSD: usdRate > 0 ? egp / usdRate : 0 };
    }, [wallets, usdRate]);

    const walletStats = useMemo(() => {
        const stats = {};
        wallets.forEach(w => {
            const wTxns = transactions.filter(t => (t.walletId || t.wallet_id) === w.id);
            const totalDeposits = wTxns.filter(t => t.type === 'deposit').reduce((s, t) => s + Number(t.amount), 0);
            const totalWithdrawals = wTxns.filter(t => t.type === 'withdraw').reduce((s, t) => s + Number(t.amount), 0);
            stats[w.id] = { totalDeposits, totalWithdrawals };
        });
        return stats;
    }, [wallets, transactions]);

    // إضافة محفظة
    const handleAddWallet = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
            await walletsAPI.create({
                name: fd.get('name'),
                currency: fd.get('currency') || 'EGP',
                initialBalance: Number(fd.get('initialBalance') || 0),
                createdBy: user?.username || 'Admin',
            });
            setShowAddModal(false);
            await refreshData();
        } catch (error) { console.error(error); showAlert({ title: 'خطأ!', message: 'حدث خطأ', type: 'danger' }); }
    };

    // تعديل محفظة
    const handleEditWallet = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
            await walletsAPI.update(editingWallet.id, { name: fd.get('name'), currency: fd.get('currency') || editingWallet.currency });
            setEditingWallet(null);
            await refreshData();
        } catch (error) { console.error(error); }
    };

    // حذف محفظة
    const handleDeleteWallet = async (id) => {
        const confirmed = await showConfirm({
            title: 'حذف المحفظة',
            message: 'هل أنت متأكد من حذف هذه المحفظة وجميع حركاتها؟',
            confirmText: 'حذف',
            cancelText: 'إلغاء',
            type: 'danger'
        });
        if (!confirmed) return;
        try {
            await walletsAPI.delete(id);
            setSelectedWallet(null);
            await refreshData();
        } catch (error) { console.error(error); }
    };

    // إيداع / سحب
    const handleAddTransaction = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const amount = Number(fd.get('amount'));
        const description = fd.get('description') || '';
        const walletId = showTxnModal;

        if (amount <= 0) { showAlert({ title: 'خطأ', message: 'المبلغ يجب أن يكون أكبر من صفر', type: 'warning' }); return; }

        const wallet = wallets.find(w => w.id === walletId);
        if (!wallet) return;

        if (txnType === 'withdraw' && amount > wallet.balance) {
            showAlert({ title: 'رصيد غير كافي', message: 'الرصيد غير كافي!', type: 'danger' }); return;
        }

        try {
            if (txnType === 'deposit') {
                await walletsAPI.deposit(walletId, amount, description, 'يدوي', user?.username || 'Admin');
            } else {
                await walletsAPI.withdraw(walletId, amount, description, 'يدوي', user?.username || 'Admin');
            }
            setShowTxnModal(null);
            await refreshData();
        } catch (error) { console.error(error); showAlert({ title: 'خطأ!', message: 'حدث خطأ', type: 'danger' }); }
    };

    // حذف حركة
    const deleteTransaction = async (txn) => {
        const confirmed = await showConfirm({
            title: 'حذف الحركة',
            message: 'هل أنت متأكد من حذف هذه الحركة؟ سيتم تعديل رصيد المحفظة.',
            confirmText: 'حذف',
            cancelText: 'إلغاء',
            type: 'danger'
        });
        if (!confirmed) return;
        try {
            await walletsAPI.deleteTransaction(txn);
            await refreshData();
        } catch (error) { console.error(error); }
    };

    // تعديل الرصيد مباشرة بدون عملية
    const handleAdjustBalance = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const newBalance = Number(fd.get('newBalance'));
        try {
            await walletsAPI.update(adjustBalanceWallet.id, { balance: newBalance });
            setAdjustBalanceWallet(null);
            await refreshData();
        } catch (error) { console.error(error); showAlert({ title: 'خطأ!', message: 'حدث خطأ', type: 'danger' }); }
    };

    const walletTxns = useMemo(() => {
        if (!selectedWallet) return [];
        return transactions.filter(t => (t.walletId || t.wallet_id) === selectedWallet.id).sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [selectedWallet, transactions]);

    return (
        <div className="space-y-8 animate-fade-in pb-20 font-sans text-slate-800">

            {/* Header */}
            <div className="bg-gradient-to-r from-emerald-700 to-teal-600 rounded-2xl p-8 text-white relative overflow-hidden shadow-xl">
                <div className="absolute -left-10 -bottom-10 text-[150px] opacity-10"><i className="fa-solid fa-vault"></i></div>
                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="bg-white/20 p-3 rounded-xl backdrop-blur-sm"><i className="fa-solid fa-vault text-2xl"></i></div>
                        <div>
                            <h2 className="text-2xl font-extrabold">الخزينة والمحافظ</h2>
                            <p className="text-emerald-100 text-sm font-medium">إجمالي السيولة النقدية المتاحة في جميع المحافظ</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-4 mt-6">
                        <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-8 py-4 border border-white/20">
                            <p className="text-emerald-100 text-xs font-bold mb-1">🇪🇬 إجمالي بالمصري</p>
                            <p className="text-3xl font-black tracking-tight dir-ltr">
                                <span className="text-sm font-bold ml-1 opacity-80">EGP</span>
                                {totalEGP.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </p>
                        </div>
                        <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-8 py-4 border border-white/20">
                            <p className="text-emerald-100 text-xs font-bold mb-1">🇺🇸 إجمالي بالدولار</p>
                            <p className="text-3xl font-black tracking-tight dir-ltr">
                                <span className="text-sm font-bold ml-1 opacity-80">$</span>
                                {totalUSD.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-sm rounded-2xl px-6 py-4 border border-white/10 flex items-center gap-3">
                            <div className="flex items-center gap-2 text-sm font-bold">
                                <i className="fa-solid fa-dollar-sign"></i>
                                <span>سعر الدولار: {usdRate} ج.م</span>
                                {rateLoading ? (
                                    <i className="fa-solid fa-spinner fa-spin text-xs opacity-70"></i>
                                ) : (
                                    <button onClick={() => fetchUsdRate(true)} className="bg-white/10 hover:bg-white/20 p-1.5 rounded-lg transition" title="تحديث السعر">
                                        <i className="fa-solid fa-rotate text-xs"></i>
                                    </button>
                                )}
                            </div>
                            {rateLastUpdate && (
                                <span className="text-[9px] text-emerald-200 opacity-70">
                                    آخر تحديث: {rateLastUpdate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* زر إضافة */}
            <div className="flex justify-between items-center">
                <button onClick={() => setShowAddModal(true)} className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 hover:-translate-y-0.5 transition-all flex items-center gap-2">
                    <i className="fa-solid fa-plus text-lg"></i> إضافة محفظة جديدة
                </button>
                {selectedWallet && (
                    <button onClick={() => setSelectedWallet(null)} className="text-slate-500 hover:text-slate-700 font-bold text-sm flex items-center gap-1">
                        <i className="fa-solid fa-arrow-right"></i> عرض الكل
                    </button>
                )}
            </div>

            {/* عرض المحافظ */}
            {!selectedWallet ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {wallets.length === 0 ? (
                        <div className="col-span-full bg-white rounded-2xl border-2 border-dashed border-slate-200 p-16 text-center text-slate-400">
                            <i className="fa-solid fa-wallet text-5xl mb-4 block opacity-30"></i>
                            <p className="font-bold text-lg">لا توجد محافظ بعد</p>
                            <p className="text-sm mt-1">اضغط "إضافة محفظة جديدة" للبدء</p>
                        </div>
                    ) : wallets.map(w => {
                        const st = walletStats[w.id] || { totalDeposits: 0, totalWithdrawals: 0 };
                        const ci = getCurrencyInfo(w.currency || 'EGP');
                        return (
                            <div key={w.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-emerald-200 transition-all duration-300 overflow-hidden group cursor-pointer" onClick={() => setSelectedWallet(w)}>
                                <div className="p-6">
                                    <div className="flex justify-between items-start mb-5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-11 h-11 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 border border-emerald-100 group-hover:bg-emerald-100 transition text-lg">{ci.flag}</div>
                                            <div>
                                                <h3 className="text-lg font-extrabold text-slate-800">{w.name}</h3>
                                                <span className="text-[10px] text-slate-400 font-bold bg-slate-50 px-2 py-0.5 rounded border border-slate-100">{ci.label}</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-1.5">
                                            <button onClick={(e) => { e.stopPropagation(); setEditingWallet(w); }} className="w-8 h-8 flex items-center justify-center text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition border border-blue-100 opacity-0 group-hover:opacity-100"><i className="fa-solid fa-pen text-xs"></i></button>
                                            <button onClick={(e) => { e.stopPropagation(); handleDeleteWallet(w.id); }} className="w-8 h-8 flex items-center justify-center text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition border border-red-100 opacity-0 group-hover:opacity-100"><i className="fa-solid fa-trash text-xs"></i></button>
                                        </div>
                                    </div>
                                    <div className="mb-5">
                                        <p className="text-xs text-slate-400 font-bold mb-1">الرصيد الحالي</p>
                                        <p className="text-3xl font-black text-slate-800 dir-ltr">
                                            <span className="text-xs text-slate-400 ml-0.5">{ci.code}</span>
                                            {Number(w.balance).toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-100">
                                        <div className="text-center">
                                            <p className="text-[10px] text-slate-400 font-bold mb-0.5">إجمالي الإيداع</p>
                                            <p className="text-sm font-black text-emerald-600 dir-ltr">{st.totalDeposits.toLocaleString()}+</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-[10px] text-slate-400 font-bold mb-0.5">إجمالي السحب</p>
                                            <p className="text-sm font-black text-red-600 dir-ltr">{st.totalWithdrawals.toLocaleString()}-</p>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-slate-300 font-bold mt-3 text-center">الرصيد الافتتاحي: {Number(w.initialBalance || w.initial_balance || 0).toLocaleString()} {ci.symbol}</p>
                                </div>
                                <div className="flex border-t border-slate-100">
                                    <button onClick={(e) => { e.stopPropagation(); setShowTxnModal(w.id); setTxnType('deposit'); }} className="flex-1 py-3.5 text-center text-emerald-600 hover:bg-emerald-50 transition font-bold text-sm flex items-center justify-center gap-1.5 border-l border-slate-100">
                                        <i className="fa-solid fa-plus-circle"></i> إيداع
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); setShowTxnModal(w.id); setTxnType('withdraw'); }} className="flex-1 py-3.5 text-center text-red-600 hover:bg-red-50 transition font-bold text-sm flex items-center justify-center gap-1.5 border-l border-slate-100">
                                        <i className="fa-solid fa-minus-circle"></i> سحب
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); setAdjustBalanceWallet(w); }} className="flex-1 py-3.5 text-center text-amber-600 hover:bg-amber-50 transition font-bold text-sm flex items-center justify-center gap-1.5">
                                        <i className="fa-solid fa-pen-to-square"></i> تعديل
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className="w-11 h-11 bg-emerald-50 rounded-xl flex items-center justify-center text-lg border border-emerald-100">{getCurrencyInfo(selectedWallet.currency).flag}</div>
                            <div>
                                <h3 className="text-xl font-extrabold text-slate-800">{selectedWallet.name}</h3>
                                <p className="text-sm text-slate-400 font-bold">الرصيد: <span className="text-emerald-600 dir-ltr">{Number(selectedWallet.balance).toLocaleString()} {selectedWallet.currency || 'EGP'}</span></p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => { setShowTxnModal(selectedWallet.id); setTxnType('deposit'); }} className="bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-emerald-700 transition flex items-center gap-1.5"><i className="fa-solid fa-plus-circle"></i> إيداع</button>
                            <button onClick={() => { setShowTxnModal(selectedWallet.id); setTxnType('withdraw'); }} className="bg-red-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-red-700 transition flex items-center gap-1.5"><i className="fa-solid fa-minus-circle"></i> سحب</button>
                        </div>
                    </div>
                    <div className="p-6">
                        <h4 className="text-sm font-extrabold text-slate-700 mb-4 flex items-center gap-2"><i className="fa-solid fa-clock-rotate-left text-indigo-500"></i> سجل الحركات</h4>
                        {walletTxns.length === 0 ? (
                            <p className="text-slate-400 text-center py-12 font-bold">لا توجد حركات بعد</p>
                        ) : (
                            <div className="space-y-3">
                                {walletTxns.map(txn => (
                                    <div key={txn.id} className="flex items-center justify-between p-4 rounded-xl border border-slate-100 hover:border-slate-200 transition group">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${txn.type === 'deposit' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                                                <i className={`fa-solid ${txn.type === 'deposit' ? 'fa-arrow-down' : 'fa-arrow-up'}`}></i>
                                            </div>
                                            <div>
                                                <p className="font-bold text-sm text-slate-800">{txn.type === 'deposit' ? 'إيداع' : 'سحب'}{txn.source ? ` — ${txn.source}` : ''}</p>
                                                {txn.description && <p className="text-xs text-slate-400 mt-0.5">{txn.description}</p>}
                                                <p className="text-[10px] text-slate-300 mt-0.5">{new Date(txn.date).toLocaleString('ar-EG')} — {txn.by || txn.created_by}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="text-left">
                                                <p className={`font-black text-lg dir-ltr ${txn.type === 'deposit' ? 'text-emerald-600' : 'text-red-600'}`}>
                                                    {txn.type === 'deposit' ? '+' : '-'}{Number(txn.amount).toLocaleString()}
                                                    <span className="text-[10px] text-slate-400 mr-1">{selectedWallet.currency || 'EGP'}</span>
                                                </p>
                                                <p className="text-[10px] text-slate-300 font-bold">الرصيد: {Number(txn.balanceAfter || txn.balance_after || 0).toLocaleString()}</p>
                                            </div>
                                            <button onClick={() => deleteTransaction(txn)} className="w-8 h-8 flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition border border-transparent hover:border-red-100 opacity-0 group-hover:opacity-100" title="حذف الحركة">
                                                <i className="fa-solid fa-trash text-xs"></i>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* MODAL: إضافة محفظة */}
            {showAddModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
                        <div className="p-6 bg-slate-800 text-white flex justify-between items-center">
                            <h3 className="text-xl font-bold flex items-center gap-2"><i className="fa-solid fa-wallet"></i> إضافة محفظة</h3>
                            <button onClick={() => setShowAddModal(false)} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>
                        <form onSubmit={handleAddWallet} className="p-8 space-y-5">
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">اسم المحفظة / طريقة الدفع</label>
                                <input name="name" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-emerald-100 focus:border-emerald-600 outline-none transition-all" placeholder="مثال: فودافون كاش 010..." required />
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">العملة</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {CURRENCIES.map(c => (
                                        <label key={c.code} className="flex items-center justify-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50 border-slate-200 hover:border-emerald-200">
                                            <input type="radio" name="currency" value={c.code} defaultChecked={c.code === 'EGP'} className="hidden" />
                                            <span className="text-base">{c.flag}</span>
                                            <span className="text-xs font-bold text-slate-700">{c.code}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">الرصيد الافتتاحي</label>
                                <input name="initialBalance" type="number" step="0.01" defaultValue="0" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-emerald-100 focus:border-emerald-600 outline-none transition-all dir-ltr text-left" />
                            </div>
                            <div className="flex gap-3 pt-4 border-t border-slate-200">
                                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 py-3 rounded-xl font-bold text-slate-600 bg-white border-2 border-slate-200 hover:bg-slate-50 transition">إلغاء</button>
                                <button type="submit" className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition">حفظ المحفظة</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: تعديل محفظة */}
            {editingWallet && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
                        <div className="p-6 bg-white border-b border-slate-100 flex justify-between items-center">
                            <h3 className="text-xl font-extrabold text-slate-800">تعديل المحفظة</h3>
                            <button onClick={() => setEditingWallet(null)} className="bg-slate-50 hover:bg-slate-100 p-2 rounded-full transition text-slate-400"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>
                        <form onSubmit={handleEditWallet} className="p-8 space-y-5">
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">اسم المحفظة</label>
                                <input name="name" defaultValue={editingWallet.name} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-emerald-100 focus:border-emerald-600 outline-none transition-all" required />
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">العملة</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {CURRENCIES.map(c => (
                                        <label key={c.code} className="flex items-center justify-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50 border-slate-200 hover:border-emerald-200">
                                            <input type="radio" name="currency" value={c.code} defaultChecked={c.code === (editingWallet.currency || 'EGP')} className="hidden" />
                                            <span className="text-base">{c.flag}</span>
                                            <span className="text-xs font-bold text-slate-700">{c.code}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-3 pt-4 border-t border-slate-200">
                                <button type="button" onClick={() => setEditingWallet(null)} className="flex-1 py-3 rounded-xl font-bold text-slate-600 bg-white border-2 border-slate-200 hover:bg-slate-50 transition">إلغاء</button>
                                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 transition">حفظ</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL: إيداع / سحب */}
            {showTxnModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
                        <div className={`p-6 text-white flex justify-between items-center ${txnType === 'deposit' ? 'bg-gradient-to-r from-emerald-600 to-teal-600' : 'bg-gradient-to-r from-red-600 to-rose-600'}`}>
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <i className={`fa-solid ${txnType === 'deposit' ? 'fa-plus-circle' : 'fa-minus-circle'}`}></i>
                                {txnType === 'deposit' ? 'إيداع' : 'سحب'}
                            </h3>
                            <button onClick={() => setShowTxnModal(null)} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>
                        <form onSubmit={handleAddTransaction} className="p-8 space-y-5">
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">المبلغ</label>
                                <input name="amount" type="number" step="0.01" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-emerald-100 focus:border-emerald-600 outline-none transition-all dir-ltr text-left" placeholder="0.00" required />
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">وصف (اختياري)</label>
                                <input name="description" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-slate-100 focus:border-slate-400 outline-none transition-all" placeholder="وصف الحركة..." />
                            </div>
                            <div className="flex gap-3 pt-4 border-t border-slate-200">
                                <button type="button" onClick={() => setShowTxnModal(null)} className="flex-1 py-3 rounded-xl font-bold text-slate-600 bg-white border-2 border-slate-200 hover:bg-slate-50 transition">إلغاء</button>
                                <button type="submit" className={`flex-1 text-white py-3 rounded-xl font-bold shadow-lg transition ${txnType === 'deposit' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200' : 'bg-red-600 hover:bg-red-700 shadow-red-200'}`}>
                                    {txnType === 'deposit' ? 'تأكيد الإيداع' : 'تأكيد السحب'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* ============ ADJUST BALANCE MODAL ============ */}
            {adjustBalanceWallet && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
                        <div className="p-6 bg-gradient-to-r from-amber-500 to-orange-500 text-white">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <i className="fa-solid fa-pen-to-square"></i> تعديل رصيد المحفظة
                            </h3>
                            <p className="text-amber-100 text-sm font-medium mt-1">{adjustBalanceWallet.name}</p>
                        </div>
                        <form onSubmit={handleAdjustBalance} className="p-8 space-y-5">
                            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm font-bold text-amber-800 flex items-start gap-2">
                                <i className="fa-solid fa-circle-info mt-0.5"></i>
                                <span>تعديل الرصيد مباشرة بدون تسجيل عملية إيداع أو سحب. مفيد لتصحيح الأرصدة.</span>
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">الرصيد الحالي</label>
                                <div className="text-2xl font-black text-slate-400 dir-ltr bg-slate-50 rounded-xl p-3 border border-slate-200">
                                    {Number(adjustBalanceWallet.balance).toLocaleString()} <span className="text-sm">{adjustBalanceWallet.currency || 'EGP'}</span>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">الرصيد الجديد</label>
                                <input name="newBalance" type="number" step="0.01" defaultValue={adjustBalanceWallet.balance} className="w-full bg-white border-2 border-amber-300 rounded-xl p-3.5 font-bold text-lg focus:ring-4 focus:ring-amber-100 focus:border-amber-500 outline-none transition-all text-amber-700" required autoFocus />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setAdjustBalanceWallet(null)} className="flex-1 py-3 rounded-xl font-bold text-slate-600 bg-slate-50 border-2 border-slate-200 hover:bg-slate-100 transition-all">إلغاء</button>
                                <button type="submit" className="flex-1 py-3 rounded-xl font-bold text-white bg-amber-500 hover:bg-amber-600 shadow-lg shadow-amber-200 transition-all flex items-center justify-center gap-2">
                                    <i className="fa-solid fa-check"></i> حفظ الرصيد
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <style>{`
                .animate-fade-in { animation: fadeIn 0.4s ease-out forwards; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
}
