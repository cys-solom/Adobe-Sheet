import { useState, useEffect } from 'react';
import telegram from '../services/telegram';

const NOTIFICATION_TYPES = [
    { key: 'newSale',         label: 'بيع جديد',          icon: 'fa-cart-shopping',       color: 'indigo',  desc: 'عند إنشاء عملية بيع جديدة' },
    { key: 'saleActivated',   label: 'تفعيل بيعة',        icon: 'fa-circle-check',        color: 'emerald', desc: 'عند تعليم بيعة كمفعّلة' },
    { key: 'debtPaid',        label: 'دفع مديونية',       icon: 'fa-hand-holding-dollar', color: 'amber',   desc: 'عند تعليم مديونية كمدفوعة' },
    { key: 'saleRenewed',     label: 'تجديد اشتراك',      icon: 'fa-rotate',              color: 'blue',    desc: 'عند تجديد اشتراك عميل' },
    { key: 'stockAdded',      label: 'إضافة مخزون',       icon: 'fa-boxes-stacked',       color: 'purple',  desc: 'عند إضافة حسابات أو أكواد للمخزون' },
    { key: 'inventoryPulled',  label: 'سحب من المخزون',    icon: 'fa-arrow-up-from-bracket', color: 'cyan',  desc: 'عند سحب حساب أو كود من المخزون' },
    { key: 'newProblem',      label: 'مشكلة جديدة',       icon: 'fa-triangle-exclamation', color: 'red',    desc: 'عند تسجيل مشكلة جديدة' },
    { key: 'problemResolved', label: 'حل مشكلة',          icon: 'fa-check-double',        color: 'green',   desc: 'عند حل مشكلة قائمة' },
    { key: 'expenseAdded',    label: 'مصروف جديد',        icon: 'fa-receipt',             color: 'orange',  desc: 'عند إضافة مصروف (معطّل افتراضياً)' },
];

const colorMap = {
    indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600',  border: 'border-indigo-200', activeBg: 'bg-indigo-600' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', activeBg: 'bg-emerald-600' },
    amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-200', activeBg: 'bg-amber-600' },
    blue:    { bg: 'bg-blue-50',    text: 'text-blue-600',    border: 'border-blue-200', activeBg: 'bg-blue-600' },
    purple:  { bg: 'bg-purple-50',  text: 'text-purple-600',  border: 'border-purple-200', activeBg: 'bg-purple-600' },
    cyan:    { bg: 'bg-cyan-50',    text: 'text-cyan-600',    border: 'border-cyan-200', activeBg: 'bg-cyan-600' },
    red:     { bg: 'bg-red-50',     text: 'text-red-600',     border: 'border-red-200', activeBg: 'bg-red-600' },
    green:   { bg: 'bg-green-50',   text: 'text-green-600',   border: 'border-green-200', activeBg: 'bg-green-600' },
    orange:  { bg: 'bg-orange-50',  text: 'text-orange-600',  border: 'border-orange-200', activeBg: 'bg-orange-600' },
};

export default function BotSettings() {
    useEffect(() => { window.scrollTo(0, 0); }, []);

    const [prefs, setPrefs] = useState(telegram.getPrefs());
    const [testStatus, setTestStatus] = useState(null); // null | 'loading' | 'success' | 'error'

    const togglePref = (key) => {
        const updated = { ...prefs, [key]: !prefs[key] };
        setPrefs(updated);
        telegram.savePrefs(updated);
    };

    const enableAll = () => {
        const all = {};
        NOTIFICATION_TYPES.forEach(n => { all[n.key] = true; });
        setPrefs(all);
        telegram.savePrefs(all);
    };

    const disableAll = () => {
        const all = {};
        NOTIFICATION_TYPES.forEach(n => { all[n.key] = false; });
        setPrefs(all);
        telegram.savePrefs(all);
    };

    const testBot = async () => {
        setTestStatus('loading');
        const result = await telegram.testConnection();
        setTestStatus(result.ok ? 'success' : 'error');
        setTimeout(() => setTestStatus(null), 4000);
    };

    const enabledCount = Object.values(prefs).filter(Boolean).length;

    return (
        <div className="space-y-4 md:space-y-6 animate-fade-in pb-20 font-sans text-slate-800">

            {/* Header */}
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-5 md:p-8 text-white relative overflow-hidden shadow-xl">
                <div className="absolute -left-10 -bottom-10 text-[120px] opacity-5"><i className="fa-brands fa-telegram"></i></div>
                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="bg-blue-500/20 p-3 rounded-xl backdrop-blur-sm border border-blue-400/20">
                            <i className="fa-brands fa-telegram text-2xl text-blue-400"></i>
                        </div>
                        <div>
                            <h2 className="text-xl md:text-2xl font-extrabold">إعدادات بوت تليجرام</h2>
                            <p className="text-slate-400 text-xs md:text-sm font-medium">تحكم في الإشعارات اللي بتوصلك على الجروب</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-3 mt-5">
                        <div className="bg-white/10 backdrop-blur-sm rounded-2xl px-5 py-3 border border-white/10">
                            <p className="text-slate-400 text-[10px] md:text-xs font-bold mb-1">الإشعارات النشطة</p>
                            <p className="text-xl md:text-2xl font-black">{enabledCount} <span className="text-sm text-slate-400">/ {NOTIFICATION_TYPES.length}</span></p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-sm rounded-2xl px-5 py-3 border border-white/10">
                            <p className="text-slate-400 text-[10px] md:text-xs font-bold mb-1">الحالة</p>
                            <p className="text-xl md:text-2xl font-black flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                متصل
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Actions Bar */}
            <div className="bg-white p-3 md:p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap gap-2 md:gap-3 items-center justify-between">
                <div className="flex gap-2 flex-wrap">
                    <button onClick={enableAll} className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold rounded-xl text-xs md:text-sm px-3 md:px-4 py-2.5 transition-all flex items-center gap-1.5">
                        <i className="fa-solid fa-toggle-on"></i> تفعيل الكل
                    </button>
                    <button onClick={disableAll} className="bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 font-bold rounded-xl text-xs md:text-sm px-3 md:px-4 py-2.5 transition-all flex items-center gap-1.5">
                        <i className="fa-solid fa-toggle-off"></i> إيقاف الكل
                    </button>
                </div>
                <button onClick={testBot} disabled={testStatus === 'loading'}
                    className={`font-bold rounded-xl text-xs md:text-sm px-4 md:px-6 py-2.5 transition-all flex items-center gap-2 shadow-sm ${
                        testStatus === 'success' ? 'bg-emerald-600 text-white' :
                        testStatus === 'error' ? 'bg-red-600 text-white' :
                        'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200'
                    }`}>
                    {testStatus === 'loading' ? (
                        <><i className="fa-solid fa-spinner fa-spin"></i> جاري الاختبار...</>
                    ) : testStatus === 'success' ? (
                        <><i className="fa-solid fa-check"></i> تم الإرسال ✅</>
                    ) : testStatus === 'error' ? (
                        <><i className="fa-solid fa-xmark"></i> فشل الإرسال</>
                    ) : (
                        <><i className="fa-brands fa-telegram"></i> اختبار البوت</>
                    )}
                </button>
            </div>

            {/* Notification Toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                {NOTIFICATION_TYPES.map(nt => {
                    const c = colorMap[nt.color] || colorMap.indigo;
                    const isOn = prefs[nt.key] !== false;
                    return (
                        <div key={nt.key}
                            onClick={() => togglePref(nt.key)}
                            className={`bg-white rounded-2xl border-2 p-4 md:p-5 cursor-pointer transition-all hover:shadow-lg group ${isOn ? c.border : 'border-slate-100 opacity-60 hover:opacity-80'}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center transition-all ${isOn ? `${c.bg} ${c.text}` : 'bg-slate-100 text-slate-400'}`}>
                                        <i className={`fa-solid ${nt.icon} text-base md:text-lg`}></i>
                                    </div>
                                    <div>
                                        <h3 className="font-extrabold text-sm md:text-base text-slate-800">{nt.label}</h3>
                                        <p className="text-[10px] md:text-xs text-slate-400 mt-0.5">{nt.desc}</p>
                                    </div>
                                </div>

                                {/* Toggle Switch */}
                                <div className={`relative w-11 h-6 rounded-full transition-all flex-shrink-0 mt-1 ${isOn ? c.activeBg : 'bg-slate-200'}`}>
                                    <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-all ${isOn ? 'left-[22px]' : 'left-0.5'}`}></div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 p-4 md:p-5 rounded-2xl border border-blue-200">
                <div className="flex items-start gap-3">
                    <div className="bg-blue-100 p-2 rounded-xl text-blue-600 flex-shrink-0">
                        <i className="fa-solid fa-circle-info"></i>
                    </div>
                    <div className="text-xs md:text-sm text-blue-800">
                        <p className="font-bold mb-1">ملاحظات مهمة</p>
                        <ul className="space-y-1 text-blue-700">
                            <li>• الإعدادات تتحفظ على <strong>هذا الجهاز فقط</strong> — كل جهاز ليه إعداداته</li>
                            <li>• الإشعارات بتوصل لجروب <strong>Service Hub Alert</strong> على تليجرام</li>
                            <li>• لو إشعار معيّن متوقف ← النشاط بيتنفذ عادي بس مش بيبعت للبوت</li>
                            <li>• استخدم زر "اختبار البوت" للتأكد إن التوصيل شغال</li>
                        </ul>
                    </div>
                </div>
            </div>

            <style>{`
                .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
}
