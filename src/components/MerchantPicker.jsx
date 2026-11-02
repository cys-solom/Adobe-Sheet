import { useState } from 'react';
import { sheetsAPI } from '../services/api';

export default function MerchantPicker({ value, onChange, sheets, onSaved, records }) {
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const configured = sheets.find(sheet => sheet.id === 'merchant_data')?.merchantNames;
    const names = [...new Set([
        ...(Array.isArray(configured) ? configured : []),
        ...records.map(record => record.name),
        value
    ].filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()))];

    const addMerchant = async () => {
        const name = draft.trim();
        if (!name || saving) return;
        setSaving(true);
        setError('');
        try {
            const latest = await sheetsAPI.getSheetsConfig();
            const config = latest.length ? latest : sheets;
            const existing = config.find(sheet => sheet.id === 'merchant_data');
            const previous = Array.isArray(existing?.merchantNames) ? existing.merchantNames : [];
            const match = previous.find(item => item.trim().toLowerCase() === name.toLowerCase());
            const selected = match || name;
            const updated = existing
                ? config.map(sheet => sheet.id === 'merchant_data'
                    ? { ...sheet, merchantNames: match ? previous : [...previous, name] } : sheet)
                : [...config, { id: 'merchant_data', name: 'بيانات التاجر', merchantNames: [name] }];
            await sheetsAPI.saveSheetsConfig(updated);
            onSaved(updated);
            onChange(selected);
            setDraft('');
        } catch {
            setError('تعذر حفظ اسم التاجر. حاول مرة أخرى.');
        } finally {
            setSaving(false);
        }
    };

    return <fieldset className='space-y-2' disabled={saving}>
        <label className='block text-xs font-bold' htmlFor='merchant-name'>اسم التاجر</label>
        <select id='merchant-name' required value={value || ''} onChange={event => onChange(event.target.value)}
            className='w-full border rounded-lg p-2 bg-white dark:bg-slate-800'>
            <option value=''>اختر التاجر</option>
            {names.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <div className='flex gap-2'>
            <input aria-label='اسم تاجر جديد' placeholder='اسم تاجر جديد' value={draft}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addMerchant(); } }}
                className='min-w-0 flex-1 border rounded-lg p-2 bg-white dark:bg-slate-800' />
            <button type='button' disabled={!draft.trim() || saving} onClick={addMerchant}
                className='border rounded-lg px-3 text-xs font-bold'>
                <i className={saving ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-plus'} aria-hidden='true' /> إضافة
            </button>
        </div>
        {error && <p role='alert' className='text-red-600 text-xs'>{error}</p>}
    </fieldset>;
}
