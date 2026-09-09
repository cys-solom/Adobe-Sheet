import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from './ConfirmDialog';
import { sheetsAPI } from '../services/api';
import { SHEETS_CHANGED, sellCloudAccount } from '../services/sheetSync';
import {
    DEFAULT_SHEETS,
    sanitizeRecord,
    calculateAccountReminder
} from '../utils/dataRepair';

// Calendar Icon with dynamic number or placeholder matching the user design
const CalendarOptionIcon = ({ num = null, isSelected = false }) => {
    const strokeColor = isSelected ? '#2563eb' : '#64748b';
    return (
        <svg
            className="w-5 h-5 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke={strokeColor}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <rect x="3" y="4" width="18" height="18" rx="3" ry="3" fill={isSelected ? 'rgba(37, 99, 235, 0.08)' : 'transparent'} />
            <line x1="16" y1="2" x2="16" y2="6" stroke={strokeColor} strokeWidth="2" />
            <line x1="8" y1="2" x2="8" y2="6" stroke={strokeColor} strokeWidth="2" />
            <line x1="3" y1="10" x2="21" y2="10" stroke={strokeColor} strokeWidth="1.5" />
            {num ? (
                <text
                    x="12"
                    y="18.5"
                    textAnchor="middle"
                    fill={strokeColor}
                    stroke="none"
                    fontSize="9"
                    fontWeight="800"
                    fontFamily="system-ui, -apple-system, sans-serif"
                >
                    {num}
                </text>
            ) : (
                <g stroke={strokeColor} strokeWidth="2">
                    <line x1="7.5" y1="15.5" x2="10" y2="15.5" />
                    <line x1="14" y1="15.5" x2="16.5" y2="15.5" />
                </g>
            )}
        </svg>
    );
};

const DURATION_ITEMS = [
    { label: '1 شهر', value: '1 شهر', num: 1 },
    { label: '2 شهر', value: '2 شهر', num: 2 },
    { label: '3 شهور', value: '3 شهور', num: 3 },
    { label: '4 شهور', value: '4 شهور', num: 4 },
];

/**
 * Calculates accurate remaining subscription duration from start date and duration string
 */
export const calculateRemainingTime = (rawStartDate, rawDuration, rawCreatedAt) => {
    const duration = String(rawDuration || '').trim();
    if (!duration) {
        return { text: '-', status: 'none', days: null };
    }

    if (duration.includes('مدى الحياة') || duration.toLowerCase().includes('lifetime')) {
        return { text: 'مدى الحياة', status: 'lifetime', days: 999999, label: '∞' };
    }

    const effectiveDateStr = rawStartDate || (rawCreatedAt ? String(rawCreatedAt).slice(0, 10) : '');
    if (!effectiveDateStr) {
        return { text: '-', status: 'none', days: null };
    }

    const parseDateParts = (str) => {
        if (!str) return null;
        if (str instanceof Date && !isNaN(str.getTime())) return new Date(str.getFullYear(), str.getMonth(), str.getDate());
        const s = String(str).trim().slice(0, 10);
        const match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
        if (match) {
            return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
        }
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    };

    const start = parseDateParts(effectiveDateStr);
    if (!start) {
        return { text: '-', status: 'none', days: null };
    }

    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate());

    if (duration.includes('سنة') || duration.includes('سنوات') || duration.toLowerCase().includes('year')) {
        const num = parseInt(duration) || 1;
        end.setFullYear(end.getFullYear() + num);
    } else if (duration.includes('شهر') || duration.includes('شهور') || duration.toLowerCase().includes('month')) {
        const num = parseInt(duration) || 1;
        end.setDate(end.getDate() + (num * 30));
    } else if (duration.includes('يوم') || duration.toLowerCase().includes('day')) {
        const num = parseInt(duration) || 30;
        end.setDate(end.getDate() + num);
    } else {
        const num = parseInt(duration);
        if (!isNaN(num) && num > 0) {
            end.setDate(end.getDate() + (num * 30));
        } else {
            return { text: '-', status: 'none', days: null };
        }
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const diffMs = end.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    const y = end.getFullYear();
    const m = String(end.getMonth() + 1).padStart(2, '0');
    const d = String(end.getDate()).padStart(2, '0');
    const endFormatted = `${y}-${m}-${d}`;

    const startFormatted = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;

    if (diffDays < 0) {
        const absDays = Math.abs(diffDays);
        return {
            text: absDays === 1 ? 'منتهي أمس' : `منتهي (منذ ${absDays} يوم)`,
            status: 'expired',
            days: diffDays,
            endDate: endFormatted,
            startDate: startFormatted
        };
    }

    if (diffDays === 0) {
        return {
            text: 'ينتهي اليوم',
            status: 'expiring-today',
            days: 0,
            endDate: endFormatted,
            startDate: startFormatted
        };
    }

    if (diffDays === 1) {
        return {
            text: 'متبقي يوم واحد',
            status: 'urgent',
            days: 1,
            endDate: endFormatted,
            startDate: startFormatted
        };
    }

    if (diffDays < 30) {
        return {
            text: `متبقي ${diffDays} يوم`,
            status: diffDays <= 3 ? 'urgent' : (diffDays <= 7 ? 'warning' : 'active'),
            days: diffDays,
            endDate: endFormatted,
            startDate: startFormatted
        };
    }

    const months = Math.floor(diffDays / 30);
    const remDays = diffDays % 30;

    let text = '';
    if (months === 1) {
        text = remDays > 0 ? `متبقي شهر و ${remDays} يوم` : 'متبقي شهر';
    } else if (months === 2) {
        text = remDays > 0 ? `متبقي شهرين و ${remDays} يوم` : 'متبقي شهرين';
    } else if (months >= 3 && months <= 10) {
        text = remDays > 0 ? `متبقي ${months} شهور و ${remDays} يوم` : `متبقي ${months} شهور`;
    } else {
        text = remDays > 0 ? `متبقي ${months} شهر و ${remDays} يوم` : `متبقي ${months} شهر`;
    }

    return {
        text,
        status: 'active',
        days: diffDays,
        endDate: endFormatted,
        startDate: startFormatted
    };
};

export default function CustomSheets({ activeSheetId, setActiveSheetId }) {
    const { user, hasPermission } = useAuth();
    const { showConfirm, showAlert } = useConfirm();
    const canAdd = user?.role === 'admin' || hasPermission('add_row');
    const canEdit = user?.role === 'admin' || hasPermission('edit_row');
    const canDelete = user?.role === 'admin' || hasPermission('delete_row');
    const canEmptyTrash = user?.role === 'admin' || hasPermission('empty_trash');
    const canCustomize = user?.role === 'admin' || hasPermission('customize_columns');

    // Current active sheet
    const currentSheetId = activeSheetId || 'client_data';
    const isTrashSheet = currentSheetId === 'trash_data';

    // Sheet titles & metadata (customizable)
    const [sheetsList, setSheetsList] = useState(DEFAULT_SHEETS);

    // Sheet Data state for current sheet
    const [records, setRecords] = useState([]);
    const [allSheetsCounts, setAllSheetsCounts] = useState({});

    // UI States
    const [searchTerm, setSearchTerm] = useState('');
    const [showAddModal, setShowAddModal] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [editingRecord, setEditingRecord] = useState(null);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [visibleSecrets, setVisibleSecrets] = useState({}); // { [rowId_field]: boolean }
    const [copiedField, setCopiedField] = useState(null);
    const [pageSize, setPageSize] = useState(25);
    const [currentPage, setCurrentPage] = useState(1);
    const [sortBy, setSortBy] = useState({ field: 'created_at', asc: false });
    const [bulkText, setBulkText] = useState('');
    const [isDurationDropdownOpen, setIsDurationDropdownOpen] = useState(false);
    const durationDropdownRef = useRef(null);
    const [expiryFilter, setExpiryFilter] = useState('all'); // 'all', 'near', 'expired', 'active'
    const [offerReminderFilter, setOfferReminderFilter] = useState('all'); // account_data only: all, pending, near3, today, overdue
    const [isAlertsExpanded, setIsAlertsExpanded] = useState(true);
    const [paymentFilter, setPaymentFilter] = useState('all'); // advanced: all, paid, unpaid
    const [deviceFilter, setDeviceFilter] = useState('all'); // advanced: all, جهاز, جهازين
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    // Notification toast
    const [toast, setToast] = useState(null);
    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3500);
    };

    // File input ref for import
    const fileInputRef = useRef(null);
    const tableRef = useRef(null);
    useEffect(() => {
        const table = tableRef.current;
        if (!table) return;
        const labels = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
        table.querySelectorAll('tbody tr').forEach(row => {
            Array.from(row.cells).forEach((cell, index) => { cell.dataset.label = labels[index] || ''; });
        });
    }, [records, currentPage, currentSheetId, searchTerm, expiryFilter, offerReminderFilter, sortBy, pageSize]);

    // Form State
    const [formData, setFormData] = useState({
        email: '',
        password: '',
        password2: '',
        duration: '',
        startDate: '',
        deviceType: '',
        paymentStatus: 'مدفوع',
        selectedAccount: '',
        invoiceNumber: '',
        visa: '',
        visaAccount: '',
        notes: '',
        accountCreatedDate: '',
        reminderDays: '20',
        offerActivated: false,
        offerActivatedAt: ''
    });
    const [accountEntryMode, setAccountEntryMode] = useState('available');

    // Stored accounts loaded from account_data for dropdown selection
    const [availableAccounts, setAvailableAccounts] = useState([]);

    const refreshAvailableAccounts = async () => {
        try {
            const cloudRecords = await sheetsAPI.getSheetRecords('account_data');
            if (Array.isArray(cloudRecords)) {
                const sanitized = cloudRecords.map((a, i) => sanitizeRecord(a, i)).filter(Boolean);
                setAvailableAccounts(sanitized);
            }
        } catch (e) {
            console.error('Error loading available accounts:', e);
            setAvailableAccounts([]);
        }
    };

    // Load records whenever currentSheetId changes with automatic row sanitization
    const loadCurrentSheetData = async () => {
        try {
            refreshAvailableAccounts();
            const cloudRecords = await sheetsAPI.getSheetRecords(currentSheetId);
            if (cloudRecords && Array.isArray(cloudRecords)) {
                const sanitized = cloudRecords.map((item, idx) => sanitizeRecord(item, idx)).filter(Boolean);
                setRecords(sanitized);
                await refreshAllCounts();
            }
        } catch (e) {
            console.error('Failed to load sheet data:', e);
        }
    };

    // Update counts of all sheets for badges
    const refreshAllCounts = async () => {
        try {
            const counts = await sheetsAPI.getAllSheetCounts();
            setAllSheetsCounts(counts);
        } catch (error) {
            console.error('Failed to refresh sheet counts:', error);
            setAllSheetsCounts({});
        }
    };

    // Self-healing check on component mount
    useEffect(() => {
        sheetsAPI.getSheetsConfig().then(cfg => {
            if (Array.isArray(cfg) && cfg.length > 0) {
                setSheetsList(cfg);
            }
        });
    }, []);

    // Periodic background sync across devices (every 3 seconds)
    useEffect(() => {
        const onSheetsChanged = () => {
            loadCurrentSheetData();
            refreshAllCounts();
        };
        window.addEventListener(SHEETS_CHANGED, onSheetsChanged);
        const interval = setInterval(async () => {
            try {
                const cloudRecords = await sheetsAPI.getSheetRecords(currentSheetId);
                if (cloudRecords && Array.isArray(cloudRecords)) {
                    const sanitized = cloudRecords.map((item, idx) => sanitizeRecord(item, idx)).filter(Boolean);
                    setRecords(prev => {
                        if (JSON.stringify(prev) !== JSON.stringify(sanitized)) {
                            return sanitized;
                        }
                        return prev;
                    });
                    refreshAllCounts();
                }
            } catch {}
        }, 30000);
        return () => { clearInterval(interval); window.removeEventListener(SHEETS_CHANGED, onSheetsChanged); };
    }, [currentSheetId]);

    // Close duration dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (durationDropdownRef.current && !durationDropdownRef.current.contains(e.target)) {
                setIsDurationDropdownOpen(false);
            }
        };
        if (isDurationDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isDurationDropdownOpen]);

    useEffect(() => {
        loadCurrentSheetData();
        refreshAllCounts();
        setSelectedIds(new Set());
        setCurrentPage(1);
        setSearchTerm('');
        setExpiryFilter('all');
    }, [currentSheetId]);

    // Save records to LocalStorage & Supabase cloud
    const saveRecords = async (newRecords) => {
        try {
            const sanitized = newRecords.map((r, i) => sanitizeRecord(r, i)).filter(Boolean);
            await sheetsAPI.saveSheetRecords(currentSheetId, sanitized);
            setRecords(sanitized);
            refreshAllCounts();
            if (currentSheetId === 'account_data') {
                refreshAvailableAccounts();
            }
            return true;
        } catch (e) {
            console.error('Error saving data:', e);
            showToast('حدث خطأ أثناء حفظ البيانات', 'error');
            return false;
        }
    };

    // Current sheet object
    const currentSheet = useMemo(() => {
        return sheetsList.find(s => s.id === currentSheetId) || sheetsList[0] || DEFAULT_SHEETS[0];
    }, [sheetsList, currentSheetId]);

    const isClientOrMerchant = currentSheetId === 'client_data' || currentSheetId === 'merchant_data';

    const availableAccountChoices = useMemo(() => {
        return availableAccounts
            .filter(acc => {
                const maxUses = Math.max(1, Number(acc.maxUses || 2));
                const currentUses = Math.max(0, Number(acc.currentUses || 0));
                return currentUses < maxUses;
            })
            .sort((a, b) => String(a.email || a.selectedAccount || '').localeCompare(String(b.email || b.selectedAccount || '')));
    }, [availableAccounts]);

    const handleSelectAvailableAccount = (value) => {
        const selectedValue = String(value || '').trim();
        const account = availableAccountChoices.find(acc => {
            return String(acc.id) === selectedValue
                || String(acc.email || '').toLowerCase() === selectedValue.toLowerCase()
                || String(acc.selectedAccount || '').toLowerCase() === selectedValue.toLowerCase();
        });

        if (!account) {
            setFormData(prev => ({ ...prev, selectedAccount: selectedValue }));
            return;
        }

        setFormData(prev => ({
            ...prev,
            email: account.email || account.selectedAccount || selectedValue,
            selectedAccount: account.email || account.selectedAccount || selectedValue,
            password: prev.password || account.password || '',
            password2: prev.password2 || account.password2 || ''
        }));
    };

    const handleSetDeviceType = (deviceType) => {
        setFormData(prev => {
            if (deviceType !== 'جهازين' || !prev.selectedAccount) {
                return { ...prev, deviceType };
            }

            const account = availableAccounts.find(acc => {
                const selectedValue = String(prev.selectedAccount || '').toLowerCase();
                return String(acc.email || '').toLowerCase() === selectedValue
                    || String(acc.selectedAccount || '').toLowerCase() === selectedValue;
            });
            const maxUses = Math.max(1, Number(account?.maxUses || 2));
            const currentUses = Math.max(0, Number(account?.currentUses || 0));
            if (account && (currentUses > 0 || maxUses < 2)) {
                return { ...prev, deviceType, selectedAccount: '' };
            }
            return { ...prev, deviceType };
        });
    };

    const findSelectedAvailableAccount = (selectedAccount = formData.selectedAccount) => {
        const selectedValue = String(selectedAccount || '').trim().toLowerCase();
        if (!selectedValue) return null;
        return availableAccountChoices.find(acc => {
            return String(acc.id) === selectedValue
                || String(acc.email || '').toLowerCase() === selectedValue
                || String(acc.selectedAccount || '').toLowerCase() === selectedValue;
        }) || null;
    };

    // Copy helper with feedback
    const handleCopy = (text, key) => {
        if (!text) {
            showToast('لا توجد بيانات للنسخ', 'warning');
            return;
        }
        navigator.clipboard.writeText(text);
        setCopiedField(key);
        showToast('تم النسخ إلى الحافظة بنجاح ✓', 'success');
        setTimeout(() => setCopiedField(null), 1500);
    };

    const handleCopyAdobeAccess = (rec) => {
        if (!rec?.email) {
            showToast('يجب وجود الإيميل للنسخ', 'warning');
            return;
        }

        const adobePassword = (rec.password2 && rec.password2.trim() && rec.password2 !== 'Will be added later')
            ? rec.password2.trim()
            : 'Service2030@';

        const message = [
            '┌──────────────────────────┐',
            '│          🎨 Adobe Creative Cloud  ',
            '└──────────────────────────┘',
            '',
            `📧 Adobe Mail : ${rec.email}`,
            `🔑 Adobe Password : ${adobePassword}`,
            '',
            '━━━━━━━━━',
            '⚠️ ملحوظه هامة جداً ‼️',
            '',
            '🚫 ممنوع تغيير أي بيانات أو',
            '   باسورد في حساب Adobe أو',
            '   تعديل أي إعدادات خاصة بالحساب.',
            '',
            ' في حالة تغيير أي بيانات،',
            '   الحساب هيفقد الضمان والاشتراك.',
        ].join('\n');

        handleCopy(message, `adobe_access_${rec.id}`);
    };

    // Toggle Secret Visibility
    const toggleSecret = (id, field) => {
        const key = `${id}_${field}`;
        setVisibleSecrets(prev => ({ ...prev, [key]: (field === 'pass' || field === 'pass2') ? prev[key] === false : !prev[key] }));
    };

    // Handle Form Submit (Add or Edit)
    const handleFormSubmit = async (e) => {
        e.preventDefault();
        if (isSaving) return;

        if (isClientOrMerchant) {
            if (!editingRecord && currentSheetId === 'client_data' && accountEntryMode === 'available' && !findSelectedAvailableAccount()) {
                showToast('يرجى اختيار ميل متاح من بيانات الحساب', 'warning');
                return;
            }
            if (!formData.email.trim()) {
                showToast('يرجى إدخال البريد الإلكتروني', 'warning');
                return;
            }
            if (!formData.duration) {
                showToast('يرجى اختيار مدة الاشتراك', 'warning');
                return;
            }
            if (!formData.deviceType) {
                showToast('يرجى اختيار جهاز أو جهازين', 'warning');
                return;
            }
            const selected = findSelectedAvailableAccount();
            if (!editingRecord && accountEntryMode === 'available' && selected && formData.deviceType === 'جهازين' && Number(selected.currentUses) > 0) {
                showToast('الحساب المختار متاح لجهاز واحد فقط', 'warning');
                return;
            }
        } else if (currentSheetId === 'account_data') {
            if (!formData.email && !formData.password && !formData.password2) {
                showToast('يرجى إدخال البريد الإلكتروني أو كلمة المرور على الأقل', 'warning');
                return;
            }
        } else if (currentSheetId === 'reminders_data') {
            if (!formData.email && !formData.notes) {
                showToast('يرجى كتابة عنوان أو تفاصيل التذكير', 'warning');
                return;
            }
        } else {
            if (!formData.email && !formData.invoiceNumber && !formData.visa && !formData.selectedAccount) {
                showToast('يرجى إدخال البريد الإلكتروني أو رقم الفاتورة أو بيانات الحساب على الأقل', 'warning');
                return;
            }
        }

        const cleanPayload = isClientOrMerchant ? {
            email: formData.email,
            password: formData.password,
            password2: formData.password2 || 'Service2030@',
            duration: formData.duration,
            startDate: formData.startDate || '',
            deviceType: formData.deviceType || 'جهاز',
            paymentStatus: formData.paymentStatus || 'مدفوع',
            selectedAccount: formData.selectedAccount || '',
            notes: formData.notes,
            invoiceNumber: '',
            visa: '',
            visaAccount: '',
            accountCreatedDate: '',
            reminderDays: ''
        } : currentSheetId === 'account_data' ? {
            email: formData.email,
            password: formData.password,
            password2: formData.password2 || 'Service2030@',
            invoiceNumber: formData.invoiceNumber || '',
            visa: formData.visa || '',
            visaAccount: formData.visaAccount || '',
            duration: '',
            startDate: '',
            deviceType: '',
            paymentStatus: '',
            selectedAccount: '',
            notes: formData.notes,
            accountCreatedDate: formData.accountCreatedDate || new Date().toISOString().slice(0, 10),
            reminderDays: formData.reminderDays || '20',
            currentUses: editingRecord?.currentUses || 0,
            maxUses: editingRecord?.maxUses || 2,
            accountUsageStatus: editingRecord?.accountUsageStatus || '',
            offerActivated: editingRecord?.offerActivated || false,
            offerActivatedAt: editingRecord?.offerActivatedAt || ''
        } : currentSheetId === 'reminders_data' ? {
            email: formData.email || 'تذكير بدون عنوان',
            password: formData.password || 'متوسط',
            password2: 'Service2030@',
            invoiceNumber: '',
            visa: '',
            visaAccount: '',
            duration: '',
            startDate: formData.accountCreatedDate || formData.startDate || new Date().toISOString().slice(0, 10),
            deviceType: formData.deviceType || 'تذكير عام',
            paymentStatus: '',
            selectedAccount: '',
            notes: formData.notes || '',
            accountCreatedDate: formData.accountCreatedDate || formData.startDate || new Date().toISOString().slice(0, 10),
            reminderDays: formData.reminderDays || '0',
            currentUses: 0,
            maxUses: 1,
            accountUsageStatus: '',
            offerActivated: editingRecord?.offerActivated || false,
            offerActivatedAt: editingRecord?.offerActivatedAt || ''
        } : {
            email: formData.email,
            password: formData.password,
            password2: formData.password2 || 'Service2030@',
            invoiceNumber: formData.invoiceNumber,
            visa: formData.visa,
            visaAccount: formData.visaAccount,
            duration: '',
            startDate: '',
            deviceType: '',
            paymentStatus: '',
            selectedAccount: formData.selectedAccount || '',
            notes: formData.notes,
            accountCreatedDate: '',
            reminderDays: ''
        };

        setIsSaving(true);
        try {
        if (editingRecord) {
            // Edit existing
            const updated = records.map(item => {
                if (item.id === editingRecord.id) {
                    return {
                        ...item,
                        ...cleanPayload,
                        updated_at: new Date().toISOString()
                    };
                }
                return item;
            });
            if (!await saveRecords(updated)) return;
            showToast('تم تعديل البيانات بنجاح ✓', 'success');
        } else {
            // Add new
            const newRecord = {
                id: 'REC-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
                ...cleanPayload,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            if (currentSheetId === 'client_data' && accountEntryMode === 'available') {
                const selectedAcc = findSelectedAvailableAccount();
                await sellCloudAccount(newRecord, selectedAcc?.id);
            } else if (!await saveRecords([newRecord, ...records])) return;
            showToast('تم إضافة السجل الجديد بنجاح ✓', 'success');
        }

        setShowAddModal(false);
        setEditingRecord(null);
        setAccountEntryMode('available');
        setFormData({
            email: '',
            password: '',
            password2: '',
            duration: '',
            startDate: '',
            deviceType: '',
            paymentStatus: 'مدفوع',
            selectedAccount: '',
            invoiceNumber: '',
            visa: '',
            visaAccount: '',
            notes: '',
            accountCreatedDate: '',
            reminderDays: '20',
            offerActivated: false,
            offerActivatedAt: ''
        });
        } catch (err) {
            console.error('Error saving record/sale:', err);
            showToast('تعذر حفظ البيع: ' + (err?.message || 'تأكد من اتصال قاعدة البيانات وتوفر الحساب'), 'error');
        } finally { setIsSaving(false); }
    };

    // Open Edit Modal
    const handleOpenEdit = (rec) => {
        refreshAvailableAccounts();
        setEditingRecord(rec);
        setAccountEntryMode(rec.selectedAccount ? 'available' : 'manual');
        setFormData({
            email: rec.email || '',
            password: rec.password || '',
            password2: rec.password2 || '',
            duration: rec.duration || '',
            startDate: rec.startDate || rec.date || '',
            deviceType: rec.deviceType || 'جهاز',
            paymentStatus: rec.paymentStatus || 'مدفوع',
            selectedAccount: rec.selectedAccount || '',
            invoiceNumber: rec.invoiceNumber || '',
            visa: rec.visa || '',
            visaAccount: rec.visaAccount || '',
            notes: rec.notes || '',
            accountCreatedDate: rec.accountCreatedDate || '',
            reminderDays: rec.reminderDays || '',
            offerActivated: rec.offerActivated || false,
            offerActivatedAt: rec.offerActivatedAt || ''
        });
        setShowAddModal(true);
    };

    // Move records to trash
    const moveToTrash = async (recordsToTrash, originId, originName) => {
        try {
            const existingTrash = await sheetsAPI.getSheetRecords('trash_data');

            const now = new Date().toISOString();
            const prepared = recordsToTrash.map(rec => ({
                ...rec,
                deletedAt: now,
                originSheetId: originId,
                originSheetName: originName
            }));

            const updatedTrash = [...prepared, ...existingTrash].map((r, i) => sanitizeRecord(r, i)).filter(Boolean);
            await sheetsAPI.saveSheetRecords('trash_data', updatedTrash);
            await refreshAllCounts();
        } catch (err) {
            console.error('Error moving records to trash:', err);
        }
    };

    // Delete single record (Soft delete to trash, or permanent if already in trash)
    const handleDeleteRecord = async (id) => {
        if (isTrashSheet) {
            const confirmed = await showConfirm({
                title: 'حذف السجل نهائياً',
                message: 'هل أنت متأكد من حذف هذا السجل نهائياً؟ لن يمكنك استعادته مرة أخرى.',
                confirmText: 'نعم، احذف',
                cancelText: 'إلغاء',
                type: 'danger'
            });
            if (!confirmed) return;

            const updated = records.filter(r => r.id !== id);
            saveRecords(updated);
            const newSelected = new Set(selectedIds);
            newSelected.delete(id);
            setSelectedIds(newSelected);
            showToast('تم الحذف النهائي للسجل بنجاح', 'info');
        } else {
            const confirmed = await showConfirm({
                title: 'حذف السجل',
                message: 'هل تريد حذف هذا السجل ونقله إلى سلة المهملات؟',
                confirmText: 'نعم، احذف',
                cancelText: 'إلغاء',
                type: 'danger'
            });
            if (!confirmed) return;

            const targetRecord = records.find(r => r.id === id);
            if (targetRecord) {
                await moveToTrash([targetRecord], currentSheetId, currentSheet?.name || 'شيت');
            }
            const updated = records.filter(r => r.id !== id);
            await saveRecords(updated);
            const newSelected = new Set(selectedIds);
            newSelected.delete(id);
            setSelectedIds(newSelected);
            showToast('تم نقل السجل إلى سلة المهملات بنجاح ✓', 'success');
        }
    };

    // Restore single record from trash back to its original sheet
    const handleRestoreRecord = async (recordToRestore) => {
        try {
            const targetSheetId = recordToRestore.originSheetId || 'account_data';
            const targetRecords = await sheetsAPI.getSheetRecords(targetSheetId);

            // Clean trash metadata from restored record
            const { deletedAt, originSheetId, originSheetName, ...cleanRecord } = recordToRestore;
            cleanRecord.updated_at = new Date().toISOString();

            const updatedTarget = [cleanRecord, ...targetRecords].map((r, i) => sanitizeRecord(r, i)).filter(Boolean);
            await sheetsAPI.saveSheetRecords(targetSheetId, updatedTarget);

            // Remove from trash
            const updatedTrash = records.filter(r => r.id !== recordToRestore.id);
            await saveRecords(updatedTrash);

            const newSelected = new Set(selectedIds);
            newSelected.delete(recordToRestore.id);
            setSelectedIds(newSelected);

            const destName = recordToRestore.originSheetName || sheetsList.find(s => s.id === targetSheetId)?.name || 'الشيت الأصلي';
            showToast(`تم استرداد السجل بنجاح إلى "${destName}" ✓`, 'success');
        } catch (err) {
            console.error('Error restoring record:', err);
            showToast('حدث خطأ أثناء استرداد السجل', 'error');
        }
    };

    // Bulk Restore from trash
    const handleBulkRestore = async () => {
        if (selectedIds.size === 0) return;
        try {
            const selectedRecords = records.filter(r => selectedIds.has(r.id));
            // Group by originSheetId
            const grouped = {};
            selectedRecords.forEach(rec => {
                const destId = rec.originSheetId || 'account_data';
                if (!grouped[destId]) grouped[destId] = [];
                const { deletedAt, originSheetId, originSheetName, ...cleanRec } = rec;
                cleanRec.updated_at = new Date().toISOString();
                grouped[destId].push(cleanRec);
            });

            // Save to each origin sheet
            for (const destId of Object.keys(grouped)) {
                const currentDestData = await sheetsAPI.getSheetRecords(destId);
                const updatedDest = [...grouped[destId], ...currentDestData].map((r, i) => sanitizeRecord(r, i)).filter(Boolean);
                await sheetsAPI.saveSheetRecords(destId, updatedDest);
            }

            // Remove all restored from trash
            const updatedTrash = records.filter(r => !selectedIds.has(r.id));
            await saveRecords(updatedTrash);
            setSelectedIds(new Set());
            showToast(`تم استرداد ${selectedRecords.length} سجل بنجاح إلى شيتاتها الأصلية ✓`, 'success');
        } catch (err) {
            console.error('Error in bulk restore:', err);
            showToast('حدث خطأ أثناء استرداد السجلات', 'error');
        }
    };

    // Empty entire trash
    const handleEmptyTrash = async () => {
        if (records.length === 0) return;
        const confirmed = await showConfirm({
            title: 'إفراغ سلة المهملات',
            message: 'تحذير: هل أنت متأكد من رغبتك في إفراغ سلة المهملات بالكامل؟ سيتم حذف جميع السجلات نهائياً ولا يمكن التراجع.',
            confirmText: 'نعم، إفراغ المهملات',
            cancelText: 'إلغاء',
            type: 'danger'
        });
        if (!confirmed) return;

        saveRecords([]);
        setSelectedIds(new Set());
        showToast('تم إفراغ سلة المهملات بالكامل بنجاح', 'info');
    };

    // Quick toggle payment status directly from table
    const handleTogglePaymentStatus = (id) => {
        const updated = records.map(r => {
            if (r.id === id) {
                const nextStatus = r.paymentStatus === 'غير مدفوع' ? 'مدفوع' : 'غير مدفوع';
                return { ...r, paymentStatus: nextStatus, updated_at: new Date().toISOString() };
            }
            return r;
        });
        saveRecords(updated);
        showToast('تم تحديث حالة الدفع بنجاح ✓', 'success');
    };

    const handleSetAccountUsage = async (id, uses, accountUsageStatus = '') => {
        const updated = records.map(r => {
            if (r.id !== id) return r;
            const maxUses = Math.max(1, Number(r.maxUses || 2));
            const currentUses = Math.min(maxUses, Math.max(0, Number(uses) || 0));
            return {
                ...r,
                currentUses,
                maxUses,
                accountUsageStatus,
                updated_at: new Date().toISOString()
            };
        });
        if (await saveRecords(updated)) showToast('تم تحديث حالة بيع الحساب بنجاح ✓', 'success');
    };

    const handleToggleOfferActivated = async (id) => {
        const updated = records.map(r => {
            if (r.id !== id) return r;
            const nextValue = !r.offerActivated;
            return {
                ...r,
                offerActivated: nextValue,
                offerActivatedAt: nextValue ? new Date().toISOString() : '',
                updated_at: new Date().toISOString()
            };
        });
        if (await saveRecords(updated)) showToast('تم تحديث حالة تفعيل العرض ✓', 'success');
    };

    // Delete Selected Records (Bulk soft-delete or permanent delete)
    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;
        if (isTrashSheet) {
            const confirmed = await showConfirm({
                title: 'حذف السجلات نهائياً',
                message: `هل أنت متأكد من الحذف النهائي لـ ${selectedIds.size} سجل محدد؟ لن يمكن استعادتها.`,
                confirmText: 'نعم، احذف',
                cancelText: 'إلغاء',
                type: 'danger'
            });
            if (!confirmed) return;

            const updated = records.filter(r => !selectedIds.has(r.id));
            saveRecords(updated);
            setSelectedIds(new Set());
            showToast(`تم الحذف النهائي لـ ${selectedIds.size} سجل بنجاح`, 'info');
        } else {
            const confirmed = await showConfirm({
                title: 'نقل إلى سلة المهملات',
                message: `هل أنت متأكد من نقل ${selectedIds.size} سجل محدد إلى سلة المهملات؟`,
                confirmText: 'نعم، احذف',
                cancelText: 'إلغاء',
                type: 'danger'
            });
            if (!confirmed) return;

            const targetRecords = records.filter(r => selectedIds.has(r.id));
            await moveToTrash(targetRecords, currentSheetId, currentSheet?.name || 'شيت');
            const updated = records.filter(r => !selectedIds.has(r.id));
            await saveRecords(updated);
            setSelectedIds(new Set());
            showToast(`تم نقل ${targetRecords.length} سجل إلى سلة المهملات بنجاح ✓`, 'success');
        }
    };

    // Bulk Add from textarea (supports various delimiters: tab, colon, comma, pipe)
    const handleBulkAddSubmit = (e) => {
        e.preventDefault();
        if (!bulkText.trim()) return;

        const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean);
        const newItems = [];

        lines.forEach((line, idx) => {
            // Determine delimiter: tab, pipe, colon, comma
            let parts = [];
            if (line.includes('\t')) parts = line.split('\t');
            else if (line.includes('|')) parts = line.split('|');
            else if (line.includes(',')) parts = line.split(',');
            else if (line.includes(':')) parts = line.split(':');
            else parts = [line];

            parts = parts.map(p => p.trim());

            if (isClientOrMerchant) {
                newItems.push({
                    id: 'REC-' + Date.now() + '-' + idx + '-' + Math.random().toString(36).substring(2, 6),
                    email: parts[0] || '',
                    password: parts[1] || '',
                    password2: parts[2] || '',
                    duration: parts[3] || '',
                    startDate: parts[4] || '',
                    selectedAccount: parts[5] || '',
                    notes: parts[6] || '',
                    invoiceNumber: '',
                    visa: '',
                    visaAccount: '',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });
            } else {
                newItems.push({
                    id: 'REC-' + Date.now() + '-' + idx + '-' + Math.random().toString(36).substring(2, 6),
                    email: parts[0] || '',
                    password: parts[1] || '',
                    password2: parts[2] || '',
                    invoiceNumber: parts[3] || '',
                    visa: parts[4] || '',
                    visaAccount: parts[5] || '',
                    selectedAccount: parts[6] || '',
                    notes: parts[7] || '',
                    duration: '',
                    startDate: '',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });
            }
        });

        if (newItems.length > 0) {
            saveRecords([...newItems, ...records]);
            showToast(`تمت إضافة ${newItems.length} سجل بنجاح ✓`, 'success');
            setBulkText('');
            setShowBulkModal(false);
        }
    };

    // Export to Excel
    const handleExportExcel = () => {
        if (records.length === 0) {
            showToast('لا توجد بيانات لتصديرها', 'warning');
            return;
        }

        let dataToExport;
        if (isTrashSheet) {
            dataToExport = records.map((r, i) => ({
                'م': i + 1,
                'البريد الإلكتروني (Email)': r.email || '',
                'Outlook Password': r.password || '',
                'Adobe Password': r.password2 || '',
                'الشيت الأصلي': r.originSheetName || '',
                'بيانات الحساب (Account)': r.selectedAccount || '',
                'تاريخ الحذف': r.deletedAt ? new Date(r.deletedAt).toLocaleString('ar-EG') : '',
                'ملاحظات': r.notes || '',
                'تاريخ الإضافة': r.created_at ? new Date(r.created_at).toLocaleString('ar-EG') : ''
            }));
        } else if (isClientOrMerchant) {
            dataToExport = records.map((r, i) => ({
                'م': i + 1,
                'البريد الإلكتروني (Email)': r.email || '',
                'Outlook Password': r.password || '',
                'Adobe Password': r.password2 || '',
                'مدة الاشتراك (Duration)': r.duration || '',
                'تاريخ بداية الاشتراك (Start Date)': r.startDate || '',
                'نوع الاشتراك (Device Type)': r.deviceType || 'جهاز',
                'حالة الدفع (Payment Status)': r.paymentStatus || 'مدفوع',
                'بيانات الحساب (Account)': r.selectedAccount || '',
                'ملاحظات': r.notes || '',
                'تاريخ الإضافة': r.created_at ? new Date(r.created_at).toLocaleString('ar-EG') : ''
            }));
        } else {
            dataToExport = records.map((r, i) => {
                const base = {
                    'م': i + 1,
                    'البريد الإلكتروني (Email)': r.email || '',
                    'كلمة المرور 1 (Password)': r.password || '',
                    'كلمة المرور 2 (Password 2)': r.password2 || '',
                    'رقم الفاتورة (Invoice)': r.invoiceNumber || '',
                    'الفيزا (Visa)': r.visa || '',
                    'Edu Mail': r.visaAccount || ''
                };
                if (currentSheetId === 'account_data') {
                    const rem = calculateAccountReminder(r.accountCreatedDate, r.reminderDays, r.created_at);
                    base['تاريخ إنشاء الحساب (Creation Date)'] = r.accountCreatedDate || '';
                    base['فترة التذكير بالأيام (Reminder Days)'] = r.reminderDays || '';
                    base['حالة التذكير'] = rem.text || '';
                    base['تم تفعيل العرض'] = r.offerActivated ? 'تم' : 'لم يتم';
                    base['تاريخ تفعيل العرض'] = r.offerActivatedAt ? new Date(r.offerActivatedAt).toLocaleString('ar-EG') : '';
                } else {
                    base['بيانات الحساب (Account)'] = r.selectedAccount || '';
                }
                base['ملاحظات'] = r.notes || '';
                base['تاريخ الإضافة'] = r.created_at ? new Date(r.created_at).toLocaleString('ar-EG') : '';
                return base;
            });
        }

        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, currentSheet.name);
        XLSX.writeFile(wb, `${currentSheet.name}_${new Date().toISOString().slice(0, 10)}.xlsx`);
        showToast('تم تصدير ملف Excel بنجاح ✓', 'success');
    };

    // Export to JSON Backup
    const handleExportBackup = async () => {
        const fullBackup = await sheetsAPI.getAllSheetsData();

        const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Service_Hub_Sheets_Backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('تم حفظ نسخة احتياطية شاملة لجميع الشيتات بنجاح ✓', 'success');
    };

    // Import Excel or JSON
    const handleFileImport = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();

        if (file.name.endsWith('.json')) {
            reader.onload = (event) => {
                try {
                    const parsed = JSON.parse(event.target.result);
                    if (typeof parsed === 'object' && !Array.isArray(parsed)) {
                        // Multi-sheet backup
                        Object.keys(parsed).forEach(key => {
                            if (Array.isArray(parsed[key])) {
                                sheetsAPI.saveSheetRecords(key, parsed[key]);
                            }
                        });
                        loadCurrentSheetData();
                        refreshAllCounts();
                        showToast('تم استعادة جميع الشيتات من النسخة الاحتياطية بنجاح ✓', 'success');
                    } else if (Array.isArray(parsed)) {
                        // Single sheet
                        saveRecords([...parsed, ...records]);
                        showToast(`تم استيراد ${parsed.length} سجل بنجاح ✓`, 'success');
                    }
                } catch (err) {
                    showToast('ملف النسخ الاحتياطي غير صالح', 'error');
                }
            };
            reader.readAsText(file);
        } else {
            // Excel / CSV
            reader.onload = (event) => {
                try {
                    const data = new Uint8Array(event.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

                    if (jsonData.length <= 1) {
                        showToast('الملف فارغ أو لا يحتوي على صفوف بيانات', 'warning');
                        return;
                    }

                    // First row could be header
                    const rows = jsonData.slice(1);
                    const imported = rows.map((row, i) => {
                        if (isClientOrMerchant) {
                            return {
                                id: 'REC-' + Date.now() + '-' + i + '-' + Math.random().toString(36).substring(2, 6),
                                email: String(row[1] || row[0] || '').trim(),
                                password: String(row[2] || row[1] || '').trim(),
                                password2: String(row[3] || row[2] || '').trim(),
                                duration: String(row[4] || row[3] || '').trim(),
                                notes: String(row[5] || row[4] || '').trim(),
                                invoiceNumber: '',
                                visa: '',
                                visaAccount: '',
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString()
                            };
                        }
                        return {
                            id: 'REC-' + Date.now() + '-' + i + '-' + Math.random().toString(36).substring(2, 6),
                            email: String(row[1] || row[0] || '').trim(),
                            password: String(row[2] || row[1] || '').trim(),
                            password2: String(row[3] || row[2] || '').trim(),
                            invoiceNumber: String(row[4] || row[3] || '').trim(),
                            visa: String(row[5] || row[4] || '').trim(),
                            visaAccount: String(row[6] || row[5] || '').trim(),
                            notes: String(row[7] || row[6] || '').trim(),
                            duration: '',
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        };
                    }).filter(r => r.email || r.password || r.duration || r.invoiceNumber || r.visa);

                    if (imported.length > 0) {
                        saveRecords([...imported, ...records]);
                        showToast(`تم استيراد ${imported.length} سجل من ملف الإكسيل بنجاح ✓`, 'success');
                    } else {
                        showToast('لم يتم العثور على سجلات صالحة للاستيراد', 'warning');
                    }
                } catch (err) {
                    console.error(err);
                    showToast('حدث خطأ أثناء قراءة ملف الإكسيل', 'error');
                }
            };
            reader.readAsArrayBuffer(file);
        }

        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // Rename sheet
    const handleRenameSheet = (e) => {
        e.preventDefault();
        if (!renameValue.trim()) return;
        const updated = sheetsList.map(s => {
            if (s.id === currentSheetId) {
                return { ...s, name: renameValue.trim() };
            }
            return s;
        });
        setSheetsList(updated);
        sheetsAPI.saveSheetsConfig(updated);
        setShowRenameModal(false);
        showToast('تم تحديث اسم الشيت بنجاح ✓', 'success');
    };

    // Subscriptions & Account Alert Groups (قرب التجديد / التذكير في آخر 3 أيام، ومنتهي/مستحق، وساري)
    const alertGroups = useMemo(() => {
        if (currentSheetId === 'trash_data') {
            return { nearRenewal: [], expired: [], active: [] };
        }

        const nearRenewal = [];
        const expired = [];
        const active = [];

        records.forEach(r => {
            if ((currentSheetId === 'account_data' || currentSheetId === 'reminders_data') && r.offerActivated) return;

            const rem = (currentSheetId === 'account_data' || currentSheetId === 'reminders_data')
                ? calculateAccountReminder(r.accountCreatedDate, r.reminderDays, r.created_at)
                : calculateRemainingTime(r.startDate, r.duration, r.created_at);

            if (!rem || rem.status === 'none') return;

            if (rem.status === 'lifetime') {
                active.push({ ...r, remInfo: rem });
            } else if (rem.days !== null && rem.days < 0) {
                expired.push({ ...r, remInfo: rem });
            } else if (rem.days !== null && rem.days >= 0 && rem.days <= 3) {
                nearRenewal.push({ ...r, remInfo: rem });
            } else if (rem.days !== null && rem.days > 3) {
                active.push({ ...r, remInfo: rem });
            }
        });

        // Sort near renewal by fewest remaining days first
        nearRenewal.sort((a, b) => (a.remInfo.days ?? 0) - (b.remInfo.days ?? 0));
        // Sort expired by most recently expired first
        expired.sort((a, b) => (b.remInfo.days ?? 0) - (a.remInfo.days ?? 0));

        return { nearRenewal, expired, active };
    }, [records, currentSheetId]);

    // Filter & Search (bulletproof against numbers and nulls)
    const filteredRecords = useMemo(() => {
        let result = records;

        // Filter by Expiry Status Tab (All, Near Renewal, Expired, Active)
        if ((currentSheetId === 'account_data' || currentSheetId === 'reminders_data') && offerReminderFilter !== 'all') {
            result = result.filter(r => {
                if (offerReminderFilter === 'completed') return !!r.offerActivated;
                if (offerReminderFilter === 'pending') return !r.offerActivated;
                if (r.offerActivated) return false;
                const rem = calculateAccountReminder(r.accountCreatedDate, r.reminderDays, r.created_at);
                if (offerReminderFilter === 'near3') return rem.days !== null && rem.days > 0 && rem.days <= 3;
                if (offerReminderFilter === 'today') return rem.days === 0;
                if (offerReminderFilter === 'overdue') return rem.days !== null && rem.days < 0;
                return true;
            });
        }

        if (expiryFilter === 'near') {
            result = result.filter(r => {
                if ((currentSheetId === 'account_data' || currentSheetId === 'reminders_data') && r.offerActivated) return false;
                const rem = (currentSheetId === 'account_data' || currentSheetId === 'reminders_data')
                    ? calculateAccountReminder(r.accountCreatedDate, r.reminderDays, r.created_at)
                    : calculateRemainingTime(r.startDate, r.duration, r.created_at);
                return rem.days !== null && rem.days >= 0 && rem.days <= 3 && rem.status !== 'lifetime';
            });
        } else if (expiryFilter === 'expired') {
            result = result.filter(r => {
                if ((currentSheetId === 'account_data' || currentSheetId === 'reminders_data') && r.offerActivated) return false;
                const rem = (currentSheetId === 'account_data' || currentSheetId === 'reminders_data')
                    ? calculateAccountReminder(r.accountCreatedDate, r.reminderDays, r.created_at)
                    : calculateRemainingTime(r.startDate, r.duration, r.created_at);
                return rem.days !== null && rem.days < 0;
            });
        } else if (expiryFilter === 'active') {
            result = result.filter(r => {
                const rem = (currentSheetId === 'account_data' || currentSheetId === 'reminders_data')
                    ? calculateAccountReminder(r.accountCreatedDate, r.reminderDays, r.created_at)
                    : calculateRemainingTime(r.startDate, r.duration, r.created_at);
                return rem.days > 3 || rem.status === 'lifetime';
            });
        }

        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase().trim();
            result = result.filter(r => {
                const rem = (currentSheetId === 'account_data' || currentSheetId === 'reminders_data')
                    ? calculateAccountReminder(r.accountCreatedDate, r.reminderDays, r.created_at)
                    : calculateRemainingTime(r.startDate, r.duration, r.created_at);
                return (
                    String(r.email || '').toLowerCase().includes(q) ||
                    String(r.password || '').toLowerCase().includes(q) ||
                    String(r.password2 || '').toLowerCase().includes(q) ||
                    String(r.originSheetName || '').toLowerCase().includes(q) ||
                    String(r.deletedAt || '').toLowerCase().includes(q) ||
                    String(r.duration || '').toLowerCase().includes(q) ||
                    String(r.startDate || '').toLowerCase().includes(q) ||
                    String(r.accountCreatedDate || '').toLowerCase().includes(q) ||
                    String(r.reminderDays || '').toLowerCase().includes(q) ||
                    String(r.deviceType || '').toLowerCase().includes(q) ||
                    String(r.paymentStatus || '').toLowerCase().includes(q) ||
                    String(rem?.text || '').toLowerCase().includes(q) ||
                    String(r.invoiceNumber || '').toLowerCase().includes(q) ||
                    String(r.visa || '').toLowerCase().includes(q) ||
                    String(r.visaAccount || '').toLowerCase().includes(q) ||
                    String(r.notes || '').toLowerCase().includes(q)
                );
            });
        }

        // Advanced filters: paymentStatus filter
        if (paymentFilter !== 'all' && isClientOrMerchant) {
            result = result.filter(r => {
                const status = String(r.paymentStatus || 'مدفوع').toLowerCase();
                if (paymentFilter === 'paid') return status === 'مدفوع';
                if (paymentFilter === 'unpaid') return status !== 'مدفوع';
                return true;
            });
        }

        // Advanced filters: deviceType filter
        if (deviceFilter !== 'all' && isClientOrMerchant) {
            result = result.filter(r => {
                return String(r.deviceType || 'جهاز') === deviceFilter;
            });
        }

        // Sorting
        result = [...result].sort((a, b) => {
            if (sortBy.field === 'deletedAt') {
                const timeA = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
                const timeB = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
                if (timeA < timeB) return sortBy.asc ? -1 : 1;
                if (timeA > timeB) return sortBy.asc ? 1 : -1;
                return 0;
            }
            if (sortBy.field === 'accountReminderDays') {
                const daysA = calculateAccountReminder(a.accountCreatedDate, a.reminderDays, a.created_at).days ?? -999999;
                const daysB = calculateAccountReminder(b.accountCreatedDate, b.reminderDays, b.created_at).days ?? -999999;
                if (daysA < daysB) return sortBy.asc ? -1 : 1;
                if (daysA > daysB) return sortBy.asc ? 1 : -1;
                return 0;
            }
            if (sortBy.field === 'remainingDays' || sortBy.field === 'startDate') {
                const daysA = calculateRemainingTime(a.startDate, a.duration, a.created_at).days ?? -999999;
                const daysB = calculateRemainingTime(b.startDate, b.duration, b.created_at).days ?? -999999;
                if (daysA < daysB) return sortBy.asc ? -1 : 1;
                if (daysA > daysB) return sortBy.asc ? 1 : -1;
                return 0;
            }
            const valA = String(a[sortBy.field] ?? '').toLowerCase();
            const valB = String(b[sortBy.field] ?? '').toLowerCase();

            if (valA < valB) return sortBy.asc ? -1 : 1;
            if (valA > valB) return sortBy.asc ? 1 : -1;
            return 0;
        });

        return result;
    }, [records, searchTerm, sortBy, expiryFilter, offerReminderFilter, currentSheetId]);

    // Pagination
    const totalPages = Math.ceil(filteredRecords.length / pageSize) || 1;
    const paginatedRecords = useMemo(() => {
        if (pageSize === 'all') return filteredRecords;
        const start = (currentPage - 1) * pageSize;
        return filteredRecords.slice(start, start + pageSize);
    }, [filteredRecords, currentPage, pageSize]);

    // Selection helper
    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const allIds = new Set(filteredRecords.map(r => r.id));
            setSelectedIds(allIds);
        } else {
            setSelectedIds(new Set());
        }
    };

    const toggleSelectRow = (id) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const offerReminderStats = useMemo(() => {
        if (currentSheetId !== 'account_data' && currentSheetId !== 'reminders_data') {
            return { pending: 0, near3: 0, today: 0, overdue: 0, completed: 0 };
        }

        return records.reduce((acc, r) => {
            if (r.offerActivated) {
                acc.completed += 1;
                return acc;
            }
            const rem = calculateAccountReminder(r.accountCreatedDate, r.reminderDays, r.created_at);
            if (rem.days === null) return acc;
            acc.pending += 1;
            if (rem.days > 0 && rem.days <= 3) acc.near3 += 1;
            if (rem.days === 0) acc.today += 1;
            if (rem.days < 0) acc.overdue += 1;
            return acc;
        }, { pending: 0, near3: 0, today: 0, overdue: 0, completed: 0 });
    }, [records, currentSheetId]);

    // Stats calculations
    const stats = useMemo(() => {
        const total = records.length;
        if (currentSheetId === 'trash_data') {
            const accountsCount = records.filter(r => r.originSheetId === 'account_data').length;
            const clientsCount = records.filter(r => r.originSheetId === 'client_data').length;
            const merchantsCount = records.filter(r => r.originSheetId === 'merchant_data').length;
            const remindersCount = records.filter(r => r.originSheetId === 'reminders_data').length;
            return {
                total,
                accountsCount,
                clientsCount,
                merchantsCount,
                remindersCount,
                nearCount: 0,
                expiredCount: 0
            };
        }

        if (currentSheetId === 'reminders_data') {
            return {
                total,
                todayCount: offerReminderStats.today,
                nearCount: offerReminderStats.near3,
                overdueCount: offerReminderStats.overdue,
                completedCount: offerReminderStats.completed,
                pendingCount: offerReminderStats.pending
            };
        }

        const withInvoices = records.filter(r => r.invoiceNumber).length;
        const withVisa = records.filter(r => r.visa).length;
        const withVisaAccount = records.filter(r => r.visaAccount).length;
        const withDuration = records.filter(r => r.duration).length;
        const withBothPasswords = records.filter(r => r.password && r.password2).length;
        const withEmail = records.filter(r => r.email).length;
        const withReminder = records.filter(r => r.reminderDays && parseInt(r.reminderDays) > 0).length;
        return {
            total,
            withInvoices,
            withVisa,
            withVisaAccount,
            withDuration,
            withBothPasswords,
            withEmail,
            withReminder,
            nearCount: alertGroups.nearRenewal.length,
            expiredCount: alertGroups.expired.length
        };
    }, [records, alertGroups, currentSheetId, offerReminderStats]);

    return (
        <div className="space-y-6 animate-fade-in font-sans pb-12">
            {/* Toast Notification */}
            {toast && (
                <div role="alert" className={`fixed top-5 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 text-white font-bold text-sm backdrop-blur-md transition-all duration-300 ${
                    toast.type === 'success' ? 'bg-emerald-600/95 shadow-emerald-500/30' :
                    toast.type === 'error' ? 'bg-red-600/95 shadow-red-500/30' :
                    toast.type === 'warning' ? 'bg-amber-600/95 shadow-amber-500/30' :
                    'bg-blue-600/95 shadow-blue-500/30'
                }`}>
                    <i className={`fa-solid ${
                        toast.type === 'success' ? 'fa-circle-check' :
                        toast.type === 'error' ? 'fa-circle-xmark' :
                        toast.type === 'warning' ? 'fa-triangle-exclamation' : 'fa-circle-info'
                    } text-lg`}></i>
                    <span>{toast.message}</span>
                </div>
            )}

            {/* Header & Quick Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-xs font-bold text-slate-400 dark:text-slate-500">
                            {isTrashSheet ? 'إجمالي المحذوفات' : 'إجمالي السجلات'}
                        </p>
                        <h4 className={`text-2xl font-black ${isTrashSheet ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-white'} mt-1`}>
                            {stats.total}
                        </h4>
                    </div>
                    <div className={`w-12 h-12 rounded-xl ${isTrashSheet ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400' : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400'} flex items-center justify-center text-xl`}>
                        <i className={`fa-solid ${isTrashSheet ? 'fa-trash-can' : 'fa-list-check'}`}></i>
                    </div>
                </div>

                {isTrashSheet ? (
                    <>
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">حسابات محذوفة</p>
                                <h4 className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">{stats.accountsCount}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-user-gear"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">عملاء محذوفين</p>
                                <h4 className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">{stats.clientsCount}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-users"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">تجار محذوفين</p>
                                <h4 className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{stats.merchantsCount}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-store"></i>
                            </div>
                        </div>
                    </>
                ) : isClientOrMerchant ? (
                    <>
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">مدة اشتراك مسجلة</p>
                                <h4 className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{stats.withDuration}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl">
                                <i className="fa-regular fa-clock"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">باسورد أول وثانٍ</p>
                                <h4 className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">{stats.withBothPasswords}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-shield-halved"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">إيميلات مسجلة</p>
                                <h4 className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">{stats.withEmail}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-envelope"></i>
                            </div>
                        </div>
                    </>
                ) : currentSheetId === 'reminders_data' ? (
                    <>
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">تذكيرات اليوم ⏰</p>
                                <h4 className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">{stats.todayCount}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-bell"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">قادمة خلال 3 أيام</p>
                                <h4 className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{stats.nearCount}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-clock"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">تم إنجازها</p>
                                <h4 className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{stats.completedCount}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-circle-check"></i>
                            </div>
                        </div>
                    </>
                ) : currentSheetId === 'account_data' ? (
                    <>
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">حسابات بتذكير محدد</p>
                                <h4 className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">{stats.withReminder}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-bell"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">تذكيرات قريبة / مستحقة</p>
                                <h4 className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{stats.nearCount + stats.expiredCount}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-triangle-exclamation"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">إيميلات مسجلة</p>
                                <h4 className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">{stats.withEmail}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-envelope"></i>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">سجلات بفواتير</p>
                                <h4 className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{stats.withInvoices}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-receipt"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">سجلات بفيزا</p>
                                <h4 className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{stats.withVisa}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-credit-card"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">حسابات الفيزا</p>
                                <h4 className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">{stats.withVisaAccount}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-building-columns"></i>
                            </div>
                        </div>
                    </>
                )}
            </div>



            {/* Main Action Bar */}
            <div className="bg-white dark:bg-slate-900 p-4 md:p-5 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Title and rename button */}
                    <div className="flex items-center gap-3">
                        <div className={`w-11 h-11 rounded-xl bg-gradient-to-tr ${currentSheet.color} text-white flex items-center justify-center text-xl shadow-md`}>
                            <i className={`fa-solid ${currentSheet.icon}`}></i>
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg md:text-xl font-black text-slate-800 dark:text-white">
                                    {currentSheet.name}
                                </h2>
                                {canCustomize && (
                                    <button
                                        onClick={() => {
                                            setRenameValue(currentSheet.name);
                                            setShowRenameModal(true);
                                        }}
                                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition text-xs p-1"
                                        title="تعديل اسم الشيت"
                                    >
                                        <i className="fa-solid fa-pen-to-square"></i>
                                    </button>
                                )}
                            </div>
                            <p className="text-xs text-slate-400 dark:text-slate-500">
                                {isTrashSheet
                                    ? 'سلة المهملات: استعراض الحسابات والبيانات المحذوفة مع إمكانية استردادها للشيت الأصلي أو حذفها نهائياً'
                                    : currentSheetId === 'reminders_data'
                                    ? 'جدول التذكيرات والمهام: تذكير بمواعيد التجديدات والالتزامات الهامة في أيام محددة لتجنب نسيانها'
                                    : isClientOrMerchant
                                    ? 'العملاء والاشتراكات'
                                    : currentSheetId === 'account_data'
                                    ? 'الحسابات المتاحة وتفعيل العروض'
                                    : 'السجلات'}
                            </p>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                        {isTrashSheet ? (
                            <>
                                {records.length > 0 && canEmptyTrash && (
                                    <button
                                        onClick={handleEmptyTrash}
                                        className="bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800/60 px-4 py-2.5 rounded-xl font-bold text-xs md:text-sm flex items-center gap-2 shadow-xs transition transform active:scale-95 cursor-pointer"
                                        title="حذف جميع السجلات في سلة المهملات نهائياً"
                                    >
                                        <i className="fa-solid fa-trash-can"></i>
                                        <span>إفراغ سلة المهملات</span>
                                    </button>
                                )}
                            </>
                        ) : (
                            /* Add Single Record */
                            canAdd && (
                                <button
                                    onClick={() => {
                                        refreshAvailableAccounts();
                                        setEditingRecord(null);
                                        setAccountEntryMode('available');
                                        setFormData({
                                            email: '',
                                            password: currentSheetId === 'reminders_data' ? '🔴 عاجل جداً' : '',
                                            password2: '',
                                            duration: '',
                                            startDate: new Date().toISOString().slice(0, 10),
                                            deviceType: '',
                                            paymentStatus: 'مدفوع',
                                            selectedAccount: '',
                                            invoiceNumber: '',
                                            visa: '',
                                            visaAccount: '',
                                            notes: '',
                                            accountCreatedDate: new Date().toISOString().slice(0, 10),
                                            reminderDays: currentSheetId === 'reminders_data' ? '0' : '20'
                                        });
                                        setShowAddModal(true);
                                    }}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition transform active:scale-95 cursor-pointer"
                                >
                                    <i className="fa-solid fa-plus"></i>
                                    <span>{currentSheetId === 'reminders_data' ? 'إضافة تذكير جديد' : 'إضافة بيانات جديدة'}</span>
                                </button>
                            )
                        )}
                    </div>
                </div>

                {/* Filter and Search Bar */}
                <div className="flex flex-col md:flex-row items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    {/* Live Search */}
                    <div className="relative w-full md:w-96">
                        <i className="fa-solid fa-magnifying-glass absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder={
                                currentSheetId === 'reminders_data'
                                    ? "بحث في عنوان التذكير، الأولوية، التاريخ، الملاحظات..."
                                    : isClientOrMerchant
                                    ? "بحث في الإيميل، الباسورد، مدة الاشتراك..."
                                    : currentSheetId === 'account_data'
                                    ? "بحث في الإيميل، الباسورد، تاريخ الإنشاء، التذكير، الملاحظات..."
                                    : "بحث في الإيميل، الباسورد، الفاتورة، الفيزا، الملاحظات..."
                            }
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs"
                            >
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        )}
                    </div>

                    {/* Page Sizing */}
                    <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 font-bold hidden sm:inline">عرض:</span>
                            <select
                                value={pageSize}
                                onChange={(e) => {
                                    setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value));
                                    setCurrentPage(1);
                                }}
                                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 focus:outline-none"
                            >
                                <option value={10}>10</option>
                                <option value={25}>25</option>
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                                <option value="all">الكل</option>
                            </select>
                        </div>
                    </div>
                </div>

                {currentSheetId === 'reminders_data' && (
                    <div className="flex flex-wrap items-center gap-2 pt-3">
                        {[
                            { id: 'all', label: 'كل التذكيرات', count: records.length, icon: 'fa-list', cls: 'slate' },
                            { id: 'pending', label: 'قيد الانتظار', count: offerReminderStats.pending, icon: 'fa-hourglass-half', cls: 'purple' },
                            { id: 'today', label: 'تذكيرات اليوم', count: offerReminderStats.today, icon: 'fa-bell', cls: 'red' },
                            { id: 'near3', label: 'قادمة خلال 3 أيام', count: offerReminderStats.near3, icon: 'fa-clock', cls: 'amber' },
                            { id: 'overdue', label: 'متأخرة', count: offerReminderStats.overdue, icon: 'fa-triangle-exclamation', cls: 'rose' },
                            { id: 'completed', label: 'تم الإنجاز', count: offerReminderStats.completed, icon: 'fa-circle-check', cls: 'emerald' },
                        ].map(item => {
                            const active = offerReminderFilter === item.id;
                            const colorClass = item.cls === 'amber'
                                ? active ? 'bg-amber-500 text-white border-amber-500' : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 hover:bg-amber-100'
                                : item.cls === 'purple'
                                ? active ? 'bg-purple-600 text-white border-purple-600' : 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 hover:bg-purple-100'
                                : item.cls === 'red'
                                ? active ? 'bg-red-600 text-white border-red-600' : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800 hover:bg-red-100'
                                : item.cls === 'rose'
                                ? active ? 'bg-rose-600 text-white border-rose-600' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 hover:bg-rose-100'
                                : item.cls === 'emerald'
                                ? active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
                                : active ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100';
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => {
                                        setOfferReminderFilter(item.id);
                                        setCurrentPage(1);
                                    }}
                                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-black transition cursor-pointer ${colorClass}`}
                                >
                                    <i className={`fa-solid ${item.icon} text-[10px]`}></i>
                                    <span>{item.label}</span>
                                    <span className={`min-w-5 h-5 px-1 rounded-full inline-flex items-center justify-center text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-black/5'}`}>
                                        {item.count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}

                {currentSheetId === 'account_data' && (
                    <div className="flex flex-wrap items-center gap-2 pt-3">
                        {[
                            { id: 'all', label: 'كل السجلات', count: records.length, icon: 'fa-list', cls: 'slate' },
                            { id: 'pending', label: 'لم يتم العرض', count: offerReminderStats.pending, icon: 'fa-bolt', cls: 'purple' },
                            { id: 'near3', label: 'قرب خلال 3 أيام', count: offerReminderStats.near3, icon: 'fa-clock', cls: 'amber' },
                            { id: 'today', label: 'ميعاده اليوم', count: offerReminderStats.today, icon: 'fa-bell', cls: 'red' },
                            { id: 'overdue', label: 'عدى بدون تفعيل', count: offerReminderStats.overdue, icon: 'fa-triangle-exclamation', cls: 'rose' },
                        ].map(item => {
                            const active = offerReminderFilter === item.id;
                            const colorClass = item.cls === 'amber'
                                ? active ? 'bg-amber-500 text-white border-amber-500' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                                : item.cls === 'purple'
                                ? active ? 'bg-purple-600 text-white border-purple-600' : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                                : item.cls === 'red'
                                ? active ? 'bg-red-600 text-white border-red-600' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                                : item.cls === 'rose'
                                ? active ? 'bg-rose-600 text-white border-rose-600' : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                : active ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100';
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => {
                                        setOfferReminderFilter(item.id);
                                        setCurrentPage(1);
                                    }}
                                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-black transition ${colorClass}`}
                                >
                                    <i className={`fa-solid ${item.icon} text-[10px]`}></i>
                                    <span>{item.label}</span>
                                    <span className={`min-w-5 h-5 px-1 rounded-full inline-flex items-center justify-center text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-white text-slate-700 border border-black/5'}`}>
                                        {item.count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Advanced Filters Panel - Client/Merchant Only */}
            {isClientOrMerchant && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                    <button
                        type="button"
                        onClick={() => setShowAdvancedFilters(v => !v)}
                        className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
                    >
                        <div className="flex items-center gap-2">
                            <i className="fa-solid fa-sliders text-indigo-500"></i>
                            <span>فلاتر متقدمة</span>
                            {(paymentFilter !== 'all' || deviceFilter !== 'all') && (
                                <span className="bg-indigo-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full animate-pulse">
                                    {[paymentFilter !== 'all' ? 1 : 0, deviceFilter !== 'all' ? 1 : 0].reduce((a,b)=>a+b,0)} فعّال
                                </span>
                            )}
                        </div>
                        <i className={`fa-solid fa-chevron-${showAdvancedFilters ? 'up' : 'down'} text-slate-400`}></i>
                    </button>

                    {showAdvancedFilters && (
                        <div className="px-4 pb-4 pt-1 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {/* Payment Status Filter */}
                            <div>
                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                    <i className="fa-solid fa-money-bill-wave text-emerald-500"></i>
                                    حالة الدفع
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        { id: 'all', label: 'الكل', icon: 'fa-list' },
                                        { id: 'paid', label: '✅ مدفوع', icon: 'fa-check-circle' },
                                        { id: 'unpaid', label: '❌ غير مدفوع', icon: 'fa-times-circle' },
                                    ].map(opt => (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => { setPaymentFilter(opt.id); setCurrentPage(1); }}
                                            className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition ${paymentFilter === opt.id ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'}`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Device Type Filter */}
                            <div>
                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                    <i className="fa-solid fa-desktop text-blue-500"></i>
                                    نوع الجهاز
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        { id: 'all', label: 'الكل' },
                                        { id: 'جهاز', label: '💻 جهاز واحد' },
                                        { id: 'جهازين', label: '🖥️ جهازين' },
                                    ].map(opt => (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => { setDeviceFilter(opt.id); setCurrentPage(1); }}
                                            className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition ${deviceFilter === opt.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-blue-50 dark:hover:bg-blue-900/20'}`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Reset All Filters */}
                            {(paymentFilter !== 'all' || deviceFilter !== 'all') && (
                                <div className="sm:col-span-2">
                                    <button
                                        type="button"
                                        onClick={() => { setPaymentFilter('all'); setDeviceFilter('all'); setCurrentPage(1); }}
                                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 text-[11px] font-bold hover:bg-rose-100 transition"
                                    >
                                        <i className="fa-solid fa-rotate-right"></i>
                                        إعادة تعيين الفلاتر المتقدمة
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Data Table */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                <div className="overflow-x-auto">
                    <table ref={tableRef} className="sheet-table w-full text-right text-[11px] border-collapse">
                        <thead>
                            <tr className="bg-slate-50/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-b border-slate-200/80 dark:border-slate-700/80 font-bold select-none">
                                <th className="px-1 py-1.5 w-7 text-center text-[10px]">#</th>
                                {currentSheetId === 'reminders_data' ? (
                                    <>
                                        <th
                                            onClick={() => setSortBy({ field: 'email', asc: sortBy.field === 'email' ? !sortBy.asc : true })}
                                            className="px-2 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                        >
                                            <div className="flex items-center gap-1">
                                                <span>عنوان التذكير والمهمة</span>
                                                <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                            </div>
                                        </th>
                                        <th className="px-2 py-1.5 text-center">الأولوية / التصنيف</th>
                                        <th
                                            onClick={() => setSortBy({ field: 'accountCreatedDate', asc: sortBy.field === 'accountCreatedDate' ? !sortBy.asc : true })}
                                            className="px-2 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                        >
                                            <div className="flex items-center gap-1">
                                                <span>موعد التذكير</span>
                                                <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                            </div>
                                        </th>
                                        <th
                                            onClick={() => setSortBy({ field: 'accountReminderDays', asc: sortBy.field === 'accountReminderDays' ? !sortBy.asc : true })}
                                            className="px-2 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                        >
                                            <div className="flex items-center gap-1">
                                                <span>الحالة والمتبقي</span>
                                                <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                            </div>
                                        </th>
                                        <th className="px-2 py-1.5">الملاحظات والتفاصيل</th>
                                    </>
                                ) : (
                                    <>
                                        <th
                                            onClick={() => setSortBy({ field: 'email', asc: sortBy.field === 'email' ? !sortBy.asc : true })}
                                            className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                        >
                                            <div className="flex items-center gap-1">
                                                <span>البريد الإلكتروني</span>
                                                <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                            </div>
                                        </th>
                                        <th className="px-1 py-1.5">Outlook Password</th>
                                        <th className="px-1 py-1.5">Adobe Password</th>
                                        {isTrashSheet ? (
                                            <>
                                                <th
                                                    onClick={() => setSortBy({ field: 'originSheetName', asc: sortBy.field === 'originSheetName' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-rose-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>الشيت الأصلي</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'deletedAt', asc: sortBy.field === 'deletedAt' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-rose-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>تاريخ الحذف</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'selectedAccount', asc: sortBy.field === 'selectedAccount' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-purple-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>بيانات الحساب</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                            </>
                                        ) : isClientOrMerchant ? (
                                            <>
                                                <th
                                                    onClick={() => setSortBy({ field: 'duration', asc: sortBy.field === 'duration' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>مدة الاشتراك</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'remainingDays', asc: sortBy.field === 'remainingDays' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>المدة المتبقية</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'deviceType', asc: sortBy.field === 'deviceType' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>نوع الاشتراك</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'paymentStatus', asc: sortBy.field === 'paymentStatus' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>حالة الدفع</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                            </>
                                        ) : currentSheetId === 'account_data' ? (
                                            <>
                                                <th
                                                    onClick={() => setSortBy({ field: 'accountCreatedDate', asc: sortBy.field === 'accountCreatedDate' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>تاريخ الإنشاء</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'accountReminderDays', asc: sortBy.field === 'accountReminderDays' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>التذكير</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'currentUses', asc: sortBy.field === 'currentUses' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>استخدام الحساب</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                            </>
                                        ) : (
                                            <>
                                                <th
                                                    onClick={() => setSortBy({ field: 'invoiceNumber', asc: sortBy.field === 'invoiceNumber' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>رقم الفاتورة</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th className="px-1.5 py-1.5">الفيزا</th>
                                                <th className="px-1.5 py-1.5">Edu Mail</th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'selectedAccount', asc: sortBy.field === 'selectedAccount' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>بيانات الحساب</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                            </>
                                        )}
                                    </>
                                )}
                                <th className="px-1 py-1.5 text-center w-12 text-[11px]">إجراءات</th>
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-slate-700 dark:text-slate-300">
                            {paginatedRecords.length === 0 ? (
                                <tr>
                                    <td colSpan={isTrashSheet ? 8 : (currentSheetId === 'reminders_data' ? 6 : (isClientOrMerchant ? 9 : (currentSheetId === 'account_data' ? 8 : 9)))} className="p-12 text-center text-slate-400">
                                        <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 text-2xl">
                                            <i className={`fa-solid ${isTrashSheet ? 'fa-trash-can text-rose-400' : (currentSheetId === 'reminders_data' ? 'fa-bell text-amber-500' : 'fa-folder-open')}`}></i>
                                        </div>
                                        <p className="font-bold text-sm">
                                            {isTrashSheet ? 'سلة المهملات فارغة تماماً' : (currentSheetId === 'reminders_data' ? 'لا توجد تذكيرات مسجلة حتى الآن' : 'لا توجد سجلات في هذا الشيت حتى الآن')}
                                        </p>
                                        <p className="text-xs mt-1 text-slate-400">
                                            {isTrashSheet ? 'أي حسابات أو بيانات يتم حذفها ستظهر هنا ويمكنك استردادها في أي وقت' : (currentSheetId === 'reminders_data' ? 'انقر على "إضافة تذكير جديد" لحفظ موعد أو مهمة لا تريد نسيانها' : 'انقر على "إضافة بيان جديد" للبدء في حفظ البيانات')}
                                        </p>
                                    </td>
                                </tr>
                            ) : (
                                paginatedRecords.map((rec, index) => {
                                    const rowNum = pageSize === 'all' ? index + 1 : (currentPage - 1) * pageSize + index + 1;
                                    const isSelected = selectedIds.has(rec.id);

                                    if (currentSheetId === 'reminders_data') {
                                        return (
                                            <tr
                                                key={rec.id}
                                                className={`transition-colors ${rec.offerActivated ? 'bg-slate-50/50 dark:bg-slate-900/40 opacity-75' : 'hover:bg-amber-50/30 dark:hover:bg-slate-800/50'}`}
                                            >
                                                {/* Row # */}
                                                <td className="px-1 py-2 text-center font-mono text-slate-400 text-[10px]">
                                                    {rowNum}
                                                </td>

                                                {/* Reminder Title & Quick Complete */}
                                                <td className="px-2 py-2 font-medium">
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleToggleOfferActivated(rec.id)}
                                                            className={`w-5 h-5 rounded-md border flex items-center justify-center transition cursor-pointer flex-shrink-0 ${
                                                                rec.offerActivated
                                                                    ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                                                                    : 'border-slate-300 dark:border-slate-600 hover:border-emerald-500 text-transparent hover:text-emerald-500 bg-white dark:bg-slate-800'
                                                            }`}
                                                            title={rec.offerActivated ? 'انقر لإلغاء الإنجاز وإعادته لقيد الانتظار' : 'انقر للتعليم كمكتمل'}
                                                        >
                                                            <i className="fa-solid fa-check text-[10px]"></i>
                                                        </button>
                                                        <div className="min-w-0 flex items-center gap-1.5 flex-1">
                                                            <span className={`text-xs font-bold truncate ${
                                                                rec.offerActivated ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'
                                                            }`} title={rec.email}>
                                                                {rec.email || 'بدون عنوان'}
                                                            </span>
                                                            <button
                                                                onClick={() => handleCopy(rec.email, `rem_${rec.id}`)}
                                                                className="text-slate-400 hover:text-indigo-600 p-0.5 transition flex-shrink-0"
                                                                title="نسخ عنوان التذكير"
                                                            >
                                                                <i className={`fa-solid ${copiedField === `rem_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Priority / Category */}
                                                <td className="px-2 py-2 text-center whitespace-nowrap">
                                                    {(() => {
                                                        const p = rec.password || '🟢 عادي';
                                                        const isUrgent = p.includes('عاجل');
                                                        const isMedium = p.includes('متوسط');
                                                        const isRenewal = p.includes('تجديد');
                                                        const isClient = p.includes('عميل');
                                                        const isMoney = p.includes('دفع') || p.includes('مالي') || p.includes('سداد');
                                                        const cls = isUrgent
                                                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                                                            : isMedium
                                                            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                                                            : isRenewal
                                                            ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
                                                            : isClient
                                                            ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                                                            : isMoney
                                                            ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800'
                                                            : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
                                                        return (
                                                            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}>
                                                                <span>{p}</span>
                                                            </span>
                                                        );
                                                    })()}
                                                </td>

                                                {/* Reminder Target Date */}
                                                <td className="px-2 py-2 whitespace-nowrap font-mono text-xs">
                                                    <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                                                        <i className="fa-regular fa-calendar text-amber-500 text-[10px]"></i>
                                                        <span className="font-bold">{rec.accountCreatedDate || '-'}</span>
                                                    </div>
                                                </td>

                                                {/* Status & Countdown Badge */}
                                                <td className="px-2 py-2 whitespace-nowrap">
                                                    {rec.offerActivated ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                                            <i className="fa-solid fa-circle-check"></i>
                                                            <span>تم الإنجاز ✓</span>
                                                        </span>
                                                    ) : (
                                                        (() => {
                                                            const rem = calculateAccountReminder(rec.accountCreatedDate, rec.reminderDays, rec.created_at);
                                                            return (
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black border ${rem.badgeClass}`}>
                                                                        <i className={`fa-solid ${rem.days === 0 ? 'fa-bell fa-shake text-rose-600' : rem.days < 0 ? 'fa-triangle-exclamation' : 'fa-clock'} text-[9px]`}></i>
                                                                        <span>{rem.badgeText}</span>
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleToggleOfferActivated(rec.id)}
                                                                        className="text-[10px] font-bold text-slate-500 hover:text-emerald-600 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 transition cursor-pointer"
                                                                        title="تعليم كمكتمل"
                                                                    >
                                                                        إنجاز
                                                                    </button>
                                                                </div>
                                                            );
                                                        })()
                                                    )}
                                                </td>

                                                {/* Notes */}
                                                <td className="px-2 py-2 font-medium max-w-[280px]">
                                                    {rec.notes ? (
                                                        <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 text-xs">
                                                            <i className="fa-solid fa-note-sticky text-amber-500 text-[10px] flex-shrink-0"></i>
                                                            <span className="truncate" title={rec.notes}>{rec.notes}</span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-slate-300 dark:text-slate-600">-</span>
                                                    )}
                                                </td>

                                                {/* Actions */}
                                                <td className="px-1 py-1 text-center w-12">
                                                    <div className="flex items-center justify-center gap-1">
                                                        {canEdit && (
                                                            <button
                                                                onClick={() => handleOpenEdit(rec)}
                                                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                                                                title="تعديل"
                                                            >
                                                                <i className="fa-solid fa-pen text-[8.5px]"></i>
                                                            </button>
                                                        )}
                                                        {canDelete && (
                                                            <button
                                                                onClick={() => handleDeleteRecord(rec.id)}
                                                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                                                                title="حذف ونقل إلى سلة المهملات"
                                                            >
                                                                <i className="fa-solid fa-trash text-[8.5px]"></i>
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    }

                                    const isPassVisible = visibleSecrets[`${rec.id}_pass`] !== false;
                                    const isPass2Visible = visibleSecrets[`${rec.id}_pass2`] !== false;
                                    const isVisaVisible = visibleSecrets[`${rec.id}_visa`];

                                    return (
                                        <tr
                                            key={rec.id}
                                            className="transition-colors hover:bg-indigo-50/30 dark:hover:bg-slate-800/50"
                                        >
                                            {/* Row # */}
                                            <td className="px-1 py-1 text-center font-mono text-slate-400 text-[10px]">
                                                {rowNum}
                                            </td>

                                            {/* Email */}
                                            <td className="px-1.5 py-1 font-medium">
                                                {rec.email ? (
                                                    <div className="flex items-center gap-1 dir-ltr justify-end">
                                                        {rec.notes && (
                                                            <span title={`ملاحظات: ${rec.notes}`} className="text-amber-500/80 hover:text-amber-500 cursor-help mr-0.5">
                                                                <i className="fa-solid fa-note-sticky text-[8px]"></i>
                                                            </span>
                                                        )}
                                                        <span className="font-mono text-slate-800 dark:text-slate-200 select-all text-[11px] truncate max-w-[200px]" title={rec.email}>
                                                            {rec.email}
                                                        </span>
                                                        <button
                                                            onClick={() => handleCopy(rec.email, `em_${rec.id}`)}
                                                            className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 transition"
                                                            title="نسخ الإيميل"
                                                        >
                                                            <i className={`fa-solid ${copiedField === `em_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                        </button>
                                                        {currentSheetId === 'account_data' && (
                                                            <button
                                                                onClick={() => handleCopyAdobeAccess(rec)}
                                                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-black transition whitespace-nowrap ${
                                                                    copiedField === `adobe_access_${rec.id}`
                                                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                                                        : 'bg-slate-900 text-white border-slate-900 hover:bg-slate-700'
                                                                }`}
                                                                title="نسخ الإيميل و Adobe Password برسالة جاهزة"
                                                            >
                                                                <i className={`fa-solid ${copiedField === `adobe_access_${rec.id}` ? 'fa-check' : 'fa-file-lines'} text-[8px]`}></i>
                                                                <span>نسخ Adobe</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-300 dark:text-slate-600">-</span>
                                                )}
                                            </td>

                                            {/* Password 1 */}
                                            <td className="px-1 py-1 font-medium">
                                                {rec.password ? (
                                                    <div className="flex items-center gap-1 dir-ltr justify-end">
                                                        <span className="font-mono text-slate-800 dark:text-slate-200 select-all text-[10.5px]">
                                                            {isPassVisible ? rec.password : '••••••••'}
                                                        </span>
                                                        <button
                                                            onClick={() => toggleSecret(rec.id, 'pass')}
                                                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 transition"
                                                            title={isPassVisible ? 'إخفاء' : 'إظهار'}
                                                        >
                                                            <i className={`fa-solid ${isPassVisible ? 'fa-eye-slash' : 'fa-eye'} text-[8px]`}></i>
                                                        </button>
                                                        <button
                                                            onClick={() => handleCopy(rec.password, `p1_${rec.id}`)}
                                                            className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 transition"
                                                            title="نسخ الباسورد"
                                                        >
                                                            <i className={`fa-solid ${copiedField === `p1_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-300 dark:text-slate-600">-</span>
                                                )}
                                            </td>

                                            {/* Password 2 */}
                                            <td className="px-1 py-1 font-medium">
                                                {rec.password2 ? (
                                                    <div className="flex items-center gap-1 dir-ltr justify-end">
                                                        <span className="font-mono text-slate-800 dark:text-slate-200 select-all text-[10.5px]">
                                                            {isPass2Visible ? rec.password2 : '••••••••'}
                                                        </span>
                                                        <button
                                                            onClick={() => toggleSecret(rec.id, 'pass2')}
                                                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 transition"
                                                            title={isPass2Visible ? 'إخفاء' : 'إظهار'}
                                                        >
                                                            <i className={`fa-solid ${isPass2Visible ? 'fa-eye-slash' : 'fa-eye'} text-[8px]`}></i>
                                                        </button>
                                                        <button
                                                            onClick={() => handleCopy(rec.password2, `p2_${rec.id}`)}
                                                            className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 transition"
                                                            title="نسخ الباسورد 2"
                                                        >
                                                            <i className={`fa-solid ${copiedField === `p2_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-300 dark:text-slate-600">-</span>
                                                )}
                                            </td>

                                            {/* Columns branch */}
                                            {isTrashSheet ? (
                                                <>
                                                    {/* Origin Sheet Badge */}
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {(() => {
                                                            const originId = rec.originSheetId || 'account_data';
                                                            const originBadgeStyles = {
                                                                client_data: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200/70 dark:border-blue-800/60',
                                                                merchant_data: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-800/60',
                                                                account_data: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200/70 dark:border-purple-800/60',
                                                                reminders_data: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200/70 dark:border-amber-800/60',
                                                            }[originId] || 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200';

                                                            const originIcon = {
                                                                client_data: 'fa-solid fa-users text-blue-500',
                                                                merchant_data: 'fa-solid fa-store text-emerald-500',
                                                                account_data: 'fa-solid fa-user-gear text-purple-500',
                                                                reminders_data: 'fa-solid fa-bell text-amber-500',
                                                            }[originId] || 'fa-solid fa-file text-slate-400';

                                                            const name = rec.originSheetName || sheetsList.find(s => s.id === originId)?.name || 'بيانات الحساب';

                                                            return (
                                                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${originBadgeStyles} whitespace-nowrap`}>
                                                                    <i className={`${originIcon} text-[8px]`}></i>
                                                                    <span>{name}</span>
                                                                </span>
                                                            );
                                                        })()}
                                                    </td>

                                                    {/* Deleted At Date */}
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {rec.deletedAt ? (
                                                            <div className="flex items-center gap-1 font-mono text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                                                <i className="fa-regular fa-clock text-rose-400 text-[8px]"></i>
                                                                <span>{new Date(rec.deletedAt).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-300 dark:text-slate-600">-</span>
                                                        )}
                                                    </td>

                                                    {/* Account Data in Trash */}
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {rec.selectedAccount ? (
                                                            <div className="flex items-center gap-1">
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200/70 dark:border-purple-800/60 shadow-xs whitespace-nowrap font-mono">
                                                                    <i className="fa-solid fa-shield-halved text-[8px] text-purple-500"></i>
                                                                    <span>{rec.selectedAccount}</span>
                                                                </span>
                                                                <button
                                                                    onClick={() => handleCopy(rec.selectedAccount, `acc_tr_${rec.id}`)}
                                                                    className="text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 p-0.5 transition"
                                                                    title="نسخ بيانات الحساب"
                                                                >
                                                                    <i className={`fa-solid ${copiedField === `acc_tr_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-300 dark:text-slate-600 font-mono text-xs">-</span>
                                                        )}
                                                    </td>
                                                </>
                                            ) : isClientOrMerchant ? (
                                                <>
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {rec.duration ? (
                                                            <div className="flex items-center gap-1">
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/60 whitespace-nowrap">
                                                                    <i className="fa-regular fa-clock text-[8px] text-indigo-500"></i>
                                                                    <span>{rec.duration}</span>
                                                                </span>
                                                                <button
                                                                    onClick={() => handleCopy(rec.duration, `dur_${rec.id}`)}
                                                                    className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 transition"
                                                                    title="نسخ مدة الاشتراك"
                                                                >
                                                                    <i className={`fa-solid ${copiedField === `dur_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-300 dark:text-slate-600">-</span>
                                                        )}
                                                    </td>
                                                    {/* Remaining Time (المدة المتبقية) */}
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {(() => {
                                                            const remaining = calculateRemainingTime(rec.startDate, rec.duration, rec.created_at);
                                                            if (remaining.status === 'none') {
                                                                return <span className="text-slate-300 dark:text-slate-600">-</span>;
                                                            }

                                                            const badgeStyles = {
                                                                lifetime: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200/70 dark:border-purple-800/60',
                                                                expired: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200/70 dark:border-rose-800/60',
                                                                'expiring-today': 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200/70 dark:border-red-800/60 animate-pulse',
                                                                urgent: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200/70 dark:border-amber-800/60',
                                                                warning: 'bg-yellow-50 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-300 border-yellow-200/70 dark:border-yellow-800/60',
                                                                active: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-800/60',
                                                            }[remaining.status] || 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200';

                                                            const badgeIcon = {
                                                                lifetime: 'fa-solid fa-infinity text-[8px] text-purple-500',
                                                                expired: 'fa-solid fa-circle-exclamation text-[8px] text-rose-500',
                                                                'expiring-today': 'fa-solid fa-triangle-exclamation text-[8px] text-red-500',
                                                                urgent: 'fa-solid fa-triangle-exclamation text-[8px] text-amber-500',
                                                                warning: 'fa-regular fa-clock text-[8px] text-yellow-500',
                                                                active: 'fa-regular fa-hourglass-half text-[8px] text-emerald-500',
                                                            }[remaining.status] || 'fa-regular fa-clock text-[8px] text-slate-400';

                                                            const tooltip = remaining.status === 'lifetime'
                                                                ? 'اشتراك مدى الحياة'
                                                                : `تاريخ البداية: ${remaining.startDate || '-'} | تاريخ الانتهاء: ${remaining.endDate || '-'}`;

                                                            return (
                                                                <div className="flex items-center gap-1" title={tooltip}>
                                                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${badgeStyles} whitespace-nowrap`}>
                                                                        <i className={badgeIcon}></i>
                                                                        <span>{remaining.text}</span>
                                                                    </span>
                                                                    <button
                                                                        onClick={() => handleCopy(remaining.text, `rem_${rec.id}`)}
                                                                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 transition"
                                                                        title="نسخ المدة المتبقية"
                                                                    >
                                                                        <i className={`fa-solid ${copiedField === `rem_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                    </button>
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                    {/* Device Type (نوع الاشتراك: جهاز ولا جهازين) */}
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {rec.deviceType === 'جهازين' ? (
                                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200/70 dark:border-purple-800/60 shadow-xs whitespace-nowrap">
                                                                <i className="fa-solid fa-laptop text-[8px]"></i>
                                                                <span>جهازين</span>
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200/70 dark:border-blue-800/60 shadow-xs whitespace-nowrap">
                                                                <i className="fa-solid fa-mobile-screen text-[8px]"></i>
                                                                <span>جهاز</span>
                                                            </span>
                                                        )}
                                                    </td>
                                                    {/* Payment Status (حالة الدفع: مدفوع / غير مدفوع) */}
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {rec.paymentStatus === 'غير مدفوع' ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleTogglePaymentStatus(rec.id)}
                                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200/70 dark:border-rose-800/60 shadow-xs cursor-pointer hover:bg-rose-100 dark:hover:bg-rose-900/60 transition whitespace-nowrap"
                                                                title="انقر لتغيير الحالة إلى مدفوع"
                                                            >
                                                                <i className="fa-solid fa-circle-xmark text-[8px] text-rose-500"></i>
                                                                <span>غير مدفوع</span>
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleTogglePaymentStatus(rec.id)}
                                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60 shadow-xs cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition whitespace-nowrap"
                                                                title="انقر لتغيير الحالة إلى غير مدفوع"
                                                            >
                                                                <i className="fa-solid fa-circle-check text-[8px] text-emerald-500"></i>
                                                                <span>مدفوع</span>
                                                            </button>
                                                        )}
                                                    </td>
                                                </>
                                            ) : currentSheetId === 'account_data' ? (
                                                <>
                                                    {/* Account Creation Date */}
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {(() => {
                                                            const effectiveDate = rec.accountCreatedDate || (rec.created_at ? String(rec.created_at).slice(0, 10) : '');
                                                            if (!effectiveDate) return <span className="text-slate-300 dark:text-slate-600">-</span>;
                                                            return (
                                                                <div className="flex items-center gap-1">
                                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/80 whitespace-nowrap font-mono">
                                                                        <i className="fa-regular fa-calendar text-[8px] text-purple-500"></i>
                                                                        <span>{effectiveDate}</span>
                                                                    </span>
                                                                    <button
                                                                        onClick={() => handleCopy(effectiveDate, `acd_${rec.id}`)}
                                                                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 transition"
                                                                        title="نسخ تاريخ الإنشاء"
                                                                    >
                                                                        <i className={`fa-solid ${copiedField === `acd_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                    </button>
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>

                                                    {/* Account Reminder Status */}
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {(() => {
                                                            const effectiveDate = rec.accountCreatedDate || (rec.created_at ? String(rec.created_at).slice(0, 10) : '');
                                                            if (rec.offerActivated) {
                                                                return (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleToggleOfferActivated(rec.id)}
                                                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700 transition whitespace-nowrap"
                                                                        title={rec.offerActivatedAt ? `لا يحتاج تذكير - تم تفعيل العرض ${new Date(rec.offerActivatedAt).toLocaleDateString('ar-EG')}` : 'لا يحتاج تذكير'}
                                                                    >
                                                                        <i className="fa-solid fa-circle-check text-[8px]"></i>
                                                                        <span>لا يحتاج تذكير</span>
                                                                    </button>
                                                                );
                                                            }
                                                            const reminder = calculateAccountReminder(effectiveDate, rec.reminderDays, rec.created_at);
                                                            if (reminder.status === 'none') {
                                                                return <span className="text-slate-300 dark:text-slate-600">-</span>;
                                                            }
                                                            return (
                                                                <div className="flex items-center gap-1">
                                                                    <span
                                                                        title={`تاريخ الإنشاء: ${reminder.createdDate || effectiveDate || '-'} | موعد التذكير: ${reminder.targetDate || '-'} (${reminder.reminderDays || rec.reminderDays || '-'} يوم)`}
                                                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                                                                            reminder.status === 'expired'
                                                                                ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200/80 dark:border-rose-900/60 shadow-xs'
                                                                                : reminder.status === 'expiring-today'
                                                                                ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-300/80 dark:border-amber-800/60 shadow-xs animate-pulse'
                                                                                : reminder.status === 'urgent'
                                                                                ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200/80 dark:border-rose-900/60 shadow-xs'
                                                                                : reminder.status === 'warning'
                                                                                ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200/80 dark:border-amber-900/60 shadow-xs'
                                                                                : 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200/70 dark:border-purple-800/60 shadow-xs'
                                                                        }`}
                                                                    >
                                                                        <i className={`fa-solid ${
                                                                            reminder.status === 'expired' ? 'fa-circle-xmark text-[8px] text-rose-500' :
                                                                            reminder.status === 'expiring-today' ? 'fa-bell text-[8px] text-amber-500 animate-bounce' :
                                                                            reminder.status === 'urgent' ? 'fa-triangle-exclamation text-[8px] text-rose-500' :
                                                                            reminder.status === 'warning' ? 'fa-clock text-[8px] text-amber-500' :
                                                                            'fa-bell text-[8px] text-purple-500'
                                                                        }`}></i>
                                                                        <span>{reminder.text}</span>
                                                                    </span>
                                                                    <button
                                                                        onClick={() => handleCopy(reminder.text, `rem_acc_${rec.id}`)}
                                                                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 transition"
                                                                        title="نسخ حالة التذكير"
                                                                    >
                                                                        <i className={`fa-solid ${copiedField === `rem_acc_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleToggleOfferActivated(rec.id)}
                                                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black border transition whitespace-nowrap ${
                                                                            rec.offerActivated
                                                                                ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                                                                                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-emerald-400 hover:text-emerald-700'
                                                                        }`}
                                                                        title={rec.offerActivated ? `تم تفعيل العرض${rec.offerActivatedAt ? ` - ${new Date(rec.offerActivatedAt).toLocaleDateString('ar-EG')}` : ''}` : 'تعليم أن عرض التفعيل اتعمل على الحساب'}
                                                                    >
                                                                        <i className={`fa-solid ${rec.offerActivated ? 'fa-check' : 'fa-bolt'} text-[8px]`}></i>
                                                                        <span>{rec.offerActivated ? 'العرض اتفعل' : 'تم تفعيل العرض'}</span>
                                                                    </button>
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {(() => {
                                                            const currentUses = Math.max(0, Number(rec.currentUses || 0));
                                                            const maxUses = Math.max(1, Number(rec.maxUses || 2));
                                                            const status = rec.accountUsageStatus || (
                                                                currentUses >= maxUses ? 'shared_two_devices' :
                                                                currentUses === 1 ? 'shared_one_device' :
                                                                'available'
                                                            );
                                                            const optionClass = (value, statusValue) => {
                                                                const active = currentUses === value && status === statusValue;
                                                                if (statusValue === 'available') return active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100';
                                                                if (statusValue === 'personal') return active ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100';
                                                                if (statusValue === 'shared_one_device') return active ? 'bg-amber-500 text-white border-amber-500' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100';
                                                                return active ? 'bg-rose-600 text-white border-rose-600' : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100';
                                                            };
                                                            return (
                                                                <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-0.5 whitespace-nowrap">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleSetAccountUsage(rec.id, 0, 'available')}
                                                                        className={`px-1.5 py-0.5 rounded-md text-[9px] font-black border transition ${optionClass(0, 'available')}`}
                                                                        title="الحساب لم يخرج لأي عميل"
                                                                    >
                                                                        متاح
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleSetAccountUsage(rec.id, maxUses, 'personal')}
                                                                        className={`px-1.5 py-0.5 rounded-md text-[9px] font-black border transition ${optionClass(maxUses, 'personal')}`}
                                                                        title="الحساب شخصي وخرج كامل لعميل واحد"
                                                                    >
                                                                        شخصي
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleSetAccountUsage(rec.id, 1, 'shared_one_device')}
                                                                        className={`px-1.5 py-0.5 rounded-md text-[9px] font-black border transition ${optionClass(1, 'shared_one_device')}`}
                                                                        title="حساب مشترك خرج منه جهاز واحد ولسه متاح لجهاز آخر"
                                                                    >
                                                                        مشترك جهاز
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleSetAccountUsage(rec.id, maxUses, 'shared_two_devices')}
                                                                        className={`px-1.5 py-0.5 rounded-md text-[9px] font-black border transition ${optionClass(maxUses, 'shared_two_devices')}`}
                                                                        title="حساب مشترك خرج الجهازين واكتمل"
                                                                    >
                                                                        مشترك كامل
                                                                    </button>
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    {/* Invoice Number */}
                                                    <td className="px-1.5 py-1">
                                                        {rec.invoiceNumber ? (
                                                            <div className="flex items-center gap-1">
                                                                <span className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded font-mono font-bold text-[10px]">
                                                                    {rec.invoiceNumber}
                                                                </span>
                                                                <button
                                                                    onClick={() => handleCopy(rec.invoiceNumber, `inv_${rec.id}`)}
                                                                    className="text-slate-400 hover:text-amber-600 p-0.5"
                                                                    title="نسخ رقم الفاتورة"
                                                                >
                                                                    <i className={`fa-solid ${copiedField === `inv_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-300 dark:text-slate-600">-</span>
                                                        )}
                                                    </td>

                                                    {/* Visa */}
                                                    <td className="px-1.5 py-1">
                                                        {rec.visa ? (
                                                            <div className="flex items-center gap-1 dir-ltr justify-end">
                                                                <span className="font-mono text-slate-800 dark:text-slate-200 select-all text-[10.5px]">
                                                                    {isVisaVisible ? rec.visa : '•••• •••• •••• ' + rec.visa.slice(-4)}
                                                                </span>
                                                                <button
                                                                    onClick={() => toggleSecret(rec.id, 'visa')}
                                                                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
                                                                >
                                                                    <i className={`fa-solid ${isVisaVisible ? 'fa-eye-slash' : 'fa-eye'} text-[8px]`}></i>
                                                                </button>
                                                                <button
                                                                    onClick={() => handleCopy(rec.visa, `v_${rec.id}`)}
                                                                    className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5"
                                                                >
                                                                    <i className={`fa-solid ${copiedField === `v_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-300 dark:text-slate-600">-</span>
                                                        )}
                                                    </td>

                                                    {/* Visa Account */}
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {rec.visaAccount ? (
                                                            <div className="flex items-center gap-1">
                                                                <span className="bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20 px-1.5 py-0.5 rounded font-medium text-[10px] whitespace-nowrap">
                                                                    {rec.visaAccount}
                                                                </span>
                                                                <button
                                                                    onClick={() => handleCopy(rec.visaAccount, `va_${rec.id}`)}
                                                                    className="text-slate-400 hover:text-purple-600 p-0.5"
                                                                    title="نسخ حساب الفيزا"
                                                                >
                                                                    <i className={`fa-solid ${copiedField === `va_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-300 dark:text-slate-600">-</span>
                                                        )}
                                                    </td>

                                                    {/* Account Data (بيانات الحساب) */}
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {rec.selectedAccount ? (
                                                            <div className="flex items-center gap-1">
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200/70 dark:border-purple-800/60 shadow-xs whitespace-nowrap font-mono">
                                                                    <i className="fa-solid fa-shield-halved text-[8px] text-purple-500"></i>
                                                                    <span>{rec.selectedAccount}</span>
                                                                </span>
                                                                <button
                                                                    onClick={() => handleCopy(rec.selectedAccount, `acc_c_${rec.id}`)}
                                                                    className="text-slate-400 hover:text-purple-600 dark:hover:text-purple-400 p-0.5 transition"
                                                                    title="نسخ بيانات الحساب"
                                                                >
                                                                    <i className={`fa-solid ${copiedField === `acc_c_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-300 dark:text-slate-600 font-mono text-xs">-</span>
                                                        )}
                                                    </td>
                                                </>
                                            )}

                                            {/* Actions */}
                                            <td className="px-1 py-1 text-center w-12">
                                                {isTrashSheet ? (
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button
                                                            onClick={() => handleRestoreRecord(rec)}
                                                            className="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60 rounded text-[10px] font-bold flex items-center gap-1 transition shadow-xs whitespace-nowrap"
                                                            title="استرداد السجل إلى شيته الأصلي"
                                                        >
                                                            <i className="fa-solid fa-rotate-left text-[8px]"></i>
                                                            <span>استرداد</span>
                                                        </button>
                                                        {canEmptyTrash && (
                                                            <button
                                                                onClick={() => handleDeleteRecord(rec.id)}
                                                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                                                                title="حذف نهائي"
                                                            >
                                                                <i className="fa-solid fa-trash text-[8.5px]"></i>
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center justify-center gap-1">
                                                        {canEdit && (
                                                            <button
                                                                onClick={() => handleOpenEdit(rec)}
                                                                className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                                                                title="تعديل"
                                                            >
                                                                <i className="fa-solid fa-pen text-[8.5px]"></i>
                                                            </button>
                                                        )}
                                                        {canDelete && (
                                                            <button
                                                                onClick={() => handleDeleteRecord(rec.id)}
                                                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                                                                title="حذف ونقل إلى سلة المهملات"
                                                            >
                                                                <i className="fa-solid fa-trash text-[8.5px]"></i>
                                                            </button>
                                                        )}
                                                        {!canEdit && !canDelete && (
                                                            <span className="text-[9px] text-slate-400">عرض فقط</span>
                                                        )}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                {pageSize !== 'all' && totalPages > 1 && (
                    <div className="p-4 bg-slate-50/80 dark:bg-slate-800/80 border-t border-slate-200/80 dark:border-slate-700/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                        <span className="text-slate-500 dark:text-slate-400">
                            عرض الصفحة <b className="text-slate-800 dark:text-white">{currentPage}</b> من أصل <b className="text-slate-800 dark:text-white">{totalPages}</b> (إجمالي {filteredRecords.length} سجل)
                        </span>

                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => setCurrentPage(1)}
                                disabled={currentPage === 1}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                                <i className="fa-solid fa-angles-right"></i>
                            </button>
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700 font-bold"
                            >
                                السابق
                            </button>
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                disabled={currentPage === totalPages}
                                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700 font-bold"
                            >
                                التالي
                            </button>
                            <button
                                onClick={() => setCurrentPage(totalPages)}
                                disabled={currentPage === totalPages}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700"
                            >
                                <i className="fa-solid fa-angles-left"></i>
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Modal: Add / Edit Single Record */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full max-h-[90vh] sm:max-h-[88vh] shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
                        {/* Fixed Header with Title and Cancel/Close Button */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex-shrink-0">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl bg-gradient-to-tr ${currentSheet.color} text-white flex items-center justify-center text-lg shadow-sm`}>
                                    <i className={`fa-solid ${editingRecord ? 'fa-pen-to-square' : 'fa-plus'}`}></i>
                                </div>
                                <div>
                                    <h3 className="font-black text-lg text-slate-800 dark:text-white leading-tight">
                                        {editingRecord ? 'تعديل السجل' : 'إضافة بيان جديد'}
                                    </h3>
                                    <p className="text-xs text-slate-400">
                                        الشيت الحالي: <span className="font-bold text-indigo-600 dark:text-indigo-400">{currentSheet.name}</span>
                                    </p>
                                </div>
                            </div>
                            {/* Prominent Cancel / Close Button (علامة الإلغاء) */}
                            <button
                                type="button"
                                onClick={() => setShowAddModal(false)}
                                title="إلغاء وإغلاق النافذة"
                                className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-950/60 text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 flex items-center justify-center transition border border-slate-200/60 dark:border-slate-700/60 hover:border-rose-300 dark:hover:border-rose-800/80 shadow-xs cursor-pointer group"
                            >
                                <i className="fa-solid fa-xmark text-base group-hover:scale-110 transition-transform"></i>
                            </button>
                        </div>

                        <form onSubmit={handleFormSubmit} aria-busy={isSaving} className="flex flex-col flex-1 min-h-0">
                            {/* Scrollable Form Body with visible scrollbar on the left side */}
                            <div className="flex-1 overflow-y-auto custom-modal-scroll px-6 py-5 space-y-4">
                            {currentSheetId === 'client_data' && (
                                <div className="rounded-2xl border-2 border-purple-100 dark:border-purple-900/60 bg-purple-50/60 dark:bg-purple-950/20 p-3 space-y-3">
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setAccountEntryMode('available')}
                                            className={`py-2.5 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-2 transition ${
                                                accountEntryMode === 'available'
                                                    ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-purple-300'
                                            }`}
                                        >
                                            <i className="fa-solid fa-box-open text-[11px]"></i>
                                            <span>اختيار من المتاح</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setAccountEntryMode('manual');
                                                setFormData(prev => ({ ...prev, selectedAccount: '' }));
                                            }}
                                            className={`py-2.5 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-2 transition ${
                                                accountEntryMode === 'manual'
                                                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-400'
                                            }`}
                                        >
                                            <i className="fa-solid fa-keyboard text-[11px]"></i>
                                            <span>تسجيل يدوي</span>
                                        </button>
                                    </div>

                                    {accountEntryMode === 'available' ? (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                                    الميل المتباع من بيانات الحساب
                                                </label>
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">
                                                    المتاح: {availableAccountChoices.length}
                                                </span>
                                            </div>
                                            <select
                                                value={availableAccountChoices.some(acc => (acc.email || acc.selectedAccount) === formData.selectedAccount) ? formData.selectedAccount : ''}
                                                onChange={(e) => handleSelectAvailableAccount(e.target.value)}
                                                className="w-full bg-white dark:bg-slate-900 border-2 border-purple-200 dark:border-purple-800 hover:border-purple-400 focus:border-purple-500 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                                            >
                                                <option value="">اختار ميل من الحسابات غير المكتملة</option>
                                                {availableAccountChoices.map(acc => {
                                                    const maxUses = Math.max(1, Number(acc.maxUses || 2));
                                                    const currentUses = Math.max(0, Number(acc.currentUses || 0));
                                                    const remaining = Math.max(0, maxUses - currentUses);
                                                    const accountEmail = acc.email || acc.selectedAccount || '';
                                                    const statusText = currentUses === 0 ? `متاح كامل - باقي ${remaining}` : `مشترك - باقي ${remaining}`;
                                                    return (
                                                        <option key={acc.id} value={accountEmail || acc.id}>
                                                            {(accountEmail || 'حساب بدون ميل')} - {statusText}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">
                                                القائمة تعرض فقط الحسابات غير المكتملة: حساب متاح بالكامل أو حساب مشترك باقي فيه جهاز.
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                                الميل المتباع يدويًا
                                            </label>
                                            <div className="relative">
                                                <i className="fa-solid fa-pen absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                                <input
                                                    type="text"
                                                    value={formData.selectedAccount}
                                                    onChange={(e) => setFormData({ ...formData, selectedAccount: e.target.value })}
                                                    placeholder="اكتب الميل المتباع يدويًا..."
                                                    className="w-full bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 hover:border-slate-400 focus:border-slate-600 rounded-xl pr-9 pl-4 py-2.5 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-500/20 dir-ltr text-right"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            {currentSheetId === 'reminders_data' ? (
                                <div className="space-y-4">
                                    {/* Reminder Title */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                                            عنوان التذكير أو المطلوب تذكيره <span className="text-rose-500">*</span>
                                        </label>
                                        <div className="relative">
                                            <i className="fa-solid fa-bell absolute right-3.5 top-1/2 -translate-y-1/2 text-amber-500 text-xs"></i>
                                            <input
                                                type="text"
                                                required
                                                value={formData.email}
                                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                                placeholder="مثال: تجديد اشتراك أدوبي لعميل، سداد فيزا، اتصال هاتفي..."
                                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 font-bold"
                                            />
                                        </div>
                                    </div>

                                    {/* Priority / Category */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                                            الأولوية والتصنيف
                                        </label>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                            {[
                                                { id: '🔴 عاجل جداً', label: '🔴 عاجل جداً' },
                                                { id: '🟡 أولوية متوسطة', label: '🟡 أولوية متوسطة' },
                                                { id: '🟢 عادي', label: '🟢 عادي' },
                                                { id: '🟣 تجديد واشتراك', label: '🟣 تجديد واشتراك' },
                                                { id: '🔵 متابعة عميل', label: '🔵 متابعة عميل' },
                                                { id: '🟠 سداد مالي / دفع', label: '🟠 سداد مالي / دفع' },
                                            ].map(opt => {
                                                const currentVal = formData.password || '🔴 عاجل جداً';
                                                const isSel = currentVal === opt.id || currentVal.includes(opt.id.slice(2, 6));
                                                return (
                                                    <button
                                                        key={opt.id}
                                                        type="button"
                                                        onClick={() => setFormData({ ...formData, password: opt.id })}
                                                        className={`px-3 py-2 rounded-xl border text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                                                            isSel
                                                                ? 'ring-2 ring-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-500 shadow-xs'
                                                                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
                                                        }`}
                                                    >
                                                        <span>{opt.label}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Reminder Target Date & Quick Day Pickers */}
                                    <div className="p-3.5 bg-amber-50/60 dark:bg-amber-950/30 rounded-2xl border border-amber-200/70 dark:border-amber-800/50 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-bold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
                                                <i className="fa-regular fa-calendar-check text-amber-600 text-sm"></i>
                                                <span>موعد التذكير المحدد (اليوم المستهدف)</span>
                                            </label>
                                            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                                                {(() => {
                                                    const target = formData.accountCreatedDate || new Date().toISOString().slice(0, 10);
                                                    const rem = calculateAccountReminder(target, '0', null);
                                                    return rem.badgeText;
                                                })()}
                                            </span>
                                        </div>

                                        <input
                                            type="date"
                                            value={formData.accountCreatedDate || new Date().toISOString().slice(0, 10)}
                                            onChange={(e) => setFormData({ ...formData, accountCreatedDate: e.target.value, startDate: e.target.value, reminderDays: '0' })}
                                            className="w-full bg-white dark:bg-slate-850 border border-amber-300/80 dark:border-amber-700 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                                        />

                                        {/* Quick Date Chips */}
                                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                            <span className="text-[10.5px] text-slate-500 font-bold ml-1">تحديد سريع:</span>
                                            {[
                                                { label: 'اليوم', daysToAdd: 0 },
                                                { label: 'غداً', daysToAdd: 1 },
                                                { label: 'بعد 3 أيام', daysToAdd: 3 },
                                                { label: 'بعد أسبوع', daysToAdd: 7 },
                                                { label: 'بعد أسبوعين', daysToAdd: 14 },
                                                { label: 'بعد شهر (30 يوم)', daysToAdd: 30 },
                                            ].map(chip => {
                                                const d = new Date();
                                                d.setDate(d.getDate() + chip.daysToAdd);
                                                const iso = d.toISOString().slice(0, 10);
                                                const active = formData.accountCreatedDate === iso;
                                                return (
                                                    <button
                                                        key={chip.label}
                                                        type="button"
                                                        onClick={() => setFormData({ ...formData, accountCreatedDate: iso, startDate: iso, reminderDays: '0' })}
                                                        className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold border transition cursor-pointer ${
                                                            active
                                                                ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                                                                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-amber-100/60'
                                                        }`}
                                                    >
                                                        {chip.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {/* Email */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                            البريد الإلكتروني (Email)
                                        </label>
                                        <div className="relative">
                                            <i className="fa-solid fa-envelope absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                            <input
                                                type="text"
                                                value={formData.email}
                                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                                placeholder="example@domain.com"
                                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dir-ltr text-right"
                                            />
                                        </div>
                                    </div>

                                    {/* Passwords (Grid of 2) */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                                {(isClientOrMerchant || currentSheetId === 'account_data') ? 'Outlook Password' : 'كلمة المرور 1 (Password)'}
                                            </label>
                                            <div className="relative">
                                                <i className="fa-solid fa-lock absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                                <input
                                                    type="text"
                                                    value={formData.password}
                                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                                    placeholder={currentSheetId === 'account_data' ? 'Outlook password' : 'كلمة المرور الرئيسية'}
                                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dir-ltr text-right"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                                {(isClientOrMerchant || currentSheetId === 'account_data') ? 'Adobe Password' : 'كلمة المرور 2 (Password 2)'}
                                            </label>
                                            <div className="relative">
                                                <i className="fa-solid fa-key absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                                <input
                                                    type="text"
                                                    value={formData.password2}
                                                    onChange={(e) => setFormData({ ...formData, password2: e.target.value })}
                                                    placeholder={currentSheetId === 'account_data' ? 'Adobe password' : 'كلمة مرور بديلة / كود إضافي'}
                                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dir-ltr text-right"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </>
                            )}

                            {/* Duration & Start Date (for Client / Merchant) */}
                            {isClientOrMerchant && (
                                <>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {/* Duration (Custom Dropdown matching design) */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                                مدة الاشتراك
                                            </label>
                                            <span className="text-[11px] text-slate-400">
                                                (Subscription Duration)
                                            </span>
                                        </div>

                                        <div className="relative" ref={durationDropdownRef}>
                                            {/* Dropdown Trigger matching the design */}
                                            <button
                                                type="button"
                                                onClick={() => setIsDurationDropdownOpen(prev => !prev)}
                                                className={`w-full bg-white dark:bg-slate-850 border-2 ${
                                                    isDurationDropdownOpen
                                                        ? 'border-blue-500 ring-2 ring-blue-500/20 shadow-md'
                                                        : 'border-blue-400 dark:border-blue-500 hover:border-blue-500'
                                                } rounded-2xl px-3.5 py-2.5 flex items-center justify-between transition cursor-pointer select-none`}
                                            >
                                                {/* Chevron Arrow on Left */}
                                                <div className="w-5 h-5 flex items-center justify-center text-slate-700 dark:text-slate-300">
                                                    <i className={`fa-solid fa-chevron-down text-xs transition-transform duration-200 ${isDurationDropdownOpen ? 'rotate-180 text-blue-600' : ''}`}></i>
                                                </div>

                                                {/* Label + Calendar Icon on Right */}
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-xs font-bold ${formData.duration ? 'text-slate-800 dark:text-slate-100' : 'text-slate-700 dark:text-slate-300'}`}>
                                                        {formData.duration || 'اختر مدة الاشتراك'}
                                                    </span>
                                                    <CalendarOptionIcon
                                                        num={formData.duration ? parseInt(formData.duration) : null}
                                                        isSelected={true}
                                                    />
                                                </div>
                                            </button>

                                            {/* Dropdown Menu matching user image */}
                                            {isDurationDropdownOpen && (
                                                <div className="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden z-40 animate-fade-in divide-y divide-slate-100 dark:divide-slate-800">
                                                    {/* Default Option (placeholder) */}
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setFormData({ ...formData, duration: '' });
                                                            setIsDurationDropdownOpen(false);
                                                        }}
                                                        className={`w-full px-4 py-3 flex items-center justify-end gap-2.5 transition text-xs font-bold ${
                                                            !formData.duration
                                                                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                                                                : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                                                        }`}
                                                    >
                                                        <span>اختر مدة الاشتراك (من شهر إلى 4 شهور)</span>
                                                        <CalendarOptionIcon num={null} isSelected={!formData.duration} />
                                                    </button>

                                                    {/* Options from 1 to 6 months */}
                                                    {DURATION_ITEMS.map(item => {
                                                        const isSelected = formData.duration === item.value;
                                                        return (
                                                            <button
                                                                key={item.value}
                                                                type="button"
                                                                onClick={() => {
                                                                    setFormData({ ...formData, duration: item.value });
                                                                    setIsDurationDropdownOpen(false);
                                                                }}
                                                                className={`w-full px-4 py-3 flex items-center justify-end gap-3 transition text-xs font-bold ${
                                                                    isSelected
                                                                        ? 'bg-blue-50/80 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400'
                                                                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200'
                                                                }`}
                                                            >
                                                                <span className="text-sm font-bold">{item.label}</span>
                                                                <CalendarOptionIcon num={item.num} isSelected={isSelected} />
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Start Date (تاريخ بداية الاشتراك) */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                                تاريخ بداية الاشتراك
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => setFormData({ ...formData, startDate: new Date().toISOString().slice(0, 10) })}
                                                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-bold"
                                                title="تعيين لتاريخ اليوم"
                                            >
                                                اليوم
                                            </button>
                                        </div>

                                        <div className="relative">
                                            <input
                                                type="date"
                                                value={formData.startDate}
                                                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                                                className="w-full bg-white dark:bg-slate-850 border-2 border-slate-200 dark:border-slate-700 hover:border-blue-400 focus:border-blue-500 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition cursor-pointer"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* نوع الاشتراك: جهاز ولا جهازين */}
                                <div className="space-y-1.5 pt-1">
                                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                        نوع الاشتراك
                                    </label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            onClick={() => handleSetDeviceType('جهاز')}
                                            className={`py-2.5 px-4 rounded-2xl border-2 text-xs font-bold flex items-center justify-center gap-2.5 transition select-none cursor-pointer ${
                                                formData.deviceType === 'جهاز' || !formData.deviceType
                                                    ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 shadow-sm ring-2 ring-blue-500/20'
                                                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-850'
                                            }`}
                                        >
                                            <i className="fa-solid fa-mobile-screen text-base text-blue-500"></i>
                                            <span className="text-sm">جهاز</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => handleSetDeviceType('جهازين')}
                                            className={`py-2.5 px-4 rounded-2xl border-2 text-xs font-bold flex items-center justify-center gap-2.5 transition select-none cursor-pointer ${
                                                formData.deviceType === 'جهازين'
                                                    ? 'border-purple-500 bg-purple-500/10 text-purple-600 dark:text-purple-400 shadow-sm ring-2 ring-purple-500/20'
                                                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-850'
                                            }`}
                                        >
                                            <i className="fa-solid fa-laptop text-base text-purple-500"></i>
                                            <span className="text-sm">جهازين</span>
                                        </button>
                                    </div>
                                </div>

                                {/* حالة الدفع: مدفوع ولا غير مدفوع */}
                                <div className="space-y-1.5 pt-1">
                                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                        حالة الدفع
                                    </label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setFormData({ ...formData, paymentStatus: 'مدفوع' })}
                                            className={`py-2.5 px-4 rounded-2xl border-2 text-xs font-bold flex items-center justify-center gap-2.5 transition select-none cursor-pointer ${
                                                formData.paymentStatus === 'مدفوع' || !formData.paymentStatus
                                                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-sm ring-2 ring-emerald-500/20'
                                                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-850'
                                            }`}
                                        >
                                            <i className="fa-solid fa-circle-check text-base text-emerald-500"></i>
                                            <span className="text-sm">مدفوع</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setFormData({ ...formData, paymentStatus: 'غير مدفوع' })}
                                            className={`py-2.5 px-4 rounded-2xl border-2 text-xs font-bold flex items-center justify-center gap-2.5 transition select-none cursor-pointer ${
                                                formData.paymentStatus === 'غير مدفوع'
                                                    ? 'border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400 shadow-sm ring-2 ring-rose-500/20'
                                                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-850'
                                            }`}
                                        >
                                            <i className="fa-solid fa-circle-xmark text-base text-rose-500"></i>
                                            <span className="text-sm">غير مدفوع</span>
                                        </button>
                                    </div>
                                </div>

                                </>
                            )}

                            {/* Specifically for Account Data Sheet: Account Creation Date & Reminder Period */}
                            {currentSheetId === 'account_data' && (
                                <div className="p-3.5 bg-purple-50/60 dark:bg-purple-950/30 rounded-2xl border border-purple-200/70 dark:border-purple-800/50 space-y-3">
                                    <div className="flex items-center gap-2 text-purple-700 dark:text-purple-300 font-bold text-xs">
                                        <i className="fa-solid fa-clock-rotate-left text-sm"></i>
                                        <span>بيانات التذكير وتاريخ إنشاء الحساب</span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {/* Creation Date */}
                                        <div>
                                            <div className="flex items-center justify-between mb-1.5">
                                                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                                    تاريخ إنشاء الحساب
                                                </label>
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, accountCreatedDate: new Date().toISOString().slice(0, 10) })}
                                                    className="text-[10px] font-bold text-purple-600 hover:text-purple-700 dark:text-purple-400 bg-purple-100/80 dark:bg-purple-900/60 px-2 py-0.5 rounded-md transition"
                                                >
                                                    اليوم
                                                </button>
                                            </div>
                                            <div className="relative">
                                                <input
                                                    type="date"
                                                    value={formData.accountCreatedDate}
                                                    onChange={(e) => setFormData({ ...formData, accountCreatedDate: e.target.value })}
                                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                                />
                                            </div>
                                        </div>

                                        {/* Reminder Days */}
                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                                فترة التذكير (عدد الأيام)
                                            </label>
                                            <div className="relative">
                                                <i className="fa-solid fa-bell absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="3650"
                                                    value={formData.reminderDays}
                                                    onChange={(e) => setFormData({ ...formData, reminderDays: e.target.value })}
                                                    placeholder="مثال: 20"
                                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Quick chips for reminder days */}
                                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                        <span className="text-[10.5px] text-slate-400 font-bold ml-1">خيارات سريعة:</span>
                                        {[15, 20, 30, 45, 60].map(days => (
                                            <button
                                                key={days}
                                                type="button"
                                                onClick={() => setFormData({ ...formData, reminderDays: String(days) })}
                                                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-bold transition ${
                                                    String(formData.reminderDays) === String(days)
                                                        ? 'bg-purple-600 text-white shadow-xs'
                                                        : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-purple-50 dark:hover:bg-slate-750'
                                                }`}
                                            >
                                                {days} يوم
                                            </button>
                                        ))}
                                    </div>

                                    {/* Live calculation info box */}
                                    {formData.accountCreatedDate && formData.reminderDays && parseInt(formData.reminderDays) > 0 && (() => {
                                        const reminderPreview = calculateAccountReminder(formData.accountCreatedDate, formData.reminderDays);
                                        if (reminderPreview.status === 'none') return null;
                                        return (
                                            <div className="mt-1.5 p-2 rounded-xl bg-purple-100/70 dark:bg-purple-900/40 border border-purple-200/90 dark:border-purple-800/70 flex items-center justify-between text-xs text-purple-950 dark:text-purple-200">
                                                <div className="flex items-center gap-2">
                                                    <i className="fa-solid fa-calendar-check text-purple-600 dark:text-purple-400"></i>
                                                    <span>موعد التذكير: <strong>{reminderPreview.targetDate}</strong></span>
                                                </div>
                                                <span className="font-bold px-2 py-0.5 rounded-md bg-purple-200/80 dark:bg-purple-800/90 text-[10.5px]">
                                                    {reminderPreview.text}
                                                </span>
                                            </div>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* Invoice & Visa (for Invoice Sheet & Account Sheet - hidden in main table for Account sheet) */}
                            {!isClientOrMerchant && currentSheetId !== 'reminders_data' && (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                                كود الفاتورة (Invoice Code)
                                            </label>
                                            <div className="relative">
                                                <i className="fa-solid fa-file-invoice absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                                <input
                                                    type="text"
                                                    value={formData.invoiceNumber}
                                                    onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                                                    placeholder="مثال: INV-100234"
                                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                                الفيزا / رقم البطاقة (Visa)
                                            </label>
                                            <div className="relative">
                                                <i className="fa-solid fa-credit-card absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                                <input
                                                    type="text"
                                                    value={formData.visa}
                                                    onChange={(e) => setFormData({ ...formData, visa: e.target.value })}
                                                    placeholder="4111 2222 3333 4444"
                                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dir-ltr text-right"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                            Edu Mail
                                        </label>
                                        <div className="relative">
                                            <i className="fa-solid fa-envelope-circle-check absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                            <input
                                                type="text"
                                                value={formData.visaAccount}
                                                onChange={(e) => setFormData({ ...formData, visaAccount: e.target.value })}
                                                placeholder="student@university.edu"
                                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Notes Field (Directly under duration / visa for all sheets) */}
                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                    {currentSheetId === 'reminders_data' ? 'تفاصيل وملاحظات التذكير' : 'ملاحظات إضافية'}
                                </label>
                                <textarea
                                    rows={currentSheetId === 'reminders_data' ? 3 : 2}
                                    value={formData.notes}
                                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                    placeholder={currentSheetId === 'reminders_data' ? 'اكتب أي تفاصيل، أرقام تواصل، حسابات، أو ملاحظات هامة تخص التذكير...' : 'أي تفاصيل أو ملاحظات إضافية...'}
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none"
                                />
                            </div>

                            </div>

                            {/* Fixed Footer with Cancel and Submit buttons */}
                            <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/90 backdrop-blur-xs flex-shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
                                >
                                    <i className="fa-solid fa-xmark text-slate-400 text-xs"></i>
                                    <span>إلغاء</span>
                                </button>
                                <button
                                    type="submit"
                                    className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition transform active:scale-95 flex items-center gap-1.5 cursor-pointer"
                                >
                                    <i className="fa-solid fa-check text-xs"></i>
                                    <span>{editingRecord ? 'حفظ التعديلات' : 'إضافة السجل'}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: Bulk Add */}
            {showBulkModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center text-lg">
                                    <i className="fa-solid fa-layer-group"></i>
                                </div>
                                <div>
                                    <h3 className="font-black text-lg text-slate-800 dark:text-white">إضافة مجمعة سريعة</h3>
                                    <p className="text-xs text-slate-400">إضافة عدة أسطر دفعة واحدة إلى <b className="text-indigo-500">{currentSheet.name}</b></p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowBulkModal(false)}
                                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white flex items-center justify-center transition"
                            >
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>

                        <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl text-xs text-slate-600 dark:text-slate-400 space-y-1">
                            <p className="font-bold text-slate-800 dark:text-slate-200">الصيغ المدعومة لكل سطر (مفصولة بـ : أو | أو Tab):</p>
                            {isClientOrMerchant ? (
                                <>
                                    <p className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                                        email:pass1:pass2:duration:notes
                                    </p>
                                    <p className="text-[11px] text-slate-400">مثال: user@mail.com:Pass123:PassAlt:1 شهر:عميل مميز</p>
                                </>
                            ) : (
                                <>
                                    <p className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                                        email:pass:pass2:invoice:visa:visaAccount:notes
                                    </p>
                                    <p className="text-[11px] text-slate-400">مثال: user@mail.com:Pass123:PassAlt:INV-99:4111222233334444:CIB Bank:عميل مميز</p>
                                </>
                            )}
                        </div>

                        <form onSubmit={handleBulkAddSubmit} className="space-y-4">
                            <textarea
                                rows={8}
                                value={bulkText}
                                onChange={(e) => setBulkText(e.target.value)}
                                placeholder="الصق البيانات هنا، كل سطر يمثل سجلاً منفصلاً..."
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50 dir-ltr text-left"
                            />

                            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                                <span className="text-xs text-slate-400">
                                    عدد الأسطر: <b className="text-slate-700 dark:text-slate-200">{bulkText.split('\n').filter(l => l.trim()).length}</b>
                                </span>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowBulkModal(false)}
                                        className="px-5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition"
                                    >
                                        إلغاء
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-6 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-lg shadow-purple-600/30 transition transform active:scale-95"
                                    >
                                        إضافة السجلات
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Modal: Rename Sheet */}
            {showRenameModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                            <h3 className="font-black text-base text-slate-800 dark:text-white">تعديل اسم الشيت</h3>
                            <button
                                onClick={() => setShowRenameModal(false)}
                                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-white flex items-center justify-center transition"
                            >
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>

                        <form onSubmit={handleRenameSheet} className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                    اسم الشيت الجديد
                                </label>
                                <input
                                    type="text"
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    placeholder="أدخل اسم الشيت"
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowRenameModal(false)}
                                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition"
                                >
                                    إلغاء
                                </button>
                                <button
                                    type="submit"
                                    className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition"
                                >
                                    حفظ الاسم
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

        </div>
    );
}
