import 'dotenv/config';

export type AIProvider = 'claude' | 'gemini';

export const CONFIG = {
    ai: {
        provider: (process.env.AI_PROVIDER || 'claude').toLowerCase() as AIProvider,
        anthropic: {
            apiKey: process.env.ANTHROPIC_API_KEY || '',
            arbitrationModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
            maxTokens: 1024,
        },
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
        arbitrationModel: process.env.GEMINI_MODEL_ARBITRATION || 'gemini-2.5-flash',
        contractModel: process.env.GEMINI_MODEL_CONTRACT || 'gemini-2.5-flash',
        defaults: {
            temperature: 0.1,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 1024,
        }
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
        disputeWindowCheck: true, // Application logic flag
    },
    supabase: {
        url: process.env.SUPABASE_URL || '',
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || ''
    },
    security: {
        adminKey: process.env.ARBITER_ADMIN_KEY || ''
    }
};

// Fail fast on missing critical env vars for the selected provider
if (CONFIG.ai.provider === 'claude') {
    if (!CONFIG.ai.anthropic.apiKey) {
        throw new Error('ANTHROPIC_API_KEY is required when AI_PROVIDER=claude');
    }
} else {
    if (!CONFIG.gemini.apiKey) {
        throw new Error('GEMINI_API_KEY is required when AI_PROVIDER=gemini');
    }
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
