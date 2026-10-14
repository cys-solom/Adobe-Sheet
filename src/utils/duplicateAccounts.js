export const accountEmailKey = value => String(value ?? '').trim().toLowerCase();

export function duplicateAccountEmails(records) {
    const counts = new Map();
    for (const record of records) {
        const key = accountEmailKey(record?.email);
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

export function hasAccountEmail(records, email, excludedId) {
    const key = accountEmailKey(email);
    return Boolean(key) && records.some(record => record
        && (excludedId === undefined || record.id !== excludedId)
        && accountEmailKey(record.email) === key);
}
