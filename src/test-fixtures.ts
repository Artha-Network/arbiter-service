/**
 * Arbitration test fixtures for all policy use cases.
 * Each fixture describes a scenario and the expected outcome per ESCROW_POLICY_V1.
 */
import type { ArbitrationRequest } from './types.js';

const baseDeal = {
  deal_id: 'test-deal-' + Math.random().toString(36).slice(2, 11),
  seller: 'So11111111111111111111111111111111111111112',
  buyer: 'Bu11111111111111111111111111111111111111112',
  amount: 500,
  mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  dispute_by: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago (window closed)
  fee_bps: 200,
  created_at: Math.floor(Date.now() / 1000) - 86400,
  status: 'Disputed' as const,
};

export interface ArbitrationTestCase {
  name: string;
  expectedOutcome: 'RELEASE' | 'REFUND';
  expectedRule?: string; // rule id we expect to apply (optional)
  request: ArbitrationRequest;
}

export const ARBITRATION_TEST_CASES: ArbitrationTestCase[] = [
  {
    name: 'seller_delivery_proof – seller provides delivery + tracking → RELEASE',
    expectedOutcome: 'RELEASE',
    expectedRule: 'seller_delivery_proof',
    request: {
      deal: { ...baseDeal, deal_id: 'case-delivery-' + Date.now() },
      seller_claim: 'I shipped the item via USPS. Tracking number 9400111899223344556677. Delivered and signed.',
      buyer_claim: 'I never received it.',
      evidence: [
        {
          cid: 'delivery-proof-1',
          type: 'text',
          description: 'Delivery confirmation and tracking',
          submitted_by: 'seller',
          submitted_at: Math.floor(Date.now() / 1000) - 7200,
          extracted_text: 'USPS tracking 9400111899223344556677. Status: Delivered. Signed by recipient. Delivery date before dispute deadline.',
        },
      ],
    },
  },
  {
    name: 'buyer_item_not_as_described – buyer proves material discrepancy → REFUND',
    expectedOutcome: 'REFUND',
    expectedRule: 'buyer_item_not_as_described',
    request: {
      deal: { ...baseDeal, deal_id: 'case-not-described-' + Date.now() },
      seller_claim: 'The item was as described.',
      buyer_claim: 'The listing said "brand new iPhone 15" but I received a used iPhone 12 with different serial number.',
      evidence: [
        {
          cid: 'photo-evidence-1',
          type: 'text',
          description: 'Photo evidence and description comparison',
          submitted_by: 'buyer',
          submitted_at: Math.floor(Date.now() / 1000) - 3600,
          extracted_text: 'Listing: "iPhone 15, brand new, sealed." Received: iPhone 12, used, serial number does not match. Photo evidence attached showing box and device.',
        },
      ],
    },
  },
  {
    name: 'buyer_damage_proof – buyer proves shipping damage → REFUND',
    expectedOutcome: 'REFUND',
    expectedRule: 'buyer_damage_proof',
    request: {
      deal: { ...baseDeal, deal_id: 'case-damage-' + Date.now() },
      seller_claim: 'I packed it properly. Damage must have happened in transit.',
      buyer_claim: 'The item arrived with a cracked screen and damaged packaging. I have photos of the box and the item.',
      evidence: [
        {
          cid: 'damage-1',
          type: 'text',
          description: 'Damage photos and packaging',
          submitted_by: 'buyer',
          submitted_at: Math.floor(Date.now() / 1000) - 1800,
          extracted_text: 'Photos show: 1) Crushed shipping box. 2) Cracked device screen. 3) Insufficient padding in box. Damage consistent with shipping.',
        },
      ],
    },
  },
  {
    name: 'seller_fraud_proof – clear seller misrepresentation → REFUND',
    expectedOutcome: 'REFUND',
    expectedRule: 'seller_fraud_proof',
    request: {
      deal: { ...baseDeal, deal_id: 'case-seller-fraud-' + Date.now() },
      seller_claim: 'The item was authentic.',
      buyer_claim: 'The "authentic" watch was verified as counterfeit by an authorized dealer. Certificate of authenticity is forged.',
      evidence: [
        {
          cid: 'fraud-1',
          type: 'text',
          description: 'Counterfeit verification and forged certificate',
          submitted_by: 'buyer',
          submitted_at: Math.floor(Date.now() / 1000) - 2400,
          extracted_text: 'Authorized dealer letter: "This watch is counterfeit." Certificate of authenticity does not match manufacturer records. Seller provided forged documents.',
        },
      ],
    },
  },
  {
    name: 'buyer_fraud_proof – buyer false claims → RELEASE',
    expectedOutcome: 'RELEASE',
    expectedRule: 'buyer_fraud_proof',
    request: {
      deal: { ...baseDeal, deal_id: 'case-buyer-fraud-' + Date.now() },
      seller_claim: 'I delivered the correct item. Buyer is trying to keep the item and get a refund.',
      buyer_claim: 'Item never arrived.',
      evidence: [
        {
          cid: 'fraud-buyer-1',
          type: 'text',
          description: 'Delivery proof and buyer fraud evidence',
          submitted_by: 'seller',
          submitted_at: Math.floor(Date.now() / 1000) - 5000,
          extracted_text: 'Delivery confirmation with signature. Same buyer name. Security footage shows buyer receiving package. Buyer filed dispute claiming "never received" after signing.',
        },
      ],
    },
  },
  {
    name: 'seller_deadline_miss – no delivery proof before deadline → REFUND',
    expectedOutcome: 'REFUND',
    expectedRule: 'seller_deadline_miss',
    request: {
      deal: { ...baseDeal, deal_id: 'case-deadline-' + Date.now() },
      seller_claim: 'I will send tracking soon.',
      buyer_claim: 'Dispute deadline has passed. Seller never provided delivery proof or tracking.',
      evidence: [
        {
          cid: 'no-proof',
          type: 'text',
          description: 'Buyer statement',
          submitted_by: 'buyer',
          submitted_at: Math.floor(Date.now() / 1000) - 600,
          extracted_text: 'Dispute deadline has passed. Seller did not provide any delivery_proof or tracking_number before the deadline.',
        },
      ],
    },
  },
  {
    name: 'insufficient_evidence – conflicting claims, no clear proof → REFUND (default)',
    expectedOutcome: 'REFUND',
    expectedRule: 'insufficient_evidence',
    request: {
      deal: { ...baseDeal, deal_id: 'case-insufficient-' + Date.now() },
      seller_claim: 'I delivered the item as agreed.',
      buyer_claim: 'The item was not as agreed.',
      evidence: [
        {
          cid: 'vague-1',
          type: 'text',
          description: 'No specific evidence',
          submitted_by: 'seller',
          submitted_at: Math.floor(Date.now() / 1000) - 3000,
          extracted_text: 'I sent it.',
        },
        {
          cid: 'vague-2',
          type: 'text',
          description: 'No specific evidence',
          submitted_by: 'buyer',
          submitted_at: Math.floor(Date.now() / 1000) - 2000,
          extracted_text: 'I did not get what I paid for.',
        },
      ],
    },
  },
];
