import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateAccountEmails, hasAccountEmail } from './duplicateAccounts.js';

test('groups emails across account categories, ignoring case and outer whitespace', () => {
    const rows = [
        { id: 'a', email: ' Example@domain.com ', accountCategory: 'adobe' },
        { id: 'b', email: 'example@domain.com', accountCategory: 'capcut' },
        { id: 'c', email: 'another@domain.com' },
        null, { email: '' }, { email: ' ' }
    ];
    assert.deepEqual([...duplicateAccountEmails(rows)], ['example@domain.com']);
    assert.equal(hasAccountEmail(rows, 'EXAMPLE@domain.com'), true);
    assert.equal(hasAccountEmail(rows, 'new@domain.com'), false);
    assert.equal(hasAccountEmail(rows, ''), false);
});

test('editing excludes only the current record', () => {
    const rows = [{ id: 'a', email: 'a@domain.com' }, { id: 'b', email: 'b@domain.com' }];
    assert.equal(hasAccountEmail(rows, 'a@domain.com', 'a'), false);
    assert.equal(hasAccountEmail(rows, 'b@domain.com', 'a'), true);
});
