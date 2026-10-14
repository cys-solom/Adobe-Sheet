import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdobeAccounts, DEFAULT_ADOBE_PASSWORD } from './adobeImport.js';

test('imports email and Adobe password with space, tab, colon or pipe', () => {
    for (const separator of [' ', '\t', ':', '|', ',']) {
        const result = parseAdobeAccounts('user@example.com' + separator + 'Secret:123@');
        assert.deepEqual(result.errors, []);
        assert.equal(result.records[0].email, 'user@example.com');
        assert.equal(result.records[0].password2, 'Secret:123@');
        assert.equal(result.records[0].invoiceNumber, '');
    }
});

test('supports mixed entries and preserves the invoice format and email-only default', () => {
    const result = parseAdobeAccounts('one@example.com Password1\r\n\r\ntwo@example.com\nHD05095400044EEG\n****4774\nthree@example.com\nstudent@university.edu');
    assert.deepEqual(result.errors, []);
    assert.equal(result.records.length, 3);
    assert.equal(result.records[0].password2, 'Password1');
    assert.equal(result.records[1].password2, DEFAULT_ADOBE_PASSWORD);
    assert.equal(result.records[2].invoiceNumber, 'HD05095400044EEG');
    assert.equal(result.records[2].visaAccount, 'student@university.edu');
});

test('reports incomplete records', () => {
    assert.equal(parseAdobeAccounts('invoice\n****4774').errors.length, 1);
});
