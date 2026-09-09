import { useState, useMemo, useEffect } from 'react';
import { useData } from '../context/DataContext';
import { customersAPI, salesAPI } from '../services/api';
import { useConfirm } from './ConfirmDialog';

export default function Clients() {
    useEffect(() => { window.scrollTo(0, 0); }, []);

    const { sales: ctxSales, customers: ctxCustomers, refreshData } = useData();

    const [sales, setSales] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortOption, setSortOption] = useState('ordersCount');
    const [selectedClient, setSelectedClient] = useState(null);
    const [editingClient, setEditingClient] = useState(null);
    const [visibleCount, setVisibleCount] = useState(25);
    const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
    const { showConfirm, showAlert } = useConfirm();

    useEffect(() => {
        setSales(ctxSales);
        setCustomers(ctxCustomers);
    }, [ctxSales, ctxCustomers]);

    const copyToClipboard = (text) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
    };

    // --- Build enriched client list from customers + their sales ---
    const clientsList = useMemo(() => {
        return customers.map(cust => {
            const custSales = sales.filter(s => s.customerId === cust.id);
            const totalSpent = custSales.reduce((sum, s) => sum + Number(s.finalPrice || s.sellingPrice || 0), 0);

            // Count renewals: sales with renewalSourceId
            const renewalCount = custSales.filter(s => s.renewalSourceId).length;

            // Get unique products
            const productNames = [...new Set(custSales.map(s => s.productName).filter(Boolean))];

            // Latest sale & expiry
            let lastSale = null;
            let latestExpiry = null;
            custSales.forEach(s => {
                if (!lastSale || new Date(s.date) > new Date(lastSale.date)) {
                    lastSale = s;
                }
                if (s.expiryDate && (!latestExpiry || new Date(s.expiryDate) > new Date(latestExpiry))) {
                    latestExpiry = s.expiryDate;
                }
            });

            return {
                ...cust,
                totalSpent,
                ordersCount: custSales.length,
                renewalCount,
                productNames,
                history: custSales.sort((a, b) => new Date(b.date) - new Date(a.date)),
                lastSale,
                expiryDate: latestExpiry
            };
        });
    }, [customers, sales]);

    // Sort
    const sortedClients = useMemo(() => {
        let result = [...clientsList];
        if (sortOption === 'totalSpent') result.sort((a, b) => b.totalSpent - a.totalSpent);
        else if (sortOption === 'ordersCount') result.sort((a, b) => b.ordersCount - a.ordersCount);
        else if (sortOption === 'name') result.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
        else if (sortOption === 'newest') result.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        else if (sortOption === 'expiringSoon') {
            result.sort((a, b) => {
                if (!a.expiryDate) return 1;
                if (!b.expiryDate) return -1;
                return new Date(a.expiryDate) - new Date(b.expiryDate);
            });
        }
        return result;
    }, [clientsList, sortOption]);

    // Duplicate detection: clients with same email buying same product multiple times (excluding renewals)
    const duplicateClientIds = useMemo(() => {
        const emailProductCounts = {};
        sales.forEach(s => {
            if (!s.customerEmail || s.renewal_stage === 'renewed') return;
            const key = `${s.customerEmail.toLowerCase().trim()}::${s.productName}`;
            if (!emailProductCounts[key]) emailProductCounts[key] = new Set();
            emailProductCounts[key].add(s.customerId);
        });

        // Also check same email across different customers
        const emailCounts = {};
        sales.forEach(s => {
            if (!s.customerEmail || s.renewal_stage === 'renewed') return;
            const email = s.customerEmail.toLowerCase().trim();
            if (!emailCounts[email]) emailCounts[email] = new Set();
            emailCounts[email].add(s.customerId);
        });

        const dupIds = new Set();
        // Same email, same product, multiple sales
        Object.values(emailProductCounts).forEach(ids => {
            if (ids.size > 0) {
                // check if same customer has multiple non-renewal sales for same product
            }
        });
        // Same email across different customers
        Object.entries(emailCounts).forEach(([email, ids]) => {
            if (ids.size > 1) ids.forEach(id => dupIds.add(id));
        });
        // Same customer, same email, multiple non-renewal sales
        customers.forEach(cust => {
            if (!cust.email) return;
            const custSales = sales.filter(s => s.customerId === cust.id && s.renewal_stage !== 'renewed');
            const productCounts = {};
            custSales.forEach(s => {
                if (!s.productName) return;
                productCounts[s.productName] = (productCounts[s.productName] || 0) + 1;
            });
            if (Object.values(productCounts).some(c => c > 1)) {
                dupIds.add(cust.id);
            }
        });
        return dupIds;
    }, [sales, customers]);

    // Filter
    const filteredClients = useMemo(() => {
        let list = sortedClients;
        if (showDuplicatesOnly) {
            list = list.filter(c => duplicateClientIds.has(c.id));
        }
        if (!searchTerm) return list;
        const term = searchTerm.toLowerCase();
        return list.filter(c =>
            (c.name && c.name.toLowerCase().includes(term)) ||
            (c.phone && c.phone.includes(term)) ||
            (c.email && c.email.toLowerCase().includes(term)) ||
            (c.id && c.id.toLowerCase().includes(term))
        );
    }, [sortedClients, searchTerm, showDuplicatesOnly, duplicateClientIds]);

    const visibleClients = filteredClients.slice(0, visibleCount);

    // Status helpers
    const getExpiryStatus = (expiryDate) => {
        if (!expiryDate) return null;
        const diffDays = Math.ceil((new Date(expiryDate) - new Date()) / 86400000);
        if (diffDays < 0) return { label: `منتهي منذ ${Math.abs(diffDays)} يوم`, cls: 'bg-red-50 text-red-700 border-red-200', urgent: true };
        if (diffDays <= 3) return { label: `باقي ${diffDays} يوم`, cls: 'bg-orange-50 text-orange-700 border-orange-200', urgent: true };
        if (diffDays <= 30) return { label: `باقي ${diffDays} يوم`, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', urgent: false };
        return { label: `باقي ${diffDays} يوم`, cls: 'bg-blue-50 text-blue-700 border-blue-200', urgent: false };
    };

    const getChannelIcon = (ch) => {
        if (ch === 'واتساب') return 'fa-whatsapp text-green-500';
        if (ch === 'ماسنجر') return 'fa-facebook-messenger text-blue-500';
        if (ch === 'تليجرام') return 'fa-telegram text-sky-500';
        return 'fa-comment text-slate-400';
    };

    // Edit customer
    const handleSaveClient = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const updated = {
            name: fd.get('name') || editingClient.name,
            phone: fd.get('phone') || '',
            email: fd.get('email') || '',
            contactChannel: fd.get('contactChannel') || editingClient.contactChannel,
        };

        try {
            // Update customer in Supabase
            const { supabase } = await import('../lib/supabase');
            await supabase.from('customers').update({
                name: updated.name,
                phone: updated.phone,
                email: updated.email,
                contact_channel: updated.contactChannel,
            }).eq('id', editingClient.id);

            // Update related sales
            await supabase.from('sales').update({
                customer_name: updated.name,
                customer_phone: updated.phone,
                customer_email: updated.email,
                contact_channel: updated.contactChannel,
            }).eq('customer_id', editingClient.id);

            setEditingClient(null);
            await refreshData();

            if (selectedClient && selectedClient.id === editingClient.id) {
                setSelectedClient(prev => ({ ...prev, ...updated }));
            }
        } catch (error) {
            console.error(error);
            showAlert({ title: 'خطأ!', message: 'حدث خطأ أثناء الحفظ', type: 'danger' });
        }
    };

    // Delete customer
    const deleteCustomer = async (id) => {
        const confirmed = await showConfirm({
            title: 'حذف العميل',
            message: 'هل أنت متأكد من حذف هذا العميل من قائمة العملاء؟ (الأوردرات لن تتأثر)',
            confirmText: 'حذف',
            cancelText: 'إلغاء',
            type: 'danger'
        });
        if (!confirmed) return;
        try {
            const { supabase } = await import('../lib/supabase');
            await supabase.from('customers').delete().eq('id', id);
            await refreshData();
            if (selectedClient?.id === id) setSelectedClient(null);
        } catch (error) {
            console.error(error);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in pb-20 font-sans text-slate-800">

            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-700 to-blue-600 rounded-2xl p-8 text-white relative overflow-hidden shadow-xl">
                <div className="absolute -left-10 -bottom-10 text-[150px] opacity-10"><i className="fa-solid fa-users"></i></div>
                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="bg-white/20 p-3 rounded-xl backdrop-blur-sm"><i className="fa-solid fa-users text-2xl"></i></div>
                        <div>
                            <h2 className="text-2xl font-extrabold">قائمة العملاء</h2>
                            <p className="text-blue-100 text-sm font-medium">إدارة ومتابعة بيانات العملاء</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-4 mt-4">
                        <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-6 py-3 border border-white/20">
                            <p className="text-blue-100 text-xs font-bold mb-1">إجمالي العملاء</p>
                            <p className="text-2xl font-black">{customers.length}</p>
                        </div>
                        <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-6 py-3 border border-white/20">
                            <p className="text-blue-100 text-xs font-bold mb-1">إجمالي الأوردرات</p>
                            <p className="text-2xl font-black">{sales.length}</p>
                        </div>
                        <div className="bg-white/15 backdrop-blur-sm rounded-2xl px-6 py-3 border border-white/20">
                            <p className="text-blue-100 text-xs font-bold mb-1">إجمالي الإيرادات</p>
                            <p className="text-2xl font-black dir-ltr">{clientsList.reduce((s, c) => s + c.totalSpent, 0).toLocaleString()} <span className="text-sm opacity-80">ج.م</span></p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Toolbar */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4 items-center justify-between sticky top-2 z-30 bg-white/95 backdrop-blur-md">
                <div className="relative w-full md:w-96">
                    <i className="fa-solid fa-search absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input type="text" className="w-full bg-white border-2 border-slate-200 text-slate-900 text-sm font-semibold rounded-xl pr-10 p-3 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all placeholder-slate-400" placeholder="بحث بالاسم أو الرقم أو الإيميل أو ID..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                </div>
                <div className="flex gap-2 md:gap-3 w-full md:w-auto flex-wrap">
                    <button onClick={() => setShowDuplicatesOnly(!showDuplicatesOnly)}
                        className={`px-4 py-2.5 rounded-xl text-xs md:text-sm font-bold transition-all flex items-center gap-2 border ${showDuplicatesOnly ? 'bg-red-600 text-white border-red-600 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200'}`}>
                        <i className="fa-solid fa-clone"></i> المكرر ({duplicateClientIds.size})
                    </button>
                    <select value={sortOption} onChange={e => setSortOption(e.target.value)} className="bg-white border-2 border-slate-200 text-slate-700 text-sm font-bold rounded-xl p-3 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all">
                        <option value="ordersCount">🔥 الأكثر طلباً</option>
                        <option value="totalSpent">💰 الأكثر إنفاقاً</option>
                        <option value="name">🔤 حسب الاسم</option>
                        <option value="newest">🆕 الأحدث</option>
                        <option value="expiringSoon">⏳ قرب الانتهاء</option>
                    </select>
                </div>
            </div>

            {/* ============ TABLE VIEW ============ */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="text-right p-4 font-black text-slate-600 text-xs uppercase tracking-wider">العميل</th>
                                <th className="text-right p-4 font-black text-slate-600 text-xs uppercase tracking-wider">ID</th>
                                <th className="text-center p-4 font-black text-slate-600 text-xs uppercase tracking-wider">التواصل</th>
                                <th className="text-center p-4 font-black text-slate-600 text-xs uppercase tracking-wider">الأوردرات</th>
                                <th className="text-center p-4 font-black text-slate-600 text-xs uppercase tracking-wider">التجديدات</th>
                                <th className="text-center p-4 font-black text-slate-600 text-xs uppercase tracking-wider">المنتجات</th>
                                <th className="text-center p-4 font-black text-slate-600 text-xs uppercase tracking-wider">المدفوعات</th>
                                <th className="text-center p-4 font-black text-slate-600 text-xs uppercase tracking-wider">الحالة</th>
                                <th className="text-center p-4 font-black text-slate-600 text-xs uppercase tracking-wider w-20">الإجراء</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {visibleClients.length === 0 ? (
                                <tr>
                                    <td colSpan="9" className="p-16 text-center text-slate-400">
                                        <i className="fa-solid fa-user-slash text-4xl mb-4 block opacity-30"></i>
                                        <p className="font-bold text-lg">{searchTerm ? 'لا يوجد عملاء يطابقوا البحث' : 'لا يوجد عملاء بعد'}</p>
                                        <p className="text-sm mt-1">{!searchTerm && 'سجل أوردر جديد من صفحة المبيعات لإضافة عميل'}</p>
                                    </td>
                                </tr>
                            ) : (
                                visibleClients.map(client => {
                                    const expStatus = getExpiryStatus(client.expiryDate);
                                    return (
                                        <tr key={client.id}
                                            onClick={() => setSelectedClient(client)}
                                            className="hover:bg-indigo-50/40 cursor-pointer transition-colors group">
                                            {/* Name + Phone */}
                                            <td className="p-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-sm shadow-sm flex-shrink-0">
                                                        {client.name?.charAt(0).toUpperCase() || '?'}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-bold text-slate-800 truncate group-hover:text-indigo-700 transition-colors">{client.name}</p>
                                                        {client.phone && (
                                                            <p className="text-xs text-slate-400 font-mono dir-ltr text-right truncate">{client.phone}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            {/* ID */}
                                            <td className="p-4">
                                                <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-1 rounded border border-slate-100 select-all">{client.id?.replace('CUS-', '#')}</span>
                                            </td>
                                            {/* Contact */}
                                            <td className="p-4 text-center">
                                                <span className="inline-flex items-center gap-1.5 text-xs font-bold">
                                                    <i className={`fa-brands ${getChannelIcon(client.contactChannel)}`}></i>
                                                    {client.contactChannel}
                                                </span>
                                            </td>
                                            {/* Orders */}
                                            <td className="p-4 text-center">
                                                <span className="text-base font-black text-slate-700">{client.ordersCount}</span>
                                            </td>
                                            {/* Renewals */}
                                            <td className="p-4 text-center">
                                                <span className={`text-base font-black ${client.renewalCount > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                                                    {client.renewalCount}
                                                </span>
                                            </td>
                                            {/* Products */}
                                            <td className="p-4 text-center">
                                                <div className="flex flex-wrap justify-center gap-1 max-w-[200px] mx-auto">
                                                    {client.productNames.slice(0, 2).map(p => (
                                                        <span key={p} className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-bold border border-indigo-100 truncate max-w-[90px]">{p}</span>
                                                    ))}
                                                    {client.productNames.length > 2 && (
                                                        <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-bold">+{client.productNames.length - 2}</span>
                                                    )}
                                                </div>
                                            </td>
                                            {/* Total */}
                                            <td className="p-4 text-center">
                                                <span className="font-black text-emerald-700 dir-ltr">{client.totalSpent.toLocaleString()} <span className="text-[10px] text-slate-400">ج.م</span></span>
                                            </td>
                                            {/* Status */}
                                            <td className="p-4 text-center">
                                                {expStatus ? (
                                                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border ${expStatus.cls}`}>{expStatus.label}</span>
                                                ) : (
                                                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-lg border bg-slate-50 text-slate-400 border-slate-200">—</span>
                                                )}
                                            </td>
                                            {/* Actions */}
                                            <td className="p-4 text-center" onClick={e => e.stopPropagation()}>
                                                <div className="flex justify-center gap-1">
                                                    <button onClick={() => { setEditingClient(client); }} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition" title="تعديل">
                                                        <i className="fa-solid fa-pen text-xs"></i>
                                                    </button>
                                                    <button onClick={() => deleteCustomer(client.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition" title="حذف">
                                                        <i className="fa-solid fa-trash text-xs"></i>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Load More */}
            {visibleCount < filteredClients.length && (
                <div className="flex justify-center">
                    <button onClick={() => setVisibleCount(p => p + 25)} className="bg-white border-2 border-indigo-100 text-indigo-600 px-10 py-3 rounded-full font-bold hover:bg-indigo-50 hover:border-indigo-200 transition-all shadow-sm">
                        عرض المزيد ({filteredClients.length - visibleCount}) <i className="fa-solid fa-chevron-down mr-1"></i>
                    </button>
                </div>
            )}

            {/* ============ CLIENT DETAILS MODAL ============ */}
            {selectedClient && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in" onClick={() => setSelectedClient(null)}>
                    <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>

                        {/* Header */}
                        <div className="p-6 bg-gradient-to-r from-indigo-700 to-blue-600 text-white flex justify-between items-start">
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-2xl font-black">
                                    {selectedClient.name?.charAt(0).toUpperCase() || '?'}
                                </div>
                                <div>
                                    <h3 className="text-xl font-extrabold">{selectedClient.name}</h3>
                                    <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-blue-100">
                                        <span className="font-mono text-[11px] bg-white/10 px-2 py-0.5 rounded">{selectedClient.id}</span>
                                        {selectedClient.phone && <span className="flex items-center gap-1"><i className="fa-solid fa-phone text-[10px]"></i> {selectedClient.phone}</span>}
                                        {selectedClient.email && <span className="flex items-center gap-1"><i className="fa-solid fa-envelope text-[10px]"></i> {selectedClient.email}</span>}
                                        <span className="flex items-center gap-1"><i className={`fa-brands ${getChannelIcon(selectedClient.contactChannel)}`}></i> {selectedClient.contactChannel}</span>
                                    </div>
                                </div>
                            </div>
                            <button onClick={() => setSelectedClient(null)} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>

                        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50 space-y-6">

                            {/* Stats Row */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div className="bg-white p-4 rounded-2xl border border-indigo-100 text-center shadow-sm">
                                    <span className="text-[10px] text-indigo-500 font-bold uppercase block mb-1">الأوردرات</span>
                                    <span className="text-3xl font-black text-slate-800">{selectedClient.ordersCount}</span>
                                </div>
                                <div className="bg-white p-4 rounded-2xl border border-emerald-100 text-center shadow-sm">
                                    <span className="text-[10px] text-emerald-500 font-bold uppercase block mb-1">المدفوعات</span>
                                    <span className="text-2xl font-black text-emerald-700 dir-ltr">{selectedClient.totalSpent.toLocaleString()} <span className="text-xs text-slate-400">ج.م</span></span>
                                </div>
                                <div className="bg-white p-4 rounded-2xl border border-purple-100 text-center shadow-sm">
                                    <span className="text-[10px] text-purple-500 font-bold uppercase block mb-1">التجديدات</span>
                                    <span className="text-3xl font-black text-purple-700">{selectedClient.renewalCount}</span>
                                </div>
                                <div className="bg-white p-4 rounded-2xl border border-blue-100 text-center shadow-sm">
                                    <span className="text-[10px] text-blue-500 font-bold uppercase block mb-1">المنتجات</span>
                                    <span className="text-3xl font-black text-blue-700">{selectedClient.productNames?.length || 0}</span>
                                </div>
                            </div>

                            {/* Products used */}
                            {selectedClient.productNames?.length > 0 && (
                                <div>
                                    <h4 className="font-bold text-slate-700 mb-3 text-sm flex items-center gap-2">
                                        <i className="fa-solid fa-boxes-stacked text-indigo-500"></i> الخدمات المشترك فيها
                                    </h4>
                                    <div className="flex flex-wrap gap-2">
                                        {selectedClient.productNames.map(p => {
                                            const count = selectedClient.history.filter(s => s.productName === p).length;
                                            return (
                                                <span key={p} className="bg-white border border-indigo-200 text-indigo-700 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow-sm">
                                                    <i className="fa-solid fa-tag text-xs opacity-50"></i>
                                                    {p}
                                                    <span className="bg-indigo-100 text-indigo-800 text-[10px] px-1.5 py-0.5 rounded-full font-black">{count}×</span>
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Orders History Table */}
                            <div>
                                <h4 className="font-bold text-slate-700 mb-3 text-sm flex items-center gap-2">
                                    <i className="fa-solid fa-clock-rotate-left text-indigo-500"></i> سجل الأوردرات ({selectedClient.history?.length || 0})
                                </h4>
                                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                                    <table className="w-full text-xs">
                                        <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                                            <tr>
                                                <th className="p-3 text-right">التاريخ</th>
                                                <th className="p-3 text-right">المنتج</th>
                                                <th className="p-3 text-center">المدة</th>
                                                <th className="p-3 text-center">السعر</th>
                                                <th className="p-3 text-center">الدفع</th>
                                                <th className="p-3 text-center">الحالة</th>
                                                <th className="p-3 text-center">نوع</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {(!selectedClient.history || selectedClient.history.length === 0) ? (
                                                <tr><td colSpan="7" className="p-8 text-center text-slate-400 font-bold">لا توجد أوردرات</td></tr>
                                            ) : (
                                                selectedClient.history.map(sale => {
                                                    const isRenewal = !!sale.renewalSourceId;
                                                    const daysLeft = sale.expiryDate ? Math.ceil((new Date(sale.expiryDate) - new Date()) / 86400000) : null;
                                                    return (
                                                        <tr key={sale.id} className="hover:bg-slate-50/80 transition-colors">
                                                            <td className="p-3 font-mono text-slate-500">{new Date(sale.date).toLocaleDateString('en-GB')}</td>
                                                            <td className="p-3 font-bold text-slate-700">{sale.productName}</td>
                                                            <td className="p-3 text-center">{sale.duration || 30} يوم</td>
                                                            <td className="p-3 text-center font-bold text-slate-800 dir-ltr">{Number(sale.finalPrice || 0).toLocaleString()}</td>
                                                            <td className="p-3 text-center">{sale.paymentMethod || '-'}</td>
                                                            <td className="p-3 text-center">
                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${sale.isPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                                                                    {sale.isPaid ? '✅ مدفوع' : '⏳ غير مدفوع'}
                                                                </span>
                                                            </td>
                                                            <td className="p-3 text-center">
                                                                {isRenewal ? (
                                                                    <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold border border-purple-100">🔄 تجديد</span>
                                                                ) : (
                                                                    <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold border border-blue-100">🆕 جديد</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3 pt-2">
                                <button onClick={() => setEditingClient(selectedClient)} className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition flex items-center gap-2">
                                    <i className="fa-solid fa-pen"></i> تعديل بيانات العميل
                                </button>
                                <button onClick={() => { if (selectedClient.phone) copyToClipboard(selectedClient.phone); }} className="bg-white text-slate-600 px-5 py-3 rounded-xl font-bold border-2 border-slate-200 hover:bg-slate-50 transition flex items-center gap-2">
                                    <i className="fa-solid fa-copy"></i> نسخ الرقم
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ============ EDIT CLIENT MODAL ============ */}
            {editingClient && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-fade-in" onClick={() => setEditingClient(null)}>
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="p-6 bg-gradient-to-r from-blue-600 to-indigo-700 text-white flex justify-between items-center">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <i className="fa-solid fa-user-pen"></i> تعديل بيانات العميل
                            </h3>
                            <button onClick={() => setEditingClient(null)} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>
                        <form onSubmit={handleSaveClient} className="p-8 space-y-5" key={editingClient.id}>
                            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-center">
                                <span className="text-xs text-slate-400 font-bold">ID: </span>
                                <span className="text-xs font-mono font-bold text-indigo-600 select-all">{editingClient.id}</span>
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">اسم العميل</label>
                                <input name="name" defaultValue={editingClient.name} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all" required />
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">رقم الهاتف</label>
                                <input name="phone" type="tel" defaultValue={editingClient.phone} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all font-mono dir-ltr text-right" placeholder="01xxxxxxxxx" />
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">الإيميل</label>
                                <input name="email" type="email" defaultValue={editingClient.email} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all font-mono" placeholder="user@example.com" />
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">مكان التواصل</label>
                                <div className="grid grid-cols-3 gap-3">
                                    {['واتساب', 'ماسنجر', 'تليجرام'].map(ch => (
                                        <label key={ch} className="flex items-center justify-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 border-slate-200 hover:border-indigo-200">
                                            <input type="radio" name="contactChannel" value={ch} defaultChecked={editingClient.contactChannel === ch} className="hidden" />
                                            <i className={`fa-brands ${ch === 'واتساب' ? 'fa-whatsapp text-green-600' : ch === 'ماسنجر' ? 'fa-facebook-messenger text-blue-600' : 'fa-telegram text-sky-500'} text-lg`}></i>
                                            <span className="text-sm font-bold text-slate-700">{ch}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setEditingClient(null)} className="flex-1 py-3 rounded-xl font-bold text-slate-600 bg-white border-2 border-slate-200 hover:bg-slate-50 transition">إلغاء</button>
                                <button type="submit" className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition flex items-center justify-center gap-2">
                                    <i className="fa-solid fa-check"></i> حفظ التعديلات
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <style>{`
                .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
}