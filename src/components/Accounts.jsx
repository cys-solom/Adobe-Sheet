import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { accountsAPI, sectionsAPI, quickLinksAPI } from '../services/api';
import { useConfirm } from './ConfirmDialog';

export default function Accounts() {
    const { user } = useAuth();
    const { products, accounts: ctxAccounts, sections: ctxSections, refreshData } = useData();

    const [accounts, setAccounts] = useState([]);
    const [sections, setSections] = useState([]);
    const [showAddModal, setShowAddModal] = useState(false);
    const [showSectionModal, setShowSectionModal] = useState(false);
    const [isBulkAdd, setIsBulkAdd] = useState(false);
    const [editingAccount, setEditingAccount] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [copiedId, setCopiedId] = useState(null);
    const [visibleCount, setVisibleCount] = useState(20);
    const [pulledResult, setPulledResult] = useState(null);
    const [selectedSection, setSelectedSection] = useState(null);
    // Quick links state
    const [quickLinks, setQuickLinks] = useState([]);
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [linksExpanded, setLinksExpanded] = useState(true);
    const { showConfirm, showAlert } = useConfirm();

    useEffect(() => { window.scrollTo(0, 0); }, []);

    // Load quick links from Supabase
    const refreshQuickLinks = async () => {
        try {
            const links = await quickLinksAPI.getAll();
            setQuickLinks(links);
        } catch (e) { console.error(e); }
    };
    useEffect(() => { refreshQuickLinks(); }, []);

    const handleAddLink = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const label = fd.get('linkLabel')?.trim();
        const url = fd.get('linkUrl')?.trim();
        if (!label || !url) return;
        try {
            await quickLinksAPI.create({ label, url, createdBy: user?.username || 'Admin' });
            setShowLinkModal(false);
            await refreshQuickLinks();
        } catch (err) { console.error(err); showAlert({ title: 'خطأ!', message: 'حدث خطأ', type: 'danger' }); }
    };

    const deleteLink = async (id) => {
        try {
            await quickLinksAPI.delete(id);
            await refreshQuickLinks();
        } catch (err) { console.error(err); }
    };

    // Sync from context
    useEffect(() => {
        setAccounts(ctxAccounts);
        setSections(ctxSections);
    }, [ctxAccounts, ctxSections]);

    // Current section object
    const currentSection = useMemo(() => sections.find(s => s.id === selectedSection), [sections, selectedSection]);

    // Stats
    const sectionAccounts = useMemo(() => {
        if (!currentSection) return accounts;
        return accounts.filter(a => a.productName === currentSection.name);
    }, [accounts, currentSection]);

    const accountStats = useMemo(() => ({
        total: sectionAccounts.length,
        available: sectionAccounts.filter(a => a.status === 'available').length,
        used: sectionAccounts.filter(a => a.status === 'used').length,
        full: sectionAccounts.filter(a => a.status === 'completed').length,
    }), [sectionAccounts]);

    // Global stats for overview
    const globalStats = useMemo(() => ({
        total: accounts.length,
        available: accounts.filter(a => a.status === 'available').length,
        used: accounts.filter(a => a.status === 'used').length,
        full: accounts.filter(a => a.status === 'completed').length,
        accountSections: sections.filter(s => s.type === 'accounts').length,
        codeSections: sections.filter(s => s.type === 'codes').length,
    }), [accounts, sections]);

    // Filtered
    const filteredAccounts = useMemo(() => {
        return sectionAccounts.filter(acc => {
            const matchStatus = filterStatus === 'all' || acc.status === filterStatus;
            const term = searchTerm.toLowerCase();
            const matchSearch = !term ||
                (acc.email && acc.email.toLowerCase().includes(term)) ||
                (acc.password && acc.password.toLowerCase().includes(term));
            return matchStatus && matchSearch;
        }).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    }, [sectionAccounts, filterStatus, searchTerm]);

    // Section counts
    const sectionCounts = useMemo(() => {
        const c = {};
        accounts.forEach(a => { c[a.productName] = (c[a.productName] || 0) + 1; });
        return c;
    }, [accounts]);

    // Available counts per section
    const sectionAvailable = useMemo(() => {
        const c = {};
        accounts.filter(a => a.status === 'available').forEach(a => { c[a.productName] = (c[a.productName] || 0) + 1; });
        return c;
    }, [accounts]);

    // Which products link to which section
    const linkedProductsMap = useMemo(() => {
        const map = {};
        products.forEach(p => {
            if (p.inventoryProduct && p.fulfillmentType === 'from_stock') {
                if (!map[p.inventoryProduct]) map[p.inventoryProduct] = [];
                map[p.inventoryProduct].push(p.name);
            }
        });
        return map;
    }, [products]);

    // Separate sections by type
    const accountSections = useMemo(() => sections.filter(s => s.type === 'accounts'), [sections]);
    const codeSections = useMemo(() => sections.filter(s => s.type === 'codes'), [sections]);

    // ========= Section CRUD =========
    const handleCreateSection = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const name = fd.get('sectionName')?.trim();
        const type = fd.get('sectionType');
        if (!name) return;
        if (sections.find(s => s.name === name)) { showAlert({ title: 'خطأ', message: 'يوجد سجل بنفس الاسم بالفعل!', type: 'warning' }); return; }
        try {
            await sectionsAPI.create({ name, type });
            setShowSectionModal(false);
            await refreshData();
        } catch (error) {
            console.error(error);
            showAlert({ title: 'خطأ!', message: 'حدث خطأ', type: 'danger' });
        }
    };

    const deleteSection = async (sec) => {
        const confirmed = await showConfirm({
            title: 'حذف القسم',
            message: `هل أنت متأكد من حذف قسم "${sec.name}" وجميع محتوياته (${sectionCounts[sec.name] || 0} عنصر)؟`,
            confirmText: 'حذف',
            cancelText: 'إلغاء',
            type: 'danger'
        });
        if (!confirmed) return;
        try {
            await sectionsAPI.delete(sec.id, sec.name);
            if (selectedSection === sec.id) setSelectedSection(null);
            await refreshData();
        } catch (error) {
            console.error(error);
        }
    };

    // ========= Account CRUD =========
    const handleAddAccount = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const productName = currentSection.name;
        const allowedUses = Number(fd.get('allowedUses') || 1);
        const isWorkspace = fd.get('isWorkspace') === 'on';
        const workspaceMembers = isWorkspace ? Number(fd.get('workspaceMembers') || 5) : 0;

        try {
            if (isBulkAdd) {
                const bulkData = fd.get('bulkData')?.trim();
                if (!bulkData) return;
                const twoFABaseUrl = 'https://www.servicehub-mail.cloud/2fa-code/';
                const rows = bulkData.split('\n').map(l => l.trim()).filter(l => l).map(line => {
                    let email = line, password = '', twoFA = '';
                    const separator = line.includes('|') ? '|' : ':';
                    const parts = line.split(separator).map(p => p.trim());
                    email = parts[0] || '';
                    password = parts[1] || '';
                    if (parts[2]) {
                        const rawCode = parts[2].trim();
                        twoFA = rawCode.startsWith('http') ? rawCode : twoFABaseUrl + rawCode;
                    }
                    return { email, password, twoFA, productName, allowed_uses: isWorkspace ? workspaceMembers : allowedUses, createdBy: user?.username || 'Admin', isWorkspace, workspaceMembers };
                });
                await accountsAPI.createBulk(rows);
            } else {
                const email = fd.get('email')?.trim();
                if (!email) return;
                await accountsAPI.create({ email, password: fd.get('password')?.trim() || '', twoFA: fd.get('twoFA')?.trim() || '', productName, allowed_uses: isWorkspace ? workspaceMembers : allowedUses, createdBy: user?.username || 'Admin', isWorkspace, workspaceMembers });
            }
            setShowAddModal(false);
            setIsBulkAdd(false);
            await refreshData();
        } catch (error) {
            console.error(error);
            await showAlert({ title: 'خطأ!', message: 'حدث خطأ أثناء الإضافة', type: 'danger' });
        }
    };

    const handleEditAccount = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const newStatus = fd.get('status');
        const isWorkspace = fd.get('isWorkspace') === 'on';
        try {
            await accountsAPI.update(editingAccount.id, {
                email: fd.get('email').trim(),
                password: fd.get('password')?.trim() || '',
                twoFA: fd.get('twoFA')?.trim() || '',
                status: newStatus,
                allowed_uses: Number(fd.get('allowedUses') || 1),
                current_uses: newStatus === 'available' ? 0 : Number(fd.get('currentUses') || editingAccount.current_uses),
                isWorkspace: isWorkspace,
                workspaceMembers: isWorkspace ? Number(fd.get('workspaceMembers') || 5) : 0,
            });
            setEditingAccount(null);
            await refreshData();
        } catch (error) {
            console.error(error);
        }
    };

    const deleteAccount = async (id) => {
        const confirmed = await showConfirm({
            title: 'حذف العنصر',
            message: 'هل أنت متأكد من حذف هذا العنصر نهائياً؟',
            confirmText: 'حذف',
            cancelText: 'إلغاء',
            type: 'danger'
        });
        if (!confirmed) return;
        try {
            await accountsAPI.delete(id);
            await refreshData();
        } catch (error) {
            console.error(error);
        }
    };

    const handleManualPull = async (acc) => {
        if (acc.status === 'completed' || acc.status === 'damaged') return;
        try {
            const newUses = (acc.current_uses || 0) + 1;
            const newStatus = (acc.allowed_uses !== -1 && newUses >= acc.allowed_uses) ? 'completed' : 'used';
            await accountsAPI.update(acc.id, { current_uses: newUses, status: newStatus });

            let t = `البيانات: ${acc.email}`;
            if (acc.password) t += `\nالباسورد: ${acc.password}`;
            if (acc.twoFA) t += `\n2FA: ${acc.twoFA}`;
            navigator.clipboard.writeText(t);
            setCopiedId(`pull-${acc.id}`);
            setTimeout(() => setCopiedId(null), 1500);
            await refreshData();
        } catch (error) {
            console.error(error);
        }
    };

    const handlePullNext = async (sectionName) => {
        const targetName = sectionName || currentSection?.name;
        if (!targetName) return;
        try {
            const result = await accountsAPI.pullNext(targetName);
            if (result.empty) {
                setPulledResult({ empty: true, sectionName: targetName });
            } else {
                let txt = result.email;
                if (result.password) txt += `\n${result.password}`;
                if (result.twoFA || result.two_fa) txt += `\n${result.twoFA || result.two_fa}`;
                navigator.clipboard.writeText(txt);
                setPulledResult({ ...result, sectionName: targetName });
                await refreshData();
            }
        } catch (error) {
            console.error(error);
        }
    };

    const copyToClipboard = (text, id) => { navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 1500); };

    const getStatusInfo = (s) => {
        const map = {
            available: { label: 'متاح', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', icon: 'fa-check-circle' },
            used: { label: 'مستخدم', color: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500', icon: 'fa-circle-dot' },
            completed: { label: 'مكتمل', color: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400', icon: 'fa-circle-check' },
            damaged: { label: 'تالف', color: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500', icon: 'fa-circle-xmark' },
        };
        return map[s] || map.available;
    };

    const isCodesSection = currentSection?.type === 'codes';

    // =============== Section Card Component ===============
    const SectionCard = ({ sec }) => {
        const count = sectionCounts[sec.name] || 0;
        const avail = sectionAvailable[sec.name] || 0;
        const linkedProds = linkedProductsMap[sec.name] || [];
        const isCodes = sec.type === 'codes';
        const pct = count > 0 ? Math.round((avail / count) * 100) : 0;
        return (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg transition-all group flex flex-col">
                {/* Header */}
                <div onClick={() => { setSelectedSection(sec.id); setSearchTerm(''); setFilterStatus('all'); setVisibleCount(20); }} className="cursor-pointer p-4 pb-3">
                    <div className="flex items-center gap-3 mb-3">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ${isCodes ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'}`}>
                            <i className={`fa-solid ${isCodes ? 'fa-key' : 'fa-user-shield'}`}></i>
                        </div>
                        <div className="min-w-0 flex-1">
                            <h4 className="font-bold text-base text-slate-800 leading-tight break-words">{sec.name}</h4>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold inline-block mt-1 ${isCodes ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'}`}>
                                {isCodes ? 'أكواد' : 'حسابات'}
                            </span>
                        </div>
                    </div>

                    {/* Stats Row */}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="bg-slate-50 rounded-lg p-2 text-center">
                            <p className="text-[10px] text-slate-400 font-bold">إجمالي</p>
                            <p className="text-lg font-black text-slate-700">{count}</p>
                        </div>
                        <div className="bg-emerald-50 rounded-lg p-2 text-center">
                            <p className="text-[10px] text-emerald-500 font-bold">متاح</p>
                            <p className="text-lg font-black text-emerald-600">{avail}</p>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }}></div>
                    </div>

                    {/* Linked Products */}
                    {linkedProds.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                            {linkedProds.map(pn => (
                                <span key={pn} className="text-[9px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-bold">
                                    <i className="fa-solid fa-link text-[7px] ml-0.5"></i> {pn}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Action Buttons Footer */}
                <div className="border-t border-slate-100 p-3 mt-auto flex gap-2">
                    <button onClick={() => { setSelectedSection(sec.id); setSearchTerm(''); setFilterStatus('all'); setVisibleCount(20); }}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${isCodes ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'}`}>
                        <i className="fa-solid fa-folder-open ml-1 text-[10px]"></i> فتح
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handlePullNext(sec.name); }}
                        disabled={avail === 0}
                        className={`py-2 px-3 rounded-xl text-xs font-bold transition-colors ${avail > 0 ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-50 text-slate-300 cursor-not-allowed'}`}
                        title="سحب">
                        <i className="fa-solid fa-bolt"></i>
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); deleteSection(sec); }}
                        className="py-2 px-3 rounded-xl text-xs font-bold bg-red-50 text-red-400 hover:text-red-600 hover:bg-red-100 transition-colors" title="حذف">
                        <i className="fa-solid fa-trash text-[10px]"></i>
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-4 md:space-y-6 animate-fade-in pb-24 font-sans text-slate-800">

            {!selectedSection ? (
                <>
                    {/* ============ OVERVIEW ============ */}
                    {/* Global Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
                        <div className="bg-gradient-to-br from-purple-600 to-indigo-700 rounded-2xl p-3 md:p-5 text-white shadow-lg relative overflow-hidden">
                            <div className="absolute -left-4 -bottom-4 text-7xl opacity-10"><i className="fa-solid fa-boxes-stacked"></i></div>
                            <p className="text-purple-200 text-[10px] md:text-xs font-bold mb-1">إجمالي المخزون</p>
                            <h3 className="text-2xl md:text-3xl font-extrabold">{globalStats.total}</h3>
                        </div>
                        <div className="bg-white rounded-2xl p-3 md:p-5 border border-slate-200 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 md:w-1.5 h-full bg-emerald-500"></div>
                            <p className="text-slate-500 text-[10px] md:text-xs font-bold mb-1 flex items-center gap-1"><i className="fa-solid fa-check-circle text-emerald-500 text-[10px]"></i> متاح</p>
                            <h3 className="text-2xl md:text-3xl font-extrabold text-emerald-600">{globalStats.available}</h3>
                        </div>
                        <div className="bg-white rounded-2xl p-3 md:p-5 border border-slate-200 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 md:w-1.5 h-full bg-orange-500"></div>
                            <p className="text-slate-500 text-[10px] md:text-xs font-bold mb-1 flex items-center gap-1"><i className="fa-solid fa-circle-dot text-orange-500 text-[10px]"></i> مستخدم</p>
                            <h3 className="text-2xl md:text-3xl font-extrabold text-orange-600">{globalStats.used}</h3>
                        </div>
                        <div className="bg-white rounded-2xl p-3 md:p-5 border border-slate-200 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 md:w-1.5 h-full bg-slate-400"></div>
                            <p className="text-slate-500 text-[10px] md:text-xs font-bold mb-1 flex items-center gap-1"><i className="fa-solid fa-circle-check text-slate-400 text-[10px]"></i> مكتمل</p>
                            <h3 className="text-2xl md:text-3xl font-extrabold text-slate-400">{globalStats.full}</h3>
                        </div>
                    </div>

                    {/* Quick Pull Bar */}
                    {sections.length > 0 && (
                        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-3 md:p-5 shadow-lg">
                            <div className="flex items-center gap-2 text-white mb-2 md:mb-3">
                                <i className="fa-solid fa-bolt text-base md:text-lg"></i>
                                <h3 className="text-sm md:text-lg font-extrabold">سحب سريع</h3>
                                <span className="text-emerald-200 text-[10px] md:text-xs font-medium mr-2 hidden sm:inline">اسحب من أي سجل بدون ما تدخله</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5 md:gap-2">
                                {sections.map(sec => {
                                    const avail = sectionAvailable[sec.name] || 0;
                                    const isCodes = sec.type === 'codes';
                                    return (
                                        <button key={sec.id} onClick={() => handlePullNext(sec.name)}
                                            disabled={avail === 0}
                                            className={`flex items-center gap-1.5 md:gap-2 px-2.5 md:px-4 py-2 md:py-2.5 rounded-xl text-xs md:text-sm font-bold transition-all border ${avail > 0
                                                ? 'bg-white/15 text-white border-white/20 hover:bg-white/25 active:scale-95'
                                                : 'bg-white/5 text-white/30 border-white/10 cursor-not-allowed'}`}>
                                            <i className={`fa-solid ${isCodes ? 'fa-key' : 'fa-user-shield'} text-[10px] md:text-xs`}></i>
                                            <span className="truncate max-w-[80px] md:max-w-none">{sec.name}</span>
                                            <span className={`text-[9px] md:text-[10px] px-1.5 py-0.5 rounded-full font-black ${avail > 0 ? 'bg-white/20' : 'bg-white/5'}`}>{avail}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ===== QUICK LINKS ===== */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                        <button onClick={() => setLinksExpanded(!linksExpanded)} className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-violet-50 text-violet-600 rounded-xl flex items-center justify-center"><i className="fa-solid fa-link text-lg"></i></div>
                                <div className="text-right">
                                    <h3 className="text-base font-extrabold text-slate-800">الروابط السريعة</h3>
                                    <p className="text-[10px] text-slate-400 font-medium">{quickLinks.length} رابط محفوظ</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <span onClick={(e) => { e.stopPropagation(); setShowLinkModal(true); }} className="w-8 h-8 flex items-center justify-center bg-violet-100 text-violet-600 rounded-lg hover:bg-violet-200 transition">
                                    <i className="fa-solid fa-plus text-xs"></i>
                                </span>
                                <i className={`fa-solid fa-chevron-down text-slate-400 text-xs transition-transform ${linksExpanded ? 'rotate-180' : ''}`}></i>
                            </div>
                        </button>

                        {linksExpanded && (
                            <div className="px-4 pb-4">
                                {quickLinks.length === 0 ? (
                                    <div className="text-center py-6 text-slate-400">
                                        <i className="fa-solid fa-link-slash text-2xl mb-2 opacity-30 block"></i>
                                        <p className="text-sm font-bold">لا توجد روابط محفوظة</p>
                                        <button onClick={() => setShowLinkModal(true)} className="mt-2 text-violet-600 text-xs font-bold hover:underline">إضافة أول رابط +</button>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                        {quickLinks.map(link => (
                                            <div key={link.id} className="group flex items-center gap-2 bg-slate-50 hover:bg-violet-50 rounded-xl p-3 border border-slate-100 hover:border-violet-200 transition-all">
                                                <div className="w-8 h-8 bg-violet-100 text-violet-600 rounded-lg flex items-center justify-center flex-shrink-0">
                                                    <i className="fa-solid fa-globe text-xs"></i>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-bold text-slate-700 truncate">{link.label}</p>
                                                    <p className="text-[10px] text-slate-400 font-mono truncate dir-ltr text-left">{link.url}</p>
                                                </div>
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    <button onClick={() => copyToClipboard(link.url, `link-${link.id}`)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-100 transition" title="نسخ الرابط">
                                                        <i className={`fa-solid ${copiedId === `link-${link.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-xs`}></i>
                                                    </button>
                                                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition" title="فتح الرابط">
                                                        <i className="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                                                    </a>
                                                    <button onClick={() => deleteLink(link.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition opacity-0 group-hover:opacity-100" title="حذف">
                                                        <i className="fa-solid fa-trash text-[10px]"></i>
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Header + Create */}
                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center"><i className="fa-solid fa-layer-group text-lg"></i></div>
                            <div>
                                <h2 className="text-xl font-black text-slate-800">أقسام المخزون</h2>
                                <p className="text-xs text-slate-400 font-medium">{globalStats.accountSections} حسابات • {globalStats.codeSections} أكواد</p>
                            </div>
                        </div>
                        <button onClick={() => setShowSectionModal(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm px-6 py-2.5 shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2 w-full md:w-auto">
                            <i className="fa-solid fa-plus"></i> إنشاء سجل جديد
                        </button>
                    </div>

                    {/* ===== ACCOUNTS SECTION ===== */}
                    {accountSections.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center"><i className="fa-solid fa-user-shield text-sm"></i></div>
                                <h3 className="text-lg font-extrabold text-slate-800">الحسابات</h3>
                                <span className="text-xs px-2.5 py-0.5 bg-indigo-50 text-indigo-600 rounded-full font-bold border border-indigo-100">{accountSections.length}</span>
                            </div>
                            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-4">
                                {accountSections.map(sec => <SectionCard key={sec.id} sec={sec} />)}
                            </div>
                        </div>
                    )}

                    {/* ===== CODES SECTION ===== */}
                    {codeSections.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <div className="w-8 h-8 bg-amber-100 text-amber-600 rounded-lg flex items-center justify-center"><i className="fa-solid fa-key text-sm"></i></div>
                                <h3 className="text-lg font-extrabold text-slate-800">الأكواد</h3>
                                <span className="text-xs px-2.5 py-0.5 bg-amber-50 text-amber-600 rounded-full font-bold border border-amber-100">{codeSections.length}</span>
                            </div>
                            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-4">
                                {codeSections.map(sec => <SectionCard key={sec.id} sec={sec} />)}
                            </div>
                        </div>
                    )}

                    {/* Empty State */}
                    {sections.length === 0 && (
                        <div className="col-span-full py-16 bg-white rounded-3xl border-2 border-dashed border-slate-200 text-slate-400 flex flex-col items-center">
                            <i className="fa-solid fa-boxes-stacked text-5xl mb-4 opacity-30"></i>
                            <p className="font-bold text-lg">المخزون فارغ تماماً</p>
                            <p className="text-sm mt-1">اضغط "إنشاء سجل جديد" لبدء تنظيم المخزون</p>
                        </div>
                    )}
                </>
            ) : (
                <>
                    {/* ============ DETAIL VIEW ============ */}
                    {/* Stats for current section */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className={`rounded-2xl p-5 text-white shadow-lg relative overflow-hidden ${isCodesSection ? 'bg-gradient-to-br from-amber-600 to-orange-600' : 'bg-gradient-to-br from-purple-600 to-indigo-700'}`}>
                            <div className="absolute -left-4 -bottom-4 text-7xl opacity-10"><i className={`fa-solid ${isCodesSection ? 'fa-key' : 'fa-server'}`}></i></div>
                            <p className="text-white/70 text-xs font-bold mb-1">إجمالي</p>
                            <h3 className="text-3xl font-extrabold">{accountStats.total}</h3>
                        </div>
                        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1.5 h-full bg-emerald-500"></div>
                            <p className="text-slate-500 text-xs font-bold mb-1">متاح</p>
                            <h3 className="text-3xl font-extrabold text-emerald-600">{accountStats.available}</h3>
                        </div>
                        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1.5 h-full bg-orange-500"></div>
                            <p className="text-slate-500 text-xs font-bold mb-1">مستخدم</p>
                            <h3 className="text-3xl font-extrabold text-orange-600">{accountStats.used}</h3>
                        </div>
                        <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1.5 h-full bg-slate-400"></div>
                            <p className="text-slate-500 text-xs font-bold mb-1">مكتمل</p>
                            <h3 className="text-3xl font-extrabold text-slate-400">{accountStats.full}</h3>
                        </div>
                    </div>

                    {/* Toolbar */}
                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4 items-center justify-between sticky top-2 z-30 bg-white/95 backdrop-blur-md">
                        <div className="flex items-center gap-3 w-full md:w-auto overflow-hidden">
                            <button onClick={() => { setSelectedSection(null); setSearchTerm(''); setFilterStatus('all'); setVisibleCount(20); }} className="w-10 h-10 flex-shrink-0 flex items-center justify-center bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors">
                                <i className="fa-solid fa-arrow-right"></i>
                            </button>
                            <div className="min-w-0">
                                <h2 className="text-lg font-black text-slate-800 truncate">{currentSection?.name}</h2>
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${isCodesSection ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600'}`}>
                                    {isCodesSection ? 'أكواد' : 'حسابات'}
                                </span>
                            </div>
                        </div>
                        <div className="relative w-full md:w-80 border-t md:border-none pt-4 md:pt-0 border-slate-100">
                            <i className="fa-solid fa-search absolute right-3 md:top-1/2 md:-translate-y-1/2 top-7 text-slate-400"></i>
                            <input type="text" className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm font-semibold rounded-xl pr-10 p-3 outline-none focus:bg-white focus:border-indigo-400 transition-all placeholder-slate-400" placeholder="بحث بالبيانات..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                        </div>
                        <div className="flex gap-3 w-full md:w-auto">
                            <button onClick={() => handlePullNext()} className="bg-emerald-600 hover:bg-emerald-700 text-white w-full md:w-auto justify-center font-bold rounded-xl text-sm px-6 py-2.5 shadow-lg shadow-emerald-200 transition-all flex items-center gap-2">
                                <i className="fa-solid fa-bolt"></i> سحب التالي
                            </button>
                            <button onClick={() => setShowAddModal(true)} className={`w-full md:w-auto justify-center font-bold rounded-xl text-sm px-6 py-2.5 shadow-lg transition-all flex items-center gap-2 text-white ${isCodesSection ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-200' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'}`}>
                                <i className="fa-solid fa-plus"></i> إضافة {isCodesSection ? 'أكواد' : 'بيانات'}
                            </button>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex flex-wrap gap-3 items-center">
                        <div className="flex bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm overflow-x-auto w-full md:w-auto scrollbar-hide">
                            {[{ id: 'all', label: 'الكل', count: accountStats.total }, { id: 'available', label: 'متاح', count: accountStats.available }, { id: 'used', label: 'مستخدم', count: accountStats.used }, { id: 'completed', label: 'مكتمل', count: accountStats.full }, { id: 'damaged', label: 'تالف' }].map(f => (
                                <button key={f.id} onClick={() => setFilterStatus(f.id)} className={`px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap flex-1 md:flex-none flex items-center justify-center gap-1.5 ${filterStatus === f.id ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                                    {f.label}
                                    {f.count !== undefined && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${filterStatus === f.id ? 'bg-white/20' : 'bg-slate-100'}`}>{f.count}</span>}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Items List */}
                    {filteredAccounts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 bg-white rounded-3xl border-2 border-dashed border-slate-200 text-slate-400">
                            <i className={`fa-solid ${isCodesSection ? 'fa-key' : 'fa-server'} text-5xl mb-4 opacity-30`}></i>
                            <p className="font-bold text-lg">لا توجد {isCodesSection ? 'أكواد' : 'بيانات'} هنا</p>
                            <p className="text-sm mt-1">اضغط "إضافة {isCodesSection ? 'أكواد' : 'بيانات'}" لتغذية سجل {currentSection?.name}</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredAccounts.slice(0, visibleCount).map(acc => {
                                const st = getStatusInfo(acc.status);
                                return (
                                    <div key={acc.id} className="group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-indigo-200 transition-all overflow-hidden relative">
                                        <div className={`absolute top-0 bottom-0 right-0 w-1.5 ${st.dot}`}></div>
                                        <div className="p-5 flex flex-col md:flex-row gap-4 items-start md:items-center">
                                            <div className="flex-1 pr-3 min-w-0">
                                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                                    <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold border flex items-center gap-1 ${st.color}`}>
                                                        <i className={`fa-solid ${st.icon} text-[9px]`}></i> {st.label}
                                                    </span>
                                                    {acc.allowed_uses !== 1 && (
                                                        <span className="text-[10px] bg-slate-50 text-slate-500 px-2 py-0.5 rounded font-bold border border-slate-100">
                                                            {acc.current_uses} / {acc.allowed_uses === -1 ? '∞' : acc.allowed_uses}
                                                        </span>
                                                    )}
                                                    {acc.isWorkspace && (
                                                        <span className="text-[10px] bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded font-bold border border-cyan-200 flex items-center gap-1">
                                                            <i className="fa-solid fa-users-rectangle text-[8px]"></i> Workspace
                                                            {acc.workspaceMembers > 0 && <span>({acc.current_uses}/{acc.workspaceMembers} شخص)</span>}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex flex-col gap-1.5">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] text-slate-400 font-bold w-12 flex-shrink-0">{isCodesSection ? 'الكود' : 'البيانات'}</span>
                                                        <code className="text-sm font-mono font-bold text-slate-800 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 cursor-pointer hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-all truncate flex-1" onClick={() => copyToClipboard(acc.email, `email-${acc.id}`)} title="اضغط للنسخ">{acc.email}</code>
                                                        <button onClick={() => copyToClipboard(acc.email, `email-${acc.id}`)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition flex-shrink-0">
                                                            <i className={`fa-solid ${copiedId === `email-${acc.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-xs`}></i>
                                                        </button>
                                                    </div>
                                                    {acc.password && (
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] text-slate-400 font-bold w-12 flex-shrink-0">باسورد</span>
                                                            <code className="text-sm font-mono font-bold text-slate-800 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 cursor-pointer hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-all truncate flex-1" onClick={() => copyToClipboard(acc.password, `pass-${acc.id}`)} title="اضغط للنسخ">{acc.password}</code>
                                                            <button onClick={() => copyToClipboard(acc.password, `pass-${acc.id}`)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition flex-shrink-0">
                                                                <i className={`fa-solid ${copiedId === `pass-${acc.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-xs`}></i>
                                                            </button>
                                                        </div>
                                                    )}
                                                    {acc.twoFA && (
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] text-slate-400 font-bold w-12 flex-shrink-0">2FA</span>
                                                            <code className="text-[11px] font-mono font-bold text-purple-700 bg-purple-50 px-3 py-1.5 rounded-lg border border-purple-100 cursor-pointer hover:bg-purple-100 hover:border-purple-200 transition-all truncate flex-1" onClick={() => copyToClipboard(acc.twoFA, `2fa-${acc.id}`)} title="اضغط للنسخ">{acc.twoFA}</code>
                                                            <button onClick={() => copyToClipboard(acc.twoFA, `2fa-${acc.id}`)} className="w-8 h-8 flex items-center justify-center rounded-lg text-purple-300 hover:text-purple-600 hover:bg-purple-100 transition flex-shrink-0">
                                                                <i className={`fa-solid ${copiedId === `2fa-${acc.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-xs`}></i>
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex md:flex-col gap-2 mt-4 md:mt-0 flex-shrink-0">
                                                {acc.status !== 'completed' && acc.status !== 'damaged' && (
                                                    <button onClick={() => handleManualPull(acc)} className="w-9 h-9 flex items-center justify-center text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition border border-emerald-100" title="سحب مباشر">
                                                        <i className={`fa-solid ${copiedId === `pull-${acc.id}` ? 'fa-check' : 'fa-hand-holding-dollar'}`}></i>
                                                    </button>
                                                )}
                                                <button onClick={() => setEditingAccount(acc)} className="w-9 h-9 flex items-center justify-center text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-xl transition border border-blue-100" title="تعديل"><i className="fa-solid fa-pen"></i></button>
                                                <button onClick={() => deleteAccount(acc.id)} className="w-9 h-9 flex items-center justify-center text-red-600 bg-red-50 hover:bg-red-100 rounded-xl transition border border-red-100" title="حذف"><i className="fa-solid fa-trash"></i></button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            {visibleCount < filteredAccounts.length && (
                                <div className="flex justify-center mt-6">
                                    <button onClick={() => setVisibleCount(p => p + 20)} className="bg-white border-2 border-indigo-100 text-indigo-600 px-10 py-3 rounded-full font-bold hover:bg-indigo-50 transition-all flex items-center gap-2 shadow-sm">عرض المزيد <i className="fa-solid fa-chevron-down"></i></button>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}

            {/* ===== CREATE SECTION MODAL ===== */}
            {showSectionModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
                        <div className="p-6 bg-gradient-to-r from-purple-700 to-indigo-600 text-white flex justify-between items-center">
                            <h3 className="text-xl font-bold flex items-center gap-2"><i className="fa-solid fa-folder-plus"></i> إنشاء سجل جديد</h3>
                            <button onClick={() => setShowSectionModal(false)} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>
                        <form onSubmit={handleCreateSection} className="p-8 space-y-5">
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">اسم السجل</label>
                                <input name="sectionName" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all" placeholder="مثال: Gemini Pro أو أكواد ستيم..." required />
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-3">نوع السجل</label>
                                <div className="grid grid-cols-2 gap-3">
                                    <label className="flex flex-col items-center gap-2 p-5 rounded-2xl border-2 cursor-pointer transition-all has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 border-slate-200 hover:border-indigo-200 text-center">
                                        <input type="radio" name="sectionType" value="accounts" defaultChecked className="hidden" />
                                        <div className="w-14 h-14 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center text-2xl"><i className="fa-solid fa-user-shield"></i></div>
                                        <span className="text-sm font-extrabold text-slate-700">حسابات</span>
                                        <span className="text-[10px] text-slate-400 font-medium">إيميل + باسورد + 2FA</span>
                                    </label>
                                    <label className="flex flex-col items-center gap-2 p-5 rounded-2xl border-2 cursor-pointer transition-all has-[:checked]:border-amber-500 has-[:checked]:bg-amber-50 border-slate-200 hover:border-amber-200 text-center">
                                        <input type="radio" name="sectionType" value="codes" className="hidden" />
                                        <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center text-2xl"><i className="fa-solid fa-key"></i></div>
                                        <span className="text-sm font-extrabold text-slate-700">أكواد</span>
                                        <span className="text-[10px] text-slate-400 font-medium">أكواد تفعيل / سيريال</span>
                                    </label>
                                </div>
                            </div>
                            <div className="bg-blue-50 p-3.5 rounded-xl border border-blue-200">
                                <p className="text-[12px] text-blue-700 font-bold flex items-center gap-1.5"><i className="fa-solid fa-circle-info"></i> لربط هذا السجل بمنتج، اذهب لصفحة المنتجات واختر "ربط بالمخزون" من إعدادات المنتج.</p>
                            </div>
                            <button type="submit" className="w-full bg-indigo-600 text-white py-3.5 rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2">
                                <i className="fa-solid fa-check"></i> إنشاء السجل
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* ===== ADD ITEM MODAL ===== */}
            {showAddModal && currentSection && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                        <div className={`p-6 text-white flex justify-between items-center ${isCodesSection ? 'bg-gradient-to-r from-amber-600 to-orange-500' : 'bg-gradient-to-r from-purple-700 to-indigo-600'}`}>
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <i className={`fa-solid ${isCodesSection ? 'fa-key' : 'fa-plus-circle'}`}></i> إضافة {isCodesSection ? 'أكواد' : 'حسابات'} - {currentSection.name}
                            </h3>
                            <button onClick={() => setShowAddModal(false)} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>
                        <form onSubmit={handleAddAccount} className="p-8 space-y-5 overflow-y-auto">
                            <div className="flex bg-slate-100 p-1 rounded-xl mb-4 border border-slate-200 shadow-inner">
                                <button type="button" onClick={() => setIsBulkAdd(false)} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${!isBulkAdd ? 'bg-white text-indigo-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>إضافة فردية</button>
                                <button type="button" onClick={() => setIsBulkAdd(true)} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${isBulkAdd ? 'bg-white text-indigo-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>إضافة متعددة</button>
                            </div>

                            {isBulkAdd ? (
                                <div>
                                    <label className="block text-sm font-extrabold text-slate-800 mb-2">{isCodesSection ? 'الأكواد (كل كود في سطر)' : 'الحسابات (كل عنصر في سطر)'}</label>
                                    <textarea name="bulkData" rows="6" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all font-mono dir-ltr text-left resize-none" placeholder={isCodesSection ? 'XXXX-YYYY-ZZZZ\nAAAA-BBBB-CCCC' : 'email@domain.com | password | 2fa_code\nemail2@domain.com | pass2 | 2fa_code2'} required></textarea>
                                    {!isCodesSection && (
                                        <div className="mt-2 bg-indigo-50 p-3 rounded-xl border border-indigo-100">
                                            <p className="text-[11px] text-indigo-700 font-bold mb-1"><i className="fa-solid fa-info-circle ml-1"></i> الفورمات المدعومة:</p>
                                            <ul className="text-[10px] text-indigo-600 font-mono space-y-0.5 list-disc list-inside">
                                                <li>email | password | 2fa_code</li>
                                                <li>email:password:2fa_code</li>
                                                <li>email | password</li>
                                                <li>email:password</li>
                                            </ul>
                                            <p className="text-[10px] text-indigo-500 mt-1.5 font-medium">كود الـ 2FA هيتحول تلقائياً للينك: <span className="font-bold">servicehub-mail.cloud/2fa-code/</span></p>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-sm font-extrabold text-slate-800 mb-2">{isCodesSection ? 'الكود' : 'الإيميل أو البيانات'}</label>
                                        <input name="email" type="text" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all font-mono dir-ltr text-left" placeholder={isCodesSection ? 'XXXX-XXXX-XXXX' : 'user@example.com'} required />
                                    </div>
                                    {!isCodesSection && (
                                        <>
                                            <div>
                                                <label className="block text-sm font-extrabold text-slate-800 mb-2">الباسورد <span className="text-slate-400 font-medium">(اختياري)</span></label>
                                                <input name="password" type="text" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all font-mono dir-ltr text-left" placeholder="password123" />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-extrabold text-slate-800 mb-2">2FA Link <span className="text-slate-400 font-medium">(اختياري)</span></label>
                                                <input name="twoFA" type="text" className="w-full bg-white border-2 border-purple-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all font-mono dir-ltr text-left text-purple-700" placeholder="otpauth://totp/..." />
                                            </div>
                                        </>
                                    )}
                                </>
                            )}

                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">الحد الأقصى للاستخدام</label>
                                <div className="grid grid-cols-4 gap-2 mb-2">
                                    {[{ l: 'مرة واحدة', v: 1 }, { l: '3 مرات', v: 3 }, { l: '5 مرات', v: 5 }, { l: 'غير محدود', v: -1 }].map(d => (
                                        <button key={d.v} type="button" onClick={(e) => { e.target.closest('form').querySelector('[name=allowedUses]').value = d.v; }} className="py-2 px-1 rounded-xl border-2 border-slate-200 text-xs font-bold text-slate-600 hover:border-indigo-400 hover:bg-indigo-50 transition-all">{d.l}</button>
                                    ))}
                                </div>
                                <input name="allowedUses" type="number" defaultValue="1" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all" min="-1" />
                            </div>

                            {/* Workspace Options */}
                            <div className="bg-cyan-50/50 p-5 rounded-2xl border border-cyan-200 space-y-4">
                                <div className="text-xs font-black text-cyan-600 uppercase tracking-widest flex items-center gap-1.5">
                                    <i className="fa-solid fa-users-rectangle"></i> إعدادات Workspace (اختياري)
                                </div>
                                <label className="flex items-center gap-3 p-3 bg-white rounded-xl border border-cyan-100 cursor-pointer hover:bg-cyan-50 transition-colors">
                                    <input type="checkbox" name="isWorkspace" className="w-5 h-5 text-cyan-600 rounded focus:ring-cyan-500 border-cyan-300" />
                                    <span className="text-sm font-bold text-cyan-800">هذا الحساب Workspace (مجموعة عمل)</span>
                                </label>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">عدد الأشخاص المطلوب للاكتمال</label>
                                    <input name="workspaceMembers" type="number" defaultValue="5" min="1" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3 font-bold text-sm focus:ring-4 focus:ring-cyan-100 focus:border-cyan-500 outline-none transition-all" />
                                </div>
                                <p className="text-[10px] text-cyan-600 font-medium">
                                    <i className="fa-solid fa-info-circle ml-1"></i>
                                    الحساب ميتعلمش "مكتمل" غير لما العدد المضاف يوصل للحد ده
                                </p>
                            </div>

                            <button type="submit" className={`w-full text-white py-3.5 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 ${isCodesSection ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-200' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'}`}>
                                <i className="fa-solid fa-check"></i> حفظ
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* ===== EDIT MODAL ===== */}
            {editingAccount && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
                        <div className="p-6 bg-white border-b border-slate-100 flex justify-between items-center">
                            <h3 className="text-xl font-extrabold text-slate-800 flex items-center gap-2"><i className="fa-solid fa-pen-to-square text-blue-600"></i> تعديل</h3>
                            <button onClick={() => setEditingAccount(null)} className="bg-slate-50 hover:bg-slate-100 p-2 rounded-full transition text-slate-400"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>
                        <form onSubmit={handleEditAccount} className="p-8 space-y-5 overflow-y-auto" key={editingAccount.id}>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">{isCodesSection ? 'الكود' : 'الإيميل أو البيانات'}</label>
                                <input name="email" type="text" defaultValue={editingAccount.email} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all font-mono dir-ltr text-left" required />
                            </div>
                            {!isCodesSection && (
                                <>
                                    <div>
                                        <label className="block text-sm font-extrabold text-slate-800 mb-2">الباسورد</label>
                                        <input name="password" type="text" defaultValue={editingAccount.password} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all font-mono dir-ltr text-left" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-extrabold text-slate-800 mb-2">2FA Link</label>
                                        <input name="twoFA" type="text" defaultValue={editingAccount.twoFA} className="w-full bg-white border-2 border-purple-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all font-mono dir-ltr text-left text-purple-700" />
                                    </div>
                                </>
                            )}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-extrabold text-slate-800 mb-2">الحالة</label>
                                    <select name="status" defaultValue={editingAccount.status} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all">
                                        <option value="available">متاح</option><option value="used">مستخدم</option><option value="completed">مكتمل</option><option value="damaged">تالف</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-extrabold text-slate-800 mb-2">الحد الأقصى</label>
                                    <input name="allowedUses" type="number" defaultValue={editingAccount.allowed_uses} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all" min="-1" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">عدد الاستخدامات الحالي</label>
                                <input name="currentUses" type="number" defaultValue={editingAccount.current_uses} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all bg-slate-50" min="0" />
                            </div>
                            {/* Workspace Options */}
                            <div className="bg-cyan-50/50 p-5 rounded-2xl border border-cyan-200 space-y-4">
                                <div className="text-xs font-black text-cyan-600 uppercase tracking-widest flex items-center gap-1.5">
                                    <i className="fa-solid fa-users-rectangle"></i> إعدادات Workspace
                                </div>
                                <label className="flex items-center gap-3 p-3 bg-white rounded-xl border border-cyan-100 cursor-pointer hover:bg-cyan-50 transition-colors">
                                    <input type="checkbox" name="isWorkspace" defaultChecked={editingAccount.isWorkspace} className="w-5 h-5 text-cyan-600 rounded focus:ring-cyan-500 border-cyan-300" />
                                    <span className="text-sm font-bold text-cyan-800">هذا الحساب Workspace</span>
                                </label>
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 mb-1">عدد الأشخاص المطلوب</label>
                                    <input name="workspaceMembers" type="number" defaultValue={editingAccount.workspaceMembers || 5} min="1" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3 font-bold text-sm focus:ring-4 focus:ring-cyan-100 focus:border-cyan-500 outline-none transition-all" />
                                </div>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button type="button" onClick={() => setEditingAccount(null)} className="flex-1 py-3 rounded-xl font-bold text-slate-600 bg-white border-2 border-slate-200 hover:bg-slate-50 transition">إلغاء</button>
                                <button type="submit" className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 transition">حفظ التعديلات</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ===== PULLED RESULT MODAL ===== */}
            {pulledResult && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4 animate-fade-in" onClick={() => setPulledResult(null)}>
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-scale-in max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        {pulledResult.empty ? (
                            <>
                                <div className="p-6 bg-gradient-to-r from-red-600 to-orange-500 text-white text-center">
                                    <i className="fa-solid fa-box-open text-4xl mb-2 block opacity-80"></i>
                                    <h3 className="text-xl font-bold">المخزون فارغ!</h3>
                                </div>
                                <div className="p-8 text-center">
                                    <p className="text-slate-600 font-bold mb-2">لا توجد عناصر متاحة للسحب في سجل <span className="text-indigo-700">{pulledResult.sectionName || currentSection?.name}</span></p>
                                    <button onClick={() => setPulledResult(null)} className="mt-6 w-full bg-slate-800 text-white py-3.5 rounded-xl font-bold hover:bg-slate-900 shadow-lg shadow-slate-200 transition-all">حسناً</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="p-6 bg-gradient-to-r from-emerald-600 to-teal-500 text-white text-center">
                                    <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3"><i className="fa-solid fa-bolt text-3xl"></i></div>
                                    <h3 className="text-xl font-bold">تم السحب بنجاح!</h3>
                                    <p className="text-emerald-100 text-sm mt-1">تم نسخ البيانات تلقائياً • {pulledResult.sectionName}</p>
                                </div>
                                <div className="p-8 space-y-4">
                                    <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                                        <span className="text-sm font-bold text-slate-500">الحالة</span>
                                        <span className={`text-sm font-extrabold px-3 py-1 rounded-full ${pulledResult.status === 'completed' ? 'bg-slate-100 text-slate-500' : 'bg-orange-50 text-orange-600 border border-orange-200'}`}>
                                            {pulledResult.status === 'completed' ? '✅ مكتمل' : `📊 ${pulledResult.current_uses} / ${pulledResult.allowed_uses === -1 ? '∞' : pulledResult.allowed_uses}`}
                                        </span>
                                    </div>
                                    {pulledResult.is_workspace && (
                                        <div className="bg-cyan-50 p-3 rounded-xl border border-cyan-200 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <i className="fa-solid fa-users-rectangle text-cyan-600"></i>
                                                <span className="text-sm font-bold text-cyan-700">Workspace</span>
                                            </div>
                                            <div className="text-left">
                                                <span className="text-sm font-extrabold text-cyan-800">{pulledResult.current_uses} / {pulledResult.workspace_members || pulledResult.allowed_uses}</span>
                                                <span className="text-xs text-cyan-500 block">متبقي {(pulledResult.workspace_members || pulledResult.allowed_uses) - pulledResult.current_uses} شخص</span>
                                            </div>
                                        </div>
                                    )}
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-black text-slate-500 uppercase tracking-wide">البيانات</label>
                                        <div className="flex items-center">
                                            <code className="text-sm font-mono font-bold text-slate-800 bg-slate-50 px-4 py-3 rounded-r-xl border border-r-0 border-slate-200 flex-1 truncate select-all dir-ltr text-left">{pulledResult.email}</code>
                                            <button onClick={() => copyToClipboard(pulledResult.email, 'pulled-email')} className="h-[46px] w-[50px] flex items-center justify-center bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-100 rounded-l-xl transition">
                                                <i className={`fa-solid ${copiedId === 'pulled-email' ? 'fa-check text-emerald-500' : 'fa-copy'}`}></i>
                                            </button>
                                        </div>
                                    </div>
                                    {pulledResult.password && (
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-xs font-black text-slate-500 uppercase tracking-wide">الباسورد</label>
                                            <div className="flex items-center">
                                                <code className="text-sm font-mono font-bold text-slate-800 bg-slate-50 px-4 py-3 rounded-r-xl border border-r-0 border-slate-200 flex-1 truncate select-all dir-ltr text-left">{pulledResult.password}</code>
                                                <button onClick={() => copyToClipboard(pulledResult.password, 'pulled-pass')} className="h-[46px] w-[50px] flex items-center justify-center bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-100 rounded-l-xl transition">
                                                    <i className={`fa-solid ${copiedId === 'pulled-pass' ? 'fa-check text-emerald-500' : 'fa-copy'}`}></i>
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {(pulledResult.twoFA || pulledResult.two_fa) && (
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-xs font-black text-purple-500 uppercase tracking-wide">2FA Link</label>
                                            <div className="flex items-center">
                                                <code className="text-sm font-mono font-bold text-purple-700 bg-purple-50 px-4 py-3 rounded-r-xl border border-r-0 border-purple-200 flex-1 truncate select-all dir-ltr text-left">{pulledResult.twoFA || pulledResult.two_fa}</code>
                                                <button onClick={() => copyToClipboard(pulledResult.twoFA || pulledResult.two_fa, 'pulled-2fa')} className="h-[46px] w-[50px] flex items-center justify-center bg-purple-50 text-purple-600 hover:bg-purple-100 border border-purple-100 rounded-l-xl transition">
                                                    <i className={`fa-solid ${copiedId === 'pulled-2fa' ? 'fa-check text-emerald-500' : 'fa-copy'}`}></i>
                                                </button>
                                            </div>
                                            <a href={pulledResult.twoFA || pulledResult.two_fa} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-500 font-bold flex items-center gap-1 hover:text-purple-700 transition">
                                                <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i> فتح رابط الـ 2FA
                                            </a>
                                        </div>
                                    )}
                                    <button onClick={() => { let t = pulledResult.email; if (pulledResult.password) t += `\n${pulledResult.password}`; if (pulledResult.twoFA || pulledResult.two_fa) t += `\n${pulledResult.twoFA || pulledResult.two_fa}`; copyToClipboard(t, 'pulled-all'); }}
                                        className={`w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 border-2 ${copiedId === 'pulled-all' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'}`}>
                                        <i className={`fa-solid ${copiedId === 'pulled-all' ? 'fa-check' : 'fa-clipboard'}`}></i>
                                        {copiedId === 'pulled-all' ? 'تم النسخ ✓' : 'نسخ كل البيانات'}
                                    </button>
                                    <div className="flex gap-3 pt-2">
                                        <button onClick={() => setPulledResult(null)} className="flex-1 py-3 rounded-xl font-bold text-slate-600 bg-white border-2 border-slate-200 hover:bg-slate-50 transition">إغلاق</button>
                                        <button onClick={() => { const name = pulledResult.sectionName; setPulledResult(null); handlePullNext(name); }} className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all flex items-center justify-center gap-2">
                                            <i className="fa-solid fa-bolt"></i> سحب التالي
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ===== ADD LINK MODAL ===== */}
            {showLinkModal && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[999] p-4 animate-fade-in">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-scale-in">
                        <div className="p-6 bg-gradient-to-r from-violet-600 to-purple-600 text-white flex justify-between items-center">
                            <h3 className="text-xl font-bold flex items-center gap-2"><i className="fa-solid fa-link"></i> إضافة رابط سريع</h3>
                            <button onClick={() => setShowLinkModal(false)} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>
                        <form onSubmit={handleAddLink} className="p-8 space-y-5">
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">اسم الرابط</label>
                                <input name="linkLabel" type="text" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-violet-100 focus:border-violet-600 outline-none transition-all" placeholder="مثال: 2FA Code أو Dashboard..." required />
                            </div>
                            <div>
                                <label className="block text-sm font-extrabold text-slate-800 mb-2">الرابط (URL)</label>
                                <input name="linkUrl" type="text" className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-violet-100 focus:border-violet-600 outline-none transition-all font-mono dir-ltr text-left" placeholder="https://example.com/..." required />
                            </div>
                            <button type="submit" className="w-full bg-violet-600 text-white py-3.5 rounded-xl font-bold hover:bg-violet-700 shadow-lg shadow-violet-200 transition-all flex items-center justify-center gap-2">
                                <i className="fa-solid fa-check"></i> حفظ الرابط
                            </button>
                        </form>
                    </div>
                </div>
            )}

            <style>{`
                .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
                .animate-scale-in { animation: scaleIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
                @keyframes scaleIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
            `}</style>
        </div>
    );
}