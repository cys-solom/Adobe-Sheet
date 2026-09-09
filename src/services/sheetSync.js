import { supabase, isConfigured } from '../lib/supabase';

export const SHEETS_CHANGED = 'servicehub:sheets-changed';
export const SYNC_STATUS = 'servicehub:sync-status';
let channel;
const status = (state) => window.dispatchEvent(new CustomEvent(SYNC_STATUS, { detail: state }));
export const notifySheets = () => window.dispatchEvent(new Event(SHEETS_CHANGED));

export async function readCloudSheets() {
    if (!isConfigured) throw new Error('قاعدة البيانات غير متصلة');
    const { data, error } = await supabase.from('custom_sheets_data').select('*');
    if (error) { status('error'); throw error; }
    const result = {};
    for (const row of data || []) {
        const cloudRecords = Array.isArray(row.records) ? row.records : [];
        result[row.sheet_id] = cloudRecords;
    }
    status('saved');
    return result;
}

export async function writeCloudSheet(sheetId, records) {
    if (!isConfigured) throw new Error('قاعدة البيانات غير متصلة');
    status('saving');
    const { error } = await supabase.from('custom_sheets_data').upsert({
        sheet_id: sheetId, records, updated_at: new Date().toISOString()
    });
    if (error) { status('error'); throw error; }
    status('saved');
    notifySheets();
    // Broadcast only an invalidation signal, never account credentials.
    if (channel) await channel.send({ type: 'broadcast', event: 'changed', payload: {} });
}

export async function sellCloudAccount(record, accountId) {
    if (!isConfigured) throw new Error('قاعدة البيانات غير متصلة');
    status('saving');

    // 1. Fetch current client_data and account_data rows
    const { data: sheetsData, error: readError } = await supabase
        .from('custom_sheets_data')
        .select('*')
        .in('sheet_id', ['client_data', 'account_data']);

    if (readError) {
        status('error');
        throw readError;
    }

    const clientRow = sheetsData?.find(r => r.sheet_id === 'client_data');
    const accountRow = sheetsData?.find(r => r.sheet_id === 'account_data');

    const clientRecords = Array.isArray(clientRow?.records) ? clientRow.records : [];
    const accountRecords = Array.isArray(accountRow?.records) ? accountRow.records : [];

    // 2. Prepend new record to client_data
    const newRecord = {
        ...record,
        id: record.id || ('REC-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7)),
        created_at: record.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    const updatedClientRecords = [newRecord, ...clientRecords.filter(r => r.id !== newRecord.id)];

    // 3. If accountId provided, update account usage in account_data
    let updatedAccountRecords = accountRecords;
    if (accountId) {
        const isTwoDevices = record.deviceType === 'جهازين' || record.accountUsageMode === 'personal';
        const delta = isTwoDevices ? 2 : 1;

        updatedAccountRecords = accountRecords.map(acc => {
            if (String(acc.id) !== String(accountId)) return acc;
            const maxUses = Math.max(1, Number(acc.maxUses || 2));
            const currentUses = Math.min(maxUses, Math.max(0, Number(acc.currentUses || 0) + delta));
            const accountUsageStatus = currentUses <= 0
                ? 'available'
                : currentUses >= maxUses
                ? (isTwoDevices ? 'shared_two_devices' : 'sold')
                : 'shared_one_device';

            return {
                ...acc,
                currentUses,
                maxUses,
                accountUsageStatus,
                updated_at: new Date().toISOString()
            };
        });
    }

    // 4. Save both sheets to Supabase
    const upsertRows = [
        { sheet_id: 'client_data', records: updatedClientRecords, updated_at: new Date().toISOString() }
    ];
    if (accountId) {
        upsertRows.push({
            sheet_id: 'account_data', records: updatedAccountRecords, updated_at: new Date().toISOString()
        });
    }

    const { error: upsertError } = await supabase
        .from('custom_sheets_data')
        .upsert(upsertRows);

    if (upsertError) {
        status('error');
        throw upsertError;
    }

    status('saved');
    notifySheets();
    if (channel) {
        try { await channel.send({ type: 'broadcast', event: 'changed', payload: {} }); } catch {}
    }
}

export function startSheetSync() {
    if (!isConfigured) { status('error'); return () => {}; }
    let stopped = false;
    let running = false;
    const refresh = async () => {
        if (running || stopped) return;
        running = true;
        try { await readCloudSheets(); if (!stopped) notifySheets(); }
        catch { if (!stopped) status('error'); }
        finally { running = false; }
    };
    channel = supabase.channel('servicehub-sheets');
    channel.on('broadcast', { event: 'changed' }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'custom_sheets_data' }, refresh)
        .subscribe();
    refresh();
    const interval = setInterval(refresh, 30000);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    return () => {
        stopped = true;
        clearInterval(interval);
        window.removeEventListener('online', refresh);
        window.removeEventListener('focus', refresh);
        supabase.removeChannel(channel);
        channel = null;
    };
}
