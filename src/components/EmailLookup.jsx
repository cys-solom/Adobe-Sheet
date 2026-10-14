import React, { useState } from 'react';
import { readCloudSheets } from '../services/sheetSync';
import { lookupEmails } from '../services/accountLookup';
import { sanitizeRecord } from '../utils/dataRepair';

export default function EmailLookup({ sheetsList }) {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [rows, setRows] = useState(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [filter, setFilter] = useState('all');
    const run = async () => {
        setBusy(true); setRows(null); setMessage('');
        try {
            const sheets = await readCloudSheets();
            const results = lookupEmails(input, Object.fromEntries(Object.entries(sheets).map(([id, records]) => [id, records.map(sanitizeRecord).filter(Boolean)])));
            setRows(results);
            if (!results.length) setMessage('لم يتم العثور على إيميلات صالحة');
        } catch { setMessage('تعذر تحميل البيانات. حاول مرة أخرى'); }
        finally { setBusy(false); }
    };
    const visible = (rows || []).filter(row => filter === 'all' || (filter === 'found' ? row.sheets.length > 0 : !row.sheets.length));
    const copy = async () => {
        try { await navigator.clipboard.writeText(visible.map(row => row.email).join('\n')); setMessage('تم النسخ'); }
        catch { setMessage('تعذر النسخ'); }
    };
    return <>
        <button type="button" onClick={() => setOpen(true)} className="px-3 py-2 border rounded-lg text-xs font-bold flex items-center gap-2"><i className="fa-solid fa-magnifying-glass" />Lookup الإيميلات</button>
        {open && <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <section role="dialog" aria-modal="true" aria-label="Lookup الإيميلات" dir="rtl" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                <header className="p-4 border-b flex justify-between items-center"><h3 className="font-bold">Lookup الإيميلات</h3><button title="إغلاق" aria-label="إغلاق" onClick={() => setOpen(false)} className="w-8 h-8"><i className="fa-solid fa-xmark" /></button></header>
                <div className="p-4 overflow-auto space-y-3">
                    <label className="block text-sm">الإيميلات<textarea aria-label="الإيميلات" dir="ltr" value={input} onChange={event => { setInput(event.target.value); setRows(null); setMessage(''); }} disabled={busy} rows={6} className="block w-full border rounded-lg p-3 bg-transparent font-mono text-xs mt-2" /></label>
                    <button disabled={busy || !input.trim()} onClick={run} className="bg-emerald-600 text-white px-4 py-2 rounded-lg disabled:opacity-50">{busy ? 'جاري الفحص...' : 'فحص'}</button>
                    {message && <p role="status" className="text-sm">{message}</p>}
                    {rows && <>
                        <div className="flex flex-wrap gap-2 items-center">
                            <select aria-label="نتائج الفحص" value={filter} onChange={event => setFilter(event.target.value)} className="border rounded-lg p-2 bg-white dark:bg-slate-800 text-sm">
                                <option value="all">الكل ({rows.length})</option>
                                <option value="found">مسجل ({rows.filter(row => row.sheets.length).length})</option>
                                <option value="missing">غير مسجل ({rows.filter(row => !row.sheets.length).length})</option>
                            </select>
                            <button title="نسخ النتائج المعروضة" aria-label="نسخ النتائج المعروضة" disabled={!visible.length} onClick={copy} className="w-9 h-9 border rounded-lg"><i className="fa-regular fa-copy" /></button>
                        </div>
                        <ul className="divide-y">{visible.map(row => <li key={row.email} className="py-2 flex flex-wrap gap-2 justify-between text-xs">
                            <span dir="ltr" className="font-mono break-all">{row.email}</span>
                            <span className={row.sheets.length ? 'text-emerald-600' : 'text-rose-600'}>{row.sheets.length ? row.sheets.map(id => sheetsList.find(sheet => sheet.id === id)?.name || (id === 'trash_data' ? 'المهملات' : id)).join('، ') : 'غير مسجل'}</span>
                        </li>)}</ul>
                    </>}
                </div>
            </section>
        </div>}
    </>;
}
