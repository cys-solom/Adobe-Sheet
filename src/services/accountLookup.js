export const normalizeEmail = value => String(value || '').trim().toLowerCase();

export function lookupEmails(input, sheets) {
    const emails = [...new Set((input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(normalizeEmail))];
    return emails.map(email => ({ email, sheets: Object.entries(sheets).filter(([, rows]) =>
        Array.isArray(rows) && rows.some(row => row && [row.email, row.selectedAccount].some(value => normalizeEmail(value) === email))
    ).map(([id]) => id) }));
}

export function saleKeysForAccount(account, sales) {
    const keys = [account.id, account.email, account.selectedAccount].map(normalizeEmail).filter(Boolean);
    return sales.filter(sale => sale && !sale.deletedAt && sale.renewalStatus !== 'not_renewed' && !sale.nonRenewedAt
        && [sale.email, sale.selectedAccount].some(value => keys.includes(normalizeEmail(value))))
        .map(sale => JSON.stringify([String(sale.id), sale.startDate || '', sale.created_at || '']));
}

export function clearSoldGroupBadge(account, sales) {
    if (!account.postedToGroup) return account;
    const previous = new Set(account.groupSaleKeys || []);
    return saleKeysForAccount(account, sales).some(key => !previous.has(key))
        ? { ...account, postedToGroup: false, groupSaleKeys: [] }
        : account;
}
