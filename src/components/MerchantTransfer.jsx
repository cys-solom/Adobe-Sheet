import { useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import MerchantPicker from './MerchantPicker';
import { sheetsAPI } from '../services/api';
import { readCloudSheets, transferClientsToMerchant } from '../services/sheetSync';
import { planMerchantTransfer, TRANSFER_LABELS } from '../utils/merchantTransfer';

export default function MerchantTransfer({ sheetsList, onConfigSaved, onTransferred }) {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [merchant, setMerchant] = useState('');
    const [sheets, setSheets] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const rows = useMemo(() => sheets
        ? planMerchantTransfer(input, sheets.client_data || [], sheets.merchant_data || []) : [], [input, sheets]);
    const ready = [...new Map(rows.filter(row => row.status === 'ready').map(row => [String(row.record.id), row.record])).values()];

    const refresh = async () => {
        setLoading(true);
        setSheets(null);
        setMessage('');
        try {
            const [data, config] = await Promise.all([readCloudSheets(), sheetsAPI.getSheetsConfig()]);
            setSheets(data);
            if (config.length) onConfigSaved(config);
        } catch {
            setMessage('تعذر تحميل البيانات. اضغط تحديث النتائج للمحاولة مرة أخرى.');
        } finally {
            setLoading(false);
        }
    };
    const openDialog = () => {
        setInput('');
        setMerchant('');
        setOpen(true);
        refresh();
    };
    const submit = async event => {
        event.preventDefault();
        if (saving || loading || !merchant || !ready.length) return;
        setSaving(true);
        setMessage('');
        try {
            const result = await transferClientsToMerchant({ input, merchantName: merchant, expectedRecords: ready });
            setOpen(false);
            onTransferred(result.count, merchant);
        } catch (error) {
            setMessage(error.message || 'تعذر النقل، لم يتم تأكيد العملية.');
            setSheets(null);
        } finally {
            setSaving(false);
        }
    };

    return <Dialog.Root open={open} onOpenChange={value => { if (!saving && !loading) setOpen(value); }}>
        <Dialog.Trigger asChild>
            <button type='button' onClick={openDialog} className='px-3 py-2 border rounded-lg text-xs font-bold flex items-center gap-2'>
                <i className='fa-solid fa-arrow-right-arrow-left' aria-hidden='true' /> نقل إلى تاجر
            </button>
        </Dialog.Trigger>
        <Dialog.Portal>
            <Dialog.Overlay className='fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm' />
            <Dialog.Content dir='rtl' aria-describedby={undefined}
                onEscapeKeyDown={event => { if (saving || loading) event.preventDefault(); }}
                onPointerDownOutside={event => event.preventDefault()}
                className='fixed z-[10001] inset-0 m-auto h-fit w-[calc(100%-2rem)] max-w-2xl max-h-[calc(100dvh-2rem)] bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg shadow-2xl flex flex-col overflow-hidden'>
                <header className='flex items-center justify-between p-4 border-b shrink-0'>
                    <Dialog.Title className='font-bold text-base'>نقل حسابات العملاء إلى تاجر</Dialog.Title>
                    <Dialog.Close asChild><button type='button' disabled={saving || loading} aria-label='إغلاق' title='إغلاق' className='w-9 h-9'>
                        <i className='fa-solid fa-xmark' aria-hidden='true' />
                    </button></Dialog.Close>
                </header>
                <form onSubmit={submit} className='flex flex-col min-h-0'>
                    <div className='p-4 space-y-4 overflow-y-auto min-h-0 custom-modal-scroll'>
                        <fieldset disabled={loading || saving} className='space-y-4'>
                            <MerchantPicker value={merchant} onChange={setMerchant} sheets={sheetsList}
                                onSaved={onConfigSaved} records={sheets?.merchant_data || []} />
                            <label className='block text-sm font-bold' htmlFor='transfer-emails'>إيميلات العملاء</label>
                            <textarea id='transfer-emails' dir='ltr' rows={5} value={input}
                                onChange={event => { setInput(event.target.value); setMessage(''); }}
                                className='block w-full rounded-lg border p-3 bg-transparent font-mono text-sm' />
                        </fieldset>
                        <div className='flex flex-wrap items-center justify-between gap-2 text-xs'>
                            <span>{loading ? 'جاري تحميل البيانات...' : 'جاهز للنقل: ' + ready.length + ' | غير جاهز: ' + rows.filter(row => row.status !== 'ready').length}</span>
                            <button type='button' onClick={refresh} disabled={loading || saving} className='border rounded-lg px-3 py-2'>
                                <i className='fa-solid fa-rotate-right ml-1' aria-hidden='true' /> تحديث النتائج
                            </button>
                        </div>
                        {message && <p role='alert' className='text-sm text-red-600 dark:text-red-300'>{message}</p>}
                        {sheets && input.trim() && !rows.length && <p role='status' className='text-sm'>لم يتم العثور على إيميلات صالحة.</p>}
                        {!!rows.length && <div className='overflow-x-auto'>
                            <table className='w-full text-xs text-right'>
                                <thead><tr><th className='p-2'>الإيميل</th><th className='p-2'>الاسم الحالي</th><th className='p-2'>المدة</th><th className='p-2'>الحالة</th></tr></thead>
                                <tbody>{rows.map(row => <tr key={row.email} className='border-t'>
                                    <td dir='ltr' className='p-2 break-all'>{row.email}</td>
                                    <td className='p-2'>{row.record?.name || '-'}</td>
                                    <td className='p-2'>{row.record?.duration || '-'}</td>
                                    <td className={'p-2 ' + (row.status === 'ready' ? 'text-emerald-600' : 'text-rose-600')}>{TRANSFER_LABELS[row.status]}</td>
                                </tr>)}</tbody>
                            </table>
                        </div>}
                    </div>
                    <footer className='p-4 border-t flex flex-wrap justify-between gap-2 shrink-0'>
                        <Dialog.Close asChild><button type='button' disabled={saving || loading} className='border rounded-lg px-4 py-2'>إلغاء</button></Dialog.Close>
                        <button type='submit' disabled={saving || loading || !merchant || !ready.length}
                            className='bg-emerald-600 text-white rounded-lg px-4 py-2 font-bold text-sm disabled:opacity-50'>
                            <i className={saving ? 'fa-solid fa-spinner fa-spin ml-2' : 'fa-solid fa-arrow-right-arrow-left ml-2'} aria-hidden='true' />
                            {saving ? 'جاري النقل...' : 'نقل الجاهز إلى التاجر (' + ready.length + ')'}
                        </button>
                    </footer>
                </form>
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>;
}
