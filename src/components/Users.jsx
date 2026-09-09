import { useState, useEffect, useMemo } from 'react';
import { usersAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from './ConfirmDialog';

// ==========================================
// تعريف مجموعات الصلاحيات المنظمة للتطبيق
// ==========================================
export const PERMISSIONS_SECTIONS = [
    {
        title: 'أقسام وشيتات التطبيق',
        icon: 'fa-table-cells',
        description: 'تحديد الشيتات واللوحات التي يمكن للمستخدم الوصول إليها ورؤيتها',
        permissions: [
            { id: 'dashboard', label: 'الرئيسية', icon: 'fa-house', desc: 'عرض الصفحة الرئيسية ولوحة الإحصائيات' },
            { id: 'alerts', label: 'التنبيهات', icon: 'fa-bell', desc: 'عرض مركز تنبيهات الاشتراكات والتجديد' },
            { id: 'sheet_client_data', label: 'شيت بيانات العميل', icon: 'fa-user-tie', desc: 'الوصول إلى جدول ومواعيد عملاء الخدمة' },
            { id: 'sheet_merchant_data', label: 'شيت بيانات التاجر', icon: 'fa-store', desc: 'الوصول إلى جدول حسابات وتجار الخدمة' },
            { id: 'sheet_account_data', label: 'شيت بيانات الحساب', icon: 'fa-shield-halved', desc: 'الوصول إلى شيت بيانات الحسابات والمخزون' },
            { id: 'sheet_trash_data', label: 'سلة المهملات', icon: 'fa-trash-can', desc: 'استعراض البيانات المحذوفة وإمكانية استرجاعها' },
        ]
    },
    {
        title: 'العمليات والتحكم بالبيانات',
        icon: 'fa-sliders',
        description: 'تحديد الإجراءات والعمليات المسموح للمستخدم القيام بها داخل الشيتات',
        permissions: [
            { id: 'add_row', label: 'إضافة صفوف جديدة', icon: 'fa-plus', desc: 'إمكانية إدخال وإضافة بيانات جديدة في الشيتات' },
            { id: 'edit_row', label: 'تعديل البيانات', icon: 'fa-pen-to-square', desc: 'إمكانية تعديل وتحديث قيم الحقول والصفوف' },
            { id: 'delete_row', label: 'حذف السجلات', icon: 'fa-trash', desc: 'إمكانية حذف الصفوف ونقلها لسلة المهملات' },
            { id: 'customize_columns', label: 'تعديل اسم الشيت', icon: 'fa-pen-to-square', desc: 'إمكانية تغيير اسم الشيت الظاهر في القائمة' },
            { id: 'empty_trash', label: 'إفراغ المهملات نهائياً', icon: 'fa-dumpster-fire', desc: 'حذف البيانات نهائياً وتفريغ سلة المهملات بالكامل' },
        ]
    }
];

export const ALL_PERMISSIONS = PERMISSIONS_SECTIONS.flatMap(s => s.permissions);
const VALID_PERMISSION_IDS = new Set(ALL_PERMISSIONS.map(p => p.id));

export default function Users () {
    const { user: authUser } = useAuth();
    const { showConfirm, showAlert } = useConfirm();

    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState('all');

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [formUsername, setFormUsername] = useState('');
    const [formPassword, setFormPassword] = useState('');
    const [formRole, setFormRole] = useState('moderator');
    const [selectedPermissions, setSelectedPermissions] = useState([]);
    const [isSaving, setIsSaving] = useState(false);

    const isAdmin = authUser?.role === 'admin';

    // تحميل المستخدمين
    const fetchUsers = async () => {
        setLoading(true);
        try {
            const data = await usersAPI.getAll();
            setUsers(data || []);
        } catch (error) {
            console.error('Error fetching users:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isAdmin) {
            fetchUsers();
        }
    }, [isAdmin]);

    // الإحصائيات السريعة
    const stats = useMemo(() => {
        return {
            total: users.length,
            admins: users.filter(u => u.role === 'admin').length,
            moderators: users.filter(u => u.role === 'moderator').length,
            viewers: users.filter(u => u.role === 'viewer').length,
        };
    }, [users]);

    // فلترة المستخدمين
    const filteredUsers = useMemo(() => {
        return users.filter(u => {
            const matchQuery = (u.username || '').toLowerCase().includes(searchQuery.toLowerCase().trim());
            const matchRole = roleFilter === 'all' || u.role === roleFilter;
            return matchQuery && matchRole;
        });
    }, [users, searchQuery, roleFilter]);

    // فتح نافذة الإضافة
    const handleOpenAdd = () => {
        setEditingUser(null);
        setFormUsername('');
        setFormPassword('');
        setFormRole('moderator');
        // الصلاحيات الافتراضية للمشرف (الوصول للشيتات الأساسية والإضافة والتعديل)
        setSelectedPermissions(['dashboard', 'sheet_client_data', 'sheet_merchant_data', 'sheet_account_data', 'add_row', 'edit_row']);
        setShowModal(true);
    };

    // فتح نافذة التعديل
    const handleOpenEdit = (userToEdit) => {
        setEditingUser(userToEdit);
        setFormUsername(userToEdit.username || '');
        setFormPassword(''); // فارغة إلا إذا أراد التغيير
        setFormRole(userToEdit.role || 'moderator');
        const perms = Array.isArray(userToEdit.permissions) ? userToEdit.permissions.filter(p => VALID_PERMISSION_IDS.has(p)) : [];
        setSelectedPermissions(perms);
        setShowModal(true);
    };

    // تبديل اختيار صلاحية محددة
    const togglePermission = (permId) => {
        setSelectedPermissions(prev => {
            if (prev.includes(permId)) {
                return prev.filter(id => id !== permId);
            } else {
                return [...prev, permId];
            }
        });
    };

    // تحديد كافة الصلاحيات
    const handleSelectAllPerms = () => {
        setSelectedPermissions(ALL_PERMISSIONS.map(p => p.id));
    };

    // إلغاء تحديد كافة الصلاحيات
    const handleClearAllPerms = () => {
        setSelectedPermissions([]);
    };

    // حفظ المستخدم (إضافة أو تعديل)
    const handleSaveUser = async (e) => {
        e.preventDefault();
        const trimmedName = formUsername.trim();

        if (!trimmedName) {
            await showAlert({ title: 'تنبيه', message: 'يرجى إدخال اسم المستخدم أولاً', type: 'warning' });
            return;
        }

        if (!editingUser && !formPassword) {
            await showAlert({ title: 'تنبيه', message: 'يرجى إدخال كلمة المرور للمستخدم الجديد', type: 'warning' });
            return;
        }

        setIsSaving(true);
        try {
            // الأدمن يحصل على كافة الصلاحيات دائماً
            const finalPermissions = (formRole === 'admin') ? ['all'] : selectedPermissions.filter(p => VALID_PERMISSION_IDS.has(p));

            const payload = {
                id: editingUser?.id,
                username: trimmedName,
                role: formRole,
                permissions: finalPermissions,
                ...(formPassword ? { password: formPassword } : {})
            };

            await usersAPI.save(payload);
            setShowModal(false);
            await showAlert({
                title: 'تم بنجاح!',
                message: editingUser ? 'تم تحديث بيانات وصلاحيات المستخدم بنجاح.' : 'تم إنشاء المستخدم الجديد وتعيين صلاحياته بنجاح.',
                type: 'success'
            });
            fetchUsers();
        } catch (err) {
            console.error(err);
            await showAlert({
                title: 'تعذر الحفظ',
                message: err?.message || 'حدث خطأ أثناء حفظ المستخدم',
                type: 'danger'
            });
        } finally {
            setIsSaving(false);
        }
    };

    // حذف مستخدم
    const handleDeleteUser = async (userToDelete) => {
        // حماية: لا يمكن للأدمن حذف نفسه
        if (userToDelete.username === authUser?.username || String(userToDelete.id) === String(authUser?.id)) {
            await showAlert({
                title: 'إجراء محظور',
                message: 'لا يمكنك حذف حسابك الحالي الذي تستخدمه لتسجيل الدخول!',
                type: 'warning'
            });
            return;
        }

        const confirmed = await showConfirm({
            title: 'حذف المستخدم نهائياً',
            message: `هل أنت متأكد من حذف المستخدم "${userToDelete.username}"؟ لن يتمكن من تسجيل الدخول بعد الآن.`,
            confirmText: 'نعم، احذف',
            cancelText: 'إلغاء',
            type: 'danger'
        });

        if (!confirmed) return;

        try {
            await usersAPI.delete(userToDelete.id);
            await showAlert({ title: 'تم الحذف', message: 'تم حذف المستخدم بنجاح.', type: 'success' });
            fetchUsers();
        } catch (err) {
            console.error(err);
            await showAlert({ title: 'خطأ', message: 'فشل حذف المستخدم، حاول مرة أخرى.', type: 'danger' });
        }
    };

    // شارة الدور
    const renderRoleBadge = (role) => {
        switch (role) {
            case 'admin':
                return (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                        <i className="fa-solid fa-crown text-amber-500 text-[11px]"></i>
                        مدير النظام (Admin)
                    </span>
                );
            case 'moderator':
                return (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        <i className="fa-solid fa-shield-halved text-blue-500 text-[11px]"></i>
                        مشرف (Moderator)
                    </span>
                );
            case 'viewer':
                return (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                        <i className="fa-solid fa-eye text-emerald-500 text-[11px]"></i>
                        مشاهد (Viewer)
                    </span>
                );
            default:
                return (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {role}
                    </span>
                );
        }
    };

    // حماية الشاشة لغير الأدمن
    if (!isAdmin) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center">
                <div className="w-24 h-24 rounded-3xl bg-rose-50 dark:bg-rose-950/40 border-2 border-rose-200 dark:border-rose-800/60 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-6 shadow-xl shadow-rose-500/10">
                    <i className="fa-solid fa-shield-halved text-4xl"></i>
                </div>
                <h2 className="text-2xl font-black text-slate-800 dark:text-white mb-2">
                    وصول محظور — للمدير فقط
                </h2>
                <p className="text-slate-500 dark:text-slate-400 max-w-md text-sm leading-relaxed mb-6 font-medium">
                    لوحة إدارة المستخدمين وتوزيع الصلاحيات متاحة حصرياً لمدير النظام (Admin). لا تملك الصلاحية الكافية لعرض هذه الصفحة.
                </p>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-mono font-bold">
                    <i className="fa-solid fa-lock"></i>
                    Your Role: {authUser?.role || 'User'}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in pb-12 font-sans">

            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25">
                        <i className="fa-solid fa-users-gear text-2xl"></i>
                    </div>
                    <div>
                        <div className="flex items-center gap-2.5">
                            <h1 className="text-2xl font-black text-slate-900 dark:text-white">إدارة المستخدمين والصلاحيات</h1>
                            <span className="text-[11px] font-black uppercase px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                للأدمن فقط
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                            إضافة حسابات جديدة وتحديد صلاحيات الوصول للشيتات والعمليات بدقة
                        </p>
                    </div>
                </div>

                <button
                    onClick={handleOpenAdd}
                    className="inline-flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-sm shadow-lg shadow-indigo-600/30 hover:shadow-indigo-600/40 hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
                >
                    <i className="fa-solid fa-user-plus text-base"></i>
                    <span>إضافة مستخدم جديد</span>
                </button>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xl">
                        <i className="fa-solid fa-users"></i>
                    </div>
                    <div>
                        <span className="text-xs text-slate-400 font-bold block">إجمالي المستخدمين</span>
                        <span className="text-2xl font-black text-slate-800 dark:text-white">{stats.total}</span>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-950/60 border border-purple-100 dark:border-purple-800 text-purple-600 dark:text-purple-400 flex items-center justify-center text-xl">
                        <i className="fa-solid fa-crown text-amber-500"></i>
                    </div>
                    <div>
                        <span className="text-xs text-slate-400 font-bold block">المدراء (Admins)</span>
                        <span className="text-2xl font-black text-slate-800 dark:text-white">{stats.admins}</span>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-800 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xl">
                        <i className="fa-solid fa-shield-halved"></i>
                    </div>
                    <div>
                        <span className="text-xs text-slate-400 font-bold block">المشرفين (Moderators)</span>
                        <span className="text-2xl font-black text-slate-800 dark:text-white">{stats.moderators}</span>
                    </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl">
                        <i className="fa-solid fa-eye"></i>
                    </div>
                    <div>
                        <span className="text-xs text-slate-400 font-bold block">المشاهدين (Viewers)</span>
                        <span className="text-2xl font-black text-slate-800 dark:text-white">{stats.viewers}</span>
                    </div>
                </div>
            </div>

            {/* Controls: Search & Filter */}
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="relative w-full md:w-80">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="البحث باسم المستخدم..."
                        className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl pr-10 pl-4 py-2.5 text-sm font-bold text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
                    />
                    <i className="fa-solid fa-magnifying-glass absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                </div>

                {/* Filter buttons */}
                <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                    {[
                        { id: 'all', label: 'الكل' },
                        { id: 'admin', label: 'مدراء' },
                        { id: 'moderator', label: 'مشرفين' },
                        { id: 'viewer', label: 'مشاهدين' }
                    ].map(f => (
                        <button
                            key={f.id}
                            onClick={() => setRoleFilter(f.id)}
                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                roleFilter === f.id
                                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-white shadow-sm'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Users Table */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="p-12 text-center text-slate-400">
                        <i className="fa-solid fa-spinner fa-spin text-3xl text-indigo-600 mb-3"></i>
                        <p className="text-sm font-bold">جاري تحميل بيانات المستخدمين...</p>
                    </div>
                ) : filteredUsers.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mx-auto mb-3">
                            <i className="fa-solid fa-user-slash text-2xl"></i>
                        </div>
                        <h3 className="text-base font-bold text-slate-700 dark:text-slate-300">لا يوجد مستخدمين</h3>
                        <p className="text-xs text-slate-400 mt-1">لم يتم العثور على مستخدمين يطابقون خيارات البحث.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-right border-collapse">
                            <thead>
                                <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 text-xs font-black tracking-wider">
                                    <th className="p-4 pr-6">المستخدم</th>
                                    <th className="p-4">الدور / الرتبة</th>
                                    <th className="p-4">الصلاحيات الممنوحة</th>
                                    <th className="p-4">تاريخ الإنشاء</th>
                                    <th className="p-4 pl-6 text-left">الإجراءات</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                                {filteredUsers.map(u => {
                                    const isCurrentLoggedUser = u.username === authUser?.username;
                                    const userPerms = Array.isArray(u.permissions) ? u.permissions.filter(p => VALID_PERMISSION_IDS.has(p) || p === 'all') : [];
                                    const isUserAdmin = u.role === 'admin' || userPerms.includes('all');
                                    const visibleUserPerms = userPerms.filter(p => p !== 'all');

                                    return (
                                        <tr key={u.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                                            {/* Username & Avatar */}
                                            <td className="p-4 pr-6">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm text-white shadow-md ${
                                                        isUserAdmin
                                                            ? 'bg-gradient-to-tr from-purple-600 to-indigo-600 shadow-purple-500/20'
                                                            : u.role === 'moderator'
                                                            ? 'bg-gradient-to-tr from-blue-600 to-cyan-600 shadow-blue-500/20'
                                                            : 'bg-gradient-to-tr from-emerald-600 to-teal-600 shadow-emerald-500/20'
                                                    }`}>
                                                        {u.username.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-extrabold text-slate-800 dark:text-slate-100">
                                                                {u.username}
                                                            </span>
                                                            {isCurrentLoggedUser && (
                                                                <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300">
                                                                    أنت (الحساب الحالي)
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-[11px] text-slate-400 font-mono">
                                                            ID: {String(u.id).substring(0, 10)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* Role */}
                                            <td className="p-4">
                                                {renderRoleBadge(u.role)}
                                            </td>

                                            {/* Permissions tags */}
                                            <td className="p-4">
                                                {isUserAdmin ? (
                                                    <span className="inline-flex items-center gap-1.5 text-xs font-black text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 px-3 py-1 rounded-xl border border-purple-200 dark:border-purple-800/60">
                                                        <i className="fa-solid fa-unlock-keyhole text-[11px]"></i>
                                                        كافة الصلاحيات الكاملة (Admin Full Access)
                                                    </span>
                                                ) : visibleUserPerms.length === 0 ? (
                                                    <span className="text-xs text-rose-500 font-bold bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 rounded-lg">
                                                        لا توجد صلاحيات ممنوحة
                                                    </span>
                                                ) : (
                                                    <div className="flex flex-wrap gap-1.5 max-w-md">
                                                        {visibleUserPerms.slice(0, 3).map(pId => {
                                                            const pDef = ALL_PERMISSIONS.find(p => p.id === pId);
                                                            return (
                                                                <span
                                                                    key={pId}
                                                                    className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700"
                                                                >
                                                                    <i className={`fa-solid ${pDef?.icon || 'fa-check'} text-[9px] text-indigo-500`}></i>
                                                                    {pDef?.label || pId}
                                                                </span>
                                                            );
                                                        })}
                                                        {visibleUserPerms.length > 3 && (
                                                            <span className="inline-flex items-center text-[10px] font-black px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                                                                +{visibleUserPerms.length - 3} صلاحيات إضافية
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </td>

                                            {/* Created At */}
                                            <td className="p-4 text-xs font-mono text-slate-500 dark:text-slate-400">
                                                {u.created_at ? new Date(u.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' }) : 'افتراضي'}
                                            </td>

                                            {/* Actions */}
                                            <td className="p-4 pl-6 text-left">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => handleOpenEdit(u)}
                                                        className="p-2 rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-800 transition cursor-pointer"
                                                        title="تعديل المستخدم والصلاحيات"
                                                    >
                                                        <i className="fa-solid fa-pen-to-square text-base"></i>
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteUser(u)}
                                                        disabled={isCurrentLoggedUser}
                                                        className={`p-2 rounded-xl transition ${
                                                            isCurrentLoggedUser
                                                                ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed'
                                                                : 'text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 cursor-pointer'
                                                        }`}
                                                        title={isCurrentLoggedUser ? 'لا يمكن حذف الحساب الحالي' : 'حذف المستخدم'}
                                                    >
                                                        <i className="fa-solid fa-trash text-base"></i>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* ==========================================
                Modal: Add / Edit User & Permissions
               ========================================== */}
            {showModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
                    <div
                        className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-8 animate-scale-in"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/30">
                                    <i className={`fa-solid ${editingUser ? 'fa-user-pen' : 'fa-user-plus'}`}></i>
                                </div>
                                <div>
                                    <h3 className="text-lg font-black text-slate-900 dark:text-white">
                                        {editingUser ? `تعديل المستخدم: ${editingUser.username}` : 'إضافة مستخدم جديد'}
                                    </h3>
                                    <p className="text-xs text-slate-400">
                                        قم بتحديد بيانات تسجيل الدخول ومستوى الصلاحيات بدقة
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowModal(false)}
                                className="w-9 h-9 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition cursor-pointer"
                            >
                                <i className="fa-solid fa-xmark text-lg"></i>
                            </button>
                        </div>

                        {/* Modal Form */}
                        <form onSubmit={handleSaveUser} className="p-6 space-y-6 max-h-[75vh] overflow-y-auto custom-scrollbar">

                            {/* Row: Username & Password */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-black text-slate-700 dark:text-slate-200 mb-2">
                                        اسم المستخدم <span className="text-rose-500">*</span>
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            required
                                            value={formUsername}
                                            onChange={(e) => setFormUsername(e.target.value)}
                                            placeholder="مثال: ahmed_vip"
                                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 pr-10 text-sm font-bold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none transition"
                                        />
                                        <i className="fa-solid fa-user absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-black text-slate-700 dark:text-slate-200 mb-2">
                                        {editingUser ? 'تغيير كلمة المرور (اختياري)' : 'كلمة المرور *'}
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="password"
                                            required={!editingUser}
                                            value={formPassword}
                                            onChange={(e) => setFormPassword(e.target.value)}
                                            placeholder={editingUser ? 'اتركه فارغاً للاحتفاظ بالحالية' : '••••••••'}
                                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 pr-10 text-sm font-bold font-mono text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 outline-none transition"
                                        />
                                        <i className="fa-solid fa-lock absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                                    </div>
                                </div>
                            </div>

                            {/* Role Selection */}
                            <div>
                                <label className="block text-xs font-black text-slate-700 dark:text-slate-200 mb-2">
                                    نوع الحساب / الرتبة <span className="text-rose-500">*</span>
                                </label>
                                <div className="grid grid-cols-3 gap-3">
                                    {[
                                        {
                                            id: 'admin',
                                            title: 'مدير (Admin)',
                                            desc: 'كافة الصلاحيات تلقائياً',
                                            icon: 'fa-crown',
                                            color: 'text-amber-500',
                                            border: 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/20'
                                        },
                                        {
                                            id: 'moderator',
                                            title: 'مشرف (Moderator)',
                                            desc: 'صلاحيات مخصصة يحددها الأدمن',
                                            icon: 'fa-shield-halved',
                                            color: 'text-blue-500',
                                            border: 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20'
                                        },
                                        {
                                            id: 'viewer',
                                            title: 'مشاهد (Viewer)',
                                            desc: 'عرض الشيتات فقط بدون تعديل',
                                            icon: 'fa-eye',
                                            color: 'text-emerald-500',
                                            border: 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20'
                                        }
                                    ].map(r => (
                                        <button
                                            type="button"
                                            key={r.id}
                                            onClick={() => setFormRole(r.id)}
                                            className={`p-3.5 rounded-2xl border-2 text-right transition-all cursor-pointer ${
                                                formRole === r.id
                                                    ? r.border
                                                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/40'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2 mb-1">
                                                <i className={`fa-solid ${r.icon} ${r.color} text-sm`}></i>
                                                <span className="font-black text-xs text-slate-800 dark:text-white">{r.title}</span>
                                            </div>
                                            <p className="text-[11px] text-slate-400 leading-tight">{r.desc}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Permissions Matrix */}
                            <div className="space-y-4 pt-2">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h4 className="text-sm font-black text-slate-800 dark:text-white">
                                            مصفوفة الصلاحيات الممنوحة
                                        </h4>
                                        <p className="text-xs text-slate-400">
                                            {formRole === 'admin'
                                                ? 'المدير يمتلك كافة الصلاحيات بشكل تلقائي ودائم'
                                                : 'حدد الأقسام والعمليات المسموح لهذا المستخدم بتنفيذها'}
                                        </p>
                                    </div>

                                    {formRole !== 'admin' && (
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={handleSelectAllPerms}
                                                className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                                            >
                                                تحديد الكل
                                            </button>
                                            <span className="text-slate-300">|</span>
                                            <button
                                                type="button"
                                                onClick={handleClearAllPerms}
                                                className="text-xs font-bold text-slate-500 hover:text-rose-500 cursor-pointer"
                                            >
                                                إلغاء التحديد
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {formRole === 'admin' ? (
                                    <div className="p-4 rounded-2xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60 flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center flex-shrink-0 shadow-md">
                                            <i className="fa-solid fa-unlock-keyhole"></i>
                                        </div>
                                        <div>
                                            <h5 className="text-sm font-black text-purple-900 dark:text-purple-200">
                                                صلاحيات كاملة وغير مقيدة
                                            </h5>
                                            <p className="text-xs text-purple-700 dark:text-purple-300 mt-0.5">
                                                حسابات الـ Admin لها وصول مباشر لجميع الشيتات والتنبيهات، ولوحة إدارة المستخدمين، وعمليات الإضافة والتعديل والحذف وتصدير البيانات.
                                            </p>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {PERMISSIONS_SECTIONS.map((section, sIdx) => (
                                            <div key={sIdx} className="bg-slate-50/80 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800">
                                                <div className="flex items-center gap-2.5 mb-3">
                                                    <i className={`fa-solid ${section.icon} text-indigo-500 text-sm`}></i>
                                                    <h5 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider">
                                                        {section.title}
                                                    </h5>
                                                    <span className="text-[10px] text-slate-400">
                                                        ({section.permissions.filter(p => selectedPermissions.includes(p.id)).length} من {section.permissions.length} محددة)
                                                    </span>
                                                </div>

                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                                    {section.permissions.map(perm => {
                                                        const isChecked = selectedPermissions.includes(perm.id);
                                                        return (
                                                            <div
                                                                key={perm.id}
                                                                onClick={() => togglePermission(perm.id)}
                                                                className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-3 select-none ${
                                                                    isChecked
                                                                        ? 'bg-indigo-50/60 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-700/70 shadow-sm'
                                                                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700/60 opacity-75 hover:opacity-100'
                                                                }`}
                                                            >
                                                                <div className={`w-5 h-5 rounded-md flex items-center justify-center text-xs mt-0.5 flex-shrink-0 transition-colors ${
                                                                    isChecked
                                                                        ? 'bg-indigo-600 text-white shadow-sm'
                                                                        : 'border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                                                                }`}>
                                                                    {isChecked && <i className="fa-solid fa-check text-[10px]"></i>}
                                                                </div>

                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <i className={`fa-solid ${perm.icon} text-[11px] ${isChecked ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`}></i>
                                                                        <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                                                                            {perm.label}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">
                                                                        {perm.desc}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Modal Footer Actions */}
                            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setShowModal(false)}
                                    className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition flex items-center gap-2 disabled:opacity-60 cursor-pointer"
                                >
                                    {isSaving ? (
                                        <>
                                            <i className="fa-solid fa-spinner fa-spin"></i>
                                            <span>جاري الحفظ...</span>
                                        </>
                                    ) : (
                                        <>
                                            <i className="fa-solid fa-floppy-disk"></i>
                                            <span>{editingUser ? 'حفظ التعديلات' : 'إنشاء المستخدم'}</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

        </div>
    );
}
