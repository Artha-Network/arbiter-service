/**
 * Test cases for the Gemini AI Arbiter
 * 
 * These tests demonstrate various arbitration scenarios
 */

import { GeminiArbiter } from './gemini-arbiter.js';
import { ArbitrationRequest, Deal, Evidence } from './types.js';

// Example test data
const mockDeal: Deal = {
  deal_id: 'test_deal_001',
  seller: 'SellerPublicKey123...',
  buyer: 'BuyerPublicKey456...',
  amount: 1000,
  mint: 'USDCMintAddress...',
  dispute_by: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago (expired)
  fee_bps: 250,
  created_at: Math.floor(Date.now() / 1000) - 86400, // 1 day ago
  status: 'Disputed'
};

const mockEvidenceDeliveryProof: Evidence = {
  cid: 'QmExample1DeliveryProof',
  type: 'pdf',
  description: 'UPS delivery confirmation with signature',
  submitted_by: 'seller',
  submitted_at: Math.floor(Date.now() / 1000) - 7200, // 2 hours ago
  extracted_text: 'DELIVERY CONFIRMATION\nPackage delivered to: 123 Main St\nSignature: John Doe\nDate: 2024-01-15 14:30:00\nTracking: 1Z999AA1234567890'
};

const mockEvidenceDamageReport: Evidence = {
  cid: 'QmExample2DamageReport',
  type: 'image',
  description: 'Photos showing damaged item and packaging',
  submitted_by: 'buyer',
  submitted_at: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
  extracted_text: 'Image analysis: Shows laptop with cracked screen. Packaging appears damaged with visible impact marks. Original listing showed laptop in perfect condition.'
};

// Test case 1: Seller provides valid delivery proof (should RELEASE)
export const testCaseDeliveryProof: ArbitrationRequest = {
  deal: mockDeal,
  evidence: [mockEvidenceDeliveryProof],
  seller_claim: 'I delivered the laptop as described. Here is the UPS tracking confirmation showing successful delivery with signature confirmation.',
  buyer_claim: 'The laptop was damaged when I received it. The screen is cracked and it won\'t turn on.'
};

// Test case 2: Buyer provides damage evidence (should REFUND)
export const testCaseDamageEvidence: ArbitrationRequest = {
  deal: mockDeal,
  evidence: [mockEvidenceDamageReport],
  seller_claim: 'The laptop was in perfect condition when I shipped it. The buyer must have damaged it.',
  buyer_claim: 'The laptop arrived with a cracked screen and damaged packaging. This was clearly shipping damage.'
};

// Test case 3: Both parties provide evidence (precedence test)
export const testCaseConflictingEvidence: ArbitrationRequest = {
  deal: mockDeal,
  evidence: [mockEvidenceDeliveryProof, mockEvidenceDamageReport],
  seller_claim: 'I have delivery confirmation proving the item was delivered successfully.',
  buyer_claim: 'The item was damaged during shipping as shown in the photos.'
};

// Test case 4: Insufficient evidence (should default to REFUND)
export const testCaseInsufficientEvidence: ArbitrationRequest = {
  deal: mockDeal,
  evidence: [{
    cid: 'QmExampleVague',
    type: 'text',
    description: 'Vague complaint about item quality',
    submitted_by: 'buyer',
    submitted_at: Math.floor(Date.now() / 1000) - 1800,
    extracted_text: 'The item is not what I expected. Very disappointed.'
  }],
  seller_claim: 'The item was exactly as described in the listing.',
  buyer_claim: 'The item is not what I expected based on the description.'
};

/**
 * Run test cases (for development/testing)
 */
export async function runTestCases() {
  const GEMINI_API_KEY = 'your_api_key_here';
  const ARBITER_SECRET_HEX = 'your_secret_key_here';
  
  if (GEMINI_API_KEY === 'your_api_key_here') {
    console.log('⚠️  Please set real API keys to run tests');
    return;
  }

  const arbiter = new GeminiArbiter(GEMINI_API_KEY, ARBITER_SECRET_HEX);
  
  console.log('🤖 Running AI Arbiter Test Cases\n');
  console.log(`🔑 Arbiter Public Key: ${arbiter.getArbiterPublicKey()}\n`);

  const testCases = [
    { name: 'Delivery Proof Test', request: testCaseDeliveryProof },
    { name: 'Damage Evidence Test', request: testCaseDamageEvidence },
    { name: 'Conflicting Evidence Test', request: testCaseConflictingEvidence },
    { name: 'Insufficient Evidence Test', request: testCaseInsufficientEvidence }
  ];

  for (const testCase of testCases) {
    console.log(`\n📋 ${testCase.name}`);
    console.log('─'.repeat(50));
    
    try {
      const result = await arbiter.arbitrateCase(testCase.request);
      
      console.log(`✅ Outcome: ${result.ticket.outcome}`);
      console.log(`📊 Confidence: ${result.ticket.confidence}`);
      console.log(`💭 Reason: ${result.ticket.reason_short}`);
      console.log(`⚖️  Violated Rules: ${result.ticket.violated_rules.join(', ')}`);
      console.log(`🔐 Signature Valid: ${GeminiArbiter.verifyTicket(result)}`);
      
    } catch (error) {
      console.log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Usage example
if (import.meta.url === `file://${process.argv[1]}`) {
  runTestCases().catch(console.error);
}