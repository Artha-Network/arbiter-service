
import { GeminiArbiter } from '../src/gemini-arbiter.js';

async function testFallback() {
    console.log('🧪 Testing Contract Generation Fallback');

    const arbiter = new GeminiArbiter();
    const mockDeal = {
        deal_id: "TEST-FALLBACK-001",
        seller: "Alice",
        buyer: "Bob",
        amount: 1000,
        mint: "USDC",
        description: "Web development services"
    };

    console.log('📡 Generating contract (expecting potential fallback if AI fails)...');
    const result = await arbiter.generateContract(mockDeal);

    console.log('📄 Result:');
    console.log(JSON.stringify(result, null, 2));

    if (result.source === 'fallback') {
        console.log('✅ Success: Fallback template was used.');
    } else if (result.source === 'ai') {
        console.log('✅ Success: AI generated the contract.');
    } else {
        console.error('❌ Failed: Unknown source or error.');
        process.exit(1);
    }
}

testFallback().catch(console.error);
