import test from 'node:test';
import assert from 'node:assert/strict';
import { accountOfferState, toggleAccountOffer } from './accountOffers.js';
import { sanitizeRecord } from './dataRepair.js';

const record = { id: 'test', accountCategory: 'adobe', accountCreatedDate: '2026-01-01', reminderDays: '20' };
const firstDate = new Date(2026, 0, 21, 12);
const beforeSecond = new Date(2026, 3, 10, 12);
const secondDate = new Date(2026, 3, 11, 12);

test('first activation stays checked until day 100, not 100 days after activation', () => {
    const first = toggleAccountOffer(record, firstDate);
    assert.equal(accountOfferState(first, beforeSecond).done, true);
    assert.equal(accountOfferState(first, secondDate).cycle, 2);
    assert.equal(accountOfferState(first, secondDate).done, false);
    assert.equal(accountOfferState(first, secondDate).days, 100);
});
test('same action completes second cycle and retains first activation through sanitization', () => {
    const first = toggleAccountOffer(record, firstDate);
    const second = sanitizeRecord(toggleAccountOffer(first, secondDate));
    assert.equal(second.offerFirstActivatedAt, firstDate.toISOString());
    assert.equal(second.offerSecondActivatedAt, secondDate.toISOString());
    assert.equal(accountOfferState(second, new Date(2027, 0, 1)).done, true);
    const undone = sanitizeRecord(toggleAccountOffer(second, secondDate));
    assert.equal(accountOfferState(undone, secondDate).done, false);
    assert.equal(undone.offerFirstActivatedAt, firstDate.toISOString());
});
test('legacy activation becomes first cycle and unknown dates do not trigger second cycle', () => {
    const legacy = { ...record, offerActivated: true, offerActivatedAt: firstDate.toISOString() };
    assert.equal(accountOfferState(legacy, secondDate).done, false);
    assert.equal(toggleAccountOffer(legacy, secondDate).offerFirstActivatedAt, firstDate.toISOString());
    assert.equal(accountOfferState({ offerActivated: true }, secondDate).cycle, 1);
});
test('uncompleted first cycle remains due and first activation can be undone', () => {
    assert.equal(accountOfferState(record, secondDate).cycle, 1);
    const undone = toggleAccountOffer(toggleAccountOffer(record, firstDate), firstDate);
    assert.equal(undone.offerFirstActivated, false);
    assert.equal(undone.offerFirstActivatedAt, '');
});
