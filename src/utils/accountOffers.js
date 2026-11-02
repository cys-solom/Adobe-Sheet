import { calculateAccountReminder } from './dataRepair.js';

export function accountOfferState(record, now = new Date()) {
    const firstDone = record.offerFirstActivated !== undefined
        ? record.offerFirstActivated === true : record.offerActivated === true;
    const firstAt = record.offerFirstActivatedAt || (firstDone ? record.offerActivatedAt || '' : '');
    const start = String(record.accountCreatedDate || record.created_at || '').slice(0, 10);
    const date = new Date(start + 'T00:00:00');
    const due = new Date(date);
    due.setDate(due.getDate() + 100);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const second = firstDone && !Number.isNaN(due.getTime()) && today >= due;
    return {
        cycle: second ? 2 : 1,
        done: second ? record.offerSecondActivated === true : firstDone,
        firstDone,
        firstAt,
        days: second ? 100 : (record.reminderDays || 20)
    };
}

export function accountOfferReminder(record) {
    const state = accountOfferState(record);
    return calculateAccountReminder(record.accountCreatedDate, state.days, record.created_at);
}

export function toggleAccountOffer(record, now = new Date()) {
    const state = accountOfferState(record, now);
    const done = !state.done;
    const at = done ? now.toISOString() : '';
    return {
        ...record,
        offerFirstActivated: state.cycle === 1 ? done : state.firstDone,
        offerFirstActivatedAt: state.cycle === 1 ? at : state.firstAt,
        offerSecondActivated: state.cycle === 2 ? done : Boolean(record.offerSecondActivated),
        offerSecondActivatedAt: state.cycle === 2 ? at : record.offerSecondActivatedAt || '',
        offerActivated: done,
        offerActivatedAt: at,
        updated_at: now.toISOString()
    };
}
