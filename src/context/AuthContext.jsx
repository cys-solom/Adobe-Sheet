import { createContext, useState, useContext, useEffect, useRef, useCallback, useMemo } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext();
const SESSION_USER_KEY = 'service-vip_session_user';
const SESSION_TOKEN_KEY = 'service-vip_session_token';

export const AuthProvider = ({ children }) => {
    // البدء دائماً بحالة فارغة null عند فتح المتصفح/المشروع لمنع الدخول التلقائي
    const [user, setUser] = useState(() => {
        try {
            // مسح أي تسجيل دخول تلقائي قديم من localStorage لضمان طلب تسجيل الدخول دائماً
            localStorage.removeItem('service-vip_user');
            localStorage.removeItem('service-vip_token');

            // استعادة الجلسة فقط إذا كانت نافذة المتصفح الحالية قد سجلت دخول بالفعل
            const sessionToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
            const sessionUser = sessionStorage.getItem(SESSION_USER_KEY);
            if (sessionToken && sessionUser) {
                return JSON.parse(sessionUser);
            }
            return null;
        } catch {
            return null;
        }
    });

    const [loading, setLoading] = useState(false);
    const authChecked = useRef(false);

    // التحقق من صحة التوكن في الجلسة النشطة
    useEffect(() => {
        if (authChecked.current) return;
        authChecked.current = true;

        const checkUser = async () => {
            const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
            if (!token) {
                setUser(null);
                return;
            }

            try {
                const userData = await authAPI.checkAuth(token);
                if (userData) {
                    setUser(userData);
                    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(userData));
                } else {
                    setUser(null);
                }
            } catch (error) {
                console.warn('Auth check error:', error);
            }
        };
        checkUser();
    }, []);

    const login = useCallback(async (username, password) => {
        try {
            const result = await authAPI.login(username, password);
            if (result && result.status === 'success') {
                sessionStorage.setItem(SESSION_TOKEN_KEY, result.token);
                sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(result.user));
                setUser(result.user);
                return { success: true };
            }
            return { success: false, message: result?.message || 'اسم المستخدم أو كلمة المرور غير صحيحة' };
        } catch (e) {
            console.error('Login error:', e);
            return { success: false, message: e?.message || 'حدث خطأ أثناء تسجيل الدخول' };
        }
    }, []);

    const logout = useCallback(async () => {
        const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
        if (token) {
            try { await authAPI.logout(token); } catch { }
        }
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        sessionStorage.removeItem(SESSION_USER_KEY);
        localStorage.removeItem('service-vip_token');
        localStorage.removeItem('service-vip_user');
        setUser(null);
    }, []);

    const hasPermission = useCallback((perm) => {
        if (!user) return false;
        if (user.role === 'admin' || (Array.isArray(user.permissions) && user.permissions.includes('all'))) return true;
        if (!user.permissions) return false;
        return Array.isArray(user.permissions) ? user.permissions.includes(perm) : false;
    }, [user]);

    const value = useMemo(() => ({
        user,
        login,
        logout,
        hasPermission,
        loading
    }), [user, login, logout, hasPermission, loading]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
