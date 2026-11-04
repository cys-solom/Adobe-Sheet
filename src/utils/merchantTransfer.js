import { accountEmailKey } from './duplicateAccounts.js';

export const TRANSFER_LABELS = {
    ready: 'جاهز للنقل',
    missing: 'غير موجود في بيانات العملاء',
    ineligible: 'الاشتراك ليس شخصي 4 شهور',
    ambiguous: 'أكثر من سجل مطابق، راجع البيانات',
    conflict: 'موجود بالفعل في بيانات التاجر',
    invalid: 'السجل بدون معرّف صالح'
};

const keys = record => [record?.email, record?.selectedAccount].map(accountEmailKey).filter(Boolean);
const isEligible = record => {
    const personal = ['شخصي', 'جهازين'].includes(record.deviceType)
        || record.accountUsageMode === 'personal' || record.saleType === 'personal';
    const duration = String(record.duration || '').trim().toLowerCase()
        .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    return personal && /^(?:4\s*(?:شهر|شهور|أشهر|اشهر|months?)|120\s*(?:يوم|days?))(?:\s*\(120\s*(?:يوم|days?)\))?$/.test(duration);
};

export function planMerchantTransfer(input, clients = [], merchants = []) {
    const emails = [...new Set((String(input).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(accountEmailKey))];
    return emails.map(email => {
        const matches = clients.filter(record => record && !record.deletedAt && keys(record).includes(email));
        const eligible = matches.filter(isEligible);
        if (!matches.length) return { email, status: 'missing' };
        if (!eligible.length) return { email, status: 'ineligible' };
        if (eligible.length !== 1) return { email, status: 'ambiguous' };
        const record = eligible[0];
        if (!record.id) return { email, status: 'invalid' };
        if (clients.filter(item => String(item?.id) === String(record.id)).length !== 1) return { email, status: 'ambiguous' };
        const recordKeys = keys(record);
        if (merchants.some(item => item && (String(item.id) === String(record.id)
            || keys(item).some(key => recordKeys.includes(key))))) return { email, status: 'conflict' };
        return { email, status: 'ready', record };
    });
}

export async function executeMerchantTransfer({ input, merchantName, expectedRecords }, { readSheets, writeSheets }) {
    const name = String(merchantName || '').trim();
    if (!name) throw new Error('اختر اسم التاجر أولاً');
    if (!expectedRecords?.length) throw new Error('لا توجد سجلات جاهزة للنقل');
    const sheets = await readSheets();
    const clients = sheets.client_data || [];
    const merchants = sheets.merchant_data || [];
    const ready = planMerchantTransfer(input, clients, merchants).filter(row => row.status === 'ready');
    const unique = [...new Map(ready.map(row => [String(row.record.id), row.record])).values()];
    if (unique.length !== expectedRecords.length || unique.some(record =>
        !expectedRecords.some(expected => String(expected.id) === String(record.id) && JSON.stringify(expected) === JSON.stringify(record)))) {
        throw new Error('البيانات اتغيرت منذ المعاينة. حدّث النتائج وراجعها قبل النقل.');
    }
    const ids = new Set(unique.map(record => String(record.id)));
    const at = new Date().toISOString();
    const moved = unique.map(record => ({
        ...record,
        name,
        merchantTransfer: { from: 'client_data', previousName: record.name || '', merchantName: name, transferredAt: at },
        updated_at: at
    }));
    const updatedClients = clients.filter(record => !ids.has(String(record?.id)));
    const updatedMerchants = [...moved, ...merchants];
    // One batch statement writes both sheets; never delete the source separately.
    await writeSheets([
        { sheet_id: 'client_data', records: updatedClients, updated_at: at },
        { sheet_id: 'merchant_data', records: updatedMerchants, updated_at: at }
    ]);
    return { count: moved.length };
}
