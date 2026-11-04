import test from 'node:test';
import assert from 'node:assert/strict';
import { planMerchantTransfer, executeMerchantTransfer } from './merchantTransfer.js';
import { sanitizeRecord } from './dataRepair.js';

const record = { id: 'one', email: 'one@example.com', name: 'Original', deviceType: 'شخصي', duration: '4 شهور',
    startDate: '2026-07-01', created_at: '2026-07-01', password2: 'test-only', renewalHistory: [{ type: 'renewal', at: '2026-07-01' }] };
const request = { input: ' ONE@example.com\none@example.com ', merchantName: 'Trader', expectedRecords: [record] };

test('matches case-insensitively, deduplicates pasted emails and reports unmatched subscriptions', () => {
    const rows = planMerchantTransfer(request.input + '\nmissing@example.com\nshared@example.com', [
        record, { ...record, id: 'two', email: 'shared@example.com', deviceType: 'مشترك' }
    ]);
    assert.deepEqual(rows.map(row => row.status), ['ready', 'missing', 'ineligible']);
    assert.equal(planMerchantTransfer('one@example.com', [{ ...record, duration: '٤ شهور', deviceType: 'جهازين' }])[0].status, 'ready');
    assert.equal(planMerchantTransfer('one@example.com', [{ ...record, duration: '14 شهور' }])[0].status, 'ineligible');
});

test('blocks existing merchant accounts and ambiguous source records', () => {
    assert.equal(planMerchantTransfer(request.input, [record], [{ ...record, id: 'target' }])[0].status, 'conflict');
    assert.equal(planMerchantTransfer(request.input, [record, { ...record, id: 'copy' }])[0].status, 'ambiguous');
});

test('moves in one write, retains history and dates, and leaves unrelated records untouched', async () => {
    const unrelated = { id: 'unrelated', email: 'other@example.com' };
    let writes = 0;
    const result = await executeMerchantTransfer(request, {
        readSheets: async () => ({ client_data: [record, unrelated], merchant_data: [] }),
        writeSheets: async rows => {
            writes++;
            assert.equal(rows.length, 2);
            assert.deepEqual(rows[0].records, [unrelated]);
            const moved = rows[1].records[0];
            assert.equal(moved.id, record.id);
            assert.equal(moved.name, 'Trader');
            assert.equal(moved.startDate, record.startDate);
            assert.equal(moved.password2, record.password2);
            assert.deepEqual(moved.renewalHistory, record.renewalHistory);
            assert.deepEqual(sanitizeRecord(moved).renewalHistory, record.renewalHistory);
            assert.equal(sanitizeRecord(moved).merchantTransfer.previousName, 'Original');
        }
    });
    assert.equal(writes, 1);
    assert.equal(result.count, 1);
});

test('changed source and repeat submission abort without writes', async () => {
    for (const sheets of [
        { client_data: [{ ...record, duration: '1 شهر' }], merchant_data: [] },
        { client_data: [{ ...record, password2: 'changed' }], merchant_data: [] },
        { client_data: [], merchant_data: [record] }
    ]) {
        await assert.rejects(executeMerchantTransfer(request, {
            readSheets: async () => sheets, writeSheets: async () => assert.fail('must not write')
        }), /البيانات اتغيرت/);
    }
});

test('failed batch save surfaces failure without a second destructive operation', async () => {
    let writes = 0;
    await assert.rejects(executeMerchantTransfer(request, {
        readSheets: async () => ({ client_data: [record] }),
        writeSheets: async () => { writes++; throw new Error('save failed'); }
    }), /save failed/);
    assert.equal(writes, 1);
});
