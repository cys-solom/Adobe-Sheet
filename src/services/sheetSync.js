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
    const { error } = await supabase.rpc('servicehub_sell_account', { p_record: record, p_account_id: String(accountId) });
    if (error) { status('error'); throw error; }
    // The transaction has committed. A refresh failure must not invite duplicate sales.
    try { await readCloudSheets(); notifySheets(); }
    catch { status('error'); }
    if (channel) await channel.send({ type: 'broadcast', event: 'changed', payload: {} });
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
