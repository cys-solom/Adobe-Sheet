import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(
    supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('placeholder') &&
    supabaseUrl.startsWith('https://')
);

// Resilient chainable mock query builder for offline / local-only operation
const createMockQueryBuilder = () => {
    const builder = {
        _data: [],
        select: () => builder,
        insert: () => builder,
        update: () => builder,
        delete: () => builder,
        eq: () => builder,
        neq: () => builder,
        gt: () => builder,
        gte: () => builder,
        lt: () => builder,
        lte: () => builder,
        like: () => builder,
        ilike: () => builder,
        or: () => builder,
        is: () => builder,
        in: () => builder,
        contains: () => builder,
        containedBy: () => builder,
        range: () => builder,
        order: () => builder,
        limit: () => builder,
        offset: () => builder,
        single: () => Promise.resolve({ data: null, error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve) => resolve({ data: [], error: null, count: 0 }),
        catch: () => builder,
    };
    return builder;
};

const mockClient = {
    from: () => createMockQueryBuilder(),
    channel: () => ({
        on: function () { return this; },
        subscribe: () => ({ unsubscribe: () => {} }),
    }),
    removeChannel: () => {},
    auth: {
        getSession: () => Promise.resolve({ data: { session: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signInWithPassword: () => Promise.resolve({ data: null, error: new Error('وضع عدم الاتصال') }),
        signOut: () => Promise.resolve({ error: null }),
    }
};

let client;
if (isConfigured) {
    try {
        client = createClient(supabaseUrl, supabaseAnonKey);
    } catch (err) {
        console.warn('Supabase initialization failed, falling back to local mock:', err);
        client = mockClient;
    }
} else {
    // Graceful offline fallback without attempting broken DNS requests
    client = mockClient;
}

export const supabase = client;
