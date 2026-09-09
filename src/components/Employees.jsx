import { useState, useMemo, useEffect, useRef } from 'react';
import { employeesAPI, salaryPaymentsAPI, employeeActionsAPI } from '../services/api';
import { supabase } from '../lib/supabase';
import { useConfirm } from './ConfirmDialog';

const DAY_NAMES = { saturday: 'السبت', sunday: 'الأحد', monday: 'الاثنين', tuesday: 'الثلاثاء', wednesday: 'الأربعاء', thursday: 'الخميس', friday: 'الجمعة' };
const DAY_EN = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const PAY_CYCLES = { weekly: 'أسبوعي', biweekly: 'نصف شهري', monthly: 'شهري' };

export default function Employees() {
    useEffect(() => { window.scrollTo(0, 0); }, []);

    const [employees, setEmployees] = useState([]);
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingEmp, setEditingEmp] = useState(null);
    const [filterActive, setFilterActive] = useState('all');
    const [selectedEmp, setSelectedEmp] = useState(null);
    const [empPayments, setEmpPayments] = useState([]);
    const [empActions, setEmpActions] = useState([]);
    const [confirmDelete, setConfirmDelete] = useState(null); // emp id to delete

    // Quick action modals
    const [quickAction, setQuickAction] = useState(null); // {type: 'deduction'|'absence'|'bonus'|'pay', emp}
    const [quickAmount, setQuickAmount] = useState('');
    const [quickDesc, setQuickDesc] = useState('');
    const [quickDate, setQuickDate] = useState(new Date().toISOString().split('T')[0]);
    const { showAlert } = useConfirm();

    const emptyForm = { name: '', phone: '', role: '', baseSalary: 0, bonus: 0, deductions: 0, absenceDays: 0, absenceDeductionPerDay: 0, notes: '', joinDate: new Date().toISOString().split('T')[0], payDay: 'thursday', payCycle: 'weekly' };
    const [form, setForm] = useState(emptyForm);

    const loadData = async () => {
        try {
            const [emps, pays] = await Promise.all([employeesAPI.getAll(), salaryPaymentsAPI.getAll()]);
            setEmployees(emps);
            setPayments(pays);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    useEffect(() => { loadData(); }, []);

    // Supabase Realtime auto‑refresh
    useEffect(() => {
        const timerRef = { current: null };
        const debounceRefresh = () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => loadData(), 600);
        };
        const ch = supabase.channel('emp-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, debounceRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'salary_payments' }, debounceRefresh)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'employee_actions' }, debounceRefresh)
            .subscribe();
        return () => { supabase.removeChannel(ch); if (timerRef.current) clearTimeout(timerRef.current); };
    }, []);

    const handleChange = (f, v) => setForm(p => ({ ...p, [f]: v }));

    const openAdd = () => { setEditingEmp(null); setForm(emptyForm); setShowModal(true); };
    const openEdit = (emp) => {
        setEditingEmp(emp);
        setForm({ name: emp.name, phone: emp.phone||'', role: emp.role||'', baseSalary: emp.baseSalary||0, bonus: emp.bonus||0, deductions: emp.deductions||0, absenceDays: emp.absenceDays||0, absenceDeductionPerDay: emp.absenceDeductionPerDay||0, notes: emp.notes||'', joinDate: emp.joinDate||'', payDay: emp.payDay||'thursday', payCycle: emp.payCycle||'weekly' });
        setShowModal(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) { showAlert({ title: 'خطأ', message: 'اسم الموظف مطلوب', type: 'warning' }); return; }
        try {
            if (editingEmp) await employeesAPI.update(editingEmp.id, form);
            else await employeesAPI.create(form);
            setShowModal(false); setEditingEmp(null); setForm(emptyForm); await loadData();
        } catch (err) { console.error(err); showAlert({ title: 'خطأ!', message: 'حدث خطأ', type: 'danger' }); }
    };

    const handleDelete = async (id) => {
        try { await employeesAPI.delete(id); if (selectedEmp?.id === id) setSelectedEmp(null); setConfirmDelete(null); await loadData(); } catch (err) { console.error(err); }
    };

    const toggleActive = async (emp) => {
        try { await employeesAPI.update(emp.id, { isActive: !emp.isActive }); await loadData(); } catch (err) { console.error(err); }
    };

    // Quick actions handler
    const handleQuickAction = async () => {
        if (!quickAction) return;
        const { type, emp } = quickAction;
        const amount = Number(quickAmount) || 0;
        if (amount <= 0 && type !== 'absence') { showAlert({ title: 'خطأ', message: 'أدخل مبلغ صحيح', type: 'warning' }); return; }

        try {
            if (type === 'pay') {
                await salaryPaymentsAPI.create({ employeeId: emp.id, amount, notes: quickDesc, paymentDate: quickDate });
            } else if (type === 'deduction') {
                if (!quickDesc.trim()) { showAlert({ title: 'خطأ', message: 'أدخل سبب الخصم', type: 'warning' }); return; }
                await employeeActionsAPI.create({ employeeId: emp.id, actionType: 'deduction', amount, description: quickDesc, actionDate: quickDate });
                await employeesAPI.update(emp.id, { deductions: (emp.deductions || 0) + amount });
            } else if (type === 'absence') {
                const days = Number(quickAmount) || 1;
                await employeeActionsAPI.create({ employeeId: emp.id, actionType: 'absence', amount: days, description: quickDesc || 'غياب', actionDate: quickDate });
                await employeesAPI.update(emp.id, { absenceDays: (emp.absenceDays || 0) + days });
            } else if (type === 'bonus') {
                if (!quickDesc.trim()) { showAlert({ title: 'خطأ', message: 'أدخل سبب المكافأة', type: 'warning' }); return; }
                await employeeActionsAPI.create({ employeeId: emp.id, actionType: 'bonus', amount, description: quickDesc, actionDate: quickDate });
                await employeesAPI.update(emp.id, { bonus: (emp.bonus || 0) + amount });
            }
            setQuickAction(null); setQuickAmount(''); setQuickDesc(''); setQuickDate(new Date().toISOString().split('T')[0]);
            await loadData();
        } catch (err) { console.error(err); showAlert({ title: 'خطأ!', message: 'حدث خطأ', type: 'danger' }); }
    };

    // Open details
    const openDetails = async (emp) => {
        setSelectedEmp(emp);
        try {
            const [p, a] = await Promise.all([salaryPaymentsAPI.getByEmployee(emp.id), employeeActionsAPI.getByEmployee(emp.id)]);
            setEmpPayments(p);
            setEmpActions(a);
        } catch (err) { console.error(err); }
    };

    const calcNet = (emp) => {
        const absenceTotal = (emp.absenceDays || 0) * (emp.absenceDeductionPerDay || 0);
        return (emp.baseSalary || 0) + (emp.bonus || 0) - (emp.deductions || 0) - absenceTotal;
    };

    const getTotalPaid = (empId) => payments.filter(p => p.employeeId === empId).reduce((s, p) => s + Number(p.amount || 0), 0);

    // Today's pay day alerts
    const todayDay = DAY_EN[new Date().getDay()];
    const payDayAlerts = useMemo(() => employees.filter(e => e.isActive && e.payDay === todayDay), [employees, todayDay]);

    const filtered = useMemo(() => {
        return employees.filter(emp => {
            const matchActive = filterActive === 'all' ? true : filterActive === 'active' ? emp.isActive : !emp.isActive;
            const t = searchTerm.toLowerCase();
            const matchSearch = !t || emp.name.toLowerCase().includes(t) || (emp.phone && emp.phone.includes(t)) || (emp.role && emp.role.toLowerCase().includes(t));
            return matchActive && matchSearch;
        });
    }, [employees, filterActive, searchTerm]);

    const stats = useMemo(() => {
        const active = employees.filter(e => e.isActive);
        const totalSalaries = active.reduce((s, e) => s + calcNet(e), 0);
        const totalPaid = active.reduce((s, e) => s + getTotalPaid(e.id), 0);
        return { total: employees.length, active: active.length, totalSalaries, totalPaid };
    }, [employees, payments]);

    if (loading) return <div className="text-center p-20 text-slate-400"><i className="fa-solid fa-spinner fa-spin text-3xl"></i></div>;

    const quickConfig = {
        pay: { title: 'تسجيل قبض', icon: 'fa-money-bill-wave', color: 'emerald', label: 'المبلغ المقبوض', placeholder: 'مثل: 500' },
        deduction: { title: 'إضافة خصم', icon: 'fa-minus-circle', color: 'red', label: 'قيمة الخصم', placeholder: 'مثل: 50' },
        absence: { title: 'تسجيل غياب', icon: 'fa-calendar-xmark', color: 'orange', label: 'عدد الأيام', placeholder: '1' },
        bonus: { title: 'إضافة مكافأة', icon: 'fa-gift', color: 'blue', label: 'قيمة المكافأة', placeholder: 'مثل: 100' },
    };

    return (
        <div className="space-y-4 md:space-y-6 animate-fade-in pb-20 font-sans text-slate-800">

            {/* Header */}
            <div className="bg-gradient-to-r from-violet-700 to-purple-600 rounded-2xl p-5 md:p-8 text-white relative overflow-hidden shadow-xl">
                <div className="absolute -left-10 -bottom-10 text-[120px] opacity-10"><i className="fa-solid fa-id-card-clip"></i></div>
                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="bg-white/20 p-3 rounded-xl"><i className="fa-solid fa-id-card-clip text-2xl"></i></div>
                        <div>
                            <h2 className="text-xl md:text-2xl font-extrabold">إدارة الموظفين</h2>
                            <p className="text-purple-100 text-xs md:text-sm">المرتبات والمكافآت والخصومات والغياب</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-3 mt-5">
                        <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-4 py-3 border border-white/20">
                            <p className="text-purple-100 text-[10px] font-bold mb-1">الموظفين</p>
                            <p className="text-xl font-black">{stats.active} <span className="text-sm opacity-60">/ {stats.total}</span></p>
                        </div>
                        <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-4 py-3 border border-white/20">
                            <p className="text-purple-100 text-[10px] font-bold mb-1">إجمالي المرتبات</p>
                            <p className="text-xl font-black dir-ltr">{stats.totalSalaries.toLocaleString()} <span className="text-sm opacity-60">ج.م</span></p>
                        </div>
                        <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-4 py-3 border border-white/20">
                            <p className="text-purple-100 text-[10px] font-bold mb-1">إجمالي المقبوض</p>
                            <p className="text-xl font-black text-emerald-300 dir-ltr">{stats.totalPaid.toLocaleString()}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* PAY DAY ALERTS */}
            {payDayAlerts.length > 0 && (
                <div className="bg-amber-50 p-4 rounded-2xl border-2 border-amber-300 shadow-sm animate-fade-in">
                    <div className="flex items-center gap-2 mb-3">
                        <div className="bg-amber-400 text-white p-2 rounded-lg"><i className="fa-solid fa-bell fa-shake"></i></div>
                        <h3 className="font-extrabold text-amber-800">💰 موظفين ميعاد قبضهم النهارده!</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {payDayAlerts.map(emp => {
                            const net = calcNet(emp);
                            const paid = getTotalPaid(emp.id);
                            const remaining = net - paid;
                            return (
                                <div key={emp.id} className="bg-white p-3 rounded-xl border border-amber-200 flex items-center gap-3 shadow-sm">
                                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 text-white flex items-center justify-center font-bold text-sm">{emp.name?.charAt(0)}</div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-sm text-slate-800 truncate">{emp.name}</p>
                                        <p className="text-[10px] text-slate-500">صافي: {net.toLocaleString()} | مقبوض: {paid.toLocaleString()} | <span className={remaining > 0 ? 'text-red-600 font-bold' : 'text-emerald-600 font-bold'}>متبقي: {remaining.toLocaleString()}</span></p>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); setQuickAction({type:'pay', emp}); setQuickAmount(remaining > 0 ? String(remaining) : ''); }}
                                        className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-emerald-700 transition flex-shrink-0">
                                        <i className="fa-solid fa-money-bill-wave ml-1"></i> قبّض
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Toolbar */}
            <div className="bg-white p-3 md:p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-3 items-center justify-between sticky top-2 z-30 bg-white/95 backdrop-blur-md">
                <div className="relative w-full md:w-80">
                    <i className="fa-solid fa-search absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input type="text" className="w-full bg-white border-2 border-slate-200 text-slate-900 text-sm font-semibold rounded-xl pr-10 p-3 focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all placeholder-slate-400" placeholder="بحث بالاسم أو الرقم أو الوظيفة..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <div className="flex gap-2 w-full md:w-auto flex-wrap">
                    <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
                        {[{id:'all',label:'الكل'},{id:'active',label:'نشط'},{id:'inactive',label:'متوقف'}].map(f => (
                            <button key={f.id} onClick={() => setFilterActive(f.id)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${filterActive === f.id ? 'bg-purple-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{f.label}</button>
                        ))}
                    </div>
                    <button onClick={openAdd} className="bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-sm px-5 py-2.5 shadow-lg shadow-purple-200 transition-all flex items-center gap-2">
                        <i className="fa-solid fa-plus"></i> <span className="hidden sm:inline">موظف جديد</span>
                    </button>
                </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                {filtered.length === 0 ? (
                    <div className="col-span-full bg-white rounded-2xl border border-slate-200 p-16 text-center text-slate-400">
                        <i className="fa-solid fa-users-slash text-4xl mb-4 block opacity-30"></i>
                        <p className="font-bold text-lg">{searchTerm ? 'لا يوجد نتائج' : 'لا يوجد موظفين'}</p>
                    </div>
                ) : filtered.map(emp => {
                    const net = calcNet(emp);
                    const totalPaid = getTotalPaid(emp.id);
                    const remaining = net - totalPaid;
                    const isPayDay = emp.payDay === todayDay;
                    return (
                        <div key={emp.id} onClick={() => openDetails(emp)}
                            className={`bg-white rounded-2xl border-2 p-4 cursor-pointer transition-all hover:shadow-lg ${isPayDay && emp.isActive ? 'border-amber-300 ring-2 ring-amber-100' : emp.isActive ? 'border-slate-200 hover:border-purple-300' : 'border-slate-100 opacity-60'}`}>
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-sm ${emp.isActive ? 'bg-gradient-to-br from-purple-600 to-violet-700' : 'bg-slate-400'}`}>{emp.name?.charAt(0).toUpperCase()}</div>
                                    <div className="min-w-0">
                                        <h3 className="font-extrabold text-sm text-slate-800 truncate">{emp.name}</h3>
                                        <p className="text-[10px] text-slate-400">{emp.role || '-'} • {PAY_CYCLES[emp.payCycle] || 'أسبوعي'} • {DAY_NAMES[emp.payDay] || emp.payDay}</p>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${emp.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>{emp.isActive ? 'نشط' : 'متوقف'}</span>
                                    {isPayDay && emp.isActive && <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700 border border-amber-200 animate-pulse">💰 يوم القبض</span>}
                                </div>
                            </div>

                            <div className="space-y-1.5 text-xs mb-3">
                                <div className="flex justify-between"><span className="text-slate-500">صافي المرتب</span><span className="font-bold text-purple-700 dir-ltr">{net.toLocaleString()}</span></div>
                                <div className="flex justify-between"><span className="text-emerald-600">مقبوض</span><span className="font-bold text-emerald-600 dir-ltr">{totalPaid.toLocaleString()}</span></div>
                                <div className="flex justify-between border-t border-dashed border-slate-200 pt-1.5"><span className={`font-bold ${remaining > 0 ? 'text-red-600' : 'text-emerald-600'}`}>متبقي</span><span className={`font-black ${remaining > 0 ? 'text-red-600' : 'text-emerald-600'} dir-ltr`}>{remaining.toLocaleString()}</span></div>
                            </div>

                            {/* Quick Action Buttons */}
                            <div className="flex gap-1.5 pt-2 border-t border-slate-100" onClick={e => e.stopPropagation()}>
                                <button onClick={() => { setQuickAction({type:'pay',emp}); setQuickAmount(''); setQuickDate(new Date().toISOString().split('T')[0]); }} className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 transition flex items-center justify-center gap-1"><i className="fa-solid fa-money-bill-wave"></i> قبّض</button>
                                <button onClick={() => { setQuickAction({type:'deduction',emp}); setQuickAmount(''); setQuickDate(new Date().toISOString().split('T')[0]); }} className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-100 transition flex items-center justify-center gap-1"><i className="fa-solid fa-minus-circle"></i> خصم</button>
                                <button onClick={() => { setQuickAction({type:'absence',emp}); setQuickAmount('1'); setQuickDate(new Date().toISOString().split('T')[0]); }} className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-100 transition flex items-center justify-center gap-1"><i className="fa-solid fa-calendar-xmark"></i> غياب</button>
                                <button onClick={() => { setQuickAction({type:'bonus',emp}); setQuickAmount(''); setQuickDate(new Date().toISOString().split('T')[0]); }} className="flex-1 py-1.5 rounded-lg text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-100 transition flex items-center justify-center gap-1"><i className="fa-solid fa-gift"></i> مكافأة</button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ============ QUICK ACTION MODAL ============ */}
            {quickAction && (() => {
                const c = quickConfig[quickAction.type];
                const colorClasses = { emerald: 'from-emerald-600 to-green-700', red: 'from-red-600 to-rose-700', orange: 'from-orange-500 to-amber-600', blue: 'from-blue-600 to-indigo-700' };
                return (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-fade-in" onClick={() => setQuickAction(null)}>
                        <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className={`p-5 bg-gradient-to-r ${colorClasses[c.color]} text-white flex justify-between items-center`}>
                                <h3 className="text-lg font-bold flex items-center gap-2"><i className={`fa-solid ${c.icon}`}></i> {c.title}</h3>
                                <button onClick={() => setQuickAction(null)} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition"><i className="fa-solid fa-xmark"></i></button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="flex items-center gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                                    <div className="w-9 h-9 rounded-lg bg-purple-600 text-white flex items-center justify-center font-bold text-sm">{quickAction.emp.name?.charAt(0)}</div>
                                    <div><p className="font-bold text-sm">{quickAction.emp.name}</p><p className="text-[10px] text-slate-400">{quickAction.emp.role || ''}</p></div>
                                </div>
                                <div>
                                    <label className="block text-sm font-extrabold text-slate-800 mb-1.5">{c.label}</label>
                                    <input type="number" min="0" value={quickAmount} onChange={e => setQuickAmount(e.target.value)} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3 font-bold text-lg focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all dir-ltr text-right" placeholder={c.placeholder} autoFocus />
                                </div>
                                <div>
                                    <label className="block text-sm font-extrabold text-slate-800 mb-1.5">{quickAction.type === 'deduction' || quickAction.type === 'bonus' ? 'السبب *' : 'ملاحظة (اختياري)'}</label>
                                    <input type="text" value={quickDesc} onChange={e => setQuickDesc(e.target.value)} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3 font-bold text-sm focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all" placeholder={quickAction.type === 'deduction' ? 'سبب الخصم...' : quickAction.type === 'bonus' ? 'سبب المكافأة...' : 'ملاحظة...'} required={quickAction.type === 'deduction' || quickAction.type === 'bonus'} />
                                </div>
                                <div>
                                    <label className="block text-sm font-extrabold text-slate-800 mb-1.5">التاريخ</label>
                                    <input type="date" value={quickDate} onChange={e => setQuickDate(e.target.value)} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3 font-bold text-sm focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all" />
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={() => setQuickAction(null)} className="flex-1 py-3 rounded-xl font-bold text-slate-600 bg-white border-2 border-slate-200 hover:bg-slate-50 transition">إلغاء</button>
                                    <button onClick={handleQuickAction} className={`flex-1 bg-gradient-to-r ${colorClasses[c.color]} text-white py-3 rounded-xl font-bold transition shadow-lg flex items-center justify-center gap-2`}>
                                        <i className="fa-solid fa-check"></i> تأكيد
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* ============ DETAILS MODAL ============ */}
            {selectedEmp && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in" onClick={() => setSelectedEmp(null)}>
                    <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="p-5 bg-gradient-to-r from-violet-700 to-purple-600 text-white flex justify-between items-start flex-shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-xl font-black">{selectedEmp.name?.charAt(0)}</div>
                                <div>
                                    <h3 className="text-lg font-extrabold">{selectedEmp.name}</h3>
                                    <p className="text-purple-200 text-xs">{selectedEmp.role || '-'} • {selectedEmp.phone || ''}</p>
                                </div>
                            </div>
                            <button onClick={() => setSelectedEmp(null)} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition"><i className="fa-solid fa-xmark"></i></button>
                        </div>

                        <div className="p-5 overflow-y-auto flex-1 space-y-4">
                            {/* Salary Breakdown */}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center"><span className="text-[10px] text-slate-500 font-bold block">أساسي</span><span className="text-base font-black text-slate-800">{Number(selectedEmp.baseSalary||0).toLocaleString()}</span></div>
                                <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200 text-center"><span className="text-[10px] text-emerald-600 font-bold block">مكافآت</span><span className="text-base font-black text-emerald-700">+{Number(selectedEmp.bonus||0).toLocaleString()}</span></div>
                                <div className="bg-red-50 p-3 rounded-xl border border-red-200 text-center"><span className="text-[10px] text-red-600 font-bold block">خصومات</span><span className="text-base font-black text-red-600">-{Number(selectedEmp.deductions||0).toLocaleString()}</span></div>
                                <div className="bg-orange-50 p-3 rounded-xl border border-orange-200 text-center"><span className="text-[10px] text-orange-600 font-bold block">غياب ({selectedEmp.absenceDays||0} يوم)</span><span className="text-base font-black text-orange-600">-{((selectedEmp.absenceDays||0)*(selectedEmp.absenceDeductionPerDay||0)).toLocaleString()}</span></div>
                            </div>

                            <div className="bg-purple-50 p-4 rounded-xl border border-purple-200 flex justify-between items-center">
                                <span className="font-bold text-purple-700">صافي المرتب</span>
                                <span className="font-black text-xl text-purple-700 dir-ltr">{calcNet(selectedEmp).toLocaleString()} ج.م</span>
                            </div>

                            {/* Payments Log */}
                            <div>
                                <h4 className="font-bold text-sm text-slate-700 mb-2 flex items-center gap-2"><i className="fa-solid fa-money-bill-wave text-emerald-500"></i> سجل القبض</h4>
                                {empPayments.length === 0 ? (
                                    <p className="text-xs text-slate-400 text-center p-4 bg-slate-50 rounded-xl">لا يوجد سجلات قبض</p>
                                ) : (
                                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                        {empPayments.map(p => (
                                            <div key={p.id} className="bg-emerald-50 p-2.5 rounded-xl border border-emerald-100 flex justify-between items-center text-xs">
                                                <div><span className="font-bold text-emerald-700">{Number(p.amount).toLocaleString()} ج.م</span> <span className="text-slate-400 mr-2">{p.notes && `— ${p.notes}`}</span></div>
                                                <span className="text-slate-400 font-mono text-[10px]">{new Date(p.paymentDate).toLocaleDateString('en-GB')}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Actions Log */}
                            <div>
                                <h4 className="font-bold text-sm text-slate-700 mb-2 flex items-center gap-2"><i className="fa-solid fa-list-check text-blue-500"></i> سجل الإجراءات</h4>
                                {empActions.length === 0 ? (
                                    <p className="text-xs text-slate-400 text-center p-4 bg-slate-50 rounded-xl">لا يوجد إجراءات</p>
                                ) : (
                                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                        {empActions.map(a => {
                                            const colors = { deduction: 'bg-red-50 border-red-100 text-red-700', absence: 'bg-orange-50 border-orange-100 text-orange-700', bonus: 'bg-blue-50 border-blue-100 text-blue-700' };
                                            const labels = { deduction: '🔻 خصم', absence: '📅 غياب', bonus: '🎁 مكافأة' };
                                            return (
                                                <div key={a.id} className={`p-2.5 rounded-xl border flex justify-between items-center text-xs ${colors[a.actionType] || 'bg-slate-50 border-slate-100'}`}>
                                                    <div><span className="font-bold">{labels[a.actionType] || a.actionType}</span> — {a.actionType === 'absence' ? `${a.amount} يوم` : `${Number(a.amount).toLocaleString()} ج.م`} {a.description && <span className="text-slate-500">({a.description})</span>}</div>
                                                    <span className="text-slate-400 font-mono text-[10px]">{new Date(a.actionDate).toLocaleDateString('en-GB')}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-2 pt-2">
                                <button onClick={() => { openEdit(selectedEmp); setSelectedEmp(null); }} className="flex-1 bg-purple-600 text-white px-4 py-2.5 rounded-xl font-bold hover:bg-purple-700 shadow transition flex items-center justify-center gap-2 text-sm"><i className="fa-solid fa-pen"></i> تعديل</button>
                                <button onClick={() => toggleActive(selectedEmp)} className="bg-white text-slate-600 px-4 py-2.5 rounded-xl font-bold border-2 border-slate-200 hover:bg-slate-50 transition text-sm">{selectedEmp.isActive ? '⏸ إيقاف' : '▶️ تفعيل'}</button>
                                <button onClick={() => { setConfirmDelete(selectedEmp.id); }} className="bg-white text-red-600 px-4 py-2.5 rounded-xl font-bold border-2 border-red-200 hover:bg-red-50 transition text-sm"><i className="fa-solid fa-trash"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ============ ADD/EDIT MODAL ============ */}
            {showModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-fade-in" onClick={() => setShowModal(false)}>
                    <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-5 bg-gradient-to-r from-purple-600 to-violet-700 text-white flex justify-between items-center flex-shrink-0">
                            <h3 className="text-lg font-bold flex items-center gap-2"><i className={`fa-solid ${editingEmp ? 'fa-user-pen' : 'fa-user-plus'}`}></i> {editingEmp ? 'تعديل موظف' : 'موظف جديد'}</h3>
                            <button onClick={() => setShowModal(false)} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition"><i className="fa-solid fa-xmark"></i></button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-5 md:p-6 space-y-3 overflow-y-auto flex-1">
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="block text-xs font-extrabold text-slate-800 mb-1">الاسم *</label><input type="text" value={form.name} onChange={e => handleChange('name',e.target.value)} className="w-full border-2 border-slate-200 rounded-xl p-2.5 font-bold text-sm focus:border-purple-600 outline-none" required /></div>
                                <div><label className="block text-xs font-extrabold text-slate-800 mb-1">الوظيفة</label><input type="text" value={form.role} onChange={e => handleChange('role',e.target.value)} className="w-full border-2 border-slate-200 rounded-xl p-2.5 font-bold text-sm focus:border-purple-600 outline-none" /></div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="block text-xs font-extrabold text-slate-800 mb-1">الهاتف</label><input type="tel" value={form.phone} onChange={e => handleChange('phone',e.target.value)} className="w-full border-2 border-slate-200 rounded-xl p-2.5 font-bold text-sm focus:border-purple-600 outline-none font-mono" /></div>
                                <div><label className="block text-xs font-extrabold text-slate-800 mb-1">تاريخ الانضمام</label><input type="date" value={form.joinDate} onChange={e => handleChange('joinDate',e.target.value)} className="w-full border-2 border-slate-200 rounded-xl p-2.5 font-bold text-sm focus:border-purple-600 outline-none" /></div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="block text-xs font-extrabold text-slate-800 mb-1">المرتب الأساسي</label><input type="number" min="0" value={form.baseSalary} onChange={e => handleChange('baseSalary',Number(e.target.value))} className="w-full border-2 border-slate-200 rounded-xl p-2.5 font-bold text-sm focus:border-purple-600 outline-none dir-ltr text-right" /></div>
                                <div><label className="block text-xs font-extrabold text-slate-800 mb-1">يوم القبض</label>
                                    <select value={form.payDay} onChange={e => handleChange('payDay',e.target.value)} className="w-full border-2 border-slate-200 rounded-xl p-2.5 font-bold text-sm focus:border-purple-600 outline-none">
                                        {Object.entries(DAY_NAMES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div><label className="block text-xs font-extrabold text-slate-800 mb-1">مدة القبض</label>
                                    <select value={form.payCycle} onChange={e => handleChange('payCycle',e.target.value)} className="w-full border-2 border-slate-200 rounded-xl p-2.5 font-bold text-sm focus:border-purple-600 outline-none">
                                        {Object.entries(PAY_CYCLES).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div><label className="block text-xs font-extrabold text-slate-800 mb-1">خصم يوم الغياب (ج.م)</label><input type="number" min="0" value={form.absenceDeductionPerDay} onChange={e => handleChange('absenceDeductionPerDay',Number(e.target.value))} className="w-full border-2 border-slate-200 rounded-xl p-2.5 font-bold text-sm focus:border-purple-600 outline-none dir-ltr text-right" /></div>
                            <div><label className="block text-xs font-extrabold text-slate-800 mb-1">ملاحظات</label><textarea value={form.notes} onChange={e => handleChange('notes',e.target.value)} rows="2" className="w-full border-2 border-slate-200 rounded-xl p-2.5 font-semibold text-sm focus:border-purple-600 outline-none resize-none"></textarea></div>

                            <div className="bg-purple-50 p-3 rounded-xl border border-purple-200 flex justify-between items-center">
                                <span className="font-bold text-purple-700 text-sm">صافي المرتب</span>
                                <span className="font-black text-lg text-purple-700 dir-ltr">{calcNet(form).toLocaleString()} ج.م</span>
                            </div>

                            <div className="flex gap-3 pt-1">
                                <button type="button" onClick={() => setShowModal(false)} className="flex-1 py-2.5 rounded-xl font-bold text-slate-600 bg-white border-2 border-slate-200 hover:bg-slate-50 transition">إلغاء</button>
                                <button type="submit" className="flex-1 bg-purple-600 text-white py-2.5 rounded-xl font-bold hover:bg-purple-700 shadow-lg shadow-purple-200 transition flex items-center justify-center gap-2">
                                    <i className={`fa-solid ${editingEmp ? 'fa-check' : 'fa-plus'}`}></i> {editingEmp ? 'حفظ' : 'إضافة'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ============ CONFIRM DELETE MODAL ============ */}
            {confirmDelete && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[80] p-4 animate-fade-in" onClick={() => setConfirmDelete(null)}>
                    <div className="bg-white rounded-3xl w-full max-w-xs shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="p-6 text-center space-y-4">
                            <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center"><i className="fa-solid fa-trash text-2xl text-red-500"></i></div>
                            <h3 className="font-extrabold text-lg text-slate-800">حذف الموظف؟</h3>
                            <p className="text-sm text-slate-500">سيتم حذف جميع البيانات نهائياً</p>
                            <div className="flex gap-3">
                                <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 rounded-xl font-bold text-slate-600 bg-white border-2 border-slate-200 hover:bg-slate-50 transition">إلغاء</button>
                                <button onClick={() => { handleDelete(confirmDelete); setSelectedEmp(null); }} className="flex-1 py-2.5 rounded-xl font-bold text-white bg-red-600 hover:bg-red-700 transition shadow-lg">حذف</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <style>{`.animate-fade-in{animation:fadeIn .3s ease-out forwards}@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
        </div>
    );
}
