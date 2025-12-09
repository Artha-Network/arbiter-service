import { GoogleGenAI } from '@google/genai';
import { CONFIG } from '../src/config.js';

async function listModels() {
    console.log('🔍 Listing available models using @google/genai SDK...');

    if (!CONFIG.gemini.apiKey) {
        console.error('❌ No API Key found in CONFIG');
        return;
    }

    const ai = new GoogleGenAI({ apiKey: CONFIG.gemini.apiKey });

    try {
        const response = await ai.models.list();

        console.log('✅ Models found:');

        // Pager is async iterable
        for await (const m of response) {
            console.log(`- ${m.name} (Display: ${m.displayName})`);
        }

    } catch (error: any) {
        console.error('❌ Failed to list models:', error.message || error);
    }
}

listModels();
