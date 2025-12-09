import { GeminiArbiter } from '../src/gemini-arbiter.js';
import { ArbitrationRequest } from '../src/types.js';
import { CONFIG } from '../src/config.js';
import * as fs from 'fs';
import * as path from 'path';

async function log(message: string) {
    console.log(message);
    fs.appendFileSync('test_output.log', message + '\n');
}

async function runTest() {
    fs.writeFileSync('test_output.log', 'Start of Log\n');
    await log('🧪 Starting AI Arbitration Manual Test...');

    await log('Debug: Checking Config...');
    try {
        await log(`Debug: API Key present: ${!!CONFIG.gemini.apiKey}`);
        await log(`Debug: Secret Hex present: ${!!CONFIG.arbiter.secretHex}`);
    } catch (e: any) {
        await log(`❌ Error accessing CONFIG: ${e.message}`);
        return;
    }

    if (!CONFIG.gemini.apiKey || !CONFIG.arbiter.secretHex) {
        await log('❌ Missing environment variables (GEMINI_API_KEY, ARBITER_ED25519_SECRET_HEX)');
        return;
    }

    let arbiter;
    try {
        await log('Debug: Initializing Arbiter...');
        arbiter = new GeminiArbiter();
        await log('✅ Arbiter initialized');
        await log(`🔑 Public Key: ${arbiter.getArbiterPublicKey()}`);
    } catch (e: any) {
        await log(`❌ Failed to initialize GeminiArbiter: ${e.message}`);
        if (e.stack) await log(e.stack);
        return;
    }

    if (!arbiter) {
        await log('❌ Arbiter is undefined');
        return;
    }

    const mockRequest: ArbitrationRequest = {
        deal: {
            deal_id: 'test-deal-12345',
            seller: 'So11111111111111111111111111111111111111112',
            buyer: 'Bu11111111111111111111111111111111111111112',
            amount: 500,
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
            dispute_by: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago (Window closed)
            fee_bps: 200,
            created_at: Math.floor(Date.now() / 1000) - 86400,
            status: 'Disputed'
        },
        seller_claim: "I delivered the digital artwork exactly as requested. Here is the download link and the source file.",
        buyer_claim: "The file is corrupt and not what we agreed on. It's a low resolution jpeg, not the vector file.",
        evidence: [
            {
                cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
                type: 'text',
                description: 'Seller delivery proof email',
                submitted_by: 'seller',
                submitted_at: Math.floor(Date.now() / 1000) - 4000,
                extracted_text: "Here is the final deliverable: https://example.com/vector-source.svg"
            },
            {
                cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdj',
                type: 'image',
                description: 'Buyer screenshot of "corrupt file"',
                submitted_by: 'buyer',
                submitted_at: Math.floor(Date.now() / 1000) - 2000,
                extracted_text: "[Image Content Analysis]: Screenshot shows an error message 'File corrupted' when opening a .svg file."
            }
        ]
    };

    try {
        await log('\n📡 Sending request to Gemini...');
        const startTime = Date.now();
        const result = await arbiter.arbitrateCase(mockRequest);
        const duration = Date.now() - startTime;

        await log(`\n✅ Arbitration Complete in ${duration}ms!`);
        await log('📝 VERDICT:');
        await log(JSON.stringify(result.ticket, null, 2));

        await log('\n🔐 SIGNATURE VERIFICATION:');
        const isValid = GeminiArbiter.verifyTicket(result);
        if (isValid) {
            await log('✅ Signature is VALID');
        } else {
            await log('❌ Signature is INVALID');
        }

    } catch (error: any) {
        await log(`\n❌ Test Failed: ${error.message}`);
        if (error.stack) await log(error.stack);
    }
}

runTest().catch(console.error);
