import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
    const { login } = useAuth();
    const [creds, setCreds] = useState({ username: '', password: '' });
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            const result = await login(creds.username, creds.password);
            if (!result.success) {
                setError(result.message || 'اسم المستخدم أو كلمة المرور غير صحيحة');
            }
        } catch {
            setError('حدث خطأ في الاتصال. تأكد من اتصالك بالإنترنت.');
        }

        setIsLoading(false);
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 dir-rtl relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #0f172a 100%)' }}>

            {/* Decorative background elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full"
                    style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)' }} />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full"
                    style={{ background: 'radial-gradient(circle, rgba(168,85,247,0.15) 0%, transparent 70%)' }} />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full"
                    style={{ background: 'radial-gradient(circle, rgba(79,70,229,0.08) 0%, transparent 65%)' }} />
                {/* Decorative grid dots */}
                <div className="absolute inset-0 opacity-[0.03]"
                    style={{ backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
            </div>

            {/* Login Card */}
            <div className="relative w-full max-w-md animate-fade-in">

                {/* Glassmorphism card */}
                <div className="relative bg-white/[0.06] backdrop-blur-xl border border-white/[0.1] rounded-3xl shadow-2xl overflow-hidden"
                    style={{ boxShadow: '0 32px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)' }}>

                    {/* Top accent line */}
                    <div className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #4f46e5, #7c3aed, #ec4899)' }} />

                    <div className="p-8 sm:p-10">

                        {/* Logo & Header */}
                        <div className="text-center mb-8">
                            <div className="relative w-20 h-20 mx-auto mb-5">
                                <div className="vip-logo-badge w-20 h-20 rounded-2xl flex items-center justify-center border border-white/25 shadow-2xl"
                                    style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed, #ec4899)' }}>
                                    <span className="text-white font-black text-4xl select-none"
                                        style={{ fontFamily: "'Cairo', sans-serif", textShadow: '0 2px 6px rgba(0,0,0,0.4)' }}>
                                        H
                                    </span>
                                    <div className="logo-shine-sweep" />
                                </div>
                            </div>

                            <h1 className="vip-animated-text text-3xl font-black mb-1 tracking-tight">Service Hub</h1>
                            <p className="text-indigo-300 font-bold text-xs uppercase tracking-widest mb-2">
                                Subscription Management
                            </p>
                            <p className="text-slate-400 text-sm">سجل دخولك للوصول إلى لوحة التحكم</p>
                        </div>

                        {/* Error message */}
                        {error && (
                            <div className="mb-6 p-4 rounded-xl border border-red-500/30 bg-red-500/10 flex items-center gap-3 text-red-300 text-sm font-bold animate-fade-in"
                                role="alert">
                                <i className="fa-solid fa-circle-exclamation text-red-400 flex-shrink-0" aria-hidden="true" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Form */}
                        <form onSubmit={handleLogin} className="space-y-5" aria-label="نموذج تسجيل الدخول">

                            {/* Username field */}
                            <div>
                                <label htmlFor="login-username" className="block text-sm font-bold text-slate-300 mb-2">
                                    اسم المستخدم أو البريد الإلكتروني
                                </label>
                                <div className="relative">
                                    <input
                                        id="login-username"
                                        type="text"
                                        autoComplete="username"
                                        className="w-full rounded-xl border font-bold text-sm outline-none transition-all pl-10 pr-4 py-3"
                                        style={{
                                            background: 'rgba(255,255,255,0.07)',
                                            borderColor: 'rgba(255,255,255,0.12)',
                                            color: '#f1f5f9',
                                            minHeight: '48px',
                                        }}
                                        value={creds.username}
                                        onChange={e => setCreds({ ...creds, username: e.target.value })}
                                        onFocus={e => {
                                            e.target.style.borderColor = '#6366f1';
                                            e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.2)';
                                        }}
                                        onBlur={e => {
                                            e.target.style.borderColor = 'rgba(255,255,255,0.12)';
                                            e.target.style.boxShadow = 'none';
                                        }}
                                        required
                                        placeholder="أدخل اسم المستخدم"
                                        dir="auto"
                                    />
                                    <i className="fa-solid fa-user absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none"
                                        aria-hidden="true" />
                                </div>
                            </div>

                            {/* Password field */}
                            <div>
                                <label htmlFor="login-password" className="block text-sm font-bold text-slate-300 mb-2">
                                    كلمة المرور
                                </label>
                                <div className="relative">
                                    <input
                                        id="login-password"
                                        type={showPassword ? 'text' : 'password'}
                                        autoComplete="current-password"
                                        className="w-full rounded-xl border font-mono text-sm outline-none transition-all pl-10 pr-12 py-3"
                                        style={{
                                            background: 'rgba(255,255,255,0.07)',
                                            borderColor: 'rgba(255,255,255,0.12)',
                                            color: '#f1f5f9',
                                            minHeight: '48px',
                                            direction: 'ltr',
                                            textAlign: 'left',
                                        }}
                                        value={creds.password}
                                        onChange={e => setCreds({ ...creds, password: e.target.value })}
                                        onFocus={e => {
                                            e.target.style.borderColor = '#6366f1';
                                            e.target.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.2)';
                                        }}
                                        onBlur={e => {
                                            e.target.style.borderColor = 'rgba(255,255,255,0.12)';
                                            e.target.style.boxShadow = 'none';
                                        }}
                                        required
                                        placeholder="••••••••"
                                    />
                                    {/* Lock icon */}
                                    <i className="fa-solid fa-lock absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none"
                                        aria-hidden="true" />
                                    {/* Show/hide toggle */}
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(v => !v)}
                                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition p-1"
                                        aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                                    >
                                        <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'} text-sm`} aria-hidden="true" />
                                    </button>
                                </div>
                            </div>

                            {/* Submit button */}
                            <button
                                type="submit"
                                id="login-submit-btn"
                                disabled={isLoading}
                                className="w-full py-3.5 rounded-xl font-bold text-white text-base transition-all duration-300 flex items-center justify-center gap-2.5 mt-2"
                                style={{
                                    background: isLoading
                                        ? 'rgba(99,102,241,0.5)'
                                        : 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                                    boxShadow: isLoading ? 'none' : '0 8px 24px rgba(99,102,241,0.4)',
                                }}
                                onMouseOver={e => { if (!isLoading) e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                onMouseOut={e => { e.currentTarget.style.transform = ''; }}
                            >
                                {isLoading ? (
                                    <>
                                        <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                                        <span>جارٍ تسجيل الدخول…</span>
                                    </>
                                ) : (
                                    <>
                                        <span>تسجيل الدخول</span>
                                        <i className="fa-solid fa-arrow-right-to-bracket text-sm" aria-hidden="true" />
                                    </>
                                )}
                            </button>
                        </form>

                        {/* Footer */}
                        <div className="mt-8 pt-6 border-t border-white/[0.08] text-center">
                            <span className="text-xs text-slate-500 font-medium flex items-center justify-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                                Service Hub — متصل ومحمي
                            </span>
                        </div>
                    </div>
                </div>

                {/* Version tag */}
                <p className="text-center mt-4 text-[11px] text-slate-600 font-medium">
                    v2.0 · Service Hub Management System
                </p>
            </div>
        </div>
    );
}
