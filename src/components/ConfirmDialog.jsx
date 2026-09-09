import { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';

// ========= Context for app-wide confirm/alert =========
const ConfirmContext = createContext();

export function ConfirmProvider({ children }) {
    const [dialog, setDialog] = useState(null);
    const resolveRef = useRef(null);

    const showConfirm = useCallback(({ title, message, confirmText, cancelText, type }) => {
        return new Promise((resolve) => {
            resolveRef.current = resolve;
            setDialog({ title, message, confirmText: confirmText || 'تأكيد', cancelText: cancelText || 'إلغاء', type: type || 'warning' });
        });
    }, []);

    const showAlert = useCallback(({ title, message, type }) => {
        return new Promise((resolve) => {
            resolveRef.current = resolve;
            setDialog({ title, message, confirmText: 'حسناً', cancelText: null, type: type || 'info', isAlert: true });
        });
    }, []);

    const handleConfirm = () => {
        if (resolveRef.current) resolveRef.current(true);
        setDialog(null);
    };

    const handleCancel = () => {
        if (resolveRef.current) resolveRef.current(false);
        setDialog(null);
    };

    // ESC key to cancel
    useEffect(() => {
        if (!dialog) return;
        const handleKey = (e) => { if (e.key === 'Escape') handleCancel(); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [dialog]);

    const typeConfig = {
        warning: { icon: 'fa-triangle-exclamation', iconBg: 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/20', btnClass: 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/30' },
        danger: { icon: 'fa-trash-can', iconBg: 'bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-500 border border-rose-500/25', btnClass: 'bg-rose-500 hover:bg-rose-600 text-white shadow-rose-500/30' },
        success: { icon: 'fa-check-circle', iconBg: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20', btnClass: 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/30' },
        info: { icon: 'fa-circle-info', iconBg: 'bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20', btnClass: 'bg-blue-500 hover:bg-blue-600 text-white shadow-blue-500/30' },
    };

    return (
        <ConfirmContext.Provider value={{ showConfirm, showAlert }}>
            {children}
            {dialog && (
                <div className="fixed inset-0 bg-black/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 animate-confirm-fade-in" onClick={handleCancel}>
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-sm sm:max-w-md shadow-2xl overflow-hidden animate-confirm-scale-in p-6 sm:p-7" onClick={e => e.stopPropagation()}>
                        {/* Icon + Title */}
                        <div className="text-center">
                            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 ${typeConfig[dialog.type]?.iconBg || typeConfig.warning.iconBg}`}>
                                <i className={`fa-solid ${typeConfig[dialog.type]?.icon || 'fa-question'} text-2xl`}></i>
                            </div>
                            <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">{dialog.title || 'تأكيد'}</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed mb-6">{dialog.message}</p>
                        </div>

                        {/* Actions */}
                        <div className={`flex gap-3 items-center ${dialog.isAlert ? 'justify-center' : ''}`}>
                            {!dialog.isAlert && (
                                <button
                                    onClick={handleCancel}
                                    className="flex-1 py-3 px-4 rounded-2xl font-bold text-sm text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-750 transition cursor-pointer"
                                >
                                    {dialog.cancelText}
                                </button>
                            )}
                            <button
                                onClick={handleConfirm}
                                autoFocus
                                className={`flex-1 py-3 px-4 rounded-2xl font-bold text-sm shadow-lg transition-all hover:-translate-y-0.5 cursor-pointer ${typeConfig[dialog.type]?.btnClass || typeConfig.warning.btnClass}`}
                            >
                                {dialog.confirmText}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <style>{`
                .animate-confirm-fade-in { animation: confirmFadeIn 0.2s ease-out forwards; }
                @keyframes confirmFadeIn { from { opacity: 0; } to { opacity: 1; } }
                .animate-confirm-scale-in { animation: confirmScaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
                @keyframes confirmScaleIn { from { opacity: 0; transform: scale(0.85) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            `}</style>
        </ConfirmContext.Provider>
    );
}

export const useConfirm = () => {
    const ctx = useContext(ConfirmContext);
    if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
    return ctx;
};
