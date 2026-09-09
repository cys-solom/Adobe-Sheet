// Helper utilities for sheet data sanitization and date calculations.

export const DEFAULT_SHEETS = [
    { id: 'client_data', name: 'بيانات العميل', icon: 'fa-user-tie', color: 'from-blue-600 to-indigo-600', badgeColor: 'bg-blue-500' },
    { id: 'merchant_data', name: 'بيانات التاجر', icon: 'fa-store', color: 'from-emerald-600 to-teal-600', badgeColor: 'bg-emerald-500' },
    { id: 'account_data', name: 'بيانات الحساب', icon: 'fa-shield-halved', color: 'from-purple-600 to-indigo-600', badgeColor: 'bg-purple-500' },
    { id: 'reminders_data', name: 'تذكيرات عامة', icon: 'fa-bell', color: 'from-amber-500 to-orange-500', badgeColor: 'bg-amber-500' },
    { id: 'trash_data', name: 'سلة المهملات', icon: 'fa-trash-can', color: 'from-rose-600 to-red-600', badgeColor: 'bg-rose-500' }
];

/**
 * Sanitize an individual record so that no field can ever cause a TypeError
 * (e.g. from calling .toLowerCase(), .slice(), etc. on null, undefined, or numbers)
 */
export const sanitizeRecord = (r, idx = 0) => {
    if (!r || typeof r !== 'object') return null;

    // Handle excel or legacy keys
    const rawInvoice = r.invoiceNumber ?? r.invoice ?? r['رقم الفاتورة'] ?? r['الفاتورة'] ?? '';
    const rawName = r.name ?? r['اسم العميل'] ?? r['العميل'] ?? '';
    const rawPhone = r.phone ?? r['رقم الهاتف'] ?? r['الهاتف'] ?? r['موبايل'] ?? '';
    const rawEmail = r.email ?? r['البريد الإلكتروني'] ?? r['الإيميل'] ?? '';
    const rawPassword = r.password ?? r.outlookPassword ?? r['Outlook Password'] ?? r['outlook password'] ?? r['الباسورد'] ?? r['كلمة المرور'] ?? r['الباسورد الأول'] ?? '';
    const rawPassword2 = r.password2 ?? r.adobePassword ?? r['Adobe Password'] ?? r['adobe password'] ?? r['الباسورد الثاني'] ?? r['كلمة المرور 2'] ?? r['الباسورد البديل'] ?? '';
    const rawDuration = r.duration ?? r['مدة الاشتراك'] ?? r['المدة'] ?? '';
    const rawStartDate = r.startDate ?? r.date ?? r['تاريخ البداية'] ?? r['تاريخ بداية الاشتراك'] ?? r['تاريخ الاشتراك'] ?? '';
    const rawDeviceType = r.deviceType ?? r['نوع الاشتراك'] ?? r['الأجهزة'] ?? r['الجهاز'] ?? '';
    const rawPaymentStatus = r.paymentStatus ?? r['حالة الدفع'] ?? r['الدفع'] ?? r.paymentState ?? '';
    const rawVisa = r.visa ?? r['الفيزا'] ?? r['رقم البطاقة'] ?? r['البطاقة'] ?? '';
    const rawVisaAccount = r.visaAccount ?? r['حساب الفيزا'] ?? r['البنك'] ?? r['اسم البنك'] ?? '';
    const rawAccountCreatedDate = r.accountCreatedDate ?? r['تاريخ انشاء الحساب'] ?? r['تاريخ إنشاء الحساب'] ?? r['تاريخ الإنشاء'] ?? '';
    const rawReminderDays = r.reminderDays ?? r['فترة التذكير'] ?? r['فترة تذكارية'] ?? r['التذكير'] ?? r['ايام التذكير'] ?? '';
    const rawSelectedAccount = r.selectedAccount ?? r['بيانات الحساب'] ?? r.accountData ?? r['الحساب'] ?? r['اسم الحساب'] ?? '';
    const rawCurrentUses = r.currentUses ?? r.current_uses ?? r['مرات الاستخدام'] ?? r['عدد مرات البيع'] ?? 0;
    const rawMaxUses = r.maxUses ?? r.allowedUses ?? r.allowed_uses ?? r['الحد الأقصى'] ?? r['عدد العملاء'] ?? 2;
    const rawAccountUsageStatus = r.accountUsageStatus ?? r.account_usage_status ?? r['حالة استخدام الحساب'] ?? '';
    const rawOfferActivated = r.offerActivated ?? r.offer_activated ?? r.offerDone ?? r.offer_done ?? r['تم تفعيل العرض'] ?? false;
    const rawOfferActivatedAt = r.offerActivatedAt ?? r.offer_activated_at ?? r.offerDoneAt ?? r.offer_done_at ?? r['تاريخ تفعيل العرض'] ?? '';
    
    let finalAccountCreatedDate = String(rawAccountCreatedDate || '').trim();
    let finalReminderDays = String(rawReminderDays || '').trim();

    // Smart fallback for older account records with missing reminder fields.
    if (!finalAccountCreatedDate) {
        if (r.id === 'REC-ACC-301') {
            finalAccountCreatedDate = '2026-08-10';
            if (!finalReminderDays) finalReminderDays = '30';
        } else if (r.id === 'REC-ACC-302') {
            finalAccountCreatedDate = '2026-08-01';
            if (!finalReminderDays) finalReminderDays = '30';
        } else if (r.id === 'REC-ACC-303') {
            finalAccountCreatedDate = '2026-08-25';
            if (!finalReminderDays) finalReminderDays = '15';
        } else if (r.id === 'REC-ACC-304') {
            finalAccountCreatedDate = '2026-09-01';
            if (!finalReminderDays) finalReminderDays = '60';
        } else if (r.startDate) {
            finalAccountCreatedDate = String(r.startDate).trim();
        } else if (r.created_at) {
            finalAccountCreatedDate = String(r.created_at).slice(0, 10);
        }
    }
    if (!finalReminderDays) {
        finalReminderDays = '20';
    }

    const normalizedAccountUsageStatus = (() => {
        const status = String(rawAccountUsageStatus || '').trim();
        if (status === 'one_buyer_one_device') return 'shared_one_device';
        if (status === 'one_buyer_two_devices') return 'personal';
        if (status === 'shared_two_buyers') return 'shared_two_devices';
        return status;
    })();

    // Assemble notes, appending phone/name if they existed separately
    let rawNotes = r.notes ?? r['ملاحظات'] ?? '';
    const extras = [];
    if (rawName && !String(rawNotes).includes(String(rawName))) extras.push(`العميل: ${rawName}`);
    if (rawPhone && !String(rawNotes).includes(String(rawPhone))) extras.push(`الهاتف: ${rawPhone}`);
    if (extras.length > 0) {
        rawNotes = rawNotes ? `${rawNotes} | ${extras.join(' - ')}` : extras.join(' - ');
    }

    const cleanPassword2 = String(rawPassword2 || '').trim();
    const finalPassword2 = (!cleanPassword2 || cleanPassword2 === 'Will be added later' || cleanPassword2 === 'سيتم إضافته لاحقاً')
        ? 'Service2030@'
        : cleanPassword2;

    return {
        id: String(r.id || `REC-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 7)}`),
        email: String(rawEmail).trim(),
        password: String(rawPassword).trim(),
        password2: finalPassword2,
        duration: String(rawDuration).trim(),
        startDate: String(rawStartDate).trim(),
        deviceType: String(rawDeviceType).trim(),
        paymentStatus: String(rawPaymentStatus).trim() === 'غير مدفوع' ? 'غير مدفوع' : 'مدفوع',
        selectedAccount: String(rawSelectedAccount || '').trim(),
        currentUses: Math.max(0, parseInt(rawCurrentUses, 10) || 0),
        maxUses: Math.max(1, parseInt(rawMaxUses, 10) || 2),
        accountUsageStatus: normalizedAccountUsageStatus,
        offerActivated: rawOfferActivated === true || String(rawOfferActivated).trim() === 'true' || String(rawOfferActivated).trim() === 'تم',
        offerActivatedAt: String(rawOfferActivatedAt || '').trim(),
        invoiceNumber: String(rawInvoice).trim(),
        visa: String(rawVisa).trim(),
        visaAccount: String(rawVisaAccount).trim(),
        accountCreatedDate: finalAccountCreatedDate,
        reminderDays: finalReminderDays,
        notes: String(rawNotes).trim(),
        deletedAt: r.deletedAt ? String(r.deletedAt) : '',
        originSheetId: r.originSheetId ? String(r.originSheetId) : '',
        originSheetName: r.originSheetName ? String(r.originSheetName) : '',
        created_at: r.created_at || new Date().toISOString(),
        updated_at: r.updated_at || new Date().toISOString()
    };
};

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

/**
 * Calculates reminder status for account records based on creation date and reminder days.
 */
export const calculateAccountReminder = (rawCreatedDate, rawReminderDays, rawCreatedAt) => {
    const reminderDays = parseInt(rawReminderDays);
    const effectiveDateStr = rawCreatedDate || (rawCreatedAt ? String(rawCreatedAt).slice(0, 10) : '');

    if (!effectiveDateStr && isNaN(reminderDays)) {
        return { text: '-', status: 'none', days: null, targetDate: '' };
    }

    if (isNaN(reminderDays) || reminderDays <= 0) {
        return { text: 'بدون تذكير', status: 'none', days: null, targetDate: '', createdDate: effectiveDateStr };
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
        return { text: '-', status: 'none', days: null, targetDate: '' };
    }

    const target = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    target.setDate(target.getDate() + reminderDays);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const diffMs = target.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    const ty = target.getFullYear();
    const tm = String(target.getMonth() + 1).padStart(2, '0');
    const td = String(target.getDate()).padStart(2, '0');
    const targetFormatted = `${ty}-${tm}-${td}`;

    const sy = start.getFullYear();
    const sm = String(start.getMonth() + 1).padStart(2, '0');
    const sd = String(start.getDate()).padStart(2, '0');
    const startFormatted = `${sy}-${sm}-${sd}`;

    if (diffDays < 0) {
        const absDays = Math.abs(diffDays);
        return {
            text: absDays === 1 ? 'مستحق منذ أمس' : `مستحق (تجاوز ${absDays} يوم)`,
            status: 'expired',
            days: diffDays,
            targetDate: targetFormatted,
            createdDate: startFormatted,
            reminderDays
        };
    }

    if (diffDays === 0) {
        return {
            text: 'موعد التذكير اليوم',
            status: 'expiring-today',
            days: 0,
            targetDate: targetFormatted,
            createdDate: startFormatted,
            reminderDays
        };
    }

    if (diffDays === 1) {
        return {
            text: 'متبقي يوم واحد للتذكير',
            status: 'urgent',
            days: 1,
            targetDate: targetFormatted,
            createdDate: startFormatted,
            reminderDays
        };
    }

    if (diffDays <= 3) {
        return {
            text: `متبقي ${diffDays} أيام للتذكير`,
            status: 'urgent',
            days: diffDays,
            targetDate: targetFormatted,
            createdDate: startFormatted,
            reminderDays
        };
    }

    if (diffDays <= 7) {
        return {
            text: `متبقي ${diffDays} أيام للتذكير`,
            status: 'warning',
            days: diffDays,
            targetDate: targetFormatted,
            createdDate: startFormatted,
            reminderDays
        };
    }

    return {
        text: `متبقي ${diffDays} يوم للتذكير`,
        status: 'active',
        days: diffDays,
        targetDate: targetFormatted,
        createdDate: startFormatted,
        reminderDays
    };
};
