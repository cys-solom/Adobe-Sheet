export const DEFAULT_ADOBE_PASSWORD = 'Service2030@';
export const isAccountEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

export function parseAdobeAccounts(input) {
    const lines = input.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const records = [];
    const errors = [];
    for (let index = 0; index < lines.length;) {
        const line = lines[index];
        const pair = line.match(/^([^\s@:|,]+@[^\s@:|,]+\.[^\s@:|,]+)(?:\s+|[:|,])(.+)$/);
        if (pair && isAccountEmail(pair[1])) {
            const password = pair[2].trim();
            if (!password) {
                errors.push('باسورد أدوبي ناقص عند السطر: ' + (index + 1));
                break;
            }
            records.push({ email: pair[1], password2: password, invoiceNumber: '', visa: '', visaAccount: '' });
            index++;
        } else if (isAccountEmail(line)) {
            records.push({ email: line, password2: DEFAULT_ADOBE_PASSWORD, invoiceNumber: '', visa: '', visaAccount: '' });
            index++;
        } else if (lines[index + 1] && isAccountEmail(lines[index + 2]) && isAccountEmail(lines[index + 3])) {
            records.push({ invoiceNumber: line, visa: lines[index + 1], email: lines[index + 2], visaAccount: lines[index + 3], password2: DEFAULT_ADOBE_PASSWORD });
            index += 4;
        } else {
            errors.push('مجموعة غير مكتملة عند السطر: ' + (index + 1));
            break;
        }
    }
    return { records, errors };
}
