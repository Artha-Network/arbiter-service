import 'dotenv/config';

export const CONFIG = {
    ai: {
        anthropic: {
            apiKey: process.env.ANTHROPIC_API_KEY || '',
            arbitrationModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
            contractModel: process.env.ANTHROPIC_CONTRACT_MODEL || 'claude-sonnet-4-6',
            maxTokens: 1024,
            contractMaxTokens: 4096,
        },
    },
    arbiter: {
        secretHex: process.env.ARBITER_ED25519_SECRET_HEX!,
    },
    server: {
        port: parseInt(process.env.PORT || '3001', 10),
        env: process.env.NODE_ENV || 'development',
    },
    policy: {
        version: 'v1.0',
        disputeWindowCheck: false,
    },
    supabase: {
        url: process.env.SUPABASE_URL || '',
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || ''
    },
    security: {
        adminKey: process.env.ARBITER_ADMIN_KEY || ''
    }
};

// Fail fast on missing critical env vars
if (!CONFIG.ai.anthropic.apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required');
}

if (!CONFIG.arbiter.secretHex) {
    throw new Error('ARBITER_ED25519_SECRET_HEX environment variable is required');
}

if (!CONFIG.supabase.url || !CONFIG.supabase.serviceKey) {
    console.warn('⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. Evidence fetching will fail.');
}

if (!CONFIG.security.adminKey) {
    console.warn('⚠️ ARBITER_ADMIN_KEY missing. API is running without authentication!');
}
