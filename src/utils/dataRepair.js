// Helper utilities for sheet data sanitization and date calculations.

export const DEFAULT_SHEETS = [
    { id: 'client_data', name: 'Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¹Ù…ÙŠÙ„', icon: 'fa-user-tie', color: 'from-blue-600 to-indigo-600', badgeColor: 'bg-blue-500' },
    { id: 'merchant_data', name: 'Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„ØªØ§Ø¬Ø±', icon: 'fa-store', color: 'from-emerald-600 to-teal-600', badgeColor: 'bg-emerald-500' },
    { id: 'account_data', name: 'Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨', icon: 'fa-shield-halved', color: 'from-purple-600 to-indigo-600', badgeColor: 'bg-purple-500' },
    { id: 'reminders_data', name: 'ØªØ°ÙƒÙŠØ±Ø§Øª Ø¹Ø§Ù…Ø©', icon: 'fa-bell', color: 'from-amber-500 to-orange-500', badgeColor: 'bg-amber-500' },
    { id: 'trash_data', name: 'Ø³Ù„Ø© Ø§Ù„Ù…Ù‡Ù…Ù„Ø§Øª', icon: 'fa-trash-can', color: 'from-rose-600 to-red-600', badgeColor: 'bg-rose-500' }
];

/**
 * Sanitize an individual record so that no field can ever cause a TypeError
 * (e.g. from calling .toLowerCase(), .slice(), etc. on null, undefined, or numbers)
 */
export const sanitizeRecord = (r, idx = 0) => {
    if (!r || typeof r !== 'object') return null;

    // Handle excel or legacy keys
    const rawInvoice = r.invoiceNumber ?? r.invoice ?? r['Ø±Ù‚Ù… Ø§Ù„ÙØ§ØªÙˆØ±Ø©'] ?? r['Ø§Ù„ÙØ§ØªÙˆØ±Ø©'] ?? '';
    const rawName = r.name ?? r['Ø§Ø³Ù… Ø§Ù„Ø¹Ù…ÙŠÙ„'] ?? r['Ø§Ù„Ø¹Ù…ÙŠÙ„'] ?? '';
    const rawPhone = r.phone ?? r['Ø±Ù‚Ù… Ø§Ù„Ù‡Ø§ØªÙ'] ?? r['Ø§Ù„Ù‡Ø§ØªÙ'] ?? r['Ù…ÙˆØ¨Ø§ÙŠÙ„'] ?? '';
    const rawContactChannel = r.contactChannel ?? r.contact_channel ?? r['ÙˆØ³ÙŠÙ„Ø© Ø§Ù„ØªÙˆØ§ØµÙ„'] ?? r['Ø·Ø±ÙŠÙ‚Ø© Ø§Ù„ØªÙˆØ§ØµÙ„'] ?? '';
    const rawEmail = r.email ?? r['Ø§Ù„Ø¨Ø±ÙŠØ¯ Ø§Ù„Ø¥Ù„ÙƒØªØ±ÙˆÙ†ÙŠ'] ?? r['Ø§Ù„Ø¥ÙŠÙ…ÙŠÙ„'] ?? '';
    const rawPassword = r.password ?? r.outlookPassword ?? r['Outlook Password'] ?? r['outlook password'] ?? r['Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯'] ?? r['ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ±'] ?? r['Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯ Ø§Ù„Ø£ÙˆÙ„'] ?? '';
    const rawPassword2 = r.password2 ?? r.adobePassword ?? r['Adobe Password'] ?? r['adobe password'] ?? r['Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯ Ø§Ù„Ø«Ø§Ù†ÙŠ'] ?? r['ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± 2'] ?? r['Ø§Ù„Ø¨Ø§Ø³ÙˆØ±Ø¯ Ø§Ù„Ø¨Ø¯ÙŠÙ„'] ?? '';
    const rawDuration = r.duration ?? r['Ù…Ø¯Ø© Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ'] ?? r['Ø§Ù„Ù…Ø¯Ø©'] ?? '';
    const rawStartDate = r.startDate ?? r.date ?? r['ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©'] ?? r['ØªØ§Ø±ÙŠØ® Ø¨Ø¯Ø§ÙŠØ© Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ'] ?? r['ØªØ§Ø±ÙŠØ® Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ'] ?? '';
    const rawDeviceType = r.deviceType ?? r['Ù†ÙˆØ¹ Ø§Ù„Ø§Ø´ØªØ±Ø§Ùƒ'] ?? r['Ø§Ù„Ø£Ø¬Ù‡Ø²Ø©'] ?? r['Ø§Ù„Ø¬Ù‡Ø§Ø²'] ?? '';
    const rawPaymentStatus = r.paymentStatus ?? r['Ø­Ø§Ù„Ø© Ø§Ù„Ø¯ÙØ¹'] ?? r['Ø§Ù„Ø¯ÙØ¹'] ?? r.paymentState ?? '';
    const rawVisa = r.visa ?? r['Ø§Ù„ÙÙŠØ²Ø§'] ?? r['Ø±Ù‚Ù… Ø§Ù„Ø¨Ø·Ø§Ù‚Ø©'] ?? r['Ø§Ù„Ø¨Ø·Ø§Ù‚Ø©'] ?? '';
    const rawVisaAccount = r.visaAccount ?? r['Ø­Ø³Ø§Ø¨ Ø§Ù„ÙÙŠØ²Ø§'] ?? r['Ø§Ù„Ø¨Ù†Ùƒ'] ?? r['Ø§Ø³Ù… Ø§Ù„Ø¨Ù†Ùƒ'] ?? '';
    const rawAccountCreatedDate = r.accountCreatedDate ?? r['ØªØ§Ø±ÙŠØ® Ø§Ù†Ø´Ø§Ø¡ Ø§Ù„Ø­Ø³Ø§Ø¨'] ?? r['ØªØ§Ø±ÙŠØ® Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„Ø­Ø³Ø§Ø¨'] ?? r['ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡'] ?? '';
    const rawReminderDays = r.reminderDays ?? r['ÙØªØ±Ø© Ø§Ù„ØªØ°ÙƒÙŠØ±'] ?? r['ÙØªØ±Ø© ØªØ°ÙƒØ§Ø±ÙŠØ©'] ?? r['Ø§Ù„ØªØ°ÙƒÙŠØ±'] ?? r['Ø§ÙŠØ§Ù… Ø§Ù„ØªØ°ÙƒÙŠØ±'] ?? '';
    const rawSelectedAccount = r.selectedAccount ?? r['Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø­Ø³Ø§Ø¨'] ?? r.accountData ?? r['Ø§Ù„Ø­Ø³Ø§Ø¨'] ?? r['Ø§Ø³Ù… Ø§Ù„Ø­Ø³Ø§Ø¨'] ?? '';
    const rawCurrentUses = r.currentUses ?? r.current_uses ?? r['Ù…Ø±Ø§Øª Ø§Ù„Ø§Ø³ØªØ®Ø¯Ø§Ù…'] ?? r['Ø¹Ø¯Ø¯ Ù…Ø±Ø§Øª Ø§Ù„Ø¨ÙŠØ¹'] ?? 0;
    const rawMaxUses = r.maxUses ?? r.allowedUses ?? r.allowed_uses ?? r['Ø§Ù„Ø­Ø¯ Ø§Ù„Ø£Ù‚ØµÙ‰'] ?? r['Ø¹Ø¯Ø¯ Ø§Ù„Ø¹Ù…Ù„Ø§Ø¡'] ?? 2;
    const rawAccountUsageStatus = r.accountUsageStatus ?? r.account_usage_status ?? r['Ø­Ø§Ù„Ø© Ø§Ø³ØªØ®Ø¯Ø§Ù… Ø§Ù„Ø­Ø³Ø§Ø¨'] ?? '';
    const rawOfferActivated = r.offerActivated ?? r.offer_activated ?? r.offerDone ?? r.offer_done ?? r['ØªÙ… ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¹Ø±Ø¶'] ?? false;
    const rawOfferActivatedAt = r.offerActivatedAt ?? r.offer_activated_at ?? r.offerDoneAt ?? r.offer_done_at ?? r['ØªØ§Ø±ÙŠØ® ØªÙØ¹ÙŠÙ„ Ø§Ù„Ø¹Ø±Ø¶'] ?? '';
    const rawAccountCategory = r.accountCategory ?? r.account_category ?? '';
    const rawCapcutMonthlyReminder = r.capcutMonthlyReminder ?? r.capcut_monthly_reminder ?? false;
    const rawCapcutMonths = r.capcutMonths ?? r.capcut_months ?? '';
    const rawSharedUsers = r.sharedUsers ?? r.shared_users ?? '';
    const rawRenewalDate = r.renewalDate ?? r.renewal_date ?? '';
    const rawTwoFaLink = r.twoFaLink ?? r.two_fa_link ?? r.authLink ?? r.auth_link ?? '';
    const rawRenewalStatus = r.renewalStatus ?? r.renewal_status ?? '';
    const rawNonRenewedAt = r.nonRenewedAt ?? r.non_renewed_at ?? '';
    const rawReleasedAccountAt = r.releasedAccountAt ?? r.released_account_at ?? '';
    const rawReusedAfterExpiry = r.reusedAfterExpiry ?? r.reused_after_expiry ?? false;
    const rawLastReleasedFromCustomer = r.lastReleasedFromCustomer ?? r.last_released_from_customer ?? '';

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

    let rawNotes = r.notes ?? r['Ù…Ù„Ø§Ø­Ø¸Ø§Øª'] ?? '';

    const normalizedAccountCategory = ['adobe', 'capcut', 'chatgpt_shared'].includes(String(rawAccountCategory || '').trim()) ? String(rawAccountCategory).trim() : 'adobe';
    const cleanPassword = String(rawPassword || '').trim();
    const cleanPassword2 = String(rawPassword2 || '').trim();
    const finalPassword = (normalizedAccountCategory === 'capcut' || normalizedAccountCategory === 'chatgpt_shared') && !cleanPassword && cleanPassword2 ? cleanPassword2 : cleanPassword;
    const finalPassword2 = normalizedAccountCategory === 'adobe' && (!cleanPassword2 || cleanPassword2 === 'Will be added later' || cleanPassword2 === 'Ø³ÙŠØªÙ… Ø¥Ø¶Ø§ÙØªÙ‡ Ù„Ø§Ø­Ù‚Ø§Ù‹')
        ? 'Service2030@'
        : (normalizedAccountCategory === 'capcut' || normalizedAccountCategory === 'chatgpt_shared') ? '' : cleanPassword2;

    return {
        id: String(r.id || `REC-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 7)}`),
        name: String(rawName).trim(),
        phone: String(rawPhone).trim(),
        contactChannel: String(rawContactChannel || '').trim(),
        email: String(rawEmail).trim(),
        password: finalPassword,
        password2: finalPassword2,
        duration: String(rawDuration).trim(),
        startDate: String(rawStartDate).trim(),
        deviceType: String(rawDeviceType).trim(),
        paymentStatus: String(rawPaymentStatus).trim() === 'ØºÙŠØ± Ù…Ø¯ÙÙˆØ¹' ? 'ØºÙŠØ± Ù…Ø¯ÙÙˆØ¹' : 'Ù…Ø¯ÙÙˆØ¹',
        selectedAccount: String(rawSelectedAccount || '').trim(),
        currentUses: normalizedAccountCategory === 'capcut' ? 1 : Math.max(0, parseInt(rawCurrentUses, 10) || (normalizedAccountCategory === 'chatgpt_shared' ? parseInt(rawSharedUsers, 10) || 0 : 0)),
        maxUses: normalizedAccountCategory === 'capcut' ? 1 : Math.max(1, parseInt(normalizedAccountCategory === 'chatgpt_shared' ? (rawSharedUsers || rawMaxUses) : rawMaxUses, 10) || 2),
        accountUsageStatus: normalizedAccountCategory === 'capcut' ? 'personal_full' : normalizedAccountUsageStatus,
        offerActivated: normalizedAccountCategory === 'adobe' && (rawOfferActivated === true || String(rawOfferActivated).trim() === 'true' || String(rawOfferActivated).trim() === 'ØªÙ…'),
        offerActivatedAt: normalizedAccountCategory === 'adobe' ? String(rawOfferActivatedAt || '').trim() : '',
        accountCategory: normalizedAccountCategory,
        capcutMode: '',
        capcutGiftUsed: false,
        capcutMonthlyReminder: normalizedAccountCategory === 'capcut' || rawCapcutMonthlyReminder === true || String(rawCapcutMonthlyReminder).trim() === 'true',
        capcutMonths: Math.max(1, parseInt(rawCapcutMonths, 10) || (normalizedAccountCategory === 'capcut' ? 2 : 1)),
        sharedUsers: Math.max(1, parseInt(rawSharedUsers, 10) || 1),
        renewalDate: String(rawRenewalDate || '').trim(),
        twoFaLink: String(rawTwoFaLink || '').trim(),
        renewalStatus: String(rawRenewalStatus || '').trim(),
        nonRenewedAt: String(rawNonRenewedAt || '').trim(),
        releasedAccountAt: String(rawReleasedAccountAt || '').trim(),
        reusedAfterExpiry: rawReusedAfterExpiry === true || String(rawReusedAfterExpiry).trim() === 'true',
        lastReleasedFromCustomer: String(rawLastReleasedFromCustomer || '').trim(),
        invoiceNumber: String(rawInvoice).trim(),
        visa: String(rawVisa).trim(),
        visaAccount: String(rawVisaAccount).trim(),
        accountCreatedDate: finalAccountCreatedDate,
        reminderDays: normalizedAccountCategory === 'capcut' || normalizedAccountCategory === 'chatgpt_shared' ? '30' : finalReminderDays,
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
        return { text: 'Ø¨Ø¯ÙˆÙ† ØªØ°ÙƒÙŠØ±', status: 'none', days: null, targetDate: '', createdDate: effectiveDateStr };
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
            text: absDays === 1 ? 'Ù…Ø³ØªØ­Ù‚ Ù…Ù†Ø° Ø£Ù…Ø³' : `Ù…Ø³ØªØ­Ù‚ (ØªØ¬Ø§ÙˆØ² ${absDays} ÙŠÙˆÙ…)`,
            status: 'expired',
            days: diffDays,
            targetDate: targetFormatted,
            createdDate: startFormatted,
            reminderDays
        };
    }

    if (diffDays === 0) {
        return {
            text: 'Ù…ÙˆØ¹Ø¯ Ø§Ù„ØªØ°ÙƒÙŠØ± Ø§Ù„ÙŠÙˆÙ…',
            status: 'expiring-today',
            days: 0,
            targetDate: targetFormatted,
            createdDate: startFormatted,
            reminderDays
        };
    }

    if (diffDays === 1) {
        return {
            text: 'Ù…ØªØ¨Ù‚ÙŠ ÙŠÙˆÙ… ÙˆØ§Ø­Ø¯ Ù„Ù„ØªØ°ÙƒÙŠØ±',
            status: 'urgent',
            days: 1,
            targetDate: targetFormatted,
            createdDate: startFormatted,
            reminderDays
        };
    }

    if (diffDays <= 3) {
        return {
            text: `Ù…ØªØ¨Ù‚ÙŠ ${diffDays} Ø£ÙŠØ§Ù… Ù„Ù„ØªØ°ÙƒÙŠØ±`,
            status: 'urgent',
            days: diffDays,
            targetDate: targetFormatted,
            createdDate: startFormatted,
            reminderDays
        };
    }

    if (diffDays <= 7) {
        return {
            text: `Ù…ØªØ¨Ù‚ÙŠ ${diffDays} Ø£ÙŠØ§Ù… Ù„Ù„ØªØ°ÙƒÙŠØ±`,
            status: 'warning',
            days: diffDays,
            targetDate: targetFormatted,
            createdDate: startFormatted,
            reminderDays
        };
    }

    return {
        text: `Ù…ØªØ¨Ù‚ÙŠ ${diffDays} ÙŠÙˆÙ… Ù„Ù„ØªØ°ÙƒÙŠØ±`,
        status: 'active',
        days: diffDays,
        targetDate: targetFormatted,
        createdDate: startFormatted,
        reminderDays
    };
};

