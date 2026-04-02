import 'dotenv/config';

export const CONFIG = {
    ai: {
        provider: 'claude' as const,
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

if (!CONFIG.security.adminKey) {
    console.warn('⚠️ ARBITER_ADMIN_KEY missing. API is running without authentication!');
}
