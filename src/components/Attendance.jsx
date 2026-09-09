import { useState, useEffect, useMemo } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { attendanceAPI, usersAPI } from '../services/api';
import { useConfirm } from './ConfirmDialog';

export default function Attendance () {
    const { user } = useAuth();
    const { showAlert } = useConfirm();

    // --- States ---
    const [moderators, setModerators] = useState([]);
    const [attendanceLog, setAttendanceLog] = useState([]);
    const [loading, setLoading] = useState(true);

    const getCurrentLocalMonth = () => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    };
    const getCurrentLocalDate = () => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    };

    const [selectedMonth, setSelectedMonth] = useState(getCurrentLocalMonth());

    // Modals States
    const [showEditModal, setShowEditModal] = useState(false);
    const [showBonusModal, setShowBonusModal] = useState(false);
    const [showDeductionModal, setShowDeductionModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);

    const [currentUser, setCurrentUser] = useState(null);
    const [bonusAmount, setBonusAmount] = useState('');
    const [deductionAmount, setDeductionAmount] = useState('');

    const [historyData, setHistoryData] = useState([]);
    const [historyFilter, setHistoryFilter] = useState({
        from: getCurrentLocalMonth() + '-01',
        to: getCurrentLocalDate()
    });

    // --- Helper: Check Permissions ---
    const isUserAdmin = useMemo(() => {
        if (user.role === 'admin') return true;
        try {
            const perms = Array.isArray(user.permissions) ? user.permissions : JSON.parse(user.permissions || '[]');
            return perms.includes('all') || perms.includes('manage_attendance');
        } catch (e) { return false; }
    }, [user]);

    // --- Fetch Main Data ---
    const fetchData = async () => {
        setLoading(true);
        try {
            const [usersData, attData] = await Promise.all([
                usersAPI.getAll(),
                attendanceAPI.getByMonth(selectedMonth),
            ]);
            setModerators(usersData);
            setAttendanceLog(attData);
        } catch (error) {
            console.error(error);
            setAttendanceLog([]); setModerators([]);
        }
        setLoading(false);
    };

    useEffect(() => { fetchData(); }, [selectedMonth]);

    // --- Fetch User History ---
    const fetchHistory = async () => {
        if (!currentUser) return;
        try {
            const data = await attendanceAPI.getUserHistory(currentUser.id, historyFilter.from, historyFilter.to);
            setHistoryData(data);
        } catch (e) { console.error(e); }
    };

    useEffect(() => {
        if (showHistoryModal && currentUser) {
            fetchHistory();
        }
    }, [showHistoryModal, historyFilter, currentUser]);


    // --- Logic: Salary Calculation ---
    const salaryReport = useMemo(() => {
        if (!Array.isArray(moderators)) return [];
        const safeLog = Array.isArray(attendanceLog) ? attendanceLog : [];

        return moderators.map(mod => {
            const modAttendance = safeLog.filter(a => String(a.user_id) === String(mod.id));

            const daysAttended = modAttendance.filter(day => day.check_in).length;
            const totalBonus = modAttendance.reduce((sum, day) => sum + Number(day.bonus || 0), 0);
            const totalMoney = totalBonus;

            const baseSalary = parseFloat(mod.base_salary) || 0;
            const dailyRate = baseSalary > 0 ? (baseSalary / 30) : 0;
            const salaryEarned = Math.floor(daysAttended * dailyRate);

            const finalTotal = salaryEarned + totalMoney;
            const daysAbsent = Math.max(0, 30 - daysAttended);

            const todayStr = getCurrentLocalDate();
            const todayRecord = safeLog.find(a => String(a.user_id) === String(mod.id) && a.date === todayStr);

            return {
                ...mod,
                baseSalary,
                daysAttended,
                daysAbsent,
                totalBonus: totalMoney > 0 ? totalMoney : 0,
                totalDeduction: totalMoney < 0 ? Math.abs(totalMoney) : 0,
                salaryEarned,
                finalTotal,
                todayRecord
            };
        });
    }, [moderators, attendanceLog]);

    // --- Actions ---
    const handleCheckIn = async () => {
        const todayStr = getCurrentLocalDate();
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

        try {
            const result = await attendanceAPI.checkIn(user.id, todayStr, timeStr);
            if (result.alreadyExists) {
                showAlert({ title: 'تم بالفعل', message: 'تم تسجيل حضورك بالفعل اليوم ✅', type: 'success' });
            } else {
                showAlert({ title: 'تم بنجاح', message: 'تم تسجيل الحضور ✅', type: 'success' });
            }
            fetchData();
        } catch (e) {
            console.error(e);
            showAlert({ title: 'خطأ!', message: 'خطأ في تسجيل الحضور', type: 'danger' });
        }
    };

    // تعديل بيانات الموظف
    const handleUpdateData = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);

        try {
            await usersAPI.save({
                id: currentUser.id,
                username: currentUser.username,
                permissions: Array.isArray(currentUser.permissions) ? currentUser.permissions : JSON.parse(currentUser.permissions || '[]'),
                base_salary: isUserAdmin ? formData.get('base_salary') : currentUser.base_salary,
                vodafone_cash: formData.get('vodafone_cash'),
            });
            showAlert({ title: 'تم بنجاح', message: 'تم حفظ البيانات بنجاح ✅', type: 'success' });
            setShowEditModal(false);
            fetchData();
        } catch (error) {
            console.error(error);
            showAlert({ title: 'خطأ!', message: 'فشل الحفظ', type: 'danger' });
        }
    };

    const openBonusModal = (mod) => { setCurrentUser(mod); setBonusAmount(''); setShowBonusModal(true); };
    const submitBonus = async (e) => {
        e.preventDefault();
        if (!bonusAmount) return;
        try {
            await attendanceAPI.addBonus(currentUser.id, getCurrentLocalDate(), Number(bonusAmount));
            setShowBonusModal(false); fetchData(); showAlert({ title: 'تم بنجاح', message: 'تم البونص 💰', type: 'success' });
        } catch (error) {
            console.error(error);
        }
    };

    const openDeductionModal = (mod) => { setCurrentUser(mod); setDeductionAmount(''); setShowDeductionModal(true); };
    const submitDeduction = async (e) => {
        e.preventDefault();
        if (!deductionAmount) return;
        try {
            await attendanceAPI.addBonus(currentUser.id, getCurrentLocalDate(), -Number(deductionAmount));
            setShowDeductionModal(false); fetchData(); showAlert({ title: 'تم بنجاح', message: 'تم الخصم 📉', type: 'success' });
        } catch (error) {
            console.error(error);
        }
    };

    const openHistory = (mod) => { setCurrentUser(mod); setShowHistoryModal(true); };

    const formatTime = (timeStr) => {
        if (!timeStr) return '-';
        const [h, m] = timeStr.split(':');
        const date = new Date();
        date.setHours(h, m);
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    };

    if (loading) return <div className="text-center p-10 text-slate-500">جاري التحميل...</div>;

    return (
        <div className="space-y-8 animate-fade-in pb-20 font-sans text-slate-800">

            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div><h2 className="text-2xl font-extrabold text-slate-800">سجل الحضور والرواتب</h2><p className="text-slate-500 text-sm font-medium mt-1">إدارة فريق العمل</p></div>
                <div className="flex gap-3">
                    {(() => {
                        const safeLog = Array.isArray(attendanceLog) ? attendanceLog : [];
                        const todayStr = getCurrentLocalDate();
                        const myRecord = safeLog.find(a => a.user_id === user.id && a.date === todayStr);
                        if (!myRecord || !myRecord.check_in) {
                            return <button onClick={handleCheckIn} className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:bg-emerald-700 transition flex items-center gap-2"><i className="fa-solid fa-fingerprint"></i> تسجيل حضور</button>;
                        } else {
                            return <div className="bg-emerald-50 text-emerald-700 px-6 py-3 rounded-xl font-bold border border-emerald-200 flex items-center gap-2"><i className="fa-solid fa-check-circle"></i> تم تسجيل حضورك اليوم</div>;
                        }
                    })()}
                </div>
            </div>

            {/* Month Filter */}
            <div className="flex items-center gap-2 bg-white p-4 rounded-xl border border-slate-200 w-fit shadow-sm"><span className="text-sm font-bold text-slate-500">شهر التقرير:</span><input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="input-style !h-auto !py-1 text-sm w-40" /></div>

            {/* Salary Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {salaryReport
                    .filter(mod => isUserAdmin || mod.id === user.id)
                    .map(mod => (
                        <div key={mod.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all group relative overflow-hidden">
                            <div className={`absolute top-0 left-0 w-full h-1.5 ${mod.todayRecord && mod.todayRecord.check_in ? 'bg-emerald-500' : 'bg-slate-300'}`}></div>

                            <div className="flex justify-between items-start mb-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-xl text-slate-500 font-bold border border-slate-200">{mod.username.charAt(0).toUpperCase()}</div>
                                    <div><h3 className="font-extrabold text-lg text-slate-800">{mod.username}</h3><p className="text-xs text-slate-400 font-mono">{mod.vodafone_cash || 'لا يوجد رقم كاش'}</p></div>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={() => openHistory(mod)} className="text-slate-400 hover:text-blue-600 transition p-1" title="سجل الحضور"><i className="fa-solid fa-list-check"></i></button>
                                    {(isUserAdmin || mod.id === user.id) && (
                                        <button onClick={() => { setCurrentUser(mod); setShowEditModal(true); }} className="text-slate-400 hover:text-indigo-600 transition p-1" title="تعديل"><i className="fa-solid fa-pen-to-square"></i></button>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                <div className="flex justify-between text-sm">
                                    <span className="text-slate-500 font-medium">الراتب الأساسي</span>
                                    {mod.baseSalary > 0 ?
                                        <span className="font-bold dir-ltr">{Number(mod.baseSalary).toLocaleString()} <span className="text-[10px]">ج.م</span></span> :
                                        <span className="text-red-500 font-bold text-xs flex items-center gap-1"><i className="fa-solid fa-triangle-exclamation"></i> غير محدد</span>
                                    }
                                </div>
                                <div className="flex justify-between text-sm"><span className="text-slate-500 font-medium">أيام الحضور</span><span className="font-bold text-emerald-600">{mod.daysAttended} <span className="text-[10px] text-slate-400">يوم</span></span></div>
                                <div className="flex justify-between text-sm"><span className="text-slate-500 font-medium">أيام الغياب</span><span className="font-bold text-red-500">{mod.daysAbsent} <span className="text-[10px] text-slate-400">يوم</span></span></div>

                                {mod.totalBonus > 0 && (<div className="flex justify-between text-sm bg-orange-50 p-2 rounded-lg border border-orange-100"><span className="text-orange-700 font-bold flex items-center gap-1"><i className="fa-solid fa-star text-xs"></i> بونص إضافي</span><span className="font-bold text-orange-700 dir-ltr">+{mod.totalBonus} <span className="text-[10px]">ج.م</span></span></div>)}
                                {mod.totalDeduction > 0 && (<div className="flex justify-between text-sm bg-red-50 p-2 rounded-lg border border-red-100"><span className="text-red-700 font-bold flex items-center gap-1"><i className="fa-solid fa-circle-minus text-xs"></i> خصومات</span><span className="font-bold text-red-700 dir-ltr">-{mod.totalDeduction} <span className="text-[10px]">ج.م</span></span></div>)}
                            </div>

                            <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                                <div><p className="text-xs text-slate-400 font-bold mb-1">إجمالي المستحق</p><p className="text-2xl font-black text-slate-800 dir-ltr">{mod.finalTotal.toLocaleString()} <span className="text-sm font-bold text-slate-400">EGP</span></p></div>
                                {isUserAdmin && (
                                    <div className="flex gap-2">
                                        <button onClick={() => openDeductionModal(mod)} className="bg-red-100 text-red-600 w-10 h-10 rounded-xl hover:bg-red-200 transition flex items-center justify-center shadow-sm" title="إضافة خصم"><i className="fa-solid fa-minus"></i></button>
                                        <button onClick={() => openBonusModal(mod)} className="bg-orange-100 text-orange-600 w-10 h-10 rounded-xl hover:bg-orange-200 transition flex items-center justify-center shadow-sm" title="إضافة بونص"><i className="fa-solid fa-plus"></i></button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
                }
            </div>

            {/* --- Modals --- */}

            {/* 1. Edit Data Modal */}
            {showEditModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-8 transform scale-100 transition-all">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-extrabold text-slate-800">{isUserAdmin ? "تعديل بيانات الموظف" : "تحديث بياناتي"}</h3>
                            <button onClick={() => setShowEditModal(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>
                        <form onSubmit={handleUpdateData} className="space-y-5">
                            {isUserAdmin && (<div><label className="label-style">الراتب الشهري (لمدة 30 يوم)</label><input type="number" name="base_salary" defaultValue={currentUser?.base_salary} className="input-style pl-12" placeholder="3000" required /></div>)}
                            <div><label className="label-style">رقم فودافون كاش</label><input type="text" name="vodafone_cash" defaultValue={currentUser?.vodafone_cash} className="input-style font-mono" placeholder="010xxxxxxx" required /></div>
                            <button type="submit" className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition">حفظ التعديلات</button>
                        </form>
                    </div>
                </div>
            )}

            {/* 2. Bonus Modal */}
            {showBonusModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col transform transition-all scale-100 font-sans">
                        <div className="p-6 bg-gradient-to-r from-orange-500 to-amber-500 text-white flex justify-between items-center shadow-md"><h3 className="text-xl font-bold flex items-center gap-2"><i className="fa-solid fa-gift"></i> إضافة بونص</h3><button onClick={() => setShowBonusModal(false)} className="bg-white/20 hover:bg-white/30 p-2 rounded-full transition"><i className="fa-solid fa-xmark"></i></button></div>
                        <div className="p-8 bg-slate-50/50">
                            <form onSubmit={submitBonus} className="space-y-6">
                                <div className="text-center mb-4"><p className="text-slate-500 font-bold text-sm">مكافأة للموظف</p><h4 className="text-xl font-black text-slate-800">{currentUser?.username}</h4></div>
                                <div><label className="label-style">قيمة البونص</label><div className="relative"><input type="number" value={bonusAmount} onChange={(e) => setBonusAmount(e.target.value)} className="input-style pl-12 text-orange-600 font-bold text-lg" placeholder="0.00" autoFocus required /><span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">EGP</span></div></div>
                                <button type="submit" className="w-full bg-orange-500 text-white py-3.5 rounded-xl font-bold hover:bg-orange-600 shadow-lg shadow-orange-200 transition hover:-translate-y-0.5">تأكيد الإضافة</button>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* 3. Deduction Modal */}
            {showDeductionModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col transform transition-all scale-100 font-sans">
                        <div className="p-6 bg-gradient-to-r from-red-500 to-pink-600 text-white flex justify-between items-center shadow-md"><h3 className="text-xl font-bold flex items-center gap-2"><i className="fa-solid fa-circle-minus"></i> إضافة خصم</h3><button onClick={() => setShowDeductionModal(false)} className="bg-white/20 hover:bg-white/30 p-2 rounded-full transition"><i className="fa-solid fa-xmark"></i></button></div>
                        <div className="p-8 bg-slate-50/50">
                            <form onSubmit={submitDeduction} className="space-y-6">
                                <div className="text-center mb-4"><p className="text-slate-500 font-bold text-sm">خصم من الموظف</p><h4 className="text-xl font-black text-slate-800">{currentUser?.username}</h4></div>
                                <div><label className="label-style">قيمة الخصم</label><div className="relative"><input type="number" value={deductionAmount} onChange={(e) => setDeductionAmount(e.target.value)} className="input-style pl-12 text-red-600 font-bold text-lg" placeholder="0.00" autoFocus required /><span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">EGP</span></div></div>
                                <button type="submit" className="w-full bg-red-500 text-white py-3.5 rounded-xl font-bold hover:bg-red-600 shadow-lg shadow-red-200 transition hover:-translate-y-0.5">تأكيد الخصم</button>
                            </form>
                        </div>
                    </div>
                </div>
            )}

            {/* 4. History Modal */}
            {showHistoryModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col h-[90vh] font-sans">
                        <div className="p-6 bg-white border-b border-slate-100 flex justify-between items-center">
                            <div><h3 className="text-xl font-extrabold text-slate-800">سجل الحضور التفصيلي</h3><p className="text-slate-500 text-xs font-bold">{currentUser?.username}</p></div>
                            <button onClick={() => setShowHistoryModal(false)} className="bg-slate-100 p-2.5 rounded-full text-slate-500 hover:bg-slate-200 transition"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>

                        <div className="p-4 bg-slate-50 border-b border-slate-200 flex gap-4 overflow-x-auto">
                            <div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-500">من:</span><input type="date" value={historyFilter.from} onChange={e => setHistoryFilter({ ...historyFilter, from: e.target.value })} className="input-style !py-1 !text-sm" /></div>
                            <div className="flex items-center gap-2"><span className="text-xs font-bold text-slate-500">إلى:</span><input type="date" value={historyFilter.to} onChange={e => setHistoryFilter({ ...historyFilter, to: e.target.value })} className="input-style !py-1 !text-sm" /></div>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                            <table className="w-full text-sm text-right">
                                <thead className="text-xs text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                                    <tr>
                                        <th className="px-4 py-3 rounded-tr-lg">التاريخ</th>
                                        <th className="px-4 py-3">وقت الحضور</th>
                                        <th className="px-4 py-3">بونص</th>
                                        <th className="px-4 py-3 rounded-tl-lg">خصم</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {historyData.length === 0 ? <tr><td colSpan="4" className="text-center py-10 text-slate-400">لا توجد سجلات في هذه الفترة</td></tr> :
                                        historyData.map((record) => (
                                            <tr key={record.id} className="hover:bg-slate-50 transition">
                                                <td className="px-4 py-4 font-bold text-slate-700">{new Date(record.date).toLocaleDateString('ar-EG')}</td>
                                                <td className="px-4 py-4 font-mono text-emerald-600">{formatTime(record.check_in)}</td>
                                                <td className="px-4 py-4 text-orange-600 font-bold">{Number(record.bonus) > 0 ? `+${Number(record.bonus)}` : '-'}</td>
                                                <td className="px-4 py-4 text-red-600 font-bold">{Number(record.bonus) < 0 ? `${Number(record.bonus)}` : '-'}</td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* CSS Styles Injection */}
            <style>{`
                .label-style { @apply block text-sm font-extrabold text-slate-800 mb-2 ml-1 tracking-wide; }
                .input-style { @apply w-full bg-white border-2 border-slate-300 text-slate-900 text-sm font-bold rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 block p-3.5 transition-all outline-none placeholder-slate-400 shadow-sm; }
            `}
            </style>
        </div>
    );
}