import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from './ConfirmDialog';
import { sheetsAPI } from '../services/api';
import { SHEETS_CHANGED, sellCloudAccount, syncAccountUsageFromCloudSheets } from '../services/sheetSync';
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
    { label: '1 Ø´Ù‡Ø± (30 ÙŠÙˆÙ…)', value: '1 Ø´Ù‡Ø±', num: 1 },
    { label: '2 Ø´Ù‡Ø± (60 ÙŠÙˆÙ…)', value: '2 Ø´Ù‡Ø±', num: 2 },
    { label: '3 Ø´Ù‡ÙˆØ± (90 ÙŠÙˆÙ…)', value: '3 Ø´Ù‡ÙˆØ±', num: 3 },
    { label: '4 Ø´Ù‡ÙˆØ± (120 ÙŠÙˆÙ…)', value: '4 Ø´Ù‡ÙˆØ±', num: 4 },
    { label: '6 Ø´Ù‡ÙˆØ± (180 ÙŠÙˆÙ…)', value: '6 Ø´Ù‡ÙˆØ±', num: 6 },
    { label: '1 Ø³Ù†Ø© (365 ÙŠÙˆÙ…)', value: '1 Ø³Ù†Ø©', num: 12 },
];

const ACCOUNT_CATEGORIES = [
    { id: 'adobe', label: 'Adobe', icon: 'fa-palette', hint: 'Outlook + Adobe passwords' },
    { id: 'capcut', label: 'CapCut', icon: 'fa-clapperboard', hint: 'Customer monthly renewals' },
    { id: 'chatgpt_shared', label: 'ChatGPT Shared', icon: 'fa-comments', hint: 'Shared seats and renewal date' },
];

const getAccountCategory = (record) => record?.accountCategory || 'adobe';

const isReusedAccount = (record) => {
    const status = String(record?.accountUsageStatus || '').toLowerCase();
    const notes = String(record?.notes || '').toLowerCase();
    return Boolean(record?.reusedAfterExpiry)
        || Boolean(record?.releasedAccountAt)
        || status.includes('reused')
        || notes.includes('reused after expired')
        || notes.includes('returned to stock');
};

const parsePlainDate = (value) => {
    if (!value) return null;
    const s = String(value).trim().slice(0, 10);
    const match = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

const formatPlainDate = (date) => {
    if (!date || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const getTodayPlainDate = () => formatPlainDate(new Date());

const calculateCapCutMonthlyReminder = (record) => {
    if (getAccountCategory(record) !== 'capcut') {
        return calculateAccountReminder(record?.accountCreatedDate, record?.reminderDays, record?.created_at);
    }

    const start = parsePlainDate(record.accountCreatedDate || record.created_at);
    const months = Math.max(1, Number(record.capcutMonths || 1));
    if (!start) return { text: '-', status: 'none', days: null, targetDate: '' };

    const todayRaw = new Date();
    const today = new Date(todayRaw.getFullYear(), todayRaw.getMonth(), todayRaw.getDate());
    let target = null;
    for (let i = 1; i <= months; i += 1) {
        const d = new Date(start.getFullYear(), start.getMonth() + i, start.getDate());
        if (d >= today) {
            target = d;
            break;
        }
    }
    if (!target) target = new Date(start.getFullYear(), start.getMonth() + months, start.getDate());

    const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const targetDate = formatPlainDate(target);
    const createdDate = formatPlainDate(start);
    if (diffDays < 0) return { text: `CapCut renewal overdue (${Math.abs(diffDays)} days)`, status: 'expired', days: diffDays, targetDate, createdDate, reminderDays: 30 };
    if (diffDays === 0) return { text: 'CapCut monthly renewal today', status: 'expiring-today', days: 0, targetDate, createdDate, reminderDays: 30 };
    if (diffDays <= 3) return { text: `CapCut monthly renewal in ${diffDays} days`, status: 'urgent', days: diffDays, targetDate, createdDate, reminderDays: 30 };
    return { text: `CapCut monthly renewal in ${diffDays} days`, status: 'active', days: diffDays, targetDate, createdDate, reminderDays: 30 };
};

const calculateChatGPTMonthlyReminder = (record) => {
    if (getAccountCategory(record) !== 'chatgpt_shared') {
        return calculateAccountReminder(record?.accountCreatedDate, record?.reminderDays, record?.created_at);
    }

    const start = parsePlainDate(record.accountCreatedDate || record.startDate || record.created_at);
    if (!start) return { text: '-', status: 'none', days: null, targetDate: '' };

    const todayRaw = new Date();
    const today = new Date(todayRaw.getFullYear(), todayRaw.getMonth(), todayRaw.getDate());
    let target = new Date(start.getFullYear(), start.getMonth() + 1, start.getDate());
    while (target < today) {
        target = new Date(target.getFullYear(), target.getMonth() + 1, target.getDate());
    }

    const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const targetDate = formatPlainDate(target);
    const createdDate = formatPlainDate(start);
    if (diffDays < 0) return { text: `ChatGPT renewal overdue (${Math.abs(diffDays)} days)`, status: 'expired', days: diffDays, targetDate, createdDate, reminderDays: 30 };
    if (diffDays === 0) return { text: 'ChatGPT renewal today', status: 'expiring-today', days: 0, targetDate, createdDate, reminderDays: 30 };
    if (diffDays <= 3) return { text: `ChatGPT renewal in ${diffDays} days`, status: 'urgent', days: diffDays, targetDate, createdDate, reminderDays: 30 };
    return { text: `ChatGPT renewal in ${diffDays} days`, status: 'active', days: diffDays, targetDate, createdDate, reminderDays: 30 };
};

const getAccountReminder = (record) => {
    if (getAccountCategory(record) === 'capcut') return calculateCapCutMonthlyReminder(record);
    if (getAccountCategory(record) === 'chatgpt_shared') return calculateChatGPTMonthlyReminder(record);
    return calculateAccountReminder(record?.accountCreatedDate, record?.reminderDays, record?.created_at);
};

/**
 * Calculates accurate remaining subscription duration from start date and duration string
 */
export const calculateRemainingTime = (rawStartDate, rawDuration, rawCreatedAt) => {
    const duration = String(rawDuration || '').trim();
    if (!duration) {
        return { text: '-', status: 'none', days: null };
    }

    if (duration.includes('Ù…Ø¯Ù‰ Ø§Ù„Ø­ÙŠØ§Ø©') || duration.toLowerCase().includes('lifetime')) {
        return { text: 'Ù…Ø¯Ù‰ Ø§Ù„Ø­ÙŠØ§Ø©', status: 'lifetime', days: 999999, label: 'âˆž' };
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

    if (duration.includes('Ø³Ù†Ø©') || duration.includes('Ø³Ù†ÙˆØ§Øª') || duration.toLowerCase().includes('year')) {
        const num = parseInt(duration) || 1;
        end.setFullYear(end.getFullYear() + num);
    } else if (duration.includes('Ø´Ù‡Ø±') || duration.includes('Ø´Ù‡ÙˆØ±') || duration.toLowerCase().includes('month')) {
        const num = parseInt(duration) || 1;
        end.setDate(end.getDate() + (num * 30));
    } else if (duration.includes('ÙŠÙˆÙ…') || duration.toLowerCase().includes('day')) {
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
            text: absDays === 1 ? 'Ù…Ù†ØªÙ‡ÙŠ Ø£Ù…Ø³' : `Ù…Ù†ØªÙ‡ÙŠ (Ù…Ù†Ø° ${absDays} ÙŠÙˆÙ…)`,
            status: 'expired',
            days: diffDays,
            endDate: endFormatted,
            startDate: startFormatted
        };
    }

    if (diffDays === 0) {
        return {
            text: 'ÙŠÙ†ØªÙ‡ÙŠ Ø§Ù„ÙŠÙˆÙ…',
            status: 'expiring-today',
            days: 0,
            endDate: endFormatted,
            startDate: startFormatted
        };
    }

    if (diffDays === 1) {
        return {
            text: 'Ù…ØªØ¨Ù‚ÙŠ ÙŠÙˆÙ… ÙˆØ§Ø­Ø¯',
            status: 'urgent',
            days: 1,
            endDate: endFormatted,
            startDate: startFormatted
        };
    }

    if (diffDays < 30) {
        return {
            text: `Ù…ØªØ¨Ù‚ÙŠ ${diffDays} ÙŠÙˆÙ…`,
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
        text = remDays > 0 ? `Ù…ØªØ¨Ù‚ÙŠ Ø´Ù‡Ø± Ùˆ ${remDays} ÙŠÙˆÙ…` : 'Ù…ØªØ¨Ù‚ÙŠ Ø´Ù‡Ø±';
    } else if (months === 2) {
        text = remDays > 0 ? `Ù…ØªØ¨Ù‚ÙŠ Ø´Ù‡Ø±ÙŠÙ† Ùˆ ${remDays} ÙŠÙˆÙ…` : 'Ù…ØªØ¨Ù‚ÙŠ Ø´Ù‡Ø±ÙŠÙ†';
    } else if (months >= 3 && months <= 10) {
        text = remDays > 0 ? `Ù…ØªØ¨Ù‚ÙŠ ${months} Ø´Ù‡ÙˆØ± Ùˆ ${remDays} ÙŠÙˆÙ…` : `Ù…ØªØ¨Ù‚ÙŠ ${months} Ø´Ù‡ÙˆØ±`;
    } else {
        text = remDays > 0 ? `Ù…ØªØ¨Ù‚ÙŠ ${months} Ø´Ù‡Ø± Ùˆ ${remDays} ÙŠÙˆÙ…` : `Ù…ØªØ¨Ù‚ÙŠ ${months} Ø´Ù‡Ø±`;
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
    const [deviceFilter, setDeviceFilter] = useState('all'); // advanced: all, Ø¬Ù‡Ø§Ø², Ø¬Ù‡Ø§Ø²ÙŠÙ†
    const [renewalFilter, setRenewalFilter] = useState('all');
    const [accountStockFilter, setAccountStockFilter] = useState('all');
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [activeAccountCategory, setActiveAccountCategory] = useState('adobe');

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
        name: '',
        phone: '',
        contactChannel: 'ÙˆØ§ØªØ³Ø§Ø¨',
        email: '',
        password: '',
        password2: '',
        duration: '',
        startDate: '',
        deviceType: 'Ù…Ø´ØªØ±Ùƒ',
        paymentStatus: 'Ù…Ø¯ÙÙˆØ¹',
        selectedAccount: '',
        invoiceNumber: '',
        visa: '',
        visaAccount: '',
        notes: '',
        accountCreatedDate: '',
        reminderDays: '20',
        offerActivated: false,
        offerActivatedAt: '',
        accountCategory: 'adobe',
        capcutMode: '',
        capcutGiftUsed: false,
        capcutMonthlyReminder: false,
        capcutMonths: 1,
        sharedUsers: 1,
        renewalDate: '',
        twoFaLink: ''
    });
    const [accountEntryMode, setAccountEntryMode] = useState('available');
    const [availableAccountSearch, setAvailableAccountSearch] = useState('');
    const [availableAccountSort, setAvailableAccountSort] = useState('newest');

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
        setRenewalFilter('all');
        setAccountStockFilter('all');
    }, [currentSheetId]);

    // Save records to LocalStorage & Supabase cloud
    const saveRecords = async (newRecords) => {
        try {
            const sanitized = newRecords.map((r, i) => sanitizeRecord(r, i)).filter(Boolean);
            await sheetsAPI.saveSheetRecords(currentSheetId, sanitized);
            let visibleRecords = sanitized;
            if (['client_data', 'merchant_data', 'account_data'].includes(currentSheetId)) {
                const syncedAccounts = await syncAccountUsageFromCloudSheets({ [currentSheetId]: sanitized });
                if (currentSheetId === 'account_data' && Array.isArray(syncedAccounts)) {
                    visibleRecords = syncedAccounts.map((r, i) => sanitizeRecord(r, i)).filter(Boolean);
                }
            }
            setRecords(visibleRecords);
            refreshAllCounts();
            if (currentSheetId === 'account_data') {
                refreshAvailableAccounts();
            }
            return true;
        } catch (e) {
            console.error('Error saving data:', e);
            showToast('Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«Ù†Ø§Ø¡ Ø­ÙØ¸ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª', 'error');
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
                if (getAccountCategory(acc) !== 'adobe') return false;
                const maxUses = Math.max(1, Number(acc.maxUses || 2));
                const currentUses = Math.max(0, Number(acc.currentUses || 0));
                return currentUses < maxUses;
            })
            .sort((a, b) => String(a.email || a.selectedAccount || '').localeCompare(String(b.email || b.selectedAccount || '')));
    }, [availableAccounts]);

    const displayedAvailableAccountChoices = useMemo(() => {
        const query = availableAccountSearch.trim().toLowerCase();
        const filtered = availableAccountChoices.filter(acc => {
            if (!query) return true;
            return [
                acc.email,
                acc.selectedAccount,
                acc.id,
                acc.password,
                acc.password2
            ].some(value => String(value || '').toLowerCase().includes(query));
        });

        const getAccountSortTime = (acc) => {
            const candidates = [
                acc.created_at,
                acc.createdAt,
                acc.accountCreatedDate,
                acc.startDate,
                acc.date,
                acc.updated_at,
                acc.updatedAt
            ];
            for (const value of candidates) {
                if (!value) continue;
                const time = new Date(value).getTime();
                if (!Number.isNaN(time)) return time;
            }
            const idTime = String(acc.id || '').match(/\d{10,}/)?.[0];
            return idTime ? Number(idTime) : 0;
        };

        return filtered
            .map((acc, index) => ({ acc, index }))
            .sort((a, b) => {
                const accA = a.acc;
                const accB = b.acc;
                const emailA = String(accA.email || accA.selectedAccount || '');
                const emailB = String(accB.email || accB.selectedAccount || '');

                const currentUsesA = Math.max(0, Number(accA.currentUses || 0));
                const currentUsesB = Math.max(0, Number(accB.currentUses || 0));
                const maxUsesA = Math.max(1, Number(accA.maxUses || 2));
                const maxUsesB = Math.max(1, Number(accB.maxUses || 2));
                const remainingA = Math.max(0, maxUsesA - currentUsesA);
                const remainingB = Math.max(0, maxUsesB - currentUsesB);
                const availabilityRank = (currentUsesA - currentUsesB) || (remainingB - remainingA);
                if (availabilityRank) return availabilityRank;

                if (availableAccountSort === 'email') {
                    return emailA.localeCompare(emailB) || (a.index - b.index);
                }

                const dateA = getAccountSortTime(accA);
                const dateB = getAccountSortTime(accB);
                const byDate = availableAccountSort === 'oldest' ? dateA - dateB : dateB - dateA;
                return byDate || emailA.localeCompare(emailB) || (a.index - b.index);
            })
            .map(item => item.acc);
    }, [availableAccountChoices, availableAccountSearch, availableAccountSort]);

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

    const handleSetDeviceType = (type) => {
        const nextType = type === 'Ø´Ø®ØµÙŠ' ? 'Ø´Ø®ØµÙŠ' : 'Ù…Ø´ØªØ±Ùƒ';
        setFormData(prev => {
            if (nextType === 'Ø´Ø®ØµÙŠ' && prev.selectedAccount) {
                const account = availableAccounts.find(acc => {
                    const selectedValue = String(prev.selectedAccount || '').toLowerCase();
                    return String(acc.email || '').toLowerCase() === selectedValue
                        || String(acc.selectedAccount || '').toLowerCase() === selectedValue;
                });
                const maxUses = Math.max(1, Number(account?.maxUses || 2));
                const currentUses = Math.max(0, Number(account?.currentUses || 0));
                if (account && (currentUses > 0 || maxUses < 2)) {
                    showToast('ØªÙ… Ø¥Ù„ØºØ§Ø¡ Ø§Ø®ØªÙŠØ§Ø± Ø§Ù„Ø­Ø³Ø§Ø¨ Ù„Ø£Ù† Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ Ø§Ù„Ø´Ø®ØµÙŠ ÙŠØªØ·Ù„Ø¨ Ø­Ø³Ø§Ø¨Ø§Ù‹ Ù…ØªØ§Ø­Ø§Ù‹ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ (Ø¬Ù‡Ø§Ø²ÙŠÙ†)', 'warning');
                    return { ...prev, deviceType: 'Ø´Ø®ØµÙŠ', selectedAccount: '' };
                }
            }
            return { ...prev, deviceType: nextType };
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
            showToast('Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª Ù„Ù„Ù†Ø³Ø®', 'warning');
            return;
        }
        navigator.clipboard.writeText(text);
        setCopiedField(key);
        showToast('ØªÙ… Ø§Ù„Ù†Ø³Ø® Ø¥Ù„Ù‰ Ø§Ù„Ø­Ø§ÙØ¸Ø© Ø¨Ù†Ø¬Ø§Ø­ âœ“', 'success');
        setTimeout(() => setCopiedField(null), 1500);
    };

    const handleCopyAdobeAccess = (rec) => {
        if (!rec?.email) {
            showToast('ÙŠØ¬Ø¨ ÙˆØ¬ÙˆØ¯ Ø§Ù„Ø¥ÙŠÙ…ÙŠÙ„ Ù„Ù„Ù†Ø³Ø®', 'warning');
            return;
        }

        const adobePassword = (rec.password2 && rec.password2.trim() && rec.password2 !== 'Will be added later')
            ? rec.password2.trim()
            : 'Service2030@';

        const message = [
            '**🎨✨ *ADOBE CREATIVE CLOUD***',
            '',
            '**━━━━━━━━━━━━━━━**',
            '',
            '**📩 *بيانات تسجيل الدخول***',
            '',
            '**📧 ( *Adobe Mail* ) ⬇️**',
            '',
            `**${rec.email}**`,
            '',
            '**🔐 ( *Password* ) ⬇️**',
            '',
            `**${adobePassword}**`,
            '',
            '**━━━━━━━━━━━━━━━**',
            '',
            '**⚠️ *تنبيه هام***',
            '',
            '**يرجى عدم إجراء أي تعديل على:**',
            '',
            '**🚫 البريد الإلكتروني**',
            '**🚫 كلمة المرور**',
            '**🚫 بيانات أو إعدادات الحساب**',
            '',
            '**❗️ *أي تغيير في بيانات الحساب أو إعداداته يؤدي إلى فقدان الضمان على الحساب والاشتراك.***',
            '',
            '**🛡️ للحفاظ على *الاشتراك والضمان*، يرجى استخدام الحساب بالبيانات المرسلة كما هي وعدم تعديل أي بيانات داخله.**',
        ].join('\n');

        handleCopy(message, `adobe_access_${rec.id}`);
    };

    const handleCopyChatGPTAccess = (rec) => {
        if (!rec?.email) {
            showToast('ÙŠØ¬Ø¨ ÙˆØ¬ÙˆØ¯ Ø§Ù„Ø¥ÙŠÙ…ÙŠÙ„ Ù„Ù„Ù†Ø³Ø®', 'warning');
            return;
        }

        const message = [
            rec.email || '',
            rec.password || '',
            rec.twoFaLink || ''
        ].filter(Boolean).join('\n');

        handleCopy(message, `chatgpt_access_${rec.id}`);
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
                showToast('ÙŠØ±Ø¬Ù‰ Ø§Ø®ØªÙŠØ§Ø± Ù…ÙŠÙ„ Ù…ØªØ§Ø­ Ù…Ù† Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨', 'warning');
                return;
            }
            if (!formData.email.trim()) {
                showToast('ÙŠØ±Ø¬Ù‰ Ø¥Ø¯Ø®Ø§Ù„ Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ', 'warning');
                return;
            }
            if (!formData.duration) {
                showToast('ÙŠØ±Ø¬Ù‰ Ø§Ø®ØªÙŠØ§Ø± Ù…Ø¯Ø© Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ', 'warning');
                return;
            }
            const selected = findSelectedAvailableAccount();
            const isPersonalChosen = formData.deviceType === 'Ø´Ø®ØµÙŠ' || formData.deviceType === 'Ø¬Ù‡Ø§Ø²ÙŠÙ†';
            if (!editingRecord && accountEntryMode === 'available' && selected && isPersonalChosen && Number(selected.currentUses) > 0) {
                showToast('Ø§Ù„Ø­Ø³Ø§Ø¨ Ø§Ù„Ù…Ø®ØªØ§Ø± Ù…Ø³ØªØ®Ø¯Ù… Ù…Ù†Ù‡ Ø¬Ù‡Ø§Ø² Ø¨Ø§Ù„ÙØ¹Ù„ØŒ Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø¨ÙŠØ¹Ù‡ ÙƒØ§Ø´ØªØ±Ø§Ùƒ Ø´Ø®ØµÙŠ (Ø¬Ù‡Ø§Ø²ÙŠÙ†). ÙŠØ±Ø¬Ù‰ Ø§Ø®ØªÙŠØ§Ø± Ø­Ø³Ø§Ø¨ Ù…ØªØ§Ø­ ÙƒØ§Ù…Ù„ Ø£Ùˆ ØªØºÙŠÙŠØ± Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ Ø¥Ù„Ù‰ Ù…Ø´ØªØ±Ùƒ.', 'warning');
                return;
            }
        } else if (currentSheetId === 'account_data') {
            if (!formData.email && !formData.password && !formData.password2) {
                showToast('ÙŠØ±Ø¬Ù‰ Ø¥Ø¯Ø®Ø§Ù„ Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ Ø£Ùˆ ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„', 'warning');
                return;
            }
        } else if (currentSheetId === 'reminders_data') {
            if (!formData.email && !formData.notes) {
                showToast('ÙŠØ±Ø¬Ù‰ ÙƒØªØ§Ø¨Ø© Ø¹Ù†ÙˆØ§Ù† Ø£Ùˆ ØªÙØ§ØµÙŠÙ„ Ø§Ù„ØªØ°ÙƒÙŠØ±', 'warning');
                return;
            }
        } else {
            if (!formData.email && !formData.invoiceNumber && !formData.visa && !formData.selectedAccount) {
                showToast('ÙŠØ±Ø¬Ù‰ Ø¥Ø¯Ø®Ø§Ù„ Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ Ø£Ùˆ Ø±Ù‚Ù… Ø§Ù„ÙØ§ØªÙˆØ±Ø© Ø£Ùˆ Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨ Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„', 'warning');
                return;
            }
        }

        const isPersonalSelection = formData.deviceType === 'Ø´Ø®ØµÙŠ' || formData.deviceType === 'Ø¬Ù‡Ø§Ø²ÙŠÙ†';
        const accountCategory = formData.accountCategory || activeAccountCategory || 'adobe';
        const sharedUsers = Math.max(1, Number(formData.sharedUsers || 1));
        const capcutMonths = Math.max(1, Number(formData.capcutMonths || 2));
        const accountCreatedDate = formData.accountCreatedDate || new Date().toISOString().slice(0, 10);
        const cleanPayload = isClientOrMerchant ? {
            name: formData.name || '',
            phone: formData.phone || '',
            contactChannel: formData.contactChannel || 'ÙˆØ§ØªØ³Ø§Ø¨',
            email: formData.email,
            password: formData.password,
            password2: formData.password2 || 'Service2030@',
            duration: formData.duration,
            startDate: formData.startDate || '',
            deviceType: isPersonalSelection ? 'Ø´Ø®ØµÙŠ' : 'Ù…Ø´ØªØ±Ùƒ',
            accountUsageMode: isPersonalSelection ? 'personal' : 'shared_one_device',
            saleType: isPersonalSelection ? 'personal' : 'shared_one_device',
            paymentStatus: formData.paymentStatus || 'Ù…Ø¯ÙÙˆØ¹',
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
            password2: accountCategory === 'adobe' ? (formData.password2 || 'Service2030@') : '',
            invoiceNumber: formData.invoiceNumber || '',
            visa: formData.visa || '',
            visaAccount: formData.visaAccount || '',
            duration: accountCategory === 'capcut' ? `${capcutMonths} months` : '',
            startDate: accountCategory === 'capcut' || accountCategory === 'chatgpt_shared' ? accountCreatedDate : '',
            deviceType: '',
            paymentStatus: '',
            selectedAccount: '',
            notes: formData.notes,
            accountCreatedDate,
            reminderDays: accountCategory === 'capcut' || accountCategory === 'chatgpt_shared' ? '30' : (formData.reminderDays || '20'),
            currentUses: accountCategory === 'capcut' ? 1 : (accountCategory === 'chatgpt_shared' ? sharedUsers : (editingRecord?.currentUses || 0)),
            maxUses: accountCategory === 'chatgpt_shared' ? sharedUsers : (accountCategory === 'capcut' ? 1 : (editingRecord?.maxUses || 2)),
            accountUsageStatus: accountCategory === 'capcut' ? 'personal_full' : (editingRecord?.accountUsageStatus || ''),
            offerActivated: accountCategory === 'adobe' ? (editingRecord?.offerActivated || false) : false,
            offerActivatedAt: accountCategory === 'adobe' ? (editingRecord?.offerActivatedAt || '') : '',
            accountCategory,
            capcutMode: '',
            capcutGiftUsed: false,
            capcutMonthlyReminder: accountCategory === 'capcut',
            capcutMonths: accountCategory === 'capcut' ? capcutMonths : '',
            sharedUsers: accountCategory === 'chatgpt_shared' ? sharedUsers : '',
            renewalDate: '',
            twoFaLink: accountCategory === 'chatgpt_shared' ? (formData.twoFaLink || '') : ''
        } : currentSheetId === 'reminders_data' ? {
            email: formData.email || 'ØªØ°ÙƒÙŠØ± Ø¨Ø¯ÙˆÙ† Ø¹Ù†ÙˆØ§Ù†',
            password: formData.password || 'Ù…ØªÙˆØ³Ø·',
            password2: 'Service2030@',
            invoiceNumber: '',
            visa: '',
            visaAccount: '',
            duration: '',
            startDate: formData.accountCreatedDate || formData.startDate || new Date().toISOString().slice(0, 10),
            deviceType: formData.deviceType || 'ØªØ°ÙƒÙŠØ± Ø¹Ø§Ù…',
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
            showToast('ØªÙ… ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø¨Ù†Ø¬Ø§Ø­ âœ“', 'success');
        } else {
            // Add new
            const newRecord = {
                id: 'REC-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
                ...cleanPayload,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            if ((currentSheetId === 'client_data' || currentSheetId === 'merchant_data') && accountEntryMode === 'available') {
                const selectedAcc = findSelectedAvailableAccount();
                await sellCloudAccount(newRecord, selectedAcc?.id, currentSheetId);
            } else if (!await saveRecords([newRecord, ...records])) return;
            showToast('ØªÙ… Ø¥Ø¶Ø§ÙØ© Ø§Ù„Ø³Ø¬Ù„ Ø§Ù„Ø¬Ø¯ÙŠØ¯ Ø¨Ù†Ø¬Ø§Ø­ âœ“', 'success');
        }

        setShowAddModal(false);
        setEditingRecord(null);
        setAccountEntryMode('available');
        setFormData({
            name: '',
            phone: '',
            contactChannel: 'ÙˆØ§ØªØ³Ø§Ø¨',
            email: '',
            password: '',
            password2: '',
            duration: '',
            startDate: '',
            deviceType: 'Ù…Ø´ØªØ±Ùƒ',
            paymentStatus: 'Ù…Ø¯ÙÙˆØ¹',
            selectedAccount: '',
            invoiceNumber: '',
            visa: '',
            visaAccount: '',
            notes: '',
            accountCreatedDate: activeAccountCategory === 'capcut' || activeAccountCategory === 'chatgpt_shared' ? new Date().toISOString().slice(0, 10) : '',
            reminderDays: activeAccountCategory === 'chatgpt_shared' ? '30' : '20',
            offerActivated: false,
            offerActivatedAt: '',
            accountCategory: activeAccountCategory,
            capcutMode: '',
            capcutGiftUsed: false,
            capcutMonthlyReminder: activeAccountCategory === 'capcut',
            capcutMonths: activeAccountCategory === 'capcut' ? 2 : 1,
            sharedUsers: 1,
            renewalDate: '',
            twoFaLink: ''
        });
        } catch (err) {
            console.error('Error saving record/sale:', err);
            showToast('ØªØ¹Ø°Ø± Ø­ÙØ¸ Ø§Ù„Ø¨ÙŠØ¹: ' + (err?.message || 'ØªØ£ÙƒØ¯ Ù…Ù† Ø§ØªØµØ§Ù„ Ù‚Ø§Ø¹Ø¯Ø© Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª ÙˆØªÙˆÙØ± Ø§Ù„Ø­Ø³Ø§Ø¨'), 'error');
        } finally { setIsSaving(false); }
    };

    // Open Edit Modal
    const handleOpenEdit = (rec) => {
        refreshAvailableAccounts();
        setEditingRecord(rec);
        setAccountEntryMode(rec.selectedAccount ? 'available' : 'manual');
        setFormData({
            name: rec.name || '',
            phone: rec.phone || '',
            contactChannel: rec.contactChannel || 'ÙˆØ§ØªØ³Ø§Ø¨',
            email: rec.email || '',
            password: getAccountCategory(rec) === 'chatgpt_shared' ? (rec.password || rec.password2 || '') : (rec.password || ''),
            password2: getAccountCategory(rec) === 'chatgpt_shared' ? '' : (rec.password2 || ''),
            duration: rec.duration || '',
            startDate: rec.startDate || rec.date || '',
            deviceType: (rec.deviceType === 'Ø´Ø®ØµÙŠ' || rec.deviceType === 'Ø¬Ù‡Ø§Ø²ÙŠÙ†') ? 'Ø´Ø®ØµÙŠ' : 'Ù…Ø´ØªØ±Ùƒ',
            paymentStatus: rec.paymentStatus || 'Ù…Ø¯ÙÙˆØ¹',
            selectedAccount: rec.selectedAccount || '',
            invoiceNumber: rec.invoiceNumber || '',
            visa: rec.visa || '',
            visaAccount: rec.visaAccount || '',
            notes: rec.notes || '',
            accountCreatedDate: rec.accountCreatedDate || '',
            reminderDays: rec.reminderDays || '',
            offerActivated: rec.offerActivated || false,
            offerActivatedAt: rec.offerActivatedAt || '',
            accountCategory: getAccountCategory(rec),
            capcutMode: rec.capcutMode || '',
            capcutGiftUsed: false,
            capcutMonthlyReminder: getAccountCategory(rec) === 'capcut' || !!rec.capcutMonthlyReminder,
            capcutMonths: rec.capcutMonths || (getAccountCategory(rec) === 'capcut' ? 2 : 1),
            sharedUsers: rec.sharedUsers || rec.maxUses || 1,
            renewalDate: rec.renewalDate || '',
            twoFaLink: rec.twoFaLink || ''
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
                title: 'Ø­Ø°Ù Ø§Ù„Ø³Ø¬Ù„ Ù†Ù‡Ø§Ø¦ÙŠØ§Ù‹',
                message: 'Ù‡Ù„ Ø£Ù†Øª Ù…ØªØ£ÙƒØ¯ Ù…Ù† Ø­Ø°Ù Ù‡Ø°Ø§ Ø§Ù„Ø³Ø¬Ù„ Ù†Ù‡Ø§Ø¦ÙŠØ§Ù‹ØŸ Ù„Ù† ÙŠÙ…ÙƒÙ†Ùƒ Ø§Ø³ØªØ¹Ø§Ø¯ØªÙ‡ Ù…Ø±Ø© Ø£Ø®Ø±Ù‰.',
                confirmText: 'Ù†Ø¹Ù…ØŒ Ø§Ø­Ø°Ù',
                cancelText: 'Ø¥Ù„ØºØ§Ø¡',
                type: 'danger'
            });
            if (!confirmed) return;

            const updated = records.filter(r => r.id !== id);
            saveRecords(updated);
            const newSelected = new Set(selectedIds);
            newSelected.delete(id);
            setSelectedIds(newSelected);
            showToast('ØªÙ… Ø§Ù„Ø­Ø°Ù Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠ Ù„Ù„Ø³Ø¬Ù„ Ø¨Ù†Ø¬Ø§Ø­', 'info');
        } else {
            const confirmed = await showConfirm({
                title: 'Ø­Ø°Ù Ø§Ù„Ø³Ø¬Ù„',
                message: 'Ù‡Ù„ ØªØ±ÙŠØ¯ Ø­Ø°Ù Ù‡Ø°Ø§ Ø§Ù„Ø³Ø¬Ù„ ÙˆÙ†Ù‚Ù„Ù‡ Ø¥Ù„Ù‰ Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§ØªØŸ',
                confirmText: 'Ù†Ø¹Ù…ØŒ Ø§Ø­Ø°Ù',
                cancelText: 'Ø¥Ù„ØºØ§Ø¡',
                type: 'danger'
            });
            if (!confirmed) return;

            const targetRecord = records.find(r => r.id === id);
            if (targetRecord) {
                await moveToTrash([targetRecord], currentSheetId, currentSheet?.name || 'Ø´ÙŠØª');
            }
            const updated = records.filter(r => r.id !== id);
            await saveRecords(updated);
            const newSelected = new Set(selectedIds);
            newSelected.delete(id);
            setSelectedIds(newSelected);
            showToast('ØªÙ… Ù†Ù‚Ù„ Ø§Ù„Ø³Ø¬Ù„ Ø¥Ù„Ù‰ Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª Ø¨Ù†Ø¬Ø§Ø­ âœ“', 'success');
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
            if (['client_data', 'merchant_data', 'account_data'].includes(targetSheetId)) {
                await syncAccountUsageFromCloudSheets({ [targetSheetId]: updatedTarget });
            }

            // Remove from trash
            const updatedTrash = records.filter(r => r.id !== recordToRestore.id);
            await saveRecords(updatedTrash);

            const newSelected = new Set(selectedIds);
            newSelected.delete(recordToRestore.id);
            setSelectedIds(newSelected);

            const destName = recordToRestore.originSheetName || sheetsList.find(s => s.id === targetSheetId)?.name || 'Ø§Ù„Ø´ÙŠØª Ø§Ù„Ø£ØµÙ„ÙŠ';
            showToast(`ØªÙ… Ø§Ø³ØªØ±Ø¯Ø§Ø¯ Ø§Ù„Ø³Ø¬Ù„ Ø¨Ù†Ø¬Ø§Ø­ Ø¥Ù„Ù‰ "${destName}" âœ“`, 'success');
        } catch (err) {
            console.error('Error restoring record:', err);
            showToast('Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«Ù†Ø§Ø¡ Ø§Ø³ØªØ±Ø¯Ø§Ø¯ Ø§Ù„Ø³Ø¬Ù„', 'error');
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
                if (['client_data', 'merchant_data', 'account_data'].includes(destId)) {
                    await syncAccountUsageFromCloudSheets({ [destId]: updatedDest });
                }
            }

            // Remove all restored from trash
            const updatedTrash = records.filter(r => !selectedIds.has(r.id));
            await saveRecords(updatedTrash);
            setSelectedIds(new Set());
            showToast(`ØªÙ… Ø§Ø³ØªØ±Ø¯Ø§Ø¯ ${selectedRecords.length} Ø³Ø¬Ù„ Ø¨Ù†Ø¬Ø§Ø­ Ø¥Ù„Ù‰ Ø´ÙŠØªØ§ØªÙ‡Ø§ Ø§Ù„Ø£ØµÙ„ÙŠØ© âœ“`, 'success');
        } catch (err) {
            console.error('Error in bulk restore:', err);
            showToast('Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«Ù†Ø§Ø¡ Ø§Ø³ØªØ±Ø¯Ø§Ø¯ Ø§Ù„Ø³Ø¬Ù„Ø§Øª', 'error');
        }
    };

    // Empty entire trash
    const handleEmptyTrash = async () => {
        if (records.length === 0) return;
        const confirmed = await showConfirm({
            title: 'Ø¥ÙØ±Ø§Øº Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª',
            message: 'ØªØ­Ø°ÙŠØ±: Ù‡Ù„ Ø£Ù†Øª Ù…ØªØ£ÙƒØ¯ Ù…Ù† Ø±ØºØ¨ØªÙƒ ÙÙŠ Ø¥ÙØ±Ø§Øº Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ØŸ Ø³ÙŠØªÙ… Ø­Ø°Ù Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø³Ø¬Ù„Ø§Øª Ù†Ù‡Ø§Ø¦ÙŠØ§Ù‹ ÙˆÙ„Ø§ ÙŠÙ…ÙƒÙ† Ø§Ù„ØªØ±Ø§Ø¬Ø¹.',
            confirmText: 'Ù†Ø¹Ù…ØŒ Ø¥ÙØ±Ø§Øº Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª',
            cancelText: 'Ø¥Ù„ØºØ§Ø¡',
            type: 'danger'
        });
        if (!confirmed) return;

        saveRecords([]);
        setSelectedIds(new Set());
        showToast('ØªÙ… Ø¥ÙØ±Ø§Øº Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ Ø¨Ù†Ø¬Ø§Ø­', 'info');
    };

    // Quick toggle payment status directly from table
    const handleTogglePaymentStatus = (id) => {
        const updated = records.map(r => {
            if (r.id === id) {
                const nextStatus = r.paymentStatus === 'ØºÙŠØ± Ù…Ø¯ÙÙˆØ¹' ? 'Ù…Ø¯ÙÙˆØ¹' : 'ØºÙŠØ± Ù…Ø¯ÙÙˆØ¹';
                return { ...r, paymentStatus: nextStatus, updated_at: new Date().toISOString() };
            }
            return r;
        });
        saveRecords(updated);
        showToast('ØªÙ… ØªØ­Ø¯ÙŠØ« Ø­Ø§Ù„Ø© Ø§Ù„Ø¯ÙØ¹ Ø¨Ù†Ø¬Ø§Ø­ âœ“', 'success');
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
        if (await saveRecords(updated)) showToast('ØªÙ… ØªØ­Ø¯ÙŠØ« Ø­Ø§Ù„Ø© Ø¨ÙŠØ¹ Ø§Ù„Ø­Ø³Ø§Ø¨ Ø¨Ù†Ø¬Ø§Ø­ âœ“', 'success');
    };

    const handleSetChatGPTUsers = async (id, users) => {
        const updated = records.map(r => {
            if (r.id !== id) return r;
            const currentUses = Math.max(0, Number(users) || 0);
            return {
                ...r,
                currentUses,
                maxUses: Math.max(Number(r.maxUses || 0), currentUses, 1),
                sharedUsers: Math.max(Number(r.sharedUsers || 0), currentUses, 1),
                accountUsageStatus: currentUses <= 0 ? 'available' : 'shared_one_device',
                updated_at: new Date().toISOString()
            };
        });
        if (await saveRecords(updated)) showToast('ChatGPT user count updated', 'success');
    };

    const handleRenewChatGPTAccount = async (id) => {
        const today = getTodayPlainDate();
        const updated = records.map(r => {
            if (r.id !== id) return r;
            return {
                ...r,
                accountCreatedDate: today,
                startDate: today,
                renewalDate: '',
                reminderDays: '30',
                currentUses: 0,
                accountUsageStatus: 'available',
                updated_at: new Date().toISOString()
            };
        });
        if (await saveRecords(updated)) showToast('ChatGPT renewed and user count reset', 'success');
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
        if (await saveRecords(updated)) showToast('ØªÙ… ØªØ­Ø¯ÙŠØ« Ø­Ø§Ù„Ø© ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¹Ø±Ø¶ âœ“', 'success');
    };

    // Delete Selected Records (Bulk soft-delete or permanent delete)
    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;
        if (isTrashSheet) {
            const confirmed = await showConfirm({
                title: 'Ø­Ø°Ù Ø§Ù„Ø³Ø¬Ù„Ø§Øª Ù†Ù‡Ø§Ø¦ÙŠØ§Ù‹',
                message: `Ù‡Ù„ Ø£Ù†Øª Ù…ØªØ£ÙƒØ¯ Ù…Ù† Ø§Ù„Ø­Ø°Ù Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠ Ù„Ù€ ${selectedIds.size} Ø³Ø¬Ù„ Ù…Ø­Ø¯Ø¯ØŸ Ù„Ù† ÙŠÙ…ÙƒÙ† Ø§Ø³ØªØ¹Ø§Ø¯ØªÙ‡Ø§.`,
                confirmText: 'Ù†Ø¹Ù…ØŒ Ø§Ø­Ø°Ù',
                cancelText: 'Ø¥Ù„ØºØ§Ø¡',
                type: 'danger'
            });
            if (!confirmed) return;

            const updated = records.filter(r => !selectedIds.has(r.id));
            saveRecords(updated);
            setSelectedIds(new Set());
            showToast(`ØªÙ… Ø§Ù„Ø­Ø°Ù Ø§Ù„Ù†Ù‡Ø§Ø¦ÙŠ Ù„Ù€ ${selectedIds.size} Ø³Ø¬Ù„ Ø¨Ù†Ø¬Ø§Ø­`, 'info');
        } else {
            const confirmed = await showConfirm({
                title: 'Ù†Ù‚Ù„ Ø¥Ù„Ù‰ Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª',
                message: `Ù‡Ù„ Ø£Ù†Øª Ù…ØªØ£ÙƒØ¯ Ù…Ù† Ù†Ù‚Ù„ ${selectedIds.size} Ø³Ø¬Ù„ Ù…Ø­Ø¯Ø¯ Ø¥Ù„Ù‰ Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§ØªØŸ`,
                confirmText: 'Ù†Ø¹Ù…ØŒ Ø§Ø­Ø°Ù',
                cancelText: 'Ø¥Ù„ØºØ§Ø¡',
                type: 'danger'
            });
            if (!confirmed) return;

            const targetRecords = records.filter(r => selectedIds.has(r.id));
            await moveToTrash(targetRecords, currentSheetId, currentSheet?.name || 'Ø´ÙŠØª');
            const updated = records.filter(r => !selectedIds.has(r.id));
            await saveRecords(updated);
            setSelectedIds(new Set());
            showToast(`ØªÙ… Ù†Ù‚Ù„ ${targetRecords.length} Ø³Ø¬Ù„ Ø¥Ù„Ù‰ Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª Ø¨Ù†Ø¬Ø§Ø­ âœ“`, 'success');
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
            showToast(`ØªÙ…Øª Ø¥Ø¶Ø§ÙØ© ${newItems.length} Ø³Ø¬Ù„ Ø¨Ù†Ø¬Ø§Ø­ âœ“`, 'success');
            setBulkText('');
            setShowBulkModal(false);
        }
    };

    // Export to Excel
    const handleExportExcel = () => {
        if (records.length === 0) {
            showToast('Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¨ÙŠØ§Ù†Ø§Øª Ù„ØªØµØ¯ÙŠØ±Ù‡Ø§', 'warning');
            return;
        }

        let dataToExport;
        if (isTrashSheet) {
            dataToExport = records.map((r, i) => ({
                'Ù…': i + 1,
                'Ø§Ø³Ù… Ø§Ù„Ø¹Ù…ÙŠÙ„': r.name || '',
                'Ø±Ù‚Ù…/ÙŠÙˆØ²Ø± Ø§Ù„ØªÙˆØ§ØµÙ„': r.phone || '',
                'ÙˆØ³ÙŠÙ„Ø© Ø§Ù„ØªÙˆØ§ØµÙ„': r.contactChannel || '',
                'Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ (Email)': r.email || '',
                'Outlook Password': r.password || '',
                'Adobe Password': r.password2 || '',
                'Ø§Ù„Ø´ÙŠØª Ø§Ù„Ø£ØµÙ„ÙŠ': r.originSheetName || '',
                'Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨ (Account)': r.selectedAccount || '',
                'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø­Ø°Ù': r.deletedAt ? new Date(r.deletedAt).toLocaleString('ar-EG') : '',
                'Ù…Ù„Ø§Ø­Ø¸Ø§Øª': r.notes || '',
                'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¥Ø¶Ø§ÙØ©': r.created_at ? new Date(r.created_at).toLocaleString('ar-EG') : ''
            }));
        } else if (isClientOrMerchant) {
            dataToExport = records.map((r, i) => ({
                'Ù…': i + 1,
                'Ø§Ø³Ù… Ø§Ù„Ø¹Ù…ÙŠÙ„': r.name || '',
                'Ø±Ù‚Ù…/ÙŠÙˆØ²Ø± Ø§Ù„ØªÙˆØ§ØµÙ„': r.phone || '',
                'ÙˆØ³ÙŠÙ„Ø© Ø§Ù„ØªÙˆØ§ØµÙ„': r.contactChannel || '',
                'Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ (Email)': r.email || '',
                'Outlook Password': r.password || '',
                'Adobe Password': r.password2 || '',
                'Ù…Ø¯Ø© Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ (Duration)': r.duration || '',
                'ØªØ§Ø±ÙŠØ® Ø¨Ø¯Ø§ÙŠØ© Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ (Start Date)': r.startDate || '',
                'Ù†ÙˆØ¹ Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ (Device Type)': r.deviceType || 'Ø¬Ù‡Ø§Ø²',
                'Ø­Ø§Ù„Ø© Ø§Ù„Ø¯ÙØ¹ (Payment Status)': r.paymentStatus || 'Ù…Ø¯ÙÙˆØ¹',
                'Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨ (Account)': r.selectedAccount || '',
                'Ù…Ù„Ø§Ø­Ø¸Ø§Øª': r.notes || '',
                'ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¥Ø¶Ø§ÙØ©': r.created_at ? new Date(r.created_at).toLocaleString('ar-EG') : ''
            }));
        } else {
            dataToExport = records.map((r, i) => {
                const base = {
                    'Ù…': i + 1,
                    'Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ (Email)': r.email || '',
                    'ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± 1 (Password)': r.password || '',
                    'ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± 2 (Password 2)': r.password2 || '',
                    'Ø±Ù‚Ù… Ø§Ù„ÙØ§ØªÙˆØ±Ø© (Invoice)': r.invoiceNumber || '',
                    'Ø§Ù„ÙÙŠØ²Ø§ (Visa)': r.visa || '',
                    'Edu Mail': r.visaAccount || ''
                };
                if (currentSheetId === 'account_data') {
                    const rem = getAccountReminder(r);
                    base['ØªØ§Ø±ÙŠØ® Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ø­Ø³Ø§Ø¨ (Creation Date)'] = r.accountCreatedDate || '';
                    base['ÙØªØ±Ø© Ø§Ù„ØªØ°ÙƒÙŠØ± Ø¨Ø§Ù„Ø£ÙŠØ§Ù… (Reminder Days)'] = r.reminderDays || '';
                    base['Ø­Ø§Ù„Ø© Ø§Ù„ØªØ°ÙƒÙŠØ±'] = rem.text || '';
                    base['ØªÙ… ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¹Ø±Ø¶'] = r.offerActivated ? 'ØªÙ…' : 'Ù„Ù… ÙŠØªÙ…';
                    base['ØªØ§Ø±ÙŠØ® ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¹Ø±Ø¶'] = r.offerActivatedAt ? new Date(r.offerActivatedAt).toLocaleString('ar-EG') : '';
                } else {
                    base['Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨ (Account)'] = r.selectedAccount || '';
                }
                base['Ù…Ù„Ø§Ø­Ø¸Ø§Øª'] = r.notes || '';
                base['ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¥Ø¶Ø§ÙØ©'] = r.created_at ? new Date(r.created_at).toLocaleString('ar-EG') : '';
                return base;
            });
        }

        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, currentSheet.name);
        XLSX.writeFile(wb, `${currentSheet.name}_${new Date().toISOString().slice(0, 10)}.xlsx`);
        showToast('ØªÙ… ØªØµØ¯ÙŠØ± Ù…Ù„Ù Excel Ø¨Ù†Ø¬Ø§Ø­ âœ“', 'success');
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
        showToast('ØªÙ… Ø­ÙØ¸ Ù†Ø³Ø®Ø© Ø§Ø­ØªÙŠØ§Ø·ÙŠØ© Ø´Ø§Ù…Ù„Ø© Ù„Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø´ÙŠØªØ§Øª Ø¨Ù†Ø¬Ø§Ø­ âœ“', 'success');
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
                        showToast('ØªÙ… Ø§Ø³ØªØ¹Ø§Ø¯Ø© Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø´ÙŠØªØ§Øª Ù…Ù† Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠØ© Ø¨Ù†Ø¬Ø§Ø­ âœ“', 'success');
                    } else if (Array.isArray(parsed)) {
                        // Single sheet
                        saveRecords([...parsed, ...records]);
                        showToast(`ØªÙ… Ø§Ø³ØªÙŠØ±Ø§Ø¯ ${parsed.length} Ø³Ø¬Ù„ Ø¨Ù†Ø¬Ø§Ø­ âœ“`, 'success');
                    }
                } catch (err) {
                    showToast('Ù…Ù„Ù Ø§Ù„Ù†Ø³Ø® Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠ ØºÙŠØ± ØµØ§Ù„Ø­', 'error');
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
                        showToast('Ø§Ù„Ù…Ù„Ù ÙØ§Ø±Øº Ø£Ùˆ Ù„Ø§ ÙŠØ­ØªÙˆÙŠ Ø¹Ù„Ù‰ ØµÙÙˆÙ Ø¨ÙŠØ§Ù†Ø§Øª', 'warning');
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
                        showToast(`ØªÙ… Ø§Ø³ØªÙŠØ±Ø§Ø¯ ${imported.length} Ø³Ø¬Ù„ Ù…Ù† Ù…Ù„Ù Ø§Ù„Ø¥ÙƒØ³ÙŠÙ„ Ø¨Ù†Ø¬Ø§Ø­ âœ“`, 'success');
                    } else {
                        showToast('Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ Ø³Ø¬Ù„Ø§Øª ØµØ§Ù„Ø­Ø© Ù„Ù„Ø§Ø³ØªÙŠØ±Ø§Ø¯', 'warning');
                    }
                } catch (err) {
                    console.error(err);
                    showToast('Ø­Ø¯Ø« Ø®Ø·Ø£ Ø£Ø«Ù†Ø§Ø¡ Ù‚Ø±Ø§Ø¡Ø© Ù…Ù„Ù Ø§Ù„Ø¥ÙƒØ³ÙŠÙ„', 'error');
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
        showToast('ØªÙ… ØªØ­Ø¯ÙŠØ« Ø§Ø³Ù… Ø§Ù„Ø´ÙŠØª Ø¨Ù†Ø¬Ø§Ø­ âœ“', 'success');
    };

    // Subscriptions & Account Alert Groups (Ù‚Ø±Ø¨ Ø§Ù„ØªØ¬Ø¯ÙŠØ¯ / Ø§Ù„ØªØ°ÙƒÙŠØ± ÙÙŠ Ø¢Ø®Ø± 3 Ø£ÙŠØ§Ù…ØŒ ÙˆÙ…Ù†ØªÙ‡ÙŠ/Ù…Ø³ØªØ­Ù‚ØŒ ÙˆØ³Ø§Ø±ÙŠ)
    const alertGroups = useMemo(() => {
        if (currentSheetId === 'trash_data') {
            return { nearRenewal: [], expired: [], active: [] };
        }

        const nearRenewal = [];
        const expired = [];
        const active = [];

        const sourceRecords = currentSheetId === 'account_data'
            ? records.filter(r => getAccountCategory(r) === activeAccountCategory)
            : records;

        sourceRecords.forEach(r => {
            if ((currentSheetId === 'account_data' || currentSheetId === 'reminders_data') && r.offerActivated) return;

            const rem = (currentSheetId === 'account_data' || currentSheetId === 'reminders_data')
                ? getAccountReminder(r)
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
    }, [records, currentSheetId, activeAccountCategory]);

    // Filter & Search (bulletproof against numbers and nulls)
    const filteredRecords = useMemo(() => {
        let result = records;

        if (currentSheetId === 'account_data') {
            result = result.filter(r => getAccountCategory(r) === activeAccountCategory);
            if (accountStockFilter !== 'all') {
                result = result.filter(r => {
                    const currentUses = Math.max(0, Number(r.currentUses || 0));
                    const maxUses = Math.max(1, Number(r.maxUses || 2));
                    if (accountStockFilter === 'returned') return isReusedAccount(r);
                    if (accountStockFilter === 'available') return currentUses <= 0;
                    if (accountStockFilter === 'partial') return currentUses > 0 && currentUses < maxUses;
                    if (accountStockFilter === 'full') return currentUses >= maxUses;
                    return true;
                });
            }
        }

        // Filter by Expiry Status Tab (All, Near Renewal, Expired, Active)
        if ((currentSheetId === 'account_data' || currentSheetId === 'reminders_data') && offerReminderFilter !== 'all') {
            result = result.filter(r => {
                if (offerReminderFilter === 'completed') return !!r.offerActivated;
                if (offerReminderFilter === 'pending') return !r.offerActivated;
                if (r.offerActivated) return false;
                const rem = getAccountReminder(r);
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
                    ? getAccountReminder(r)
                    : calculateRemainingTime(r.startDate, r.duration, r.created_at);
                return rem.days !== null && rem.days >= 0 && rem.days <= 3 && rem.status !== 'lifetime';
            });
        } else if (expiryFilter === 'expired') {
            result = result.filter(r => {
                if ((currentSheetId === 'account_data' || currentSheetId === 'reminders_data') && r.offerActivated) return false;
                const rem = (currentSheetId === 'account_data' || currentSheetId === 'reminders_data')
                    ? getAccountReminder(r)
                    : calculateRemainingTime(r.startDate, r.duration, r.created_at);
                return rem.days !== null && rem.days < 0;
            });
        } else if (expiryFilter === 'active') {
            result = result.filter(r => {
                const rem = (currentSheetId === 'account_data' || currentSheetId === 'reminders_data')
                    ? getAccountReminder(r)
                    : calculateRemainingTime(r.startDate, r.duration, r.created_at);
                return rem.days > 3 || rem.status === 'lifetime';
            });
        }

        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase().trim();
            result = result.filter(r => {
                const rem = (currentSheetId === 'account_data' || currentSheetId === 'reminders_data')
                    ? getAccountReminder(r)
                    : calculateRemainingTime(r.startDate, r.duration, r.created_at);
                return (
                    String(r.email || '').toLowerCase().includes(q) ||
                    String(r.name || '').toLowerCase().includes(q) ||
                    String(r.phone || '').toLowerCase().includes(q) ||
                    String(r.contactChannel || '').toLowerCase().includes(q) ||
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
                    String(r.notes || '').toLowerCase().includes(q) ||
                    String(r.accountCategory || '').toLowerCase().includes(q) ||
                    String(r.capcutMonths || '').toLowerCase().includes(q) ||
                    String(r.renewalDate || '').toLowerCase().includes(q) ||
                    String(r.sharedUsers || '').toLowerCase().includes(q) ||
                    String(r.twoFaLink || '').toLowerCase().includes(q)
                );
            });
        }

        // Advanced filters: paymentStatus filter
        if (paymentFilter !== 'all' && isClientOrMerchant) {
            result = result.filter(r => {
                const status = String(r.paymentStatus || 'Ù…Ø¯ÙÙˆØ¹').toLowerCase();
                if (paymentFilter === 'paid') return status === 'Ù…Ø¯ÙÙˆØ¹';
                if (paymentFilter === 'unpaid') return status !== 'Ù…Ø¯ÙÙˆØ¹';
                return true;
            });
        }

        // Advanced filters: deviceType filter (Ø´Ø®ØµÙŠ Ø£Ù… Ù…Ø´ØªØ±Ùƒ)
        if (deviceFilter !== 'all' && isClientOrMerchant) {
            result = result.filter(r => {
                const dev = String(r.deviceType || '').trim();
                if (deviceFilter === 'Ø´Ø®ØµÙŠ') {
                    return dev === 'Ø´Ø®ØµÙŠ' || dev === 'Ø¬Ù‡Ø§Ø²ÙŠÙ†';
                }
                if (deviceFilter === 'Ù…Ø´ØªØ±Ùƒ') {
                    return dev === 'Ù…Ø´ØªØ±Ùƒ' || dev === 'Ø¬Ù‡Ø§Ø²' || dev === '' || (!r.deviceType);
                }
                return dev === deviceFilter;
            });
        }

        if (renewalFilter !== 'all' && isClientOrMerchant) {
            result = result.filter(r => {
                const notRenewed = r.renewalStatus === 'not_renewed' || Boolean(r.nonRenewedAt);
                return renewalFilter === 'not_renewed' ? notRenewed : !notRenewed;
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
                const daysA = getAccountReminder(a).days ?? -999999;
                const daysB = getAccountReminder(b).days ?? -999999;
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
    }, [records, searchTerm, sortBy, expiryFilter, offerReminderFilter, currentSheetId, activeAccountCategory, paymentFilter, deviceFilter, renewalFilter, accountStockFilter, isClientOrMerchant]);

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

        const sourceRecords = currentSheetId === 'account_data'
            ? records.filter(r => getAccountCategory(r) === activeAccountCategory)
            : records;

        return sourceRecords.reduce((acc, r) => {
            if (r.offerActivated) {
                acc.completed += 1;
                return acc;
            }
            const rem = getAccountReminder(r);
            if (rem.days === null) return acc;
            acc.pending += 1;
            if (rem.days > 0 && rem.days <= 3) acc.near3 += 1;
            if (rem.days === 0) acc.today += 1;
            if (rem.days < 0) acc.overdue += 1;
            return acc;
        }, { pending: 0, near3: 0, today: 0, overdue: 0, completed: 0 });
    }, [records, currentSheetId, activeAccountCategory]);

    // Stats calculations
    const stats = useMemo(() => {
        const statRecords = currentSheetId === 'account_data'
            ? records.filter(r => getAccountCategory(r) === activeAccountCategory)
            : records;
        const total = statRecords.length;
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

        const withInvoices = statRecords.filter(r => r.invoiceNumber).length;
        const withVisa = statRecords.filter(r => r.visa).length;
        const withVisaAccount = statRecords.filter(r => r.visaAccount).length;
        const withDuration = statRecords.filter(r => r.duration).length;
        const withBothPasswords = statRecords.filter(r => r.password && r.password2).length;
        const withEmail = statRecords.filter(r => r.email).length;
        const withReminder = statRecords.filter(r => r.reminderDays && parseInt(r.reminderDays) > 0).length;
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
    }, [records, alertGroups, currentSheetId, offerReminderStats, activeAccountCategory]);

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
                            {isTrashSheet ? 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ù…Ø­Ø°ÙˆÙØ§Øª' : 'Ø¥Ø¬Ù…Ø§Ù„ÙŠ Ø§Ù„Ø³Ø¬Ù„Ø§Øª'}
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
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Ø­Ø³Ø§Ø¨Ø§Øª Ù…Ø­Ø°ÙˆÙØ©</p>
                                <h4 className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">{stats.accountsCount}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-user-gear"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Ø¹Ù…Ù„Ø§Ø¡ Ù…Ø­Ø°ÙˆÙÙŠÙ†</p>
                                <h4 className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1">{stats.clientsCount}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-users"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">ØªØ¬Ø§Ø± Ù…Ø­Ø°ÙˆÙÙŠÙ†</p>
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
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Ù…Ø¯Ø© Ø§Ø´ØªØ±Ø§Ùƒ Ù…Ø³Ø¬Ù„Ø©</p>
                                <h4 className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{stats.withDuration}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl">
                                <i className="fa-regular fa-clock"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Ø¨Ø§Ø³ÙˆØ±Ø¯ Ø£ÙˆÙ„ ÙˆØ«Ø§Ù†Ù</p>
                                <h4 className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">{stats.withBothPasswords}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-shield-halved"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Ø¥ÙŠÙ…ÙŠÙ„Ø§Øª Ù…Ø³Ø¬Ù„Ø©</p>
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
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">ØªØ°ÙƒÙŠØ±Ø§Øª Ø§Ù„ÙŠÙˆÙ… â°</p>
                                <h4 className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1">{stats.todayCount}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-bell"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Ù‚Ø§Ø¯Ù…Ø© Ø®Ù„Ø§Ù„ 3 Ø£ÙŠØ§Ù…</p>
                                <h4 className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{stats.nearCount}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-clock"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">ØªÙ… Ø¥Ù†Ø¬Ø§Ø²Ù‡Ø§</p>
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
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Ø­Ø³Ø§Ø¨Ø§Øª Ø¨ØªØ°ÙƒÙŠØ± Ù…Ø­Ø¯Ø¯</p>
                                <h4 className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">{stats.withReminder}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-bell"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">ØªØ°ÙƒÙŠØ±Ø§Øª Ù‚Ø±ÙŠØ¨Ø© / Ù…Ø³ØªØ­Ù‚Ø©</p>
                                <h4 className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{stats.nearCount + stats.expiredCount}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-triangle-exclamation"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Ø¥ÙŠÙ…ÙŠÙ„Ø§Øª Ù…Ø³Ø¬Ù„Ø©</p>
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
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Ø³Ø¬Ù„Ø§Øª Ø¨ÙÙˆØ§ØªÙŠØ±</p>
                                <h4 className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{stats.withInvoices}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-receipt"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Ø³Ø¬Ù„Ø§Øª Ø¨ÙÙŠØ²Ø§</p>
                                <h4 className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{stats.withVisa}</h4>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl">
                                <i className="fa-solid fa-credit-card"></i>
                            </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
                            <div>
                                <p className="text-xs font-bold text-slate-400 dark:text-slate-500">Ø­Ø³Ø§Ø¨Ø§Øª Ø§Ù„ÙÙŠØ²Ø§</p>
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
                                        title="ØªØ¹Ø¯ÙŠÙ„ Ø§Ø³Ù… Ø§Ù„Ø´ÙŠØª"
                                    >
                                        <i className="fa-solid fa-pen-to-square"></i>
                                    </button>
                                )}
                            </div>
                            <p className="text-xs text-slate-400 dark:text-slate-500">
                                {isTrashSheet
                                    ? 'Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª: Ø§Ø³ØªØ¹Ø±Ø§Ø¶ Ø§Ù„Ø­Ø³Ø§Ø¨Ø§Øª ÙˆØ§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ù…Ø­Ø°ÙˆÙØ© Ù…Ø¹ Ø¥Ù…ÙƒØ§Ù†ÙŠØ© Ø§Ø³ØªØ±Ø¯Ø§Ø¯Ù‡Ø§ Ù„Ù„Ø´ÙŠØª Ø§Ù„Ø£ØµÙ„ÙŠ Ø£Ùˆ Ø­Ø°ÙÙ‡Ø§ Ù†Ù‡Ø§Ø¦ÙŠØ§Ù‹'
                                    : currentSheetId === 'reminders_data'
                                    ? 'Ø¬Ø¯ÙˆÙ„ Ø§Ù„ØªØ°ÙƒÙŠØ±Ø§Øª ÙˆØ§Ù„Ù…Ù‡Ø§Ù…: ØªØ°ÙƒÙŠØ± Ø¨Ù…ÙˆØ§Ø¹ÙŠØ¯ Ø§Ù„ØªØ¬Ø¯ÙŠØ¯Ø§Øª ÙˆØ§Ù„Ø§Ù„ØªØ²Ø§Ù…Ø§Øª Ø§Ù„Ù‡Ø§Ù…Ø© ÙÙŠ Ø£ÙŠØ§Ù… Ù…Ø­Ø¯Ø¯Ø© Ù„ØªØ¬Ù†Ø¨ Ù†Ø³ÙŠØ§Ù†Ù‡Ø§'
                                    : isClientOrMerchant
                                    ? 'Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡ ÙˆØ§Ù„Ø§Ø´ØªØ±Ø§ÙƒØ§Øª'
                                    : currentSheetId === 'account_data'
                                    ? 'Ø§Ù„Ø­Ø³Ø§Ø¨Ø§Øª Ø§Ù„Ù…ØªØ§Ø­Ø© ÙˆØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¹Ø±ÙˆØ¶'
                                    : 'Ø§Ù„Ø³Ø¬Ù„Ø§Øª'}
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
                                        title="Ø­Ø°Ù Ø¬Ù…ÙŠØ¹ Ø§Ù„Ø³Ø¬Ù„Ø§Øª ÙÙŠ Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª Ù†Ù‡Ø§Ø¦ÙŠØ§Ù‹"
                                    >
                                        <i className="fa-solid fa-trash-can"></i>
                                        <span>Ø¥ÙØ±Ø§Øº Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª</span>
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
                                            name: '',
                                            phone: '',
                                            contactChannel: 'ÙˆØ§ØªØ³Ø§Ø¨',
                                            email: '',
                                            password: currentSheetId === 'reminders_data' ? 'ðŸ”´ Ø¹Ø§Ø¬Ù„ Ø¬Ø¯Ø§Ù‹' : '',
                                            password2: '',
                                            duration: '',
                                            startDate: new Date().toISOString().slice(0, 10),
                                            deviceType: 'Ù…Ø´ØªØ±Ùƒ',
                                            paymentStatus: 'Ù…Ø¯ÙÙˆØ¹',
                                            selectedAccount: '',
                                            invoiceNumber: '',
                                            visa: '',
                                            visaAccount: '',
                                            notes: '',
                                            accountCreatedDate: new Date().toISOString().slice(0, 10),
                                            reminderDays: currentSheetId === 'reminders_data' ? '0' : '20',
                                            accountCategory: activeAccountCategory,
                                            capcutMode: '',
                                            capcutGiftUsed: false,
                                            capcutMonthlyReminder: activeAccountCategory === 'capcut',
                                            capcutMonths: activeAccountCategory === 'capcut' ? 2 : 1,
                                            sharedUsers: 1,
                                            renewalDate: '',
                                            twoFaLink: ''
                                        });
                                        setShowAddModal(true);
                                    }}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition transform active:scale-95 cursor-pointer"
                                >
                                    <i className="fa-solid fa-plus"></i>
                                    <span>{currentSheetId === 'reminders_data' ? 'Ø¥Ø¶Ø§ÙØ© ØªØ°ÙƒÙŠØ± Ø¬Ø¯ÙŠØ¯' : 'Ø¥Ø¶Ø§ÙØ© Ø¨ÙŠØ§Ù†Ø§Øª Ø¬Ø¯ÙŠØ¯Ø©'}</span>
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
                                    ? "Ø¨Ø­Ø« ÙÙŠ Ø¹Ù†ÙˆØ§Ù† Ø§Ù„ØªØ°ÙƒÙŠØ±ØŒ Ø§Ù„Ø£ÙˆÙ„ÙˆÙŠØ©ØŒ Ø§Ù„ØªØ§Ø±ÙŠØ®ØŒ Ø§Ù„Ù…Ù„Ø§Ø­Ø¸Ø§Øª..."
                                    : isClientOrMerchant
                                    ? "Ø¨Ø­Ø« ÙÙŠ Ø§Ù„Ø¥ÙŠÙ…ÙŠÙ„ØŒ Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯ØŒ Ù…Ø¯Ø© Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ..."
                                    : currentSheetId === 'account_data'
                                    ? "Ø¨Ø­Ø« ÙÙŠ Ø§Ù„Ø¥ÙŠÙ…ÙŠÙ„ØŒ Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯ØŒ ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡ØŒ Ø§Ù„ØªØ°ÙƒÙŠØ±ØŒ Ø§Ù„Ù…Ù„Ø§Ø­Ø¸Ø§Øª..."
                                    : "Ø¨Ø­Ø« ÙÙŠ Ø§Ù„Ø¥ÙŠÙ…ÙŠÙ„ØŒ Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯ØŒ Ø§Ù„ÙØ§ØªÙˆØ±Ø©ØŒ Ø§Ù„ÙÙŠØ²Ø§ØŒ Ø§Ù„Ù…Ù„Ø§Ø­Ø¸Ø§Øª..."
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
                            <span className="text-xs text-slate-400 font-bold hidden sm:inline">Ø¹Ø±Ø¶:</span>
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
                                <option value="all">Ø§Ù„ÙƒÙ„</option>
                            </select>
                        </div>
                    </div>
                </div>

                {currentSheetId === 'account_data' && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-3">
                        {ACCOUNT_CATEGORIES.map(cat => {
                            const active = activeAccountCategory === cat.id;
                            const count = records.filter(r => getAccountCategory(r) === cat.id).length;
                            return (
                                <button
                                    key={cat.id}
                                    type="button"
                                    onClick={() => {
                                        setActiveAccountCategory(cat.id);
                                        setCurrentPage(1);
                                        setSelectedIds(new Set());
                                        setOfferReminderFilter('all');
                                    }}
                                    className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-right transition ${
                                        active
                                            ? 'bg-slate-900 text-white border-slate-900 shadow-md dark:bg-indigo-600 dark:border-indigo-500'
                                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-750'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${active ? 'bg-white/15 text-white' : 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 border border-slate-200 dark:border-slate-700'}`}>
                                            <i className={`fa-solid ${cat.icon}`}></i>
                                        </span>
                                        <span>
                                            <span className="block text-sm font-black">{cat.label}</span>
                                            <span className={`block text-[10px] font-bold ${active ? 'text-white/70' : 'text-slate-400'}`}>{cat.hint}</span>
                                        </span>
                                    </div>
                                    <span className={`min-w-7 h-7 px-2 rounded-full inline-flex items-center justify-center text-xs font-black ${active ? 'bg-white/20 text-white' : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700'}`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}

                {currentSheetId === 'reminders_data' && (
                    <div className="flex flex-wrap items-center gap-2 pt-3">
                        {[
                            { id: 'all', label: 'ÙƒÙ„ Ø§Ù„ØªØ°ÙƒÙŠØ±Ø§Øª', count: records.length, icon: 'fa-list', cls: 'slate' },
                            { id: 'pending', label: 'Ù‚ÙŠØ¯ Ø§Ù„Ø§Ù†ØªØ¸Ø§Ø±', count: offerReminderStats.pending, icon: 'fa-hourglass-half', cls: 'purple' },
                            { id: 'today', label: 'ØªØ°ÙƒÙŠØ±Ø§Øª Ø§Ù„ÙŠÙˆÙ…', count: offerReminderStats.today, icon: 'fa-bell', cls: 'red' },
                            { id: 'near3', label: 'Ù‚Ø§Ø¯Ù…Ø© Ø®Ù„Ø§Ù„ 3 Ø£ÙŠØ§Ù…', count: offerReminderStats.near3, icon: 'fa-clock', cls: 'amber' },
                            { id: 'overdue', label: 'Ù…ØªØ£Ø®Ø±Ø©', count: offerReminderStats.overdue, icon: 'fa-triangle-exclamation', cls: 'rose' },
                            { id: 'completed', label: 'ØªÙ… Ø§Ù„Ø¥Ù†Ø¬Ø§Ø²', count: offerReminderStats.completed, icon: 'fa-circle-check', cls: 'emerald' },
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
                            { id: 'all', label: 'ÙƒÙ„ Ø§Ù„Ø³Ø¬Ù„Ø§Øª', count: records.length, icon: 'fa-list', cls: 'slate' },
                            { id: 'pending', label: 'Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø±Ø¶', count: offerReminderStats.pending, icon: 'fa-bolt', cls: 'purple' },
                            { id: 'near3', label: 'Ù‚Ø±Ø¨ Ø®Ù„Ø§Ù„ 3 Ø£ÙŠØ§Ù…', count: offerReminderStats.near3, icon: 'fa-clock', cls: 'amber' },
                            { id: 'today', label: 'Ù…ÙŠØ¹Ø§Ø¯Ù‡ Ø§Ù„ÙŠÙˆÙ…', count: offerReminderStats.today, icon: 'fa-bell', cls: 'red' },
                            { id: 'overdue', label: 'Ø¹Ø¯Ù‰ Ø¨Ø¯ÙˆÙ† ØªÙØ¹ÙŠÙ„', count: offerReminderStats.overdue, icon: 'fa-triangle-exclamation', cls: 'rose' },
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
            {(isClientOrMerchant || currentSheetId === 'account_data') && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                    <button
                        type="button"
                        onClick={() => setShowAdvancedFilters(v => !v)}
                        className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
                    >
                        <div className="flex items-center gap-2">
                            <i className="fa-solid fa-sliders text-indigo-500"></i>
                            <span>ÙÙ„Ø§ØªØ± Ù…ØªÙ‚Ø¯Ù…Ø©</span>
                            {(paymentFilter !== 'all' || deviceFilter !== 'all' || renewalFilter !== 'all' || accountStockFilter !== 'all') && (
                                <span className="bg-indigo-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full animate-pulse">
                                    {[paymentFilter !== 'all' ? 1 : 0, deviceFilter !== 'all' ? 1 : 0, renewalFilter !== 'all' ? 1 : 0, accountStockFilter !== 'all' ? 1 : 0].reduce((a,b)=>a+b,0)} ÙØ¹Ù‘Ø§Ù„
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
                                    Ø­Ø§Ù„Ø© Ø§Ù„Ø¯ÙØ¹
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        { id: 'all', label: 'Ø§Ù„ÙƒÙ„', icon: 'fa-list' },
                                        { id: 'paid', label: 'âœ… Ù…Ø¯ÙÙˆØ¹', icon: 'fa-check-circle' },
                                        { id: 'unpaid', label: 'âŒ ØºÙŠØ± Ù…Ø¯ÙÙˆØ¹', icon: 'fa-times-circle' },
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
                                    <i className="fa-solid fa-users-gear text-blue-500"></i>
                                    Ù†ÙˆØ¹ Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        { id: 'all', label: 'Ø§Ù„ÙƒÙ„' },
                                        { id: 'Ø´Ø®ØµÙŠ', label: 'ðŸ›¡ï¸ Ø´Ø®ØµÙŠ' },
                                        { id: 'Ù…Ø´ØªØ±Ùƒ', label: 'ðŸ’» Ù…Ø´ØªØ±Ùƒ' },
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

                            {currentSheetId === 'account_data' && (
                                <div>
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                        <i className="fa-solid fa-boxes-stacked text-orange-500"></i>
                                        Account stock filter
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {[
                                            { id: 'all', label: 'All' },
                                            { id: 'returned', label: 'Returned / not renewed' },
                                            { id: 'available', label: 'Available' },
                                            { id: 'partial', label: 'Partial' },
                                            { id: 'full', label: 'Full' },
                                        ].map(opt => (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => { setAccountStockFilter(opt.id); setCurrentPage(1); }}
                                                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition ${accountStockFilter === opt.id ? 'bg-orange-600 text-white border-orange-600' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-orange-50 dark:hover:bg-orange-900/20'}`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {(isClientOrMerchant || currentSheetId === 'account_data') && (
                                <div>
                                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                        <i className="fa-solid fa-user-clock text-rose-500"></i>
                                        Renewal status
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {[
                                            { id: 'all', label: 'All' },
                                            { id: 'renewed', label: 'Active / renewed' },
                                            { id: 'not_renewed', label: 'Not renewed' },
                                        ].map(opt => (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => { setRenewalFilter(opt.id); setCurrentPage(1); }}
                                                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition ${renewalFilter === opt.id ? 'bg-rose-600 text-white border-rose-600' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-rose-50 dark:hover:bg-rose-900/20'}`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {/* Reset All Filters */}
                            {(paymentFilter !== 'all' || deviceFilter !== 'all' || renewalFilter !== 'all' || accountStockFilter !== 'all') && (
                                <div className="sm:col-span-2">
                                    <button
                                        type="button"
                                        onClick={() => { setPaymentFilter('all'); setDeviceFilter('all'); setRenewalFilter('all'); setAccountStockFilter('all'); setCurrentPage(1); }}
                                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 text-[11px] font-bold hover:bg-rose-100 transition"
                                    >
                                        <i className="fa-solid fa-rotate-right"></i>
                                        Ø¥Ø¹Ø§Ø¯Ø© ØªØ¹ÙŠÙŠÙ† Ø§Ù„ÙÙ„Ø§ØªØ± Ø§Ù„Ù…ØªÙ‚Ø¯Ù…Ø©
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
                                                <span>Ø¹Ù†ÙˆØ§Ù† Ø§Ù„ØªØ°ÙƒÙŠØ± ÙˆØ§Ù„Ù…Ù‡Ù…Ø©</span>
                                                <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                            </div>
                                        </th>
                                        <th className="px-2 py-1.5 text-center">Ø§Ù„Ø£ÙˆÙ„ÙˆÙŠØ© / Ø§Ù„ØªØµÙ†ÙŠÙ</th>
                                        <th
                                            onClick={() => setSortBy({ field: 'accountCreatedDate', asc: sortBy.field === 'accountCreatedDate' ? !sortBy.asc : true })}
                                            className="px-2 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                        >
                                            <div className="flex items-center gap-1">
                                                <span>Ù…ÙˆØ¹Ø¯ Ø§Ù„ØªØ°ÙƒÙŠØ±</span>
                                                <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                            </div>
                                        </th>
                                        <th
                                            onClick={() => setSortBy({ field: 'accountReminderDays', asc: sortBy.field === 'accountReminderDays' ? !sortBy.asc : true })}
                                            className="px-2 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                        >
                                            <div className="flex items-center gap-1">
                                                <span>Ø§Ù„Ø­Ø§Ù„Ø© ÙˆØ§Ù„Ù…ØªØ¨Ù‚ÙŠ</span>
                                                <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                            </div>
                                        </th>
                                        <th className="px-2 py-1.5">Ø§Ù„Ù…Ù„Ø§Ø­Ø¸Ø§Øª ÙˆØ§Ù„ØªÙØ§ØµÙŠÙ„</th>
                                    </>
                                ) : (
                                    <>
                                        {currentSheetId === 'client_data' && (
                                            <>
                                                <th
                                                    onClick={() => setSortBy({ field: 'name', asc: sortBy.field === 'name' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>Ø§Ø³Ù… Ø§Ù„Ø¹Ù…ÙŠÙ„</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'phone', asc: sortBy.field === 'phone' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>Ø§Ù„ØªÙˆØ§ØµÙ„</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th className="px-1.5 py-1.5">Ø§Ù„ÙˆØ³ÙŠÙ„Ø©</th>
                                            </>
                                        )}
                                        <th
                                            onClick={() => setSortBy({ field: 'email', asc: sortBy.field === 'email' ? !sortBy.asc : true })}
                                            className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                        >
                                            <div className="flex items-center gap-1">
                                                <span>Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ</span>
                                                <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                            </div>
                                        </th>
                                        <th className="px-1 py-1.5">
                                            {currentSheetId === 'account_data' && (activeAccountCategory === 'capcut' || activeAccountCategory === 'chatgpt_shared') ? 'Password' : 'Outlook Password'}
                                        </th>
                                        <th className="px-1 py-1.5">
                                            {currentSheetId === 'account_data' && activeAccountCategory === 'capcut'
                                                ? 'Subscription'
                                            : currentSheetId === 'account_data' && activeAccountCategory === 'chatgpt_shared'
                                                ? '2FA Link'
                                                : 'Adobe Password'}
                                        </th>
                                        {isTrashSheet ? (
                                            <>
                                                <th
                                                    onClick={() => setSortBy({ field: 'originSheetName', asc: sortBy.field === 'originSheetName' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-rose-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>Ø§Ù„Ø´ÙŠØª Ø§Ù„Ø£ØµÙ„ÙŠ</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'deletedAt', asc: sortBy.field === 'deletedAt' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-rose-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>ØªØ§Ø±ÙŠØ® Ø§Ù„Ø­Ø°Ù</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'selectedAccount', asc: sortBy.field === 'selectedAccount' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-purple-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨</span>
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
                                                        <span>Ù…Ø¯Ø© Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'remainingDays', asc: sortBy.field === 'remainingDays' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>Ø§Ù„Ù…Ø¯Ø© Ø§Ù„Ù…ØªØ¨Ù‚ÙŠØ©</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'deviceType', asc: sortBy.field === 'deviceType' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>Ù†ÙˆØ¹ Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'paymentStatus', asc: sortBy.field === 'paymentStatus' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>Ø­Ø§Ù„Ø© Ø§Ù„Ø¯ÙØ¹</span>
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
                                                        <span>ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'accountReminderDays', asc: sortBy.field === 'accountReminderDays' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>Ø§Ù„ØªØ°ÙƒÙŠØ±</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'currentUses', asc: sortBy.field === 'currentUses' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø§Ù„Ø­Ø³Ø§Ø¨</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th className="px-1.5 py-1.5">ØªÙØ§ØµÙŠÙ„ Ø§Ù„Ù†ÙˆØ¹</th>
                                            </>
                                        ) : (
                                            <>
                                                <th
                                                    onClick={() => setSortBy({ field: 'invoiceNumber', asc: sortBy.field === 'invoiceNumber' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>Ø±Ù‚Ù… Ø§Ù„ÙØ§ØªÙˆØ±Ø©</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                                <th className="px-1.5 py-1.5">Ø§Ù„ÙÙŠØ²Ø§</th>
                                                <th className="px-1.5 py-1.5">Edu Mail</th>
                                                <th
                                                    onClick={() => setSortBy({ field: 'selectedAccount', asc: sortBy.field === 'selectedAccount' ? !sortBy.asc : true })}
                                                    className="px-1.5 py-1.5 cursor-pointer hover:text-indigo-600 transition"
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span>Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨</span>
                                                        <i className="fa-solid fa-sort text-[8px] text-slate-400"></i>
                                                    </div>
                                                </th>
                                            </>
                                        )}
                                    </>
                                )}
                                <th className="px-1 py-1.5 text-center w-12 text-[11px]">Ø¥Ø¬Ø±Ø§Ø¡Ø§Øª</th>
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-slate-700 dark:text-slate-300">
                            {paginatedRecords.length === 0 ? (
                                <tr>
                                    <td colSpan={isTrashSheet ? 8 : (currentSheetId === 'reminders_data' ? 6 : (currentSheetId === 'client_data' ? 12 : (isClientOrMerchant ? 9 : (currentSheetId === 'account_data' ? 9 : 9))))} className="p-12 text-center text-slate-400">
                                        <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 text-2xl">
                                            <i className={`fa-solid ${isTrashSheet ? 'fa-trash-can text-rose-400' : (currentSheetId === 'reminders_data' ? 'fa-bell text-amber-500' : 'fa-folder-open')}`}></i>
                                        </div>
                                        <p className="font-bold text-sm">
                                            {isTrashSheet ? 'Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª ÙØ§Ø±ØºØ© ØªÙ…Ø§Ù…Ø§Ù‹' : (currentSheetId === 'reminders_data' ? 'Ù„Ø§ ØªÙˆØ¬Ø¯ ØªØ°ÙƒÙŠØ±Ø§Øª Ù…Ø³Ø¬Ù„Ø© Ø­ØªÙ‰ Ø§Ù„Ø¢Ù†' : 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø³Ø¬Ù„Ø§Øª ÙÙŠ Ù‡Ø°Ø§ Ø§Ù„Ø´ÙŠØª Ø­ØªÙ‰ Ø§Ù„Ø¢Ù†')}
                                        </p>
                                        <p className="text-xs mt-1 text-slate-400">
                                            {isTrashSheet ? 'Ø£ÙŠ Ø­Ø³Ø§Ø¨Ø§Øª Ø£Ùˆ Ø¨ÙŠØ§Ù†Ø§Øª ÙŠØªÙ… Ø­Ø°ÙÙ‡Ø§ Ø³ØªØ¸Ù‡Ø± Ù‡Ù†Ø§ ÙˆÙŠÙ…ÙƒÙ†Ùƒ Ø§Ø³ØªØ±Ø¯Ø§Ø¯Ù‡Ø§ ÙÙŠ Ø£ÙŠ ÙˆÙ‚Øª' : (currentSheetId === 'reminders_data' ? 'Ø§Ù†Ù‚Ø± Ø¹Ù„Ù‰ "Ø¥Ø¶Ø§ÙØ© ØªØ°ÙƒÙŠØ± Ø¬Ø¯ÙŠØ¯" Ù„Ø­ÙØ¸ Ù…ÙˆØ¹Ø¯ Ø£Ùˆ Ù…Ù‡Ù…Ø© Ù„Ø§ ØªØ±ÙŠØ¯ Ù†Ø³ÙŠØ§Ù†Ù‡Ø§' : 'Ø§Ù†Ù‚Ø± Ø¹Ù„Ù‰ "Ø¥Ø¶Ø§ÙØ© Ø¨ÙŠØ§Ù† Ø¬Ø¯ÙŠØ¯" Ù„Ù„Ø¨Ø¯Ø¡ ÙÙŠ Ø­ÙØ¸ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª')}
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
                                                            title={rec.offerActivated ? 'Ø§Ù†Ù‚Ø± Ù„Ø¥Ù„ØºØ§Ø¡ Ø§Ù„Ø¥Ù†Ø¬Ø§Ø² ÙˆØ¥Ø¹Ø§Ø¯ØªÙ‡ Ù„Ù‚ÙŠØ¯ Ø§Ù„Ø§Ù†ØªØ¸Ø§Ø±' : 'Ø§Ù†Ù‚Ø± Ù„Ù„ØªØ¹Ù„ÙŠÙ… ÙƒÙ…ÙƒØªÙ…Ù„'}
                                                        >
                                                            <i className="fa-solid fa-check text-[10px]"></i>
                                                        </button>
                                                        <div className="min-w-0 flex items-center gap-1.5 flex-1">
                                                            <span className={`text-xs font-bold truncate ${
                                                                rec.offerActivated ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'
                                                            }`} title={rec.email}>
                                                                {rec.email || 'Ø¨Ø¯ÙˆÙ† Ø¹Ù†ÙˆØ§Ù†'}
                                                            </span>
                                                            <button
                                                                onClick={() => handleCopy(rec.email, `rem_${rec.id}`)}
                                                                className="text-slate-400 hover:text-indigo-600 p-0.5 transition flex-shrink-0"
                                                                title="Ù†Ø³Ø® Ø¹Ù†ÙˆØ§Ù† Ø§Ù„ØªØ°ÙƒÙŠØ±"
                                                            >
                                                                <i className={`fa-solid ${copiedField === `rem_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Priority / Category */}
                                                <td className="px-2 py-2 text-center whitespace-nowrap">
                                                    {(() => {
                                                        const p = rec.password || 'ðŸŸ¢ Ø¹Ø§Ø¯ÙŠ';
                                                        const isUrgent = p.includes('Ø¹Ø§Ø¬Ù„');
                                                        const isMedium = p.includes('Ù…ØªÙˆØ³Ø·');
                                                        const isRenewal = p.includes('ØªØ¬Ø¯ÙŠØ¯');
                                                        const isClient = p.includes('Ø¹Ù…ÙŠÙ„');
                                                        const isMoney = p.includes('Ø¯ÙØ¹') || p.includes('Ù…Ø§Ù„ÙŠ') || p.includes('Ø³Ø¯Ø§Ø¯');
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
                                                            <span>ØªÙ… Ø§Ù„Ø¥Ù†Ø¬Ø§Ø² âœ“</span>
                                                        </span>
                                                    ) : (
                                                        (() => {
                                                            const rem = getAccountReminder(rec);
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
                                                                        title="ØªØ¹Ù„ÙŠÙ… ÙƒÙ…ÙƒØªÙ…Ù„"
                                                                    >
                                                                        Ø¥Ù†Ø¬Ø§Ø²
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
                                                                title="ØªØ¹Ø¯ÙŠÙ„"
                                                            >
                                                                <i className="fa-solid fa-pen text-[8.5px]"></i>
                                                            </button>
                                                        )}
                                                        {canDelete && (
                                                            <button
                                                                onClick={() => handleDeleteRecord(rec.id)}
                                                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                                                                title="Ø­Ø°Ù ÙˆÙ†Ù‚Ù„ Ø¥Ù„Ù‰ Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª"
                                                            >
                                                                <i className="fa-solid fa-trash text-[8.5px]"></i>
                                                            </button>
                                                        )}
                                                        {currentSheetId === 'account_data' && getAccountCategory(rec) === 'chatgpt_shared' && (
                                                            <button
                                                                onClick={() => handleCopyChatGPTAccess(rec)}
                                                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-black transition whitespace-nowrap ${
                                                                    copiedField === `chatgpt_access_${rec.id}`
                                                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                                                        : 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                                                                }`}
                                                                title="Copy ChatGPT account"
                                                            >
                                                                <i className={`fa-solid ${copiedField === `chatgpt_access_${rec.id}` ? 'fa-check' : 'fa-file-lines'} text-[8px]`}></i>
                                                                <span>Copy</span>
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
                                    const isPersonalRecord = rec.deviceType === 'Ø´Ø®ØµÙŠ' || rec.deviceType === 'Ø¬Ù‡Ø§Ø²ÙŠÙ†';

                                    return (
                                        <tr
                                            key={rec.id}
                                            className={`transition-colors ${
                                                currentSheetId === 'client_data'
                                                    ? isPersonalRecord
                                                        ? 'border-r-4 border-r-cyan-500 bg-cyan-50/85 hover:bg-cyan-100/75 dark:border-r-cyan-400 dark:bg-cyan-950/25 dark:hover:bg-cyan-950/40'
                                                        : 'border-r-4 border-r-amber-500 bg-amber-50/85 hover:bg-amber-100/75 dark:border-r-amber-400 dark:bg-amber-950/25 dark:hover:bg-amber-950/40'
                                                    : 'hover:bg-indigo-50/30 dark:hover:bg-slate-800/50'
                                            }`}
                                        >
                                            {/* Row # */}
                                            <td className="px-1 py-1 text-center font-mono text-slate-400 text-[10px]">
                                                {rowNum}
                                            </td>

                                            {currentSheetId === 'client_data' && (
                                                <>
                                                    <td className="px-1.5 py-1 max-w-[160px]">
                                                        <div
                                                            className={`inline-flex w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-1 shadow-xs ${
                                                                isPersonalRecord
                                                                    ? 'border-cyan-200 bg-white/65 text-cyan-950 dark:border-cyan-800/70 dark:bg-cyan-900/25 dark:text-cyan-100'
                                                                    : 'border-amber-200 bg-white/65 text-amber-950 dark:border-amber-800/70 dark:bg-amber-900/25 dark:text-amber-100'
                                                            }`}
                                                            title={rec.name || 'Ø¹Ù…ÙŠÙ„ Ø¨Ø¯ÙˆÙ† Ø§Ø³Ù…'}
                                                        >
                                                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${
                                                                isPersonalRecord
                                                                    ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-800/60 dark:text-cyan-200'
                                                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-800/60 dark:text-amber-200'
                                                            }`}>
                                                                <i className="fa-solid fa-user text-[9px]"></i>
                                                            </span>
                                                            <span className="truncate text-[11px] font-black">{rec.name || 'Ø¹Ù…ÙŠÙ„ Ø¨Ø¯ÙˆÙ† Ø§Ø³Ù…'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-1.5 py-1 max-w-[170px]">
                                                        {rec.phone ? (
                                                            <div className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 shadow-xs ${
                                                                isPersonalRecord
                                                                    ? 'border-cyan-200 bg-white/65 text-cyan-950 dark:border-cyan-800/70 dark:bg-cyan-900/25 dark:text-cyan-100'
                                                                    : 'border-amber-200 bg-white/65 text-amber-950 dark:border-amber-800/70 dark:bg-amber-900/25 dark:text-amber-100'
                                                            }`}>
                                                                <i className={`fa-solid fa-phone text-[9px] ${isPersonalRecord ? 'text-cyan-500' : 'text-amber-500'}`}></i>
                                                                <span className="truncate block dir-ltr text-right text-[11px] font-black" title={rec.phone}>{rec.phone}</span>
                                                                <button
                                                                    onClick={() => handleCopy(rec.phone, `phone_${rec.id}`)}
                                                                    className={`mr-auto rounded-md p-0.5 transition ${
                                                                        isPersonalRecord
                                                                            ? 'text-cyan-500 hover:bg-cyan-100 hover:text-cyan-700 dark:hover:bg-cyan-800/60 dark:hover:text-cyan-100'
                                                                            : 'text-amber-500 hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-800/60 dark:hover:text-amber-100'
                                                                    }`}
                                                                    title="Ù†Ø³Ø® Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„ØªÙˆØ§ØµÙ„"
                                                                >
                                                                    <i className={`fa-solid ${copiedField === `phone_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className={`inline-flex w-full items-center justify-center rounded-lg border px-2 py-1 text-[11px] font-bold ${
                                                                isPersonalRecord
                                                                    ? 'border-cyan-200 bg-white/65 text-cyan-600 dark:border-cyan-800/70 dark:bg-cyan-900/25 dark:text-cyan-300'
                                                                    : 'border-amber-200 bg-white/65 text-amber-600 dark:border-amber-800/70 dark:bg-amber-900/25 dark:text-amber-300'
                                                            }`}>Ù„Ø§ ÙŠÙˆØ¬Ø¯ ØªÙˆØ§ØµÙ„</span>
                                                        )}
                                                    </td>
                                                    <td className="px-1.5 py-1 whitespace-nowrap">
                                                        <span className={`inline-flex min-w-[86px] items-center justify-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-black ${
                                                            rec.contactChannel === 'Ù…Ø§Ø³Ù†Ø¬Ø±'
                                                                ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
                                                                : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                                                        }`}>
                                                            <i className={`fa-brands ${rec.contactChannel === 'Ù…Ø§Ø³Ù†Ø¬Ø±' ? 'fa-facebook-messenger' : 'fa-whatsapp'} text-[10px]`}></i>
                                                            <span>{rec.contactChannel || 'ÙˆØ§ØªØ³Ø§Ø¨'}</span>
                                                        </span>
                                                    </td>
                                                </>
                                            )}

                                            {/* Email */}
                                            <td className="px-1.5 py-1 font-medium">
                                                {rec.email ? (
                                                    <div className="flex items-center gap-1 dir-ltr justify-end">
                                                        {rec.notes && (
                                                            <span title={`Ù…Ù„Ø§Ø­Ø¸Ø§Øª: ${rec.notes}`} className="text-amber-500/80 hover:text-amber-500 cursor-help mr-0.5">
                                                                <i className="fa-solid fa-note-sticky text-[8px]"></i>
                                                            </span>
                                                        )}
                                                        <span className="font-mono text-slate-800 dark:text-slate-200 select-all text-[11px] truncate max-w-[200px]" title={rec.email}>
                                                            {rec.email}
                                                        </span>
                                                        <button
                                                            onClick={() => handleCopy(rec.email, `em_${rec.id}`)}
                                                            className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 transition"
                                                            title="Ù†Ø³Ø® Ø§Ù„Ø¥ÙŠÙ…ÙŠÙ„"
                                                        >
                                                            <i className={`fa-solid ${copiedField === `em_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                        </button>
                                                        {(currentSheetId === 'client_data' || (currentSheetId === 'account_data' && getAccountCategory(rec) === 'adobe')) && (
                                                            <button
                                                                onClick={() => handleCopyAdobeAccess(rec)}
                                                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-black transition whitespace-nowrap ${
                                                                    copiedField === `adobe_access_${rec.id}`
                                                                        ? 'bg-emerald-600 text-white border-emerald-600'
                                                                        : 'bg-slate-900 text-white border-slate-900 hover:bg-slate-700'
                                                                }`}
                                                                title="Ù†Ø³Ø® Ø§Ù„Ø¥ÙŠÙ…ÙŠÙ„ Ùˆ Adobe Password Ø¨Ø±Ø³Ø§Ù„Ø© Ø¬Ø§Ù‡Ø²Ø©"
                                                            >
                                                                <i className={`fa-solid ${copiedField === `adobe_access_${rec.id}` ? 'fa-check' : 'fa-file-lines'} text-[8px]`}></i>
                                                                <span>{currentSheetId === 'client_data' ? 'Adobe' : 'Ù†Ø³Ø® Adobe'}</span>
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
                                                            {isPassVisible ? rec.password : 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢'}
                                                        </span>
                                                        <button
                                                            onClick={() => toggleSecret(rec.id, 'pass')}
                                                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 transition"
                                                            title={isPassVisible ? 'Ø¥Ø®ÙØ§Ø¡' : 'Ø¥Ø¸Ù‡Ø§Ø±'}
                                                        >
                                                            <i className={`fa-solid ${isPassVisible ? 'fa-eye-slash' : 'fa-eye'} text-[8px]`}></i>
                                                        </button>
                                                        <button
                                                            onClick={() => handleCopy(rec.password, `p1_${rec.id}`)}
                                                            className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 transition"
                                                            title="Ù†Ø³Ø® Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯"
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
                                                {currentSheetId === 'account_data' && getAccountCategory(rec) === 'capcut' ? (
                                                    <span className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-[10.5px] font-black text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
                                                        <i className="fa-solid fa-calendar-days text-[8px]"></i>
                                                        {rec.capcutMonths || 1} months
                                                    </span>
                                                ) : currentSheetId === 'account_data' && getAccountCategory(rec) === 'chatgpt_shared' ? (
                                                    rec.twoFaLink ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleCopy(rec.twoFaLink, `twofa_col_${rec.id}`)}
                                                            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10.5px] font-black transition ${
                                                                copiedField === `twofa_col_${rec.id}`
                                                                    ? 'border-emerald-600 bg-emerald-600 text-white'
                                                                    : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300'
                                                            }`}
                                                            title={rec.twoFaLink}
                                                        >
                                                            <i className={`fa-solid ${copiedField === `twofa_col_${rec.id}` ? 'fa-check' : 'fa-link'} text-[8px]`}></i>
                                                            2FA link
                                                        </button>
                                                    ) : (
                                                        <span className="text-slate-300 dark:text-slate-600">-</span>
                                                    )
                                                ) : rec.password2 ? (
                                                    <div className="flex items-center gap-1 dir-ltr justify-end">
                                                        <span className="font-mono text-slate-800 dark:text-slate-200 select-all text-[10.5px]">
                                                            {isPass2Visible ? rec.password2 : 'â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢'}
                                                        </span>
                                                        <button
                                                            onClick={() => toggleSecret(rec.id, 'pass2')}
                                                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 transition"
                                                            title={isPass2Visible ? 'Ø¥Ø®ÙØ§Ø¡' : 'Ø¥Ø¸Ù‡Ø§Ø±'}
                                                        >
                                                            <i className={`fa-solid ${isPass2Visible ? 'fa-eye-slash' : 'fa-eye'} text-[8px]`}></i>
                                                        </button>
                                                        <button
                                                            onClick={() => handleCopy(rec.password2, `p2_${rec.id}`)}
                                                            className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 transition"
                                                            title="Ù†Ø³Ø® Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯ 2"
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

                                                            const name = rec.originSheetName || sheetsList.find(s => s.id === originId)?.name || 'Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨';

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
                                                                    title="Ù†Ø³Ø® Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨"
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
                                                                    title="Ù†Ø³Ø® Ù…Ø¯Ø© Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ"
                                                                >
                                                                    <i className={`fa-solid ${copiedField === `dur_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-300 dark:text-slate-600">-</span>
                                                        )}
                                                    </td>
                                                    {/* Remaining Time (Ø§Ù„Ù…Ø¯Ø© Ø§Ù„Ù…ØªØ¨Ù‚ÙŠØ©) */}
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
                                                                ? 'Ø§Ø´ØªØ±Ø§Ùƒ Ù…Ø¯Ù‰ Ø§Ù„Ø­ÙŠØ§Ø©'
                                                                : `ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©: ${remaining.startDate || '-'} | ØªØ§Ø±ÙŠØ® Ø§Ù„Ø§Ù†ØªÙ‡Ø§Ø¡: ${remaining.endDate || '-'}`;

                                                            return (
                                                                <div className="flex items-center gap-1" title={tooltip}>
                                                                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${badgeStyles} whitespace-nowrap`}>
                                                                        <i className={badgeIcon}></i>
                                                                        <span>{remaining.text}</span>
                                                                    </span>
                                                                    <button
                                                                        onClick={() => handleCopy(remaining.text, `rem_${rec.id}`)}
                                                                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-0.5 transition"
                                                                        title="Ù†Ø³Ø® Ø§Ù„Ù…Ø¯Ø© Ø§Ù„Ù…ØªØ¨Ù‚ÙŠØ©"
                                                                    >
                                                                        <i className={`fa-solid ${copiedField === `rem_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                    </button>
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                    {/* Device Type (Ù†ÙˆØ¹ Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ: Ø´Ø®ØµÙŠ Ø£Ù… Ù…Ø´ØªØ±Ùƒ) */}
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {isPersonalRecord ? (
                                                            <span className="inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[11px] font-black text-cyan-700 shadow-xs whitespace-nowrap dark:border-cyan-800/70 dark:bg-cyan-950/35 dark:text-cyan-300">
                                                                <i className="fa-solid fa-mobile-screen-button text-[10px]"></i>
                                                                <span>Ø¬Ù‡Ø§Ø²ÙŠÙ†</span>
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700 shadow-xs whitespace-nowrap dark:border-amber-800/70 dark:bg-amber-950/35 dark:text-amber-300">
                                                                <i className="fa-solid fa-mobile-screen text-[10px]"></i>
                                                                <span>Ø¬Ù‡Ø§Ø²</span>
                                                            </span>
                                                        )}
                                                    </td>
                                                    {/* Payment Status (Ø­Ø§Ù„Ø© Ø§Ù„Ø¯ÙØ¹: Ù…Ø¯ÙÙˆØ¹ / ØºÙŠØ± Ù…Ø¯ÙÙˆØ¹) */}
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {rec.paymentStatus === 'ØºÙŠØ± Ù…Ø¯ÙÙˆØ¹' ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleTogglePaymentStatus(rec.id)}
                                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200/70 dark:border-rose-800/60 shadow-xs cursor-pointer hover:bg-rose-100 dark:hover:bg-rose-900/60 transition whitespace-nowrap"
                                                                title="Ø§Ù†Ù‚Ø± Ù„ØªØºÙŠÙŠØ± Ø§Ù„Ø­Ø§Ù„Ø© Ø¥Ù„Ù‰ Ù…Ø¯ÙÙˆØ¹"
                                                            >
                                                                <i className="fa-solid fa-circle-xmark text-[8px] text-rose-500"></i>
                                                                <span>ØºÙŠØ± Ù…Ø¯ÙÙˆØ¹</span>
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleTogglePaymentStatus(rec.id)}
                                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60 shadow-xs cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition whitespace-nowrap"
                                                                title="Ø§Ù†Ù‚Ø± Ù„ØªØºÙŠÙŠØ± Ø§Ù„Ø­Ø§Ù„Ø© Ø¥Ù„Ù‰ ØºÙŠØ± Ù…Ø¯ÙÙˆØ¹"
                                                            >
                                                                <i className="fa-solid fa-circle-check text-[8px] text-emerald-500"></i>
                                                                <span>Ù…Ø¯ÙÙˆØ¹</span>
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
                                                                        title="Ù†Ø³Ø® ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡"
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
                                                            const category = getAccountCategory(rec);
                                                            if (category === 'adobe' && rec.offerActivated) {
                                                                return (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleToggleOfferActivated(rec.id)}
                                                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black bg-emerald-600 text-white border border-emerald-600 hover:bg-emerald-700 transition whitespace-nowrap"
                                                                        title={rec.offerActivatedAt ? `Ù„Ø§ ÙŠØ­ØªØ§Ø¬ ØªØ°ÙƒÙŠØ± - ØªÙ… ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¹Ø±Ø¶ ${new Date(rec.offerActivatedAt).toLocaleDateString('ar-EG')}` : 'Ù„Ø§ ÙŠØ­ØªØ§Ø¬ ØªØ°ÙƒÙŠØ±'}
                                                                    >
                                                                        <i className="fa-solid fa-circle-check text-[8px]"></i>
                                                                        <span>Ù„Ø§ ÙŠØ­ØªØ§Ø¬ ØªØ°ÙƒÙŠØ±</span>
                                                                    </button>
                                                                );
                                                            }
                                                            const reminder = getAccountReminder(rec);
                                                            if (reminder.status === 'none') {
                                                                return <span className="text-slate-300 dark:text-slate-600">-</span>;
                                                            }
                                                            return (
                                                                <div className="flex items-center gap-1">
                                                                    <span
                                                                        title={`ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡: ${reminder.createdDate || effectiveDate || '-'} | Ù…ÙˆØ¹Ø¯ Ø§Ù„ØªØ°ÙƒÙŠØ±: ${reminder.targetDate || '-'} (${reminder.reminderDays || rec.reminderDays || '-'} ÙŠÙˆÙ…)`}
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
                                                                        title="Ù†Ø³Ø® Ø­Ø§Ù„Ø© Ø§Ù„ØªØ°ÙƒÙŠØ±"
                                                                    >
                                                                        <i className={`fa-solid ${copiedField === `rem_acc_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleToggleOfferActivated(rec.id)}
                                                                        className={`${category !== 'adobe' ? 'hidden' : 'inline-flex'} items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black border transition whitespace-nowrap ${
                                                                            rec.offerActivated
                                                                                ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                                                                                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-emerald-400 hover:text-emerald-700'
                                                                        }`}
                                                                        title={rec.offerActivated ? `ØªÙ… ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¹Ø±Ø¶${rec.offerActivatedAt ? ` - ${new Date(rec.offerActivatedAt).toLocaleDateString('ar-EG')}` : ''}` : 'ØªØ¹Ù„ÙŠÙ… Ø£Ù† Ø¹Ø±Ø¶ Ø§Ù„ØªÙØ¹ÙŠÙ„ Ø§ØªØ¹Ù…Ù„ Ø¹Ù„Ù‰ Ø§Ù„Ø­Ø³Ø§Ø¨'}
                                                                    >
                                                                        <i className={`fa-solid ${rec.offerActivated ? 'fa-check' : 'fa-bolt'} text-[8px]`}></i>
                                                                        <span>{rec.offerActivated ? 'Ø§Ù„Ø¹Ø±Ø¶ Ø§ØªÙØ¹Ù„' : 'ØªÙ… ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¹Ø±Ø¶'}</span>
                                                                    </button>
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {(() => {
                                                            if (getAccountCategory(rec) === 'capcut') {
                                                                return (
                                                                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-900 px-2.5 py-1 text-[10px] font-black text-white shadow-sm dark:border-slate-700">
                                                                        <i className="fa-solid fa-user-check text-[8px]"></i>
                                                                        Personal
                                                                    </span>
                                                                );
                                                            }
                                                            const currentUses = Math.max(0, Number(rec.currentUses || 0));
                                                            const maxUses = Math.max(1, Number(rec.maxUses || 2));
                                                            // Ø§Ø´ØªÙ‚ Ø§Ù„Ø­Ø§Ù„Ø© Ø§Ù„ØµØ­ÙŠØ­Ø© â€” Ø§Ù„Ø£ÙˆÙ„ÙˆÙŠØ© Ù„Ù„Ù€ accountUsageStatus Ø§Ù„Ù…Ø­ÙÙˆØ¸
                                                            if (getAccountCategory(rec) === 'chatgpt_shared') {
                                                                return (
                                                                    <div className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 p-0.5 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleSetChatGPTUsers(rec.id, currentUses - 1)}
                                                                            className="flex h-5 w-5 items-center justify-center rounded-md border border-emerald-200 bg-white text-[10px] font-black hover:bg-emerald-100 dark:border-emerald-800 dark:bg-slate-900"
                                                                            title="Decrease users"
                                                                        >
                                                                            -
                                                                        </button>
                                                                        <span className="min-w-[54px] text-center text-[10px] font-black">
                                                                            {currentUses} users
                                                                        </span>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleSetChatGPTUsers(rec.id, currentUses + 1)}
                                                                            className="flex h-5 w-5 items-center justify-center rounded-md border border-emerald-200 bg-white text-[10px] font-black hover:bg-emerald-100 dark:border-emerald-800 dark:bg-slate-900"
                                                                            title="Increase users"
                                                                        >
                                                                            +
                                                                        </button>
                                                                    </div>
                                                                );
                                                            }
                                                            const status = rec.accountUsageStatus || (
                                                                currentUses <= 0 ? 'available' :
                                                                currentUses >= maxUses ? 'shared_full' :
                                                                'shared_one_device'
                                                            );
                                                            const optionClass = (active, color) => {
                                                                const colors = {
                                                                    green: active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
                                                                    reused: active ? 'bg-orange-500 text-white border-orange-500 shadow-sm shadow-orange-500/20' : 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100',
                                                                    dark:  active ? 'bg-slate-900 text-white border-slate-900'   : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100',
                                                                    amber: active ? 'bg-amber-500 text-white border-amber-500'   : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
                                                                    rose:  active ? 'bg-rose-600 text-white border-rose-600'     : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100',
                                                                };
                                                                return colors[color];
                                                            };
                                                            const isReused = isReusedAccount(rec);
                                                            const remainingUses = Math.max(0, maxUses - currentUses);
                                                            const reusedAvailableLabel = remainingUses >= maxUses
                                                                ? maxUses + ' devices available - reused'
                                                                : remainingUses === 1
                                                                ? '1 device available - reused'
                                                                : remainingUses + ' devices available - reused';
                                                            return (
                                                                <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-0.5 whitespace-nowrap">
                                                                    {/* Ù…ØªØ§Ø­: 0/2 slots */}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleSetAccountUsage(rec.id, isReused && currentUses > 0 ? currentUses : 0, isReused && currentUses > 0 ? status : 'available')}
                                                                        className={`px-1.5 py-0.5 rounded-md text-[9px] font-black border transition ${optionClass((status === 'available' || status === 'available_reused_after_expiry') || (isReused && remainingUses > 0), isReused ? 'reused' : 'green')}`}
                                                                        title="Ø§Ù„Ø­Ø³Ø§Ø¨ Ù„Ù… ÙŠØ®Ø±Ø¬ Ù„Ø£ÙŠ Ø¹Ù…ÙŠÙ„ â€” 0/2 slots"
                                                                    >
                                                                        {isReused ? reusedAvailableLabel : 'Available'}
                                                                    </button>
                                                                    {/* Ø´Ø®ØµÙŠ: Ø§Ù„Ø­Ø³Ø§Ø¨ ÙƒÙ„Ù‡ Ù„Ø´Ø®Øµ ÙˆØ§Ø­Ø¯ â€” 2/2 slots */}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleSetAccountUsage(rec.id, maxUses, 'personal_full')}
                                                                        className={`px-1.5 py-0.5 rounded-md text-[9px] font-black border transition ${optionClass(status === 'personal_full', 'dark')}`}
                                                                        title="Ø´Ø®ØµÙŠ â€” Ø§Ù„Ø­Ø³Ø§Ø¨ ÙƒÙ„Ù‡ Ù„Ø¹Ù…ÙŠÙ„ ÙˆØ§Ø­Ø¯ (2/2 slots)"
                                                                    >
                                                                        Ø´Ø®ØµÙŠ
                                                                    </button>
                                                                    {/* Ù…Ø´ØªØ±Ùƒ Ø¬Ù‡Ø§Ø²: 1/2 slots Ù…Ø³ØªØ®Ø¯Ù… â€” slot ÙˆØ§Ø­Ø¯ Ù…ØªØ¨Ù‚ÙŠ */}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleSetAccountUsage(rec.id, 1, 'shared_one_device')}
                                                                        className={`px-1.5 py-0.5 rounded-md text-[9px] font-black border transition ${optionClass(status === 'shared_one_device', 'amber')}`}
                                                                        title="Ù…Ø´ØªØ±Ùƒ â€” Ø¬Ù‡Ø§Ø² ÙˆØ§Ø­Ø¯ Ø®Ø±Ø¬ØŒ slot ÙˆØ§Ø­Ø¯ Ù…ØªØ¨Ù‚ÙŠ (1/2 slots)"
                                                                    >
                                                                        Ù…Ø´ØªØ±Ùƒ Ø¬Ù‡Ø§Ø²
                                                                    </button>
                                                                    {/* Ù…Ø´ØªØ±Ùƒ ÙƒØ§Ù…Ù„: 2/2 slots â€” Ø§Ù„Ø¬Ù‡Ø§Ø²ÙŠÙ† Ø®Ø±Ø¬ÙˆØ§ */}
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleSetAccountUsage(rec.id, maxUses, 'shared_full')}
                                                                        className={`px-1.5 py-0.5 rounded-md text-[9px] font-black border transition ${optionClass(status === 'shared_full', 'rose')}`}
                                                                        title="Ù…Ø´ØªØ±Ùƒ ÙƒØ§Ù…Ù„ â€” Ø§Ù„Ø¬Ù‡Ø§Ø²ÙŠÙ† Ø®Ø±Ø¬ÙˆØ§ (2/2 slots)"
                                                                    >
                                                                        Ù…Ø´ØªØ±Ùƒ ÙƒØ§Ù…Ù„
                                                                    </button>
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td className="px-1.5 py-1 font-medium">
                                                        {(() => {
                                                            const category = getAccountCategory(rec);
                                                            if (category === 'capcut') {
                                                                const reminder = calculateCapCutMonthlyReminder(rec);
                                                                return (
                                                                    <div className="flex flex-wrap items-center gap-1">
                                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black border whitespace-nowrap bg-sky-50 text-sky-700 border-sky-200">
                                                                            <i className="fa-solid fa-calendar-days text-[8px]"></i>
                                                                            {rec.capcutMonths || 1} months
                                                                        </span>
                                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-50 text-slate-600 border border-slate-200 whitespace-nowrap">
                                                                            <i className="fa-solid fa-play text-[8px]"></i>
                                                                            {rec.accountCreatedDate || rec.startDate || '-'}
                                                                        </span>
                                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                                                                            <i className="fa-solid fa-rotate text-[8px]"></i>
                                                                            {reminder.targetDate || '-'}
                                                                        </span>
                                                                    </div>
                                                                );
                                                            }
                                                            if (category === 'chatgpt_shared') {
                                                                const reminder = calculateChatGPTMonthlyReminder(rec);
                                                                const currentUses = Math.max(0, Number(rec.currentUses || 0));
                                                                const maxUses = Math.max(1, Number(rec.maxUses || rec.sharedUsers || 1));
                                                                return (
                                                                    <div className="flex flex-wrap items-center gap-1">
                                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                                                                            <i className="fa-solid fa-users text-[8px]"></i>
                                                                            {currentUses} users
                                                                        </span>
                                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-50 text-slate-600 border border-slate-200 whitespace-nowrap">
                                                                            <i className="fa-solid fa-play text-[8px]"></i>
                                                                            {rec.accountCreatedDate || rec.startDate || '-'}
                                                                        </span>
                                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                                                                            <i className="fa-regular fa-calendar text-[8px]"></i>
                                                                            {reminder.targetDate || '-'}
                                                                        </span>
                                                                        {reminder.days === 0 && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleRenewChatGPTAccount(rec.id)}
                                                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black bg-slate-900 text-white border border-slate-900 whitespace-nowrap hover:bg-slate-700"
                                                                            >
                                                                                <i className="fa-solid fa-rotate text-[8px]"></i>
                                                                                Renew
                                                                            </button>
                                                                        )}
                                                                        {rec.twoFaLink && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleCopy(rec.twoFaLink, `twofa_${rec.id}`)}
                                                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 whitespace-nowrap hover:bg-indigo-100"
                                                                            >
                                                                                <i className={`fa-solid ${copiedField === `twofa_${rec.id}` ? 'fa-check' : 'fa-link'} text-[8px]`}></i>
                                                                                2FA
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                );
                                                            }
                                                            const isReused = isReusedAccount(rec);
                                                            return (
                                                                <div className="flex flex-wrap items-center gap-1">
                                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200 whitespace-nowrap">
                                                                        <i className="fa-solid fa-palette text-[8px]"></i>
                                                                        Adobe
                                                                    </span>
                                                                    {isReused && (
                                                                        <span
                                                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-black bg-orange-50 text-orange-700 border border-orange-200 whitespace-nowrap dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800"
                                                                            title={rec.releasedAccountAt ? `Returned to stock on ${String(rec.releasedAccountAt).slice(0, 10)}` : 'Returned to stock after no renewal'}
                                                                        >
                                                                            <i className="fa-solid fa-rotate text-[8px]"></i>
                                                                            Reused after expiry
                                                                        </span>
                                                                    )}
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
                                                                    title="Ù†Ø³Ø® Ø±Ù‚Ù… Ø§Ù„ÙØ§ØªÙˆØ±Ø©"
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
                                                                    {isVisaVisible ? rec.visa : 'â€¢â€¢â€¢â€¢ â€¢â€¢â€¢â€¢ â€¢â€¢â€¢â€¢ ' + rec.visa.slice(-4)}
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
                                                                    title="Ù†Ø³Ø® Ø­Ø³Ø§Ø¨ Ø§Ù„ÙÙŠØ²Ø§"
                                                                >
                                                                    <i className={`fa-solid ${copiedField === `va_${rec.id}` ? 'fa-check text-emerald-500' : 'fa-copy'} text-[8px]`}></i>
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-300 dark:text-slate-600">-</span>
                                                        )}
                                                    </td>

                                                    {/* Account Data (Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨) */}
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
                                                                    title="Ù†Ø³Ø® Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨"
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
                                                            title="Ø§Ø³ØªØ±Ø¯Ø§Ø¯ Ø§Ù„Ø³Ø¬Ù„ Ø¥Ù„Ù‰ Ø´ÙŠØªÙ‡ Ø§Ù„Ø£ØµÙ„ÙŠ"
                                                        >
                                                            <i className="fa-solid fa-rotate-left text-[8px]"></i>
                                                            <span>Ø§Ø³ØªØ±Ø¯Ø§Ø¯</span>
                                                        </button>
                                                        {canEmptyTrash && (
                                                            <button
                                                                onClick={() => handleDeleteRecord(rec.id)}
                                                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                                                                title="Ø­Ø°Ù Ù†Ù‡Ø§Ø¦ÙŠ"
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
                                                                title="ØªØ¹Ø¯ÙŠÙ„"
                                                            >
                                                                <i className="fa-solid fa-pen text-[8.5px]"></i>
                                                            </button>
                                                        )}
                                                        {canDelete && (
                                                            <button
                                                                onClick={() => handleDeleteRecord(rec.id)}
                                                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-slate-800 rounded transition cursor-pointer"
                                                                title="Ø­Ø°Ù ÙˆÙ†Ù‚Ù„ Ø¥Ù„Ù‰ Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª"
                                                            >
                                                                <i className="fa-solid fa-trash text-[8.5px]"></i>
                                                            </button>
                                                        )}
                                                        {!canEdit && !canDelete && (
                                                            <span className="text-[9px] text-slate-400">Ø¹Ø±Ø¶ ÙÙ‚Ø·</span>
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
                            Ø¹Ø±Ø¶ Ø§Ù„ØµÙØ­Ø© <b className="text-slate-800 dark:text-white">{currentPage}</b> Ù…Ù† Ø£ØµÙ„ <b className="text-slate-800 dark:text-white">{totalPages}</b> (Ø¥Ø¬Ù…Ø§Ù„ÙŠ {filteredRecords.length} Ø³Ø¬Ù„)
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
                                Ø§Ù„Ø³Ø§Ø¨Ù‚
                            </button>
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                disabled={currentPage === totalPages}
                                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700 font-bold"
                            >
                                Ø§Ù„ØªØ§Ù„ÙŠ
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
                                        {editingRecord ? 'ØªØ¹Ø¯ÙŠÙ„ Ø§Ù„Ø³Ø¬Ù„' : 'Ø¥Ø¶Ø§ÙØ© Ø¨ÙŠØ§Ù† Ø¬Ø¯ÙŠØ¯'}
                                    </h3>
                                    <p className="text-xs text-slate-400">
                                        Ø§Ù„Ø´ÙŠØª Ø§Ù„Ø­Ø§Ù„ÙŠ: <span className="font-bold text-indigo-600 dark:text-indigo-400">{currentSheet.name}</span>
                                    </p>
                                </div>
                            </div>
                            {/* Prominent Cancel / Close Button (Ø¹Ù„Ø§Ù…Ø© Ø§Ù„Ø¥Ù„ØºØ§Ø¡) */}
                            <button
                                type="button"
                                onClick={() => setShowAddModal(false)}
                                title="Ø¥Ù„ØºØ§Ø¡ ÙˆØ¥ØºÙ„Ø§Ù‚ Ø§Ù„Ù†Ø§ÙØ°Ø©"
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
                                            <span>Ø§Ø®ØªÙŠØ§Ø± Ù…Ù† Ø§Ù„Ù…ØªØ§Ø­</span>
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
                                            <span>ØªØ³Ø¬ÙŠÙ„ ÙŠØ¯ÙˆÙŠ</span>
                                        </button>
                                    </div>

                                    {accountEntryMode === 'available' ? (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                                    Ø§Ù„Ù…ÙŠÙ„ Ø§Ù„Ù…ØªØ¨Ø§Ø¹ Ù…Ù† Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨
                                                </label>
                                                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">
                                                    Ø§Ù„Ù…Ø¹Ø±ÙˆØ¶: {displayedAvailableAccountChoices.length} / {availableAccountChoices.length}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                                                <div className="relative">
                                                    <i className="fa-solid fa-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-[11px]"></i>
                                                    <input
                                                        type="text"
                                                        value={availableAccountSearch}
                                                        onChange={(e) => setAvailableAccountSearch(e.target.value)}
                                                        placeholder="Ø¨Ø­Ø« ÙÙŠ Ø§Ù„Ø¥ÙŠÙ…ÙŠÙ„Ø§Øª Ø§Ù„Ù…ØªØ§Ø­Ø©..."
                                                        className="w-full rounded-xl border-2 border-slate-200 bg-white py-2 pr-8 pl-3 text-xs font-bold text-slate-800 outline-none transition focus:border-purple-400 focus:ring-2 focus:ring-purple-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                                    />
                                                </div>
                                                <select
                                                    value={availableAccountSort}
                                                    onChange={(e) => setAvailableAccountSort(e.target.value)}
                                                    className="rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 outline-none transition focus:border-purple-400 focus:ring-2 focus:ring-purple-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                                                    title="ØªØ±ØªÙŠØ¨ Ø§Ù„Ø¥ÙŠÙ…ÙŠÙ„Ø§Øª"
                                                >
                                                    <option value="newest">Ø§Ù„Ø£Ø­Ø¯Ø« Ø¨ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡</option>
                                                    <option value="oldest">Ø§Ù„Ø£Ù‚Ø¯Ù… Ø¨ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡</option>
                                                    <option value="email">Ø­Ø³Ø¨ Ø§Ù„Ø¥ÙŠÙ…ÙŠÙ„</option>
                                                </select>
                                            </div>
                                            {displayedAvailableAccountChoices.length > 0 ? (
                                                <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-1 custom-modal-scroll">
                                                    {displayedAvailableAccountChoices.map(acc => {
                                                        const maxUses = Math.max(1, Number(acc.maxUses || 2));
                                                        const currentUses = Math.max(0, Number(acc.currentUses || 0));
                                                        const remaining = Math.max(0, maxUses - currentUses);
                                                        const accountEmail = acc.email || acc.selectedAccount || '';
                                                        const isFull = currentUses === 0;
                                                        const isPersonalChosen = formData.deviceType === 'Ø´Ø®ØµÙŠ' || formData.deviceType === 'Ø¬Ù‡Ø§Ø²ÙŠÙ†';
                                                        const disabledForPersonal = isPersonalChosen && !isFull;
                                                        const selectedValue = String(formData.selectedAccount || '').toLowerCase();
                                                        const isSelected = selectedValue
                                                            && [acc.id, acc.email, acc.selectedAccount].some(value => String(value || '').toLowerCase() === selectedValue);
                                                        const availabilityLabel = isFull && maxUses >= 2 ? 'Ø¬Ù‡Ø§Ø²ÙŠÙ† Ù…ØªØ§Ø­ÙŠÙ†' : `Ù…ØªØ¨Ù‚ÙŠ ${remaining} Ø¬Ù‡Ø§Ø²`;
                                                        const availabilityHint = isFull && maxUses >= 2 ? 'Personal or shared available' : 'Shared only';
                                                        const isReusedAfterExpiry = isReusedAccount(acc);

                                                        return (
                                                            <button
                                                                key={acc.id}
                                                                type="button"
                                                                disabled={disabledForPersonal}
                                                                onClick={() => handleSelectAvailableAccount(accountEmail || acc.id)}
                                                                className={`w-full rounded-2xl border-2 p-3 text-right transition ${
                                                                    disabledForPersonal
                                                                        ? 'cursor-not-allowed bg-slate-100/80 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 opacity-60'
                                                                        : isSelected
                                                                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-500/20'
                                                                            : isFull
                                                                                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 hover:border-emerald-400 hover:shadow-sm'
                                                                                : 'bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800 hover:border-violet-400 hover:shadow-sm'
                                                                }`}
                                                            >
                                                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                                                    <div className="min-w-0">
                                                                        <div dir="ltr" className={`font-mono text-xs font-black truncate text-left ${
                                                                            isSelected ? 'text-white' : 'text-slate-800 dark:text-slate-100'
                                                                        }`}>
                                                                            {accountEmail || 'Ø­Ø³Ø§Ø¨ Ø¨Ø¯ÙˆÙ† Ù…ÙŠÙ„'}
                                                                        </div>
                                                                        <div className={`mt-1 text-[11px] font-bold ${
                                                                            isSelected ? 'text-indigo-100' : 'text-slate-500 dark:text-slate-400'
                                                                        }`}>
                                                                            {availabilityHint}
                                                                        </div>
                                                                    </div>

                                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black border ${
                                                                            isSelected
                                                                                ? 'bg-white/15 text-white border-white/30'
                                                                                : isFull
                                                                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                                                                    : 'bg-violet-600 text-white border-violet-600'
                                                                        }`}>
                                                                            <i className={`fa-solid ${isFull ? 'fa-mobile-screen-button' : 'fa-mobile-screen'} text-[10px]`}></i>
                                                                            {availabilityLabel}
                                                                        </span>
                                                                        {isReusedAfterExpiry && (
                                                                            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-black border ${
                                                                                isSelected
                                                                                    ? 'bg-white/15 text-white border-white/30'
                                                                                    : 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800'
                                                                            }`}>
                                                                                <i className="fa-solid fa-rotate text-[9px]"></i>
                                                                                Reused after expiry
                                                                            </span>
                                                                        )}
                                                                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-black ${
                                                                            isSelected
                                                                                ? 'bg-white/15 text-white'
                                                                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                                                                        }`}>
                                                                            Ù…Ø³ØªØ®Ø¯Ù… {currentUses}/{maxUses}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            ) : (
                                                <div className="rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/50 px-4 py-5 text-center">
                                                    <i className="fa-solid fa-inbox text-slate-300 dark:text-slate-600 text-xl mb-2"></i>
                                                    <div className="text-xs font-black text-slate-500 dark:text-slate-400">
                                                        {availableAccountSearch ? 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ù†ØªØ§Ø¦Ø¬ Ù…Ø·Ø§Ø¨Ù‚Ø© Ù„Ù„Ø¨Ø­Ø«' : 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ø¥ÙŠÙ…ÙŠÙ„Ø§Øª Ù…ØªØ§Ø­Ø© Ø­Ø§Ù„ÙŠØ§'}
                                                    </div>
                                                </div>
                                            )}
                                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-bold">
                                                {formData.deviceType === 'Ø´Ø®ØµÙŠ'
                                                    ? 'ðŸŸ¢ Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ Ø§Ù„Ø´Ø®ØµÙŠ ÙŠØªØ·Ù„Ø¨ Ø­Ø³Ø§Ø¨Ø§Ù‹ Ù…ØªØ§Ø­Ø§Ù‹ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ (Ø§Ù„Ø¬Ù‡Ø§Ø²ÙŠÙ† Ù…Ø¹Ø§Ù‹ Ù„Ù… ÙŠØªÙ… Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø£ÙŠ Ù…Ù†Ù‡Ù…Ø§).'
                                                    : 'ðŸŸ£ Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ Ø§Ù„Ù…Ø´ØªØ±Ùƒ ÙŠÙ…ÙƒÙ† ØªØ³ÙƒÙŠÙ†Ù‡ Ø¹Ù„Ù‰ Ø­Ø³Ø§Ø¨ Ù…ØªØ§Ø­ Ø¨Ø§Ù„ÙƒØ§Ù…Ù„ Ø£Ùˆ Ø­Ø³Ø§Ø¨ Ù…Ø´ØªØ±Ùƒ Ù…ØªØ¨Ù‚ÙŠ ÙÙŠÙ‡ Ø¬Ù‡Ø§Ø².'}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="space-y-1.5">
                                            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                                Ø§Ù„Ù…ÙŠÙ„ Ø§Ù„Ù…ØªØ¨Ø§Ø¹ ÙŠØ¯ÙˆÙŠÙ‹Ø§
                                            </label>
                                            <div className="relative">
                                                <i className="fa-solid fa-pen absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                                <input
                                                    type="text"
                                                    value={formData.selectedAccount}
                                                    onChange={(e) => setFormData({ ...formData, selectedAccount: e.target.value })}
                                                    placeholder="Ø§ÙƒØªØ¨ Ø§Ù„Ù…ÙŠÙ„ Ø§Ù„Ù…ØªØ¨Ø§Ø¹ ÙŠØ¯ÙˆÙŠÙ‹Ø§..."
                                                    className="w-full bg-white dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-700 hover:border-slate-400 focus:border-slate-600 rounded-xl pr-9 pl-4 py-2.5 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-500/20 dir-ltr text-right"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                            {currentSheetId === 'client_data' && (
                                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/40 p-3.5 space-y-3">
                                    <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-black text-xs">
                                        <i className="fa-solid fa-address-card text-indigo-500"></i>
                                        <span>Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¹Ù…ÙŠÙ„ ÙˆØ§Ù„ØªÙˆØ§ØµÙ„</span>
                                        <span className="text-[10px] font-bold text-slate-400">Ø§Ø®ØªÙŠØ§Ø±ÙŠ</span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                                Ø§Ø³Ù… Ø§Ù„Ø¹Ù…ÙŠÙ„
                                            </label>
                                            <div className="relative">
                                                <i className="fa-solid fa-user absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                                <input
                                                    type="text"
                                                    value={formData.name}
                                                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                                    placeholder="Ø§Ø³Ù… Ø§Ù„Ø¹Ù…ÙŠÙ„ Ø¥Ù† ÙˆØ¬Ø¯"
                                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                                Ø±Ù‚Ù… Ø§Ù„Ù‡Ø§ØªÙ Ø£Ùˆ ÙŠÙˆØ²Ø± ÙˆØ§ØªØ³Ø§Ø¨
                                            </label>
                                            <div className="relative">
                                                <i className="fa-solid fa-phone absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                                <input
                                                    type="text"
                                                    value={formData.phone}
                                                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                                                    placeholder="010... Ø£Ùˆ username"
                                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                            ÙˆØ³ÙŠÙ„Ø© Ø§Ù„ØªÙˆØ§ØµÙ„
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {['ÙˆØ§ØªØ³Ø§Ø¨', 'Ù…Ø§Ø³Ù†Ø¬Ø±'].map(channel => (
                                                <button
                                                    key={channel}
                                                    type="button"
                                                    onClick={() => setFormData(prev => ({ ...prev, contactChannel: channel }))}
                                                    className={`py-2.5 px-3 rounded-xl border text-xs font-black flex items-center justify-center gap-2 transition ${
                                                        formData.contactChannel === channel
                                                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                                                    }`}
                                                >
                                                    <i className={`fa-brands ${channel === 'ÙˆØ§ØªØ³Ø§Ø¨' ? 'fa-whatsapp' : 'fa-facebook-messenger'} text-sm`}></i>
                                                    <span>{channel}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                            {currentSheetId === 'reminders_data' ? (
                                <div className="space-y-4">
                                    {/* Reminder Title */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                                            Ø¹Ù†ÙˆØ§Ù† Ø§Ù„ØªØ°ÙƒÙŠØ± Ø£Ùˆ Ø§Ù„Ù…Ø·Ù„ÙˆØ¨ ØªØ°ÙƒÙŠØ±Ù‡ <span className="text-rose-500">*</span>
                                        </label>
                                        <div className="relative">
                                            <i className="fa-solid fa-bell absolute right-3.5 top-1/2 -translate-y-1/2 text-amber-500 text-xs"></i>
                                            <input
                                                type="text"
                                                required
                                                value={formData.email}
                                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                                placeholder="Ù…Ø«Ø§Ù„: ØªØ¬Ø¯ÙŠØ¯ Ø§Ø´ØªØ±Ø§Ùƒ Ø£Ø¯ÙˆØ¨ÙŠ Ù„Ø¹Ù…ÙŠÙ„ØŒ Ø³Ø¯Ø§Ø¯ ÙÙŠØ²Ø§ØŒ Ø§ØªØµØ§Ù„ Ù‡Ø§ØªÙÙŠ..."
                                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-amber-500/50 font-bold"
                                            />
                                        </div>
                                    </div>

                                    {/* Priority / Category */}
                                    <div>
                                        <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                                            Ø§Ù„Ø£ÙˆÙ„ÙˆÙŠØ© ÙˆØ§Ù„ØªØµÙ†ÙŠÙ
                                        </label>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                            {[
                                                { id: 'ðŸ”´ Ø¹Ø§Ø¬Ù„ Ø¬Ø¯Ø§Ù‹', label: 'ðŸ”´ Ø¹Ø§Ø¬Ù„ Ø¬Ø¯Ø§Ù‹' },
                                                { id: 'ðŸŸ¡ Ø£ÙˆÙ„ÙˆÙŠØ© Ù…ØªÙˆØ³Ø·Ø©', label: 'ðŸŸ¡ Ø£ÙˆÙ„ÙˆÙŠØ© Ù…ØªÙˆØ³Ø·Ø©' },
                                                { id: 'ðŸŸ¢ Ø¹Ø§Ø¯ÙŠ', label: 'ðŸŸ¢ Ø¹Ø§Ø¯ÙŠ' },
                                                { id: 'ðŸŸ£ ØªØ¬Ø¯ÙŠØ¯ ÙˆØ§Ø´ØªØ±Ø§Ùƒ', label: 'ðŸŸ£ ØªØ¬Ø¯ÙŠØ¯ ÙˆØ§Ø´ØªØ±Ø§Ùƒ' },
                                                { id: 'ðŸ”µ Ù…ØªØ§Ø¨Ø¹Ø© Ø¹Ù…ÙŠÙ„', label: 'ðŸ”µ Ù…ØªØ§Ø¨Ø¹Ø© Ø¹Ù…ÙŠÙ„' },
                                                { id: 'ðŸŸ  Ø³Ø¯Ø§Ø¯ Ù…Ø§Ù„ÙŠ / Ø¯ÙØ¹', label: 'ðŸŸ  Ø³Ø¯Ø§Ø¯ Ù…Ø§Ù„ÙŠ / Ø¯ÙØ¹' },
                                            ].map(opt => {
                                                const currentVal = formData.password || 'ðŸ”´ Ø¹Ø§Ø¬Ù„ Ø¬Ø¯Ø§Ù‹';
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
                                                <span>Ù…ÙˆØ¹Ø¯ Ø§Ù„ØªØ°ÙƒÙŠØ± Ø§Ù„Ù…Ø­Ø¯Ø¯ (Ø§Ù„ÙŠÙˆÙ… Ø§Ù„Ù…Ø³ØªÙ‡Ø¯Ù)</span>
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
                                            <span className="text-[10.5px] text-slate-500 font-bold ml-1">ØªØ­Ø¯ÙŠØ¯ Ø³Ø±ÙŠØ¹:</span>
                                            {[
                                                { label: 'Ø§Ù„ÙŠÙˆÙ…', daysToAdd: 0 },
                                                { label: 'ØºØ¯Ø§Ù‹', daysToAdd: 1 },
                                                { label: 'Ø¨Ø¹Ø¯ 3 Ø£ÙŠØ§Ù…', daysToAdd: 3 },
                                                { label: 'Ø¨Ø¹Ø¯ Ø£Ø³Ø¨ÙˆØ¹', daysToAdd: 7 },
                                                { label: 'Ø¨Ø¹Ø¯ Ø£Ø³Ø¨ÙˆØ¹ÙŠÙ†', daysToAdd: 14 },
                                                { label: 'Ø¨Ø¹Ø¯ Ø´Ù‡Ø± (30 ÙŠÙˆÙ…)', daysToAdd: 30 },
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
                                            Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ (Email)
                                        </label>
                                        <div className="relative">
                                            <i className="fa-solid fa-envelope absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                            <input
                                                type="text"
                                                value={formData.email}
                                                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                                                placeholder="example@domain.com"
                                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dir-ltr text-right"
                                            />
                                        </div>
                                    </div>

                                    {/* Passwords (Grid of 2) */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                                {currentSheetId === 'account_data' && ((formData.accountCategory || activeAccountCategory) === 'capcut' || (formData.accountCategory || activeAccountCategory) === 'chatgpt_shared')
                                                    ? 'Password'
                                                    : (isClientOrMerchant || currentSheetId === 'account_data') ? 'Outlook Password' : 'ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± 1 (Password)'}
                                            </label>
                                            <div className="relative">
                                                <i className="fa-solid fa-lock absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                                <input
                                                    type="text"
                                                    value={formData.password}
                                                    onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                                                    placeholder={currentSheetId === 'account_data' && (formData.accountCategory || activeAccountCategory) === 'capcut'
                                                        ? 'CapCut password'
                                                        : currentSheetId === 'account_data' && (formData.accountCategory || activeAccountCategory) === 'chatgpt_shared'
                                                        ? 'ChatGPT password'
                                                        : currentSheetId === 'account_data' ? 'Outlook password' : 'ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± Ø§Ù„Ø±Ø¦ÙŠØ³ÙŠØ©'}
                                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dir-ltr text-right"
                                                />
                                            </div>
                                        </div>

                                        {!(currentSheetId === 'account_data' && ((formData.accountCategory || activeAccountCategory) === 'capcut' || (formData.accountCategory || activeAccountCategory) === 'chatgpt_shared')) && (
                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                                {currentSheetId === 'account_data' && (formData.accountCategory || activeAccountCategory) === 'chatgpt_shared'
                                                    ? 'ChatGPT Password'
                                                    : (isClientOrMerchant || currentSheetId === 'account_data') ? 'Adobe Password' : 'ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± 2 (Password 2)'}
                                            </label>
                                            <div className="relative">
                                                <i className="fa-solid fa-key absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                                <input
                                                    type="text"
                                                    value={formData.password2}
                                                    onChange={(e) => setFormData(prev => ({ ...prev, password2: e.target.value }))}
                                                    placeholder={currentSheetId === 'account_data' && (formData.accountCategory || activeAccountCategory) === 'chatgpt_shared'
                                                        ? 'ChatGPT password'
                                                        : currentSheetId === 'account_data' ? 'Adobe password' : 'ÙƒÙ„Ù…Ø© Ù…Ø±ÙˆØ± Ø¨Ø¯ÙŠÙ„Ø© / ÙƒÙˆØ¯ Ø¥Ø¶Ø§ÙÙŠ'}
                                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dir-ltr text-right"
                                                />
                                            </div>
                                        </div>
                                        )}
                                    </div>
                                </>
                            )}

                            {/* Duration & Start Date (for Client / Merchant) */}
                            {(isClientOrMerchant || currentSheetId === 'account_data') && (
                                <>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {/* Duration (Custom Dropdown matching design) */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                                Ù…Ø¯Ø© Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ
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
                                                        {formData.duration || 'Ø§Ø®ØªØ± Ù…Ø¯Ø© Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ'}
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
                                                            setFormData(prev => ({ ...prev, duration: '' }));
                                                            setIsDurationDropdownOpen(false);
                                                        }}
                                                        className={`w-full px-4 py-3 flex items-center justify-end gap-2.5 transition text-xs font-bold ${
                                                            !formData.duration
                                                                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                                                                : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                                                        }`}
                                                    >
                                                        <span>Ø§Ø®ØªØ± Ù…Ø¯Ø© Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ (Ù…Ù† Ø´Ù‡Ø± Ø¥Ù„Ù‰ 4 Ø´Ù‡ÙˆØ±)</span>
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
                                                                    setFormData(prev => ({ ...prev, duration: item.value }));
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

                                    {/* Start Date (ØªØ§Ø±ÙŠØ® Ø¨Ø¯Ø§ÙŠØ© Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ) */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                                ØªØ§Ø±ÙŠØ® Ø¨Ø¯Ø§ÙŠØ© Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ
                                            </label>
                                            <button
                                                type="button"
                                                onClick={() => setFormData(prev => ({ ...prev, startDate: new Date().toISOString().slice(0, 10) }))}
                                                className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-bold"
                                                title="ØªØ¹ÙŠÙŠÙ† Ù„ØªØ§Ø±ÙŠØ® Ø§Ù„ÙŠÙˆÙ…"
                                            >
                                                Ø§Ù„ÙŠÙˆÙ…
                                            </button>
                                        </div>

                                        <div className="relative">
                                            <input
                                                type="date"
                                                value={formData.startDate}
                                                onChange={(e) => setFormData(prev => ({ ...prev, startDate: e.target.value }))}
                                                className="w-full bg-white dark:bg-slate-850 border-2 border-slate-200 dark:border-slate-700 hover:border-blue-400 focus:border-blue-500 rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition cursor-pointer"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Ù†ÙˆØ¹ Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ: Ø´Ø®ØµÙŠ Ø£Ù… Ù…Ø´ØªØ±Ùƒ */}
                                <div className="space-y-1.5 pt-1">
                                    <div className="flex items-center justify-between">
                                        <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                            Ù†ÙˆØ¹ Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ (Ø´Ø®ØµÙŠ Ø£Ù… Ù…Ø´ØªØ±Ùƒ)
                                        </label>
                                        <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${
                                            (formData.deviceType === 'Ø´Ø®ØµÙŠ' || formData.deviceType === 'Ø¬Ù‡Ø§Ø²ÙŠÙ†')
                                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 ring-1 ring-emerald-500/30'
                                                : 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 ring-1 ring-purple-500/30'
                                        }`}>
                                            {(formData.deviceType === 'Ø´Ø®ØµÙŠ' || formData.deviceType === 'Ø¬Ù‡Ø§Ø²ÙŠÙ†') ? 'ðŸŸ¢ Ø´Ø®ØµÙŠ â€” ÙŠØ®ØµÙ… Ø§Ù„Ø¬Ù‡Ø§Ø²ÙŠÙ†' : 'ðŸŸ£ Ù…Ø´ØªØ±Ùƒ â€” ÙŠØ®ØµÙ… Ø¬Ù‡Ø§Ø² ÙˆØ§Ø­Ø¯'}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2.5">
                                        {/* Ø´Ø®ØµÙŠ */}
                                        <button
                                            type="button"
                                            onClick={() => handleSetDeviceType('Ø´Ø®ØµÙŠ')}
                                            className={`py-3 px-3 rounded-2xl border-2 text-xs font-bold flex flex-col items-center justify-center gap-1.5 transition select-none cursor-pointer ${
                                                (formData.deviceType === 'Ø´Ø®ØµÙŠ' || formData.deviceType === 'Ø¬Ù‡Ø§Ø²ÙŠÙ†')
                                                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-sm ring-2 ring-emerald-500/20'
                                                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-850'
                                            }`}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <i className="fa-solid fa-user-shield text-base text-emerald-500"></i>
                                                <span className="text-sm font-black">Ø´Ø®ØµÙŠ</span>
                                            </div>
                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">Ø§Ù„Ø¬Ù‡Ø§Ø²ÙŠÙ† Ù„Ù„Ø¹Ù…ÙŠÙ„ (2 slots)</span>
                                        </button>

                                        {/* Ù…Ø´ØªØ±Ùƒ */}
                                        <button
                                            type="button"
                                            onClick={() => handleSetDeviceType('Ù…Ø´ØªØ±Ùƒ')}
                                            className={`py-3 px-3 rounded-2xl border-2 text-xs font-bold flex flex-col items-center justify-center gap-1.5 transition select-none cursor-pointer ${
                                                (formData.deviceType !== 'Ø´Ø®ØµÙŠ' && formData.deviceType !== 'Ø¬Ù‡Ø§Ø²ÙŠÙ†')
                                                    ? 'border-purple-500 bg-purple-500/10 text-purple-600 dark:text-purple-400 shadow-sm ring-2 ring-purple-500/20'
                                                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-850'
                                            }`}
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <i className="fa-solid fa-laptop text-base text-purple-500"></i>
                                                <span className="text-sm font-black">Ù…Ø´ØªØ±Ùƒ</span>
                                            </div>
                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">Ø¬Ù‡Ø§Ø² ÙˆØ§Ø­Ø¯ Ù„Ù„Ø¹Ù…ÙŠÙ„ (1 slot)</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Ø­Ø§Ù„Ø© Ø§Ù„Ø¯ÙØ¹: Ù…Ø¯ÙÙˆØ¹ ÙˆÙ„Ø§ ØºÙŠØ± Ù…Ø¯ÙÙˆØ¹ */}
                                <div className="space-y-1.5 pt-1">
                                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                                        Ø­Ø§Ù„Ø© Ø§Ù„Ø¯ÙØ¹
                                    </label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, paymentStatus: 'Ù…Ø¯ÙÙˆØ¹' }))}
                                            className={`py-2.5 px-4 rounded-2xl border-2 text-xs font-bold flex items-center justify-center gap-2.5 transition select-none cursor-pointer ${
                                                formData.paymentStatus === 'Ù…Ø¯ÙÙˆØ¹' || !formData.paymentStatus
                                                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-sm ring-2 ring-emerald-500/20'
                                                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-850'
                                            }`}
                                        >
                                            <i className="fa-solid fa-circle-check text-base text-emerald-500"></i>
                                            <span className="text-sm">Ù…Ø¯ÙÙˆØ¹</span>
                                        </button>

                                        <button
                                            type="button"
                                            onClick={() => setFormData(prev => ({ ...prev, paymentStatus: 'ØºÙŠØ± Ù…Ø¯ÙÙˆØ¹' }))}
                                            className={`py-2.5 px-4 rounded-2xl border-2 text-xs font-bold flex items-center justify-center gap-2.5 transition select-none cursor-pointer ${
                                                formData.paymentStatus === 'ØºÙŠØ± Ù…Ø¯ÙÙˆØ¹'
                                                    ? 'border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400 shadow-sm ring-2 ring-rose-500/20'
                                                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-850'
                                            }`}
                                        >
                                            <i className="fa-solid fa-circle-xmark text-base text-rose-500"></i>
                                            <span className="text-sm">ØºÙŠØ± Ù…Ø¯ÙÙˆØ¹</span>
                                        </button>
                                    </div>
                                </div>

                                </>
                            )}

                            {/* Specifically for Account Data Sheet: Account Creation Date & Reminder Period */}
                            {currentSheetId === 'account_data' && (
                                <div className="p-3.5 bg-slate-50/80 dark:bg-slate-850 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
                                    <div className="flex items-center gap-2 text-slate-700 dark:text-slate-200 font-bold text-xs">
                                        <i className="fa-solid fa-layer-group text-sm text-indigo-500"></i>
                                        <span>Ù†ÙˆØ¹ Ø§Ù„Ø­Ø³Ø§Ø¨</span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                        {ACCOUNT_CATEGORIES.map(cat => {
                                            const active = (formData.accountCategory || activeAccountCategory) === cat.id;
                                            return (
                                                <button
                                                    key={cat.id}
                                                    type="button"
                                                    onClick={() => setFormData(prev => ({
                                                        ...prev,
                                                        accountCategory: cat.id,
                                                        maxUses: cat.id === 'chatgpt_shared' ? (prev.sharedUsers || 1) : (cat.id === 'capcut' ? 1 : prev.maxUses),
                                                        capcutMonthlyReminder: cat.id === 'capcut',
                                                        capcutMonths: cat.id === 'capcut' ? (prev.capcutMonths || 2) : prev.capcutMonths,
                                                        accountCreatedDate: (cat.id === 'capcut' || cat.id === 'chatgpt_shared') ? (prev.accountCreatedDate || new Date().toISOString().slice(0, 10)) : prev.accountCreatedDate,
                                                        reminderDays: cat.id === 'chatgpt_shared' ? '30' : prev.reminderDays
                                                    }))}
                                                    className={`px-3 py-2.5 rounded-xl border text-xs font-black flex items-center justify-center gap-2 transition ${
                                                        active
                                                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                                                    }`}
                                                >
                                                    <i className={`fa-solid ${cat.icon}`}></i>
                                                    <span>{cat.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {(formData.accountCategory || activeAccountCategory) === 'capcut' && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">Subscription months</label>
                                                <input
                                                    type="number"
                                                    min="2"
                                                    value={formData.capcutMonths || 2}
                                                    onChange={(e) => setFormData(prev => ({ ...prev, capcutMonths: e.target.value }))}
                                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">Subscription start date</label>
                                                <input
                                                    type="date"
                                                    value={formData.accountCreatedDate || new Date().toISOString().slice(0, 10)}
                                                    onChange={(e) => setFormData(prev => ({ ...prev, accountCreatedDate: e.target.value }))}
                                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {(formData.accountCategory || activeAccountCategory) === 'chatgpt_shared' && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">Ø¹Ø¯Ø¯ Ø§Ù„Ø£Ø´Ø®Ø§Øµ Ø¹Ù„Ù‰ Ø§Ù„Ø­Ø³Ø§Ø¨</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    value={formData.sharedUsers || 1}
                                                    onChange={(e) => setFormData(prev => ({ ...prev, sharedUsers: e.target.value }))}
                                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">Ù…ÙŠØ¹Ø§Ø¯ Ø§Ù„ØªØ¬Ø¯ÙŠØ¯</label>
                                                <input
                                                    type="date"
                                                    value={formData.accountCreatedDate || new Date().toISOString().slice(0, 10)}
                                                    onChange={(e) => setFormData(prev => ({ ...prev, accountCreatedDate: e.target.value, startDate: e.target.value, reminderDays: '30' }))}
                                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                />
                                            </div>
                                            <div className="sm:col-span-2">
                                                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">2FA auth link</label>
                                                <input
                                                    type="text"
                                                    value={formData.twoFaLink || ''}
                                                    onChange={(e) => setFormData(prev => ({ ...prev, twoFaLink: e.target.value }))}
                                                    placeholder="https://..."
                                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 dir-ltr text-left"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Specifically for Account Data Sheet: Account Creation Date & Reminder Period */}
                            {currentSheetId === 'account_data' && (formData.accountCategory || activeAccountCategory) === 'adobe' && (
                                <div className="p-3.5 bg-purple-50/60 dark:bg-purple-950/30 rounded-2xl border border-purple-200/70 dark:border-purple-800/50 space-y-3">
                                    <div className="flex items-center gap-2 text-purple-700 dark:text-purple-300 font-bold text-xs">
                                        <i className="fa-solid fa-clock-rotate-left text-sm"></i>
                                        <span>Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„ØªØ°ÙƒÙŠØ± ÙˆØªØ§Ø±ÙŠØ® Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ø­Ø³Ø§Ø¨</span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {/* Creation Date */}
                                        <div>
                                            <div className="flex items-center justify-between mb-1.5">
                                                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                                    ØªØ§Ø±ÙŠØ® Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ø­Ø³Ø§Ø¨
                                                </label>
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, accountCreatedDate: new Date().toISOString().slice(0, 10) })}
                                                    className="text-[10px] font-bold text-purple-600 hover:text-purple-700 dark:text-purple-400 bg-purple-100/80 dark:bg-purple-900/60 px-2 py-0.5 rounded-md transition"
                                                >
                                                    Ø§Ù„ÙŠÙˆÙ…
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
                                                ÙØªØ±Ø© Ø§Ù„ØªØ°ÙƒÙŠØ± (Ø¹Ø¯Ø¯ Ø§Ù„Ø£ÙŠØ§Ù…)
                                            </label>
                                            <div className="relative">
                                                <i className="fa-solid fa-bell absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="3650"
                                                    value={formData.reminderDays}
                                                    onChange={(e) => setFormData({ ...formData, reminderDays: e.target.value })}
                                                    placeholder="Ù…Ø«Ø§Ù„: 20"
                                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Quick chips for reminder days */}
                                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                        <span className="text-[10.5px] text-slate-400 font-bold ml-1">Ø®ÙŠØ§Ø±Ø§Øª Ø³Ø±ÙŠØ¹Ø©:</span>
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
                                                {days} ÙŠÙˆÙ…
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
                                                    <span>Ù…ÙˆØ¹Ø¯ Ø§Ù„ØªØ°ÙƒÙŠØ±: <strong>{reminderPreview.targetDate}</strong></span>
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
                                currentSheetId !== 'account_data' || (formData.accountCategory || activeAccountCategory) === 'adobe'
                            ) && (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                                ÙƒÙˆØ¯ Ø§Ù„ÙØ§ØªÙˆØ±Ø© (Invoice Code)
                                            </label>
                                            <div className="relative">
                                                <i className="fa-solid fa-file-invoice absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                                                <input
                                                    type="text"
                                                    value={formData.invoiceNumber}
                                                    onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                                                    placeholder="Ù…Ø«Ø§Ù„: INV-100234"
                                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pr-9 pl-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                                                Ø§Ù„ÙÙŠØ²Ø§ / Ø±Ù‚Ù… Ø§Ù„Ø¨Ø·Ø§Ù‚Ø© (Visa)
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
                                    {currentSheetId === 'reminders_data' ? 'ØªÙØ§ØµÙŠÙ„ ÙˆÙ…Ù„Ø§Ø­Ø¸Ø§Øª Ø§Ù„ØªØ°ÙƒÙŠØ±' : 'Ù…Ù„Ø§Ø­Ø¸Ø§Øª Ø¥Ø¶Ø§ÙÙŠØ©'}
                                </label>
                                <textarea
                                    rows={currentSheetId === 'reminders_data' ? 3 : 2}
                                    value={formData.notes}
                                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                                    placeholder={currentSheetId === 'reminders_data' ? 'Ø§ÙƒØªØ¨ Ø£ÙŠ ØªÙØ§ØµÙŠÙ„ØŒ Ø£Ø±Ù‚Ø§Ù… ØªÙˆØ§ØµÙ„ØŒ Ø­Ø³Ø§Ø¨Ø§ØªØŒ Ø£Ùˆ Ù…Ù„Ø§Ø­Ø¸Ø§Øª Ù‡Ø§Ù…Ø© ØªØ®Øµ Ø§Ù„ØªØ°ÙƒÙŠØ±...' : 'Ø£ÙŠ ØªÙØ§ØµÙŠÙ„ Ø£Ùˆ Ù…Ù„Ø§Ø­Ø¸Ø§Øª Ø¥Ø¶Ø§ÙÙŠØ©...'}
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
                                    <span>Ø¥Ù„ØºØ§Ø¡</span>
                                </button>
                                <button
                                    type="submit"
                                    className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition transform active:scale-95 flex items-center gap-1.5 cursor-pointer"
                                >
                                    <i className="fa-solid fa-check text-xs"></i>
                                    <span>{editingRecord ? 'Ø­ÙØ¸ Ø§Ù„ØªØ¹Ø¯ÙŠÙ„Ø§Øª' : 'Ø¥Ø¶Ø§ÙØ© Ø§Ù„Ø³Ø¬Ù„'}</span>
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
                                    <h3 className="font-black text-lg text-slate-800 dark:text-white">Ø¥Ø¶Ø§ÙØ© Ù…Ø¬Ù…Ø¹Ø© Ø³Ø±ÙŠØ¹Ø©</h3>
                                    <p className="text-xs text-slate-400">Ø¥Ø¶Ø§ÙØ© Ø¹Ø¯Ø© Ø£Ø³Ø·Ø± Ø¯ÙØ¹Ø© ÙˆØ§Ø­Ø¯Ø© Ø¥Ù„Ù‰ <b className="text-indigo-500">{currentSheet.name}</b></p>
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
                            <p className="font-bold text-slate-800 dark:text-slate-200">Ø§Ù„ØµÙŠØº Ø§Ù„Ù…Ø¯Ø¹ÙˆÙ…Ø© Ù„ÙƒÙ„ Ø³Ø·Ø± (Ù…ÙØµÙˆÙ„Ø© Ø¨Ù€ : Ø£Ùˆ | Ø£Ùˆ Tab):</p>
                            {isClientOrMerchant ? (
                                <>
                                    <p className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                                        email:pass1:pass2:duration:notes
                                    </p>
                                    <p className="text-[11px] text-slate-400">Ù…Ø«Ø§Ù„: user@mail.com:Pass123:PassAlt:1 Ø´Ù‡Ø±:Ø¹Ù…ÙŠÙ„ Ù…Ù…ÙŠØ²</p>
                                </>
                            ) : (
                                <>
                                    <p className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                                        email:pass:pass2:invoice:visa:visaAccount:notes
                                    </p>
                                    <p className="text-[11px] text-slate-400">Ù…Ø«Ø§Ù„: user@mail.com:Pass123:PassAlt:INV-99:4111222233334444:CIB Bank:Ø¹Ù…ÙŠÙ„ Ù…Ù…ÙŠØ²</p>
                                </>
                            )}
                        </div>

                        <form onSubmit={handleBulkAddSubmit} className="space-y-4">
                            <textarea
                                rows={8}
                                value={bulkText}
                                onChange={(e) => setBulkText(e.target.value)}
                                placeholder="Ø§Ù„ØµÙ‚ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª Ù‡Ù†Ø§ØŒ ÙƒÙ„ Ø³Ø·Ø± ÙŠÙ…Ø«Ù„ Ø³Ø¬Ù„Ø§Ù‹ Ù…Ù†ÙØµÙ„Ø§Ù‹..."
                                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50 dir-ltr text-left"
                            />

                            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                                <span className="text-xs text-slate-400">
                                    Ø¹Ø¯Ø¯ Ø§Ù„Ø£Ø³Ø·Ø±: <b className="text-slate-700 dark:text-slate-200">{bulkText.split('\n').filter(l => l.trim()).length}</b>
                                </span>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowBulkModal(false)}
                                        className="px-5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition"
                                    >
                                        Ø¥Ù„ØºØ§Ø¡
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-6 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-lg shadow-purple-600/30 transition transform active:scale-95"
                                    >
                                        Ø¥Ø¶Ø§ÙØ© Ø§Ù„Ø³Ø¬Ù„Ø§Øª
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
                            <h3 className="font-black text-base text-slate-800 dark:text-white">ØªØ¹Ø¯ÙŠÙ„ Ø§Ø³Ù… Ø§Ù„Ø´ÙŠØª</h3>
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
                                    Ø§Ø³Ù… Ø§Ù„Ø´ÙŠØª Ø§Ù„Ø¬Ø¯ÙŠØ¯
                                </label>
                                <input
                                    type="text"
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    placeholder="Ø£Ø¯Ø®Ù„ Ø§Ø³Ù… Ø§Ù„Ø´ÙŠØª"
                                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowRenameModal(false)}
                                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition"
                                >
                                    Ø¥Ù„ØºØ§Ø¡
                                </button>
                                <button
                                    type="submit"
                                    className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 transition"
                                >
                                    Ø­ÙØ¸ Ø§Ù„Ø§Ø³Ù…
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

        </div>
    );
}















