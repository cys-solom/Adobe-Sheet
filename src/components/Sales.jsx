import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { salesAPI, accountsAPI, walletsAPI, customersAPI, sheetsAPI } from '../services/api';
import { sanitizeRecord } from '../utils/dataRepair';
import * as XLSX from 'xlsx';
import { useConfirm } from './ConfirmDialog';

export default function Sales() {
    const { user, hasPermission } = useAuth();
    const { products, sales: ctxSales, wallets: ctxWallets, customers: ctxCustomers, accounts: ctxAccounts, refreshData } = useData();
    const isAdmin = user?.role === 'admin' || hasPermission('all');
    const { showConfirm, showAlert } = useConfirm();

    // ========= States =========
    const [sales, setSales] = useState([]);
    const [wallets, setWallets] = useState([]);
    const [customers, setCustomers] = useState([]);

    const [showProductModal, setShowProductModal] = useState(false);
    const [showSaleModal, setShowSaleModal] = useState(false);
    const [editingProduct, setEditingProduct] = useState(null);
    const [editingSale, setEditingSale] = useState(null);
    
    // Account assignment details modal
    const [assignedAccountDetails, setAssignedAccountDetails] = useState(null);
    const [copiedId, setCopiedId] = useState(null);

    // Delete confirmation modal for inventory-linked sales
    const [deleteModal, setDeleteModal] = useState(null); // { saleId, email, accountId }
    const [deleteLoading, setDeleteLoading] = useState(false);

    // Customer management state
    const [customerType, setCustomerType] = useState('new'); // 'new' | 'existing'
    const [selectedCustomerId, setSelectedCustomerId] = useState('');
    const [sheetAccounts, setSheetAccounts] = useState([]);
    const [selectedSheetAccountId, setSelectedSheetAccountId] = useState('');
    const [accountUsageMode, setAccountUsageMode] = useState('shared_one_device');
    const [contactChannel, setContactChannel] = useState('واتساب');
    const [customerSearch, setCustomerSearch] = useState('');
    const formRef = useRef(null);

    // Sale type state (personal / workspace)
    const [saleType, setSaleType] = useState('personal');
    const [workspaceEmail, setWorkspaceEmail] = useState('');

    const [searchTerm, setSearchTerm] = useState('');
    const [productFilters, setProductFilters] = useState([]); // array of selected product names
    const [statusFilter, setStatusFilter] = useState('all');
    const [visibleCount, setVisibleCount] = useState(15);

    // ========= Sync from context =========
    useEffect(() => {
        setSales(ctxSales);
        setWallets(ctxWallets);
        setCustomers(ctxCustomers);
    }, [ctxSales, ctxWallets, ctxCustomers]);

    useEffect(() => {
        let alive = true;

        const loadSheetAccounts = async () => {
            try {
                const records = await sheetsAPI.getSheetRecords('account_data');
                if (!alive) return;
                setSheetAccounts((records || []).map((item, index) => sanitizeRecord(item, index)).filter(Boolean));
            } catch (error) {
                console.warn('Failed to load account_data records for sale form:', error);
                if (alive) setSheetAccounts([]);
            }
        };

        loadSheetAccounts();
        return () => { alive = false; };
    }, [showSaleModal]);

    // Reset customer form when modal opens
    useEffect(() => {
        if (showSaleModal) {
            if (editingSale) {
                // When editing, find matching customer
                const existingCustomer = customers.find(c => c.id === editingSale.customerId);
                if (existingCustomer) {
                    setCustomerType('existing');
                    setSelectedCustomerId(existingCustomer.id);
                } else {
                    setCustomerType('new');
                    setSelectedCustomerId('');
                }
                setContactChannel(editingSale.contactChannel || 'واتساب');
                setSelectedSheetAccountId(String(editingSale.assignedAccountId || '').startsWith('sheet:')
                    ? String(editingSale.assignedAccountId).replace('sheet:', '')
                    : '');
                setAccountUsageMode(String(editingSale.notes || '').includes('account_usage:personal')
                    ? 'personal'
                    : String(editingSale.notes || '').includes('account_usage:shared_two_devices')
                    ? 'shared_two_devices'
                    : 'shared_one_device');
                setSaleType(editingSale.saleType || 'personal');
                setWorkspaceEmail(editingSale.workspaceEmail || '');
            } else {
                setCustomerType('new');
                setSelectedCustomerId('');
                setSelectedSheetAccountId('');
                setAccountUsageMode('shared_one_device');
                setContactChannel('واتساب');
                setSaleType('personal');
                setWorkspaceEmail('');
            }
            setCustomerSearch('');
        }
    }, [showSaleModal, editingSale]);

    // Auto-fill form when selecting existing customer
    const handleSelectCustomer = (custId) => {
        setSelectedCustomerId(custId);
        const customer = customers.find(c => String(c.id) === String(custId));
        if (customer && formRef.current) {
            const nameInput = formRef.current.querySelector('[name="customerName"]');
            const phoneInput = formRef.current.querySelector('[name="customerPhone"]');
            const emailInput = formRef.current.querySelector('[name="customerEmail"]');
            if (nameInput) nameInput.value = customer.name || '';
            if (phoneInput) phoneInput.value = customer.phone || '';
            if (emailInput) emailInput.value = customer.email || '';
            setContactChannel(customer.contactChannel || 'واتساب');
        }
    };

    const handleSelectSheetAccount = (accountId) => {
        setSelectedSheetAccountId(accountId);
        setAccountUsageMode('shared_one_device');
        const account = sheetAccounts.find(item => String(item.id) === String(accountId));
        if (!account || !formRef.current) return;

        const emailInput = formRef.current.querySelector('[name="customerEmail"]');
        const passwordInput = formRef.current.querySelector('[name="customerPassword"]');
        const notesInput = formRef.current.querySelector('[name="notes"]');

        if (emailInput) emailInput.value = account.email || '';
        if (passwordInput) passwordInput.value = account.password2 || '';
        if (notesInput && account.selectedAccount && !notesInput.value.includes(account.selectedAccount)) {
            notesInput.value = notesInput.value
                ? `${notesInput.value} | بيانات الحساب: ${account.selectedAccount}`
                : `بيانات الحساب: ${account.selectedAccount}`;
        }
    };

    const updateSheetAccountUsage = async (accountId, delta, usageMode = 'shared_one_device') => {
        if (!accountId) return;
        const records = await sheetsAPI.getSheetRecords('account_data');
        const sanitized = (records || []).map((item, index) => sanitizeRecord(item, index)).filter(Boolean);
        const updated = sanitized.map(item => {
            if (String(item.id) !== String(accountId)) return item;
            const maxUses = Math.max(1, Number(item.maxUses || 2));
            const currentUses = Math.min(maxUses, Math.max(0, Number(item.currentUses || 0) + delta));
            const accountUsageStatus = currentUses <= 0
                ? 'available'
                : currentUses >= maxUses
                ? (usageMode === 'personal' ? 'personal' : 'shared_two_devices')
                : 'shared_one_device';
            return {
                ...item,
                currentUses,
                maxUses,
                accountUsageStatus,
                updated_at: new Date().toISOString()
            };
        });

        await sheetsAPI.saveSheetRecords('account_data', updated);
        setSheetAccounts(updated);
    };

    // Get filtered customers for search
    const filteredCustomers = useMemo(() => {
        if (!customerSearch) return customers;
        const term = customerSearch.toLowerCase();
        return customers.filter(c =>
            (c.name && c.name.toLowerCase().includes(term)) ||
            (c.phone && c.phone.includes(term)) ||
            (c.email && c.email.toLowerCase().includes(term))
        );
    }, [customers, customerSearch]);

    // ========= Wallet Deposit Helper =========
    const depositToWallet = async (walletId, amount, description) => {
        if (!walletId) return;
        await walletsAPI.deposit(walletId, amount, description, 'مبيعات', 'System');
    };

    // ========= Filtered Sales =========
    const copyToClipboard = (text, id) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1500);
    };

    const toggleProductFilter = (name) => {
        setProductFilters(prev => 
            prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
        );
    };

    // Build duplicate email set (excluding renewals)
    const duplicateEmails = useMemo(() => {
        const emailCounts = {};
        sales.forEach(s => {
            if (!s.customerEmail || s.renewal_stage === 'renewed') return;
            const key = s.customerEmail.toLowerCase().trim();
            emailCounts[key] = (emailCounts[key] || 0) + 1;
        });
        return new Set(Object.keys(emailCounts).filter(k => emailCounts[k] > 1));
    }, [sales]);

    const filteredSales = useMemo(() => {
        return sales.filter(s => {
            const matchProduct = productFilters.length === 0 || productFilters.includes(s.productName);
            const matchStatus = statusFilter === 'all'
                ? true
                : statusFilter === 'paid' ? s.isPaid
                : statusFilter === 'unpaid' ? !s.isPaid
                : statusFilter === 'activated' ? s.isActivated
                : statusFilter === 'notActivated' ? !s.isActivated
                : statusFilter === 'hasDiscount' ? s.discount > 0
                : statusFilter === 'duplicates' ? (s.customerEmail && duplicateEmails.has(s.customerEmail.toLowerCase().trim()) && s.renewal_stage !== 'renewed')
                : true;
            const term = searchTerm.toLowerCase();
            const matchSearch = !term ||
                (s.customerEmail && s.customerEmail.toLowerCase().includes(term)) ||
                (s.customerName && s.customerName.toLowerCase().includes(term)) ||
                (s.customerPhone && s.customerPhone.includes(term)) ||
                (s.productName && s.productName.toLowerCase().includes(term)) ||
                (s.notes && s.notes.toLowerCase().includes(term));
            return matchProduct && matchStatus && matchSearch;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));
    }, [sales, productFilters, statusFilter, searchTerm, duplicateEmails]);

    const stats = useMemo(() => {
        const totalRevenue = filteredSales.reduce((sum, s) => sum + (Number(s.finalPrice) || 0), 0);
        const totalCollected = filteredSales.filter(s => s.isPaid).reduce((sum, s) => sum + (Number(s.finalPrice) || 0), 0);
        const totalRemaining = filteredSales.filter(s => !s.isPaid).reduce((sum, s) => sum + (Number(s.remainingAmount) || Number(s.finalPrice) || 0), 0);
        const totalDebtCount = filteredSales.filter(s => !s.isPaid && Number(s.remainingAmount) > 0).length;
        
        // Daily revenue
        const todayStr = new Date().toDateString();
        const todaySales = filteredSales.filter(s => new Date(s.date).toDateString() === todayStr);
        const dailyRevenue = todaySales.reduce((sum, s) => sum + (Number(s.finalPrice) || 0), 0);
        const dailyCount = todaySales.length;

        // Renewal alerts (expiring within 5 days or already expired)
        const renewalAlerts = sales.filter(s => {
            if (!s.expiryDate || s.renewal_stage === 'renewed') return false;
            const daysLeft = Math.ceil((new Date(s.expiryDate) - new Date()) / 86400000);
            return daysLeft <= 5;
        }).length;

        return { totalRevenue, totalCollected, totalRemaining, totalDebtCount, count: filteredSales.length, dailyRevenue, dailyCount, renewalAlerts };
    }, [filteredSales, sales]);



    // ========= Sale CRUD =========
    const handleSaveSale = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const productName = formData.get('productName');
        const product = products.find(p => p.name === productName);
        const originalPrice = product ? product.price : 0;
        const discount = Number(formData.get('discount') || 0);
        const finalPrice = Math.max(0, originalPrice - discount);
        const isPaid = formData.get('isPaid') === 'on';
        const walletId = formData.get('walletId') || '';
        const remainingAmount = Number(formData.get('remainingAmount') || 0);

        // Wallet is REQUIRED when customer has paid anything
        const hasPaidSomething = isPaid || (!isPaid && remainingAmount > 0 && remainingAmount < finalPrice);
        if (!walletId && hasPaidSomething) {
            showAlert({ title: 'خطأ', message: 'يجب اختيار المحفظة عند الدفع (كامل أو جزئي)', type: 'warning' });
            return;
        }

        // اسم المحفظة
        const wallet = walletId ? wallets.find(w => String(w.id) === String(walletId)) : null;

        // مدة الاشتراك من المنتج
        const productDuration = product ? (product.duration || 30) : 30;
        
        // تاريخ البيع - لو المستخدم اختار تاريخ قديم يستخدمه، غير كده تاريخ اليوم
        const customDateStr = formData.get('saleDate');
        let saleDate;
        if (editingSale) {
            saleDate = editingSale.date || new Date().toISOString();
        } else if (customDateStr) {
            // المستخدم اختار تاريخ محدد
            saleDate = new Date(customDateStr).toISOString();
        } else {
            saleDate = new Date().toISOString();
        }
        const expiryDate = new Date(new Date(saleDate).getTime() + productDuration * 86400000).toISOString();

        // Customer handling
        const customerName = formData.get('customerName') || '';
        const customerPhone = formData.get('customerPhone') || '';
        const customerEmail = formData.get('customerEmail') || '';
        const selectedChannel = contactChannel;
        const selectedSheetAccount = selectedSheetAccountId
            ? sheetAccounts.find(item => String(item.id) === String(selectedSheetAccountId))
            : null;
        const selectedAccountUsageMode = selectedSheetAccount ? accountUsageMode : 'shared_one_device';

        // Save/update customer record
        let customerId = selectedCustomerId;
        
        try {
            if (customerType === 'new' && customerName) {
                customerId = await customersAPI.upsert({
                    name: customerName,
                    phone: customerPhone,
                    email: customerEmail,
                    contactChannel: selectedChannel,
                });
            } else if (customerType === 'existing' && customerId) {
                await customersAPI.updateLastOrder(customerId, customerEmail);
            }

            const data = {
                productName,
                originalPrice,
                discount,
                finalPrice,
                duration: productDuration,
                expiryDate,
                date: saleDate,
                customerId: customerId || '',
                customerName,
                customerPhone,
                customerEmail,
                contactChannel: selectedChannel,
                isPaid,
                remainingAmount: isPaid ? 0 : (remainingAmount || finalPrice),
                paymentMethod: wallet ? wallet.name : (formData.get('paymentMethod') || ''),
                walletId: walletId,
                walletName: wallet ? wallet.name : '',
                notes: formData.get('notes') || '',
                moderator: user?.username || 'Admin',
                fromInventory: false,
                assignedAccountEmail: '',
                assignedAccountId: null,
                saleType: saleType,
                workspaceEmail: saleType === 'workspace' ? workspaceEmail : '',
                isActivated: false,
                customerPassword: formData.get('customerPassword')?.trim() || '',
            };

            if (selectedSheetAccount) {
                data.fromInventory = true;
                data.assignedAccountEmail = selectedSheetAccount.email || customerEmail || '';
                data.assignedAccountId = `sheet:${selectedSheetAccount.id}`;
                data.customerEmail = customerEmail || selectedSheetAccount.email || '';
                data.customerPassword = formData.get('customerPassword')?.trim() || selectedSheetAccount.password2 || '';
                data.notes = [
                    data.notes,
                    selectedSheetAccount.selectedAccount ? `بيانات الحساب: ${selectedSheetAccount.selectedAccount}` : '',
                    selectedAccountUsageMode === 'personal' ? 'نوع الحساب: شخصي | account_usage:personal' : '',
                    selectedAccountUsageMode === 'shared_one_device' ? 'نوع الحساب: مشترك - خرج جهاز واحد | account_usage:shared_one_device' : '',
                    selectedAccountUsageMode === 'shared_two_devices' ? 'نوع الحساب: مشترك - خرج الجهازين | account_usage:shared_two_devices' : '',
                ].filter(Boolean).join(' | ');
            }

            if (editingSale) {
                // حافظ على بيانات المخزون الأصلية عند التعديل
                data.fromInventory = selectedSheetAccount ? true : editingSale.fromInventory;
                data.assignedAccountEmail = selectedSheetAccount ? (selectedSheetAccount.email || data.customerEmail || '') : editingSale.assignedAccountEmail;
                data.assignedAccountId = selectedSheetAccount ? `sheet:${selectedSheetAccount.id}` : editingSale.assignedAccountId;
                data.saleType = saleType;
                data.workspaceEmail = saleType === 'workspace' ? workspaceEmail : '';
                data.isActivated = editingSale.isActivated;
                data.customerPassword = formData.get('customerPassword')?.trim() || selectedSheetAccount?.password2 || '';
                await salesAPI.update(editingSale.id, data);
            } else {
                // سحب من المخزون لو المنتج مربوط بالمخزون ونوعه from_stock
                if (!selectedSheetAccount && product && product.inventoryProduct && product.fulfillmentType === 'from_stock') {
                    const allAccounts = ctxAccounts || [];
                    const availableAccount = allAccounts.find(acc => 
                        acc.productName === product.inventoryProduct && 
                        acc.status !== 'damaged' && acc.status !== 'completed' &&
                        (Number(acc.allowed_uses) === -1 || Number(acc.current_uses) < Number(acc.allowed_uses))
                    );
                    if (availableAccount) {
                        data.assignedAccountEmail = availableAccount.email;
                        data.assignedAccountId = availableAccount.id;
                        data.fromInventory = true;
                        // تحديث المخزون
                        const newUses = Number(availableAccount.current_uses) + 1;
                        const newStatus = (Number(availableAccount.allowed_uses) !== -1 && newUses >= Number(availableAccount.allowed_uses)) ? 'completed' : 'used';
                        await accountsAPI.update(availableAccount.id, { current_uses: newUses, status: newStatus });

                        setAssignedAccountDetails({
                            email: availableAccount.email,
                            password: availableAccount.password,
                            twoFA: availableAccount.twoFA,
                            productName: availableAccount.productName,
                            isNew: true
                        });
                    } else {
                        data.assignedAccountEmail = '⚠️ لا يوجد حساب متاح';
                        data.fromInventory = true;
                    }
                }

                await salesAPI.create(data);
                if (selectedSheetAccount) {
                    const maxUses = Math.max(1, Number(selectedSheetAccount.maxUses || 2));
                    const currentUses = Math.max(0, Number(selectedSheetAccount.currentUses || 0));
                    const usageDelta = selectedAccountUsageMode === 'shared_one_device' ? 1 : Math.max(1, maxUses - currentUses);
                    await updateSheetAccountUsage(selectedSheetAccount.id, usageDelta, selectedAccountUsageMode);
                }

                // إيداع المبلغ المدفوع في المحفظة
                if (walletId && isPaid) {
                    await depositToWallet(walletId, finalPrice, `بيع ${productName} — ${data.customerEmail}`);
                } else if (walletId && !isPaid && finalPrice > (Number(data.remainingAmount) || 0)) {
                    const paidAmount = finalPrice - (Number(data.remainingAmount) || 0);
                    if (paidAmount > 0) await depositToWallet(walletId, paidAmount, `بيع جزئي ${productName} — ${data.customerEmail}`);
                }
            }

            setShowSaleModal(false);
            setEditingSale(null);
            await refreshData();
        } catch (error) {
            console.error('Error saving sale:', error);
            showAlert({ title: 'خطأ!', message: 'حدث خطأ أثناء الحفظ: ' + (error?.message || error?.details || 'خطأ غير معروف'), type: 'danger' });
        }
    };

    const showAccountDetails = (sale) => {
        if (sale.fromInventory && String(sale.assignedAccountId || '').startsWith('sheet:')) {
            const sheetId = String(sale.assignedAccountId).replace('sheet:', '');
            const account = sheetAccounts.find(a => String(a.id) === sheetId);
            setAssignedAccountDetails({
                email: account?.email || sale.assignedAccountEmail || 'تم حذف الحساب',
                password: account?.password2 || sale.customerPassword || '',
                twoFA: account?.password || '',
                productName: account?.selectedAccount || sale.productName,
                fromSheet: true,
                isNew: false
            });
            return;
        }

        if (sale.fromInventory && sale.assignedAccountId) {
            const account = (ctxAccounts || []).find(a => a.id === sale.assignedAccountId);
            if (account) {
                setAssignedAccountDetails({
                    email: account.email,
                    password: account.password,
                    twoFA: account.twoFA,
                    productName: account.productName || sale.productName,
                    fromSheet: false,
                    isNew: false
                });
            } else {
                setAssignedAccountDetails({
                    email: sale.assignedAccountEmail || 'تم حذف الحساب',
                    password: '',
                    twoFA: '',
                    productName: sale.productName,
                    fromSheet: false,
                    isNew: false
                });
            }
        } else {
            setAssignedAccountDetails({
                email: sale.customerEmail || sale.customerName || 'لا يوجد إيميل',
                password: '',
                twoFA: '',
                productName: sale.productName,
                fromSheet: false,
                isNew: false
            });
        }
    };

    // ========= عكس المحفظة عند حذف مبيعة =========
    const reverseWalletForSale = async (sale) => {
        if (!sale || !sale.walletId) return;

        // حساب المبلغ اللي اتدفع في المحفظة
        let depositedAmount = 0;
        if (sale.isPaid) {
            depositedAmount = Number(sale.finalPrice) || 0;
        } else {
            // لو مدفوع جزئي: الإجمالي - المتبقي = اللي اتدفع
            const remaining = Number(sale.remainingAmount) || 0;
            const total = Number(sale.finalPrice) || 0;
            depositedAmount = total - remaining;
        }

        if (depositedAmount <= 0) return;

        try {
            // البحث عن سجل الإيداع المطابق في حركات المحفظة
            const txns = await walletsAPI.getTransactions(sale.walletId);
            const matchingTxn = txns.find(t =>
                t.type === 'deposit' &&
                Math.abs(Number(t.amount) - depositedAmount) < 0.01 &&
                t.description && (
                    t.description.includes(sale.productName) ||
                    (sale.customerEmail && t.description.includes(sale.customerEmail))
                )
            );

            if (matchingTxn) {
                // حذف السجل + عكس الرصيد تلقائياً
                await walletsAPI.deleteTransaction(matchingTxn);
            } else {
                // Fallback: لو مالقيناش السجل — نسحب المبلغ يدوياً
                await walletsAPI.withdraw(
                    sale.walletId,
                    depositedAmount,
                    `استرداد — حذف بيع ${sale.productName}`,
                    'حذف مبيعة',
                    'System'
                );
            }
        } catch (e) {
            console.warn('Error reversing wallet for deleted sale:', e);
        }
    };

    const deleteSale = async (id) => {
        const sale = sales.find(s => s.id === id);
        if (!sale) return;

        if (sale.fromInventory && String(sale.assignedAccountId || '').startsWith('sheet:')) {
            const confirmed = await showConfirm({
                title: 'حذف البيع',
                message: 'سيتم حذف البيع وإرجاع الميل كمتاح مرة أخرى في بيانات الحساب. هل أنت متأكد؟',
                confirmText: 'حذف وإرجاع',
                cancelText: 'إلغاء',
                type: 'danger'
            });
            if (!confirmed) return;
            try {
                await reverseWalletForSale(sale);
                const isTwoDeviceSale = String(sale.notes || '').includes('account_usage:personal')
                    || String(sale.notes || '').includes('account_usage:shared_two_devices')
                    || String(sale.notes || '').includes('اشترى الجهازين');
                await updateSheetAccountUsage(String(sale.assignedAccountId).replace('sheet:', ''), isTwoDeviceSale ? -2 : -1);
                await salesAPI.delete(id);
                await refreshData();
            } catch (error) {
                console.error(error);
                showAlert({ title: 'خطأ!', message: 'حدث خطأ أثناء حذف البيع: ' + (error?.message || ''), type: 'danger' });
            }
            return;
        }

        // لو الأوردر مربوط بحساب من المخزون — افتح المودال
        if (sale.fromInventory && sale.assignedAccountId) {
            setDeleteModal({
                saleId: id,
                email: sale.assignedAccountEmail,
                accountId: sale.assignedAccountId,
                productName: sale.productName,
            });
        } else {
            const confirmed = await showConfirm({
                title: 'حذف البيع',
                message: 'هل أنت متأكد من حذف هذا البيع؟',
                confirmText: 'حذف',
                cancelText: 'إلغاء',
                type: 'danger'
            });
            if (!confirmed) return;
            try {
                // عكس المحفظة قبل الحذف
                await reverseWalletForSale(sale);
                await salesAPI.delete(id);
                await refreshData();
            } catch (error) {
                console.error(error);
            }
        }
    };

    const confirmDeleteWithInventory = async (returnStatus) => {
        if (!deleteModal) return;
        setDeleteLoading(true);
        try {
            if (returnStatus) {
                const account = (ctxAccounts || []).find(a => a.id === deleteModal.accountId);
                if (account) {
                    const newUses = Math.max(0, Number(account.current_uses) - 1);
                    await accountsAPI.update(account.id, { status: returnStatus, current_uses: newUses });
                }
            }
            // عكس المحفظة قبل الحذف
            const sale = sales.find(s => s.id === deleteModal.saleId);
            if (sale) await reverseWalletForSale(sale);

            await salesAPI.delete(deleteModal.saleId);
            setDeleteModal(null);
            await refreshData();
        } catch (error) {
            console.error(error);
            showAlert({ title: 'خطأ!', message: 'حدث خطأ: ' + (error?.message || ''), type: 'danger' });
        }
        setDeleteLoading(false);
    };

    const togglePaid = async (id) => {
        const sale = sales.find(s => s.id === id);
        if (!sale) return;
        try {
            const newPaid = !sale.isPaid;
            await salesAPI.togglePaid(id, newPaid, sale.finalPrice, newPaid ? sale : null);
            await refreshData();
        } catch (error) {
            console.error(error);
        }
    };

    const toggleActivated = async (id) => {
        const sale = sales.find(s => s.id === id);
        if (!sale) return;
        try {
            const newActivated = !sale.isActivated;
            await salesAPI.toggleActivated(id, newActivated, newActivated ? sale : null);
            await refreshData();
        } catch (error) {
            console.error(error);
        }
    };

    // Copy credentials to clipboard
    const copyCredentials = (sale) => {
        let text = sale.customerEmail || '';
        if (sale.customerPassword) text += '\n' + sale.customerPassword;
        navigator.clipboard.writeText(text).then(() => {
            setCopiedId(sale.id);
            setTimeout(() => setCopiedId(null), 2000);
        });
    };

    // ========= Export =========
    const exportExcel = () => {
        const ws = XLSX.utils.json_to_sheet(filteredSales.map(s => ({
            "المنتج": s.productName, "اسم العميل": s.customerName, "الهاتف": s.customerPhone, "الإيميل": s.customerEmail,
            "السعر": s.originalPrice, "الخصم": s.discount, "الإجمالي": s.finalPrice,
            "حالة الدفع": s.isPaid ? 'مدفوع' : 'غير مدفوع', "المتبقي": s.remainingAmount,
            "وسيلة التواصل": s.contactChannel, "التاريخ": new Date(s.date).toLocaleDateString('ar-EG'),
            "المودريتور": s.moderator
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sales");
        XLSX.writeFile(wb, `ServiceHub_Sales_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const openAddSale = () => { setEditingSale(null); setShowSaleModal(true); };
    const openEditSale = (sale) => { setEditingSale(sale); setShowSaleModal(true); };

    // ========= Render =========
    return (
        <div className="space-y-5 animate-fade-in pb-24 font-sans text-slate-800">

            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-gradient-to-br from-indigo-600 to-blue-700 rounded-2xl p-4 text-white shadow-lg shadow-indigo-200/50">
                    <div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center"><i className="fa-solid fa-receipt text-sm"></i></div></div>
                    <h3 className="text-2xl font-black">{stats.count}</h3>
                    <p className="text-indigo-200 text-[11px] font-bold mt-0.5">إجمالي الأوردرات</p>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-orange-500"></div>
                    <div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center"><i className="fa-solid fa-bell text-orange-500 text-sm"></i></div></div>
                    <h3 className="text-2xl font-black text-orange-600">{stats.renewalAlerts}</h3>
                    <p className="text-slate-400 text-[11px] font-bold mt-0.5">تنبيهات التجديد</p>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
                    <div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 bg-red-50 rounded-lg flex items-center justify-center"><i className="fa-solid fa-hand-holding-dollar text-red-500 text-sm"></i></div></div>
                    <h3 className="text-xl font-black text-red-600 dir-ltr">{stats.totalRemaining.toLocaleString()}<span className="text-red-300 text-xs"> ج.م</span></h3>
                    <p className="text-slate-400 text-[11px] font-bold mt-0.5">مديونيات ({stats.totalDebtCount})</p>
                </div>
            </div>

            {/* ============ SALES LIST ============ */}
                <div className="space-y-5">
                    {/* Toolbar */}
                    <div className="bg-white/95 backdrop-blur-xl p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-3 items-center justify-between sticky top-2 z-30">
                        <div className="relative w-full md:w-80">
                            <i className="fa-solid fa-search absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                            <input type="text" className="w-full bg-white border-2 border-slate-200 text-slate-900 text-sm font-semibold rounded-xl pr-10 p-3 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all placeholder-slate-400" placeholder="بحث بالاسم أو الرقم أو الإيميل أو المنتج..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                        </div>
                        <div className="flex gap-3 w-full md:w-auto">
                            <button onClick={exportExcel} className="bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 font-bold rounded-xl text-sm px-4 py-3 transition-all" title="تصدير Excel"><i className="fa-solid fa-file-excel"></i></button>
                            <button onClick={openAddSale} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm px-8 py-3 shadow-lg shadow-indigo-200 transition-all flex items-center gap-2">
                                <i className="fa-solid fa-plus"></i> بيع جديد
                            </button>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex flex-wrap gap-3 items-center">
                        <div className="flex bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm flex-wrap">
                            {[{ id: 'all', label: 'الكل' }, { id: 'paid', label: 'مدفوع' }, { id: 'unpaid', label: 'غير مدفوع' }, { id: 'activated', label: 'مفعّل' }, { id: 'notActivated', label: 'غير مفعّل' }, { id: 'hasDiscount', label: 'خصومات' }, { id: 'duplicates', label: `مكرر (${duplicateEmails.size})` }].map(f => (
                                <button key={f.id} onClick={() => setStatusFilter(f.id)} className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-bold transition-all ${statusFilter === f.id ? (f.id === 'duplicates' ? 'bg-red-600 text-white shadow-md' : 'bg-indigo-600 text-white shadow-md') : 'text-slate-500 hover:bg-slate-50'}`}>{f.label}</button>
                            ))}
                        </div>
                        {/* Product filter dropdown */}
                        <div className="relative">
                            <select
                                value={productFilters.length === 1 ? productFilters[0] : ''}
                                onChange={e => {
                                    const val = e.target.value;
                                    if (val === '') setProductFilters([]);
                                    else setProductFilters([val]);
                                }}
                                className={`appearance-none bg-white border-2 rounded-xl py-2 pr-4 pl-9 text-sm font-bold cursor-pointer outline-none transition-all ${productFilters.length > 0 ? 'border-indigo-400 text-indigo-700 bg-indigo-50' : 'border-slate-200 text-slate-600 hover:border-indigo-200'}`}
                            >
                                <option value="">كل المنتجات</option>
                                {products.map(p => (
                                    <option key={p.id} value={p.name}>{p.name}</option>
                                ))}
                            </select>
                            <i className={`fa-solid fa-boxes-stacked absolute left-3 top-1/2 -translate-y-1/2 text-xs ${productFilters.length > 0 ? 'text-indigo-500' : 'text-slate-400'}`}></i>
                        </div>
                        {productFilters.length > 0 && (
                            <button onClick={() => setProductFilters([])} className="px-3 py-2 rounded-xl text-xs font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition flex items-center gap-1">
                                <i className="fa-solid fa-xmark"></i> مسح الفلتر
                            </button>
                        )}
                    </div>

                    {/* Sales List */}
                    <div className="space-y-3">
                        {filteredSales.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-200 text-slate-400">
                                <i className="fa-regular fa-folder-open text-5xl mb-4 opacity-30"></i>
                                <p className="font-bold text-lg">لا توجد مبيعات</p>
                            </div>
                        ) : (
                            filteredSales.slice(0, visibleCount).map(sale => {
                                const daysLeft = sale.expiryDate ? Math.ceil((new Date(sale.expiryDate) - new Date()) / 86400000) : null;
                                const isExpired = daysLeft !== null && daysLeft <= 0;
                                const isSoon = daysLeft !== null && daysLeft > 0 && daysLeft <= 5;
                                return (
                                <div key={sale.id} className="bg-white rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-lg transition-all duration-200 overflow-hidden">
                                    {/* Header: colored top bar */}
                                    <div className={`h-1 ${sale.isPaid && sale.isActivated ? 'bg-gradient-to-r from-emerald-400 to-teal-400' : sale.isPaid ? 'bg-gradient-to-r from-emerald-400 to-blue-400' : 'bg-gradient-to-r from-red-400 to-orange-400'}`}></div>
                                    
                                    <div className="p-4">
                                        {/* Row 1: Avatar + Name + Price */}
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-sm flex-shrink-0 shadow-sm ${sale.isPaid ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-red-500 to-orange-600'}`}>
                                                {(sale.customerName || sale.customerEmail || 'ع').charAt(0).toUpperCase()}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-extrabold text-sm text-slate-800 truncate">{sale.customerName || sale.customerEmail || 'عميل'}</h3>
                                                    {sale.customerPhone && <span className="text-[10px] text-slate-400 font-mono dir-ltr hidden sm:inline">{sale.customerPhone}</span>}
                                                </div>
                                                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                                    <span className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold ${sale.isPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>{sale.isPaid ? '✓ مدفوع' : '○ غير مدفوع'}</span>
                                                    <span className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold ${sale.isActivated ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{sale.isActivated ? '⚡ مفعّل' : '○ غير مفعّل'}</span>
                                                    {sale.discount > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-orange-100 text-orange-700">-{sale.discount}</span>}
                                                </div>
                                            </div>
                                            <div className="text-left flex-shrink-0">
                                                <div className="text-lg font-black text-slate-800 dir-ltr leading-tight">{Number(sale.finalPrice).toLocaleString()}</div>
                                                <div className="text-[10px] text-slate-400 font-bold text-center">ج.م</div>
                                                {!sale.isPaid && sale.remainingAmount > 0 && <div className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded text-center mt-0.5">متبقي {sale.remainingAmount}</div>}
                                            </div>
                                        </div>

                                        {/* Row 2: Email + Password (if exists) */}
                                        {(sale.customerEmail || sale.customerPassword) && (
                                            <div className="bg-slate-50 rounded-lg px-3 py-2 mb-2.5 flex items-center gap-2 text-xs font-mono overflow-x-auto">
                                                {sale.customerEmail && <span className="text-indigo-600 flex items-center gap-1 flex-shrink-0"><i className="fa-solid fa-at text-[9px] text-indigo-400"></i>{sale.customerEmail}</span>}
                                                {sale.customerPassword && <><span className="text-slate-300">|</span><span className="text-purple-600 flex items-center gap-1 flex-shrink-0"><i className="fa-solid fa-key text-[9px] text-purple-400"></i>{sale.customerPassword}</span></>}
                                                <button onClick={() => copyCredentials(sale)} className={`ml-auto flex-shrink-0 w-6 h-6 rounded flex items-center justify-center transition ${copiedId === sale.id ? 'bg-emerald-100 text-emerald-600' : 'hover:bg-indigo-100 text-slate-400 hover:text-indigo-600'}`}><i className={`fa-solid text-[10px] ${copiedId === sale.id ? 'fa-check' : 'fa-copy'}`}></i></button>
                                            </div>
                                        )}

                                        {/* Row 3: Info chips */}
                                        <div className="flex flex-wrap gap-1 mb-2.5">
                                            <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[10px] font-bold"><i className="fa-solid fa-box text-[8px]"></i>{sale.productName}</span>
                                            <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-bold"><i className={`fa-brands text-[8px] ${sale.contactChannel === 'واتساب' ? 'fa-whatsapp text-green-600' : sale.contactChannel === 'ماسنجر' ? 'fa-facebook-messenger text-blue-600' : 'fa-telegram text-sky-500'}`}></i>{sale.contactChannel}</span>
                                            {sale.paymentMethod && <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold"><i className="fa-solid fa-wallet text-[8px]"></i>{sale.paymentMethod}</span>}
                                            {sale.fromInventory && sale.assignedAccountEmail && <button onClick={() => showAccountDetails(sale)} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold hover:bg-purple-100 transition"><i className="fa-solid fa-server text-[8px]"></i>{sale.assignedAccountEmail}</button>}
                                            {sale.duration && <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold"><i className="fa-solid fa-hourglass-half text-[8px]"></i>{sale.duration}ي</span>}
                                            {daysLeft !== null && <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${isExpired ? 'bg-red-100 text-red-700' : isSoon ? 'bg-orange-100 text-orange-700' : 'bg-teal-50 text-teal-700'}`}><i className={`fa-solid text-[8px] ${isExpired ? 'fa-triangle-exclamation' : 'fa-clock'}`}></i>{isExpired ? `منتهي ${Math.abs(daysLeft)}ي` : `${daysLeft}ي`}</span>}
                                            {sale.saleType === 'workspace' && sale.workspaceEmail && <span className="inline-flex items-center gap-1 bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded text-[10px] font-bold"><i className="fa-solid fa-users text-[8px]"></i>{sale.workspaceEmail}</span>}
                                        </div>
                                        {sale.notes && <p className="text-[10px] text-slate-400 mb-2 leading-relaxed"><i className="fa-solid fa-sticky-note text-[8px] ml-1"></i>{sale.notes}</p>}

                                        {/* Row 4: Footer */}
                                        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                                            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                                                <i className="fa-regular fa-calendar text-[8px]"></i>
                                                <span className="font-mono dir-ltr">{new Date(sale.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                                                <span className="font-mono dir-ltr">{new Date(sale.date).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                                                <span className="text-slate-300">|</span>
                                                <span className="text-indigo-500 font-bold">{sale.moderator}</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button onClick={() => togglePaid(sale.id)} className={`w-7 h-7 rounded-lg flex items-center justify-center transition text-xs ${sale.isPaid ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200' : 'bg-orange-100 text-orange-600 hover:bg-orange-200'}`} title={sale.isPaid ? 'إلغاء الدفع' : 'تأكيد الدفع'}><i className={`fa-solid ${sale.isPaid ? 'fa-check-double' : 'fa-coins'}`}></i></button>
                                                <button onClick={() => toggleActivated(sale.id)} className={`w-7 h-7 rounded-lg flex items-center justify-center transition text-xs ${sale.isActivated ? 'bg-blue-100 text-blue-600 hover:bg-blue-200' : 'bg-amber-100 text-amber-600 hover:bg-amber-200'}`} title={sale.isActivated ? 'إلغاء التفعيل' : 'تفعيل'}><i className={`fa-solid ${sale.isActivated ? 'fa-bolt' : 'fa-power-off'}`}></i></button>
                                                <button onClick={() => openEditSale(sale)} className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-blue-100 hover:text-blue-600 transition text-xs" title="تعديل"><i className="fa-solid fa-pen-to-square"></i></button>
                                                <button onClick={() => deleteSale(sale.id)} className="w-7 h-7 rounded-lg flex items-center justify-center bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600 transition text-xs" title="حذف"><i className="fa-solid fa-trash-can"></i></button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                );})
                        )}
                    </div>

                    {visibleCount < filteredSales.length && (
                        <div className="flex justify-center mt-6">
                            <button onClick={() => setVisibleCount(p => p + 15)} className="bg-white border-2 border-indigo-100 text-indigo-600 px-10 py-3 rounded-full font-bold hover:bg-indigo-50 transition-all flex items-center gap-2 shadow-sm">
                                عرض المزيد <i className="fa-solid fa-chevron-down"></i>
                            </button>
                        </div>
                    )}
                </div>



            {/* ============ SALE MODAL ============ */}
            {showSaleModal && createPortal(
                <div className="animate-fade-in" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>
                        <div className="p-6 bg-gradient-to-r from-indigo-700 to-blue-600 text-white flex justify-between items-center shadow-md">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <i className={`fa-solid ${editingSale ? 'fa-pen-to-square' : 'fa-plus-circle'}`}></i>
                                {editingSale ? 'تعديل البيع' : 'بيع جديد'}
                            </h3>
                            <button onClick={() => { setShowSaleModal(false); setEditingSale(null); }} className="bg-white/10 hover:bg-white/20 p-2 rounded-full transition"><i className="fa-solid fa-xmark text-lg"></i></button>
                        </div>
                        <div className="p-8 overflow-y-auto space-y-6">
                            <form id="saleForm" ref={formRef} onSubmit={handleSaveSale} className="space-y-6" key={editingSale?.id || 'new'}>
                                {/* اختيار المنتج */}
                                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                                    <div className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-2"><i className="fa-solid fa-tag ml-1"></i> المنتج</div>
                                    {products.length === 0 ? (
                                        <div className="bg-yellow-50 text-yellow-800 p-4 rounded-xl border border-yellow-200 font-bold text-sm flex items-center gap-2">
                                            <i className="fa-solid fa-triangle-exclamation"></i> لا يوجد منتجات. اطلب من الأدمن إضافة المنتجات أولاً.
                                        </div>
                                    ) : (
                                        <select name="productName" defaultValue={editingSale?.productName || ""} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all appearance-none" required>
                                            <option value="" disabled>-- اختر المنتج --</option>
                                            {products.map(p => {
                                                let isOut = false;
                                                let availCount = null;
                                                // لو بنعدل أوردر — المنتج الحالي يفضل متاح للاختيار
                                                const isCurrentProduct = editingSale && editingSale.productName === p.name;
                                                if (p.inventoryProduct && p.fulfillmentType === 'from_stock') {
                                                    const availItems = (ctxAccounts || []).filter(a => 
                                                        a.productName === p.inventoryProduct && 
                                                        a.status !== 'damaged' && a.status !== 'completed' &&
                                                        (Number(a.allowed_uses) === -1 || Number(a.current_uses) < Number(a.allowed_uses))
                                                    );
                                                    availCount = availItems.length;
                                                    isOut = availCount === 0 && !isCurrentProduct;
                                                }
                                                return <option key={p.id} value={p.name} disabled={isOut}>
                                                    {p.name} — {p.price} ج.م {availCount !== null ? `(${availCount} متاح)` : ''} {isOut ? '— نفد من المخزون' : ''} {isCurrentProduct && availCount === 0 ? '(الحالي)' : ''}
                                                </option>;
                                            })}
                                        </select>
                                    )}
                                </div>

                                {/* بيانات العميل */}
                                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                                    <div className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-2"><i className="fa-solid fa-user ml-1"></i> بيانات العميل</div>
                                    
                                    {/* Toggle: عميل جديد / عميل سابق */}
                                    <div className="flex gap-2 bg-slate-100 p-1.5 rounded-xl">
                                        <button type="button" onClick={() => { setCustomerType('new'); setSelectedCustomerId(''); }} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${customerType === 'new' ? 'bg-white text-indigo-700 shadow-md' : 'text-slate-500 hover:bg-white/50'}`}>
                                            <i className="fa-solid fa-user-plus"></i> عميل جديد
                                        </button>
                                        <button type="button" onClick={() => setCustomerType('existing')} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${customerType === 'existing' ? 'bg-white text-indigo-700 shadow-md' : 'text-slate-500 hover:bg-white/50'}`}>
                                            <i className="fa-solid fa-users"></i> عميل سابق
                                            {customers.length > 0 && <span className="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded-full font-black">{customers.length}</span>}
                                        </button>
                                    </div>

                                    <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4 space-y-2">
                                        <label className="block text-sm font-extrabold text-slate-800">
                                            <i className="fa-solid fa-shield-halved text-purple-600 ml-1"></i>
                                            الميل المباع من بيانات الحساب
                                        </label>
                                        <select
                                            value={selectedSheetAccountId}
                                            onChange={(event) => handleSelectSheetAccount(event.target.value)}
                                            className="w-full bg-white border-2 border-purple-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all"
                                        >
                                            <option value="">بدون ربط بحساب محفوظ</option>
                                            {sheetAccounts
                                                .filter(account => (account.email || account.selectedAccount) && Number(account.currentUses || 0) < Number(account.maxUses || 2))
                                                .map(account => {
                                                    const currentUses = Math.max(0, Number(account.currentUses || 0));
                                                    const maxUses = Math.max(1, Number(account.maxUses || 2));
                                                    const remainingUses = Math.max(0, maxUses - currentUses);
                                                    const availability = currentUses === 0 ? 'متاح كامل' : 'باقي جهاز واحد';
                                                    return (
                                                        <option key={account.id} value={account.id}>
                                                            {account.email || account.selectedAccount} — {availability} ({remainingUses} من {maxUses})
                                                        </option>
                                                    );
                                                })}
                                        </select>
                                        <p className="text-[11px] text-purple-700/70 font-bold">
                                            عند الاختيار يتم ملء إيميل العميل وباسورد العميل تلقائيا، ويتسجل الحساب مربوطا بالبيعة.
                                        </p>
                                        {selectedSheetAccountId && (() => {
                                            const account = sheetAccounts.find(item => String(item.id) === String(selectedSheetAccountId));
                                            const currentUses = Math.max(0, Number(account?.currentUses || 0));
                                            const maxUses = Math.max(1, Number(account?.maxUses || 2));
                                            const canTakeFullAccount = currentUses === 0 && maxUses >= 2;
                                            return (
                                                <div className="space-y-2 pt-2">
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                        <label className={`flex items-center gap-2 bg-white border-2 rounded-xl px-3 py-2 transition ${canTakeFullAccount ? 'border-slate-900 cursor-pointer hover:border-slate-700' : 'border-slate-100 opacity-50 cursor-not-allowed'}`}>
                                                            <input
                                                                type="radio"
                                                                name="accountUsageMode"
                                                                value="personal"
                                                                checked={accountUsageMode === 'personal'}
                                                                onChange={() => setAccountUsageMode('personal')}
                                                                disabled={!canTakeFullAccount && accountUsageMode !== 'personal'}
                                                                className="accent-slate-900"
                                                            />
                                                            <span className="text-xs font-black text-slate-700">شخصي - الحساب كامل</span>
                                                        </label>
                                                        <div className="rounded-xl border-2 border-purple-100 bg-purple-50/60 px-3 py-2">
                                                            <div className="text-[11px] font-black text-purple-800 mb-1">مشترك</div>
                                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                                    <label className="flex items-center gap-2 bg-white border-2 border-purple-100 rounded-xl px-3 py-2 cursor-pointer hover:border-purple-300 transition">
                                                        <input
                                                            type="radio"
                                                            name="accountUsageMode"
                                                            value="shared_one_device"
                                                            checked={accountUsageMode === 'shared_one_device'}
                                                            onChange={() => setAccountUsageMode('shared_one_device')}
                                                            className="accent-purple-600"
                                                        />
                                                        <span className="text-xs font-black text-slate-700">خرج جهاز</span>
                                                    </label>
                                                    <label className={`flex items-center gap-2 bg-white border-2 rounded-xl px-3 py-2 transition ${canTakeFullAccount ? 'border-blue-100 cursor-pointer hover:border-blue-300' : 'border-slate-100 opacity-50 cursor-not-allowed'}`}>
                                                        <input
                                                            type="radio"
                                                            name="accountUsageMode"
                                                            value="shared_two_devices"
                                                            checked={accountUsageMode === 'shared_two_devices'}
                                                            onChange={() => setAccountUsageMode('shared_two_devices')}
                                                            disabled={!canTakeFullAccount && accountUsageMode !== 'shared_two_devices'}
                                                            className="accent-blue-600"
                                                        />
                                                        <span className="text-xs font-black text-slate-700">خرج الجهازين</span>
                                                    </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>

                                    {/* عميل سابق - اختيار من القائمة */}
                                    {customerType === 'existing' && (
                                        <div className="space-y-3">
                                            <div className="relative">
                                                <i className="fa-solid fa-search absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                                                <input type="text" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl pr-10 p-3 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all" placeholder="ابحث عن العميل بالاسم أو الرقم..." />
                                            </div>
                                            {filteredCustomers.length === 0 ? (
                                                <div className="text-center py-6 text-slate-400 text-sm font-bold bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                                    <i className="fa-solid fa-user-slash text-2xl mb-2 block opacity-30"></i>
                                                    لا يوجد عملاء {customerSearch ? 'يطابقوا البحث' : 'مسجلين بعد'}
                                                </div>
                                            ) : (
                                                <div className="max-h-48 overflow-y-auto space-y-1.5 custom-scrollbar">
                                                    {filteredCustomers.map(c => (
                                                        <button key={c.id} type="button" onClick={() => handleSelectCustomer(c.id)}
                                                            className={`w-full flex items-center gap-3 p-3 rounded-xl text-right transition-all border-2 ${selectedCustomerId === c.id ? 'border-indigo-500 bg-indigo-50 shadow-sm' : 'border-transparent hover:bg-slate-50 hover:border-slate-200'}`}>
                                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${selectedCustomerId === c.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                                                {c.name?.charAt(0).toUpperCase() || '?'}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-bold text-slate-800 text-sm truncate">{c.name}</p>
                                                                <div className="flex items-center gap-2 text-xs text-slate-400">
                                                                    {c.phone && <span className="font-mono dir-ltr">{c.phone}</span>}
                                                                    <span className="flex items-center gap-1">
                                                                        <i className={`fa-brands text-[10px] ${c.contactChannel === 'واتساب' ? 'fa-whatsapp text-green-500' : c.contactChannel === 'ماسنجر' ? 'fa-facebook-messenger text-blue-500' : 'fa-telegram text-sky-500'}`}></i>
                                                                        {c.contactChannel}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            {selectedCustomerId === c.id && <i className="fa-solid fa-check-circle text-indigo-600"></i>}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* مكان التواصل */}
                                    <div>
                                        <label className="block text-sm font-extrabold text-slate-800 mb-2">مكان التواصل</label>
                                        <div className="grid grid-cols-3 gap-3">
                                            {['واتساب', 'ماسنجر', 'تليجرام'].map(ch => (
                                                <button key={ch} type="button" onClick={() => setContactChannel(ch)}
                                                    className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all ${contactChannel === ch ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-200'}`}>
                                                    <i className={`fa-brands ${ch === 'واتساب' ? 'fa-whatsapp text-green-600' : ch === 'ماسنجر' ? 'fa-facebook-messenger text-blue-600' : 'fa-telegram text-sky-500'} text-lg`}></i>
                                                    <span className="text-sm font-bold text-slate-700">{ch}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* حقول بيانات العميل */}
                                    <div>
                                        <label className="block text-sm font-extrabold text-slate-800 mb-2">اسم العميل <span className="text-red-400">*</span></label>
                                        <input name="customerName" defaultValue={editingSale?.customerName} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all" placeholder="اسم العميل" required />
                                    </div>

                                    {/* رقم الهاتف - يظهر دايماً بس مهم أكتر في الواتساب */}
                                    <div>
                                        <label className="block text-sm font-extrabold text-slate-800 mb-2">
                                            رقم الهاتف 
                                            {contactChannel === 'واتساب' ? <span className="text-red-400 mr-1">*</span> : <span className="text-slate-400 font-medium mr-1">(اختياري)</span>}
                                        </label>
                                        <input name="customerPhone" type="tel" defaultValue={editingSale?.customerPhone}
                                            className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all font-mono dir-ltr text-right"
                                            placeholder="01xxxxxxxxx" 
                                            required={contactChannel === 'واتساب'} />
                                    </div>

                                    <div>
                                        <label className="block text-sm font-extrabold text-slate-800 mb-2">إيميل العميل <span className="text-slate-400 font-medium">(اختياري)</span></label>
                                        <input name="customerEmail" type="email" defaultValue={editingSale?.customerEmail} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all font-mono" placeholder="user@example.com" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-extrabold text-slate-800 mb-2">باسورد العميل <span className="text-slate-400 font-medium">(اختياري - لو التفعيل محتاج باسورد)</span></label>
                                        <input name="customerPassword" type="text" defaultValue={editingSale?.customerPassword || ''} className="w-full bg-white border-2 border-purple-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-purple-100 focus:border-purple-600 outline-none transition-all font-mono dir-ltr text-left text-purple-700" placeholder="اكتب الباسورد لو محتاج" />
                                        <p className="text-[10px] text-slate-400 mt-1 font-medium"><i className="fa-solid fa-info-circle ml-1 text-purple-300"></i> اكتب الباسورد لو التفعيل محتاجه، اتركه فاضي لو مش محتاج</p>
                                    </div>
                                </div>

                                {/* الدفع */}
                                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                                    <div className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-2"><i className="fa-solid fa-wallet ml-1"></i> الدفع والخصم</div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-extrabold text-slate-800 mb-2">قيمة الخصم (ج.م)</label>
                                            <input name="discount" type="number" defaultValue={editingSale?.discount || 0} className="w-full bg-white border-2 border-orange-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-orange-100 focus:border-orange-500 outline-none transition-all text-orange-700" placeholder="0" min="0" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-extrabold text-slate-800 mb-2">وسيلة الدفع (المحفظة)</label>
                                            <select name="walletId" defaultValue={editingSale?.walletId || ""} className="w-full bg-white border-2 border-emerald-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-emerald-100 focus:border-emerald-600 outline-none transition-all">
                                                <option value="">بدون محفظة</option>
                                                {wallets.map(w => (
                                                    <option key={w.id} value={w.id}>{w.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-3">
                                        <label className="flex items-center gap-3 p-3.5 bg-emerald-50 rounded-xl border border-emerald-100 cursor-pointer hover:bg-emerald-100 transition-colors">
                                            <input type="checkbox" name="isPaid" defaultChecked={editingSale?.isPaid ?? true} className="w-5 h-5 text-emerald-600 rounded focus:ring-emerald-500 border-emerald-300" />
                                            <span className="text-sm font-bold text-emerald-800">مدفوع بالكامل ✅</span>
                                        </label>
                                        <div>
                                            <label className="block text-sm font-extrabold text-slate-800 mb-2">المبلغ المتبقي (لو مدفعش كامل)</label>
                                            <input name="remainingAmount" type="number" defaultValue={editingSale?.remainingAmount || 0} className="w-full bg-white border-2 border-red-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-red-100 focus:border-red-500 outline-none transition-all text-red-600" placeholder="0" min="0" />
                                        </div>
                                    </div>
                                </div>

                                {/* تاريخ البيع (اختياري - للتسجيل بتاريخ قديم) */}
                                {!editingSale && (
                                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                                        <div className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-2"><i className="fa-solid fa-calendar-alt ml-1"></i> تاريخ البيع</div>
                                        <div>
                                            <label className="block text-sm font-extrabold text-slate-800 mb-2">
                                                تاريخ تسجيل البيع <span className="text-slate-400 font-medium">(اتركه فاضي = تاريخ اليوم)</span>
                                            </label>
                                            <input name="saleDate" type="datetime-local" 
                                                className="w-full bg-white border-2 border-blue-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-blue-100 focus:border-blue-600 outline-none transition-all dir-ltr text-right" 
                                            />
                                            <p className="text-[11px] text-slate-400 mt-2 font-medium">
                                                <i className="fa-solid fa-info-circle ml-1 text-blue-400"></i>
                                                لو اخترت تاريخ قديم، الأيام اللي عدت هتتخصم من مدة الاشتراك تلقائياً
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* ملاحظات */}
                                <div>
                                    <label className="block text-sm font-extrabold text-slate-800 mb-2">ملاحظات (اختياري)</label>
                                    <textarea name="notes" defaultValue={editingSale?.notes} className="w-full bg-white border-2 border-slate-200 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-indigo-100 focus:border-indigo-600 outline-none transition-all h-20 resize-none" placeholder="أي ملاحظات إضافية..."></textarea>
                                </div>

                                {/* نوع البيع: شخصي / Workspace */}
                                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                                    <div className="text-xs font-black text-cyan-600 uppercase tracking-widest mb-2"><i className="fa-solid fa-users-rectangle ml-1"></i> نوع الإيميل</div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button type="button" onClick={() => { setSaleType('personal'); setWorkspaceEmail(''); }}
                                            className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${saleType === 'personal' ? 'border-indigo-500 bg-indigo-50 shadow-sm' : 'border-slate-200 hover:border-indigo-200'}`}>
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${saleType === 'personal' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}><i className="fa-solid fa-user"></i></div>
                                            <span className="text-sm font-extrabold text-slate-700">شخصي</span>
                                            <span className="text-[10px] text-slate-400 font-medium">إيميل العميل الشخصي</span>
                                        </button>
                                        <button type="button" onClick={() => setSaleType('workspace')}
                                            className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${saleType === 'workspace' ? 'border-cyan-500 bg-cyan-50 shadow-sm' : 'border-slate-200 hover:border-cyan-200'}`}>
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${saleType === 'workspace' ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-500'}`}><i className="fa-solid fa-users-rectangle"></i></div>
                                            <span className="text-sm font-extrabold text-slate-700">Workspace</span>
                                            <span className="text-[10px] text-slate-400 font-medium">ضمن مجموعة عمل</span>
                                        </button>
                                    </div>
                                    {saleType === 'workspace' && (
                                        <div className="animate-fade-in">
                                            <label className="block text-sm font-extrabold text-slate-800 mb-2">إيميل الـ Workspace <span className="text-red-400">*</span></label>
                                            <input type="email" value={workspaceEmail} onChange={e => setWorkspaceEmail(e.target.value)}
                                                className="w-full bg-white border-2 border-cyan-300 rounded-xl p-3.5 font-bold text-sm focus:ring-4 focus:ring-cyan-100 focus:border-cyan-600 outline-none transition-all font-mono dir-ltr text-right text-cyan-700"
                                                placeholder="workspace@example.com" required />
                                            <p className="text-[11px] text-slate-400 mt-2 font-medium">
                                                <i className="fa-solid fa-info-circle ml-1 text-cyan-400"></i>
                                                الإيميل اللي هيستخدم لتفعيل العميل على Workspace مشترك
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </form>
                        </div>
                        <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3">
                            <button onClick={() => { setShowSaleModal(false); setEditingSale(null); }} className="px-6 py-3 rounded-xl font-bold text-slate-600 bg-slate-50 border-2 border-slate-200 hover:bg-slate-100 transition-all">إلغاء</button>
                            <button type="submit" form="saleForm" className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all flex items-center gap-2">
                                <i className="fa-solid fa-check"></i> حفظ البيع
                            </button>
                        </div>
                    </div>
                </div>
            , document.body)}

            {/* ============ ASSIGNED ACCOUNT DETAILS MODAL ============ */}
            {assignedAccountDetails && createPortal(
                <div className="animate-fade-in" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
                        <div className="p-6 bg-gradient-to-r from-purple-700 to-indigo-600 text-white flex justify-between items-center text-center">
                            <h3 className="text-lg font-bold flex items-center justify-center gap-2 w-full">
                                <i className="fa-solid fa-server text-2xl"></i> {assignedAccountDetails.isNew ? 'تم البيع وسحب حساب' : 'تفاصيل الحساب المربوط'}
                            </h3>
                        </div>
                        <div className="p-8 space-y-5 flex flex-col">
                            {assignedAccountDetails.isNew ? (
                                <p className="text-center font-bold text-slate-600 text-sm mb-2">تم سحب هذا الحساب من المخزون بنجاح لتفعيل {assignedAccountDetails.productName}:</p>
                            ) : (
                                <p className="text-center font-bold text-slate-600 text-sm mb-2">تفاصيل الحساب الخاص بـ {assignedAccountDetails.productName}:</p>
                            )}
                            
                            <div className="space-y-4">
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-black text-slate-500 uppercase tracking-wide">البيانات / تفاصيل الدخول</label>
                                    <div className="flex items-center">
                                        <code className="text-sm font-mono font-bold text-slate-800 bg-slate-50 px-4 py-3 rounded-r-xl border border-r-0 border-slate-200 flex-1 truncate select-all dir-ltr text-left">
                                            {assignedAccountDetails.email}
                                        </code>
                                        <button onClick={() => copyToClipboard(assignedAccountDetails.email, 'assigned-email')} className="h-[46px] w-[50px] flex items-center justify-center bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-100 rounded-l-xl transition">
                                            <i className={`fa-solid ${copiedId === 'assigned-email' ? 'fa-check text-emerald-500' : 'fa-copy'}`}></i>
                                        </button>
                                    </div>
                                </div>
                                {assignedAccountDetails.password && (
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-black text-slate-500 uppercase tracking-wide">{assignedAccountDetails.fromSheet ? 'Adobe Password' : 'الباسورد'}</label>
                                        <div className="flex items-center">
                                            <code className="text-sm font-mono font-bold text-slate-800 bg-slate-50 px-4 py-3 rounded-r-xl border border-r-0 border-slate-200 flex-1 truncate select-all dir-ltr text-left">
                                                {assignedAccountDetails.password}
                                            </code>
                                            <button onClick={() => copyToClipboard(assignedAccountDetails.password, 'assigned-pass')} className="h-[46px] w-[50px] flex items-center justify-center bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-100 rounded-l-xl transition">
                                                <i className={`fa-solid ${copiedId === 'assigned-pass' ? 'fa-check text-emerald-500' : 'fa-copy'}`}></i>
                                            </button>
                                        </div>
                                    </div>
                                )}
                                {assignedAccountDetails.twoFA && (
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-black text-purple-500 uppercase tracking-wide">{assignedAccountDetails.fromSheet ? 'Outlook Password' : '2FA Link'}</label>
                                        <div className="flex items-center">
                                            <code className="text-sm font-mono font-bold text-purple-700 bg-purple-50 px-4 py-3 rounded-r-xl border border-r-0 border-purple-200 flex-1 truncate select-all dir-ltr text-left">
                                                {assignedAccountDetails.twoFA}
                                            </code>
                                            <button onClick={() => copyToClipboard(assignedAccountDetails.twoFA, 'assigned-2fa')} className="h-[46px] w-[50px] flex items-center justify-center bg-purple-100 text-purple-700 hover:bg-purple-200 border border-purple-200 rounded-l-xl transition">
                                                <i className={`fa-solid ${copiedId === 'assigned-2fa' ? 'fa-check text-emerald-500' : 'fa-copy'}`}></i>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button onClick={() => setAssignedAccountDetails(null)} className="mt-4 w-full bg-slate-800 text-white py-3.5 rounded-xl font-bold hover:bg-slate-900 shadow-lg shadow-slate-200 transition-all">
                                حسناً، إغلاق نافذة الحساب
                            </button>
                        </div>
                    </div>
                </div>
            , document.body)}

            {/* ============ DELETE INVENTORY MODAL ============ */}
            {deleteModal && createPortal(
                <div className="animate-fade-in" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
                        <div className="p-6 bg-gradient-to-r from-red-600 to-rose-600 text-white">
                            <h3 className="text-lg font-bold flex items-center gap-2">
                                <i className="fa-solid fa-triangle-exclamation text-2xl"></i> حذف أوردر مربوط بالمخزون
                            </h3>
                        </div>
                        <div className="p-8 space-y-5">
                            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-2">
                                <p className="text-sm font-bold text-slate-600">هذا الأوردر مربوط بحساب من المخزون:</p>
                                <div className="flex items-center gap-3 bg-white p-3 rounded-xl border border-purple-200">
                                    <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center">
                                        <i className="fa-solid fa-server text-purple-600"></i>
                                    </div>
                                    <div>
                                        <p className="font-mono font-bold text-sm text-slate-800 dir-ltr text-right">{deleteModal.email}</p>
                                        <p className="text-xs text-slate-400 font-bold">{deleteModal.productName}</p>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <p className="text-sm font-extrabold text-slate-800 mb-3">اختر حالة الحساب بعد حذف الأوردر:</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <button disabled={deleteLoading} onClick={() => confirmDeleteWithInventory('available')}
                                        className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-400 transition-all group disabled:opacity-50">
                                        <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                                            <i className="fa-solid fa-check-circle"></i>
                                        </div>
                                        <span className="text-sm font-bold text-emerald-700">متاح</span>
                                        <span className="text-[10px] text-emerald-500 font-medium">Available</span>
                                    </button>
                                    <button disabled={deleteLoading} onClick={() => confirmDeleteWithInventory('used')}
                                        className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-blue-200 bg-blue-50 hover:bg-blue-100 hover:border-blue-400 transition-all group disabled:opacity-50">
                                        <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                                            <i className="fa-solid fa-user-check"></i>
                                        </div>
                                        <span className="text-sm font-bold text-blue-700">مستخدم</span>
                                        <span className="text-[10px] text-blue-500 font-medium">Used</span>
                                    </button>
                                    <button disabled={deleteLoading} onClick={() => confirmDeleteWithInventory('damaged')}
                                        className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-orange-200 bg-orange-50 hover:bg-orange-100 hover:border-orange-400 transition-all group disabled:opacity-50">
                                        <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                                            <i className="fa-solid fa-ban"></i>
                                        </div>
                                        <span className="text-sm font-bold text-orange-700">تالف</span>
                                        <span className="text-[10px] text-orange-500 font-medium">Damaged</span>
                                    </button>
                                    <button disabled={deleteLoading} onClick={() => confirmDeleteWithInventory('completed')}
                                        className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-400 transition-all group disabled:opacity-50">
                                        <div className="w-10 h-10 bg-slate-500 rounded-xl flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                                            <i className="fa-solid fa-flag-checkered"></i>
                                        </div>
                                        <span className="text-sm font-bold text-slate-700">منتهي</span>
                                        <span className="text-[10px] text-slate-500 font-medium">Completed</span>
                                    </button>
                                </div>
                            </div>

                            <div className="flex gap-3 pt-4 border-t border-slate-200">
                                <button disabled={deleteLoading} onClick={() => setDeleteModal(null)}
                                    className="flex-1 py-3 rounded-xl font-bold text-slate-600 bg-white border-2 border-slate-200 hover:bg-slate-50 transition disabled:opacity-50">
                                    إلغاء
                                </button>
                                <button disabled={deleteLoading} onClick={() => confirmDeleteWithInventory(null)}
                                    className="flex-1 py-3 rounded-xl font-bold text-red-600 bg-red-50 border-2 border-red-200 hover:bg-red-100 transition flex items-center justify-center gap-2 disabled:opacity-50">
                                    <i className="fa-solid fa-trash"></i> حذف بدون إرجاع
                                </button>
                            </div>

                            {deleteLoading && (
                                <div className="text-center text-sm font-bold text-indigo-600">
                                    <i className="fa-solid fa-spinner fa-spin ml-2"></i> جاري التنفيذ...
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            , document.body)}

            <style>{`
                .animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
}
