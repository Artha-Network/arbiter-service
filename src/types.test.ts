/**
 * Schema validation tests — no API key required.
 */
import { describe, it, expect } from 'vitest';
import {
  ResolveTicketSchema,
  DealSchema,
  EvidenceSchema,
  ArbitrationRequestSchema,
} from './types.js';

// ── DealSchema ──────────────────────────────────────────────────────────────

describe('DealSchema', () => {
  const validDeal = {
    deal_id: 'test-deal-001',
    seller: 'So11111111111111111111111111111111111111112',
    buyer: 'Bu11111111111111111111111111111111111111112',
    amount: 500,
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    dispute_by: Math.floor(Date.now() / 1000) + 3600,
    fee_bps: 250,
    created_at: Math.floor(Date.now() / 1000),
    status: 'Disputed' as const,
  };

  it('accepts a valid deal', () => {
    expect(() => DealSchema.parse(validDeal)).not.toThrow();
  });

  it('accepts all valid status values', () => {
    for (const status of ['Init', 'Funded', 'Disputed', 'Resolved', 'Released', 'Refunded']) {
      expect(() => DealSchema.parse({ ...validDeal, status })).not.toThrow();
    }
  });

  it('rejects invalid status', () => {
    expect(() => DealSchema.parse({ ...validDeal, status: 'Pending' })).toThrow();
  });

  it('rejects negative amount', () => {
    expect(() => DealSchema.parse({ ...validDeal, amount: -100 })).toThrow();
  });

  it('rejects zero amount', () => {
    expect(() => DealSchema.parse({ ...validDeal, amount: 0 })).toThrow();
  });

  it('rejects missing deal_id', () => {
    const { deal_id, ...rest } = validDeal;
    expect(() => DealSchema.parse(rest)).toThrow();
  });
});

// ── EvidenceSchema ──────────────────────────────────────────────────────────

describe('EvidenceSchema', () => {
  const validEvidence = {
    cid: 'evidence/deal-123/photo.png',
    type: 'image' as const,
    description: 'Screenshot of delivery',
    submitted_by: 'seller' as const,
    submitted_at: Math.floor(Date.now() / 1000),
  };

  it('accepts valid evidence', () => {
    expect(() => EvidenceSchema.parse(validEvidence)).not.toThrow();
  });

  it('accepts evidence with extracted_text', () => {
    expect(() =>
      EvidenceSchema.parse({ ...validEvidence, extracted_text: 'parsed content' })
    ).not.toThrow();
  });

  it('rejects empty cid', () => {
    expect(() => EvidenceSchema.parse({ ...validEvidence, cid: '' })).toThrow();
  });

  it('rejects invalid type', () => {
    expect(() => EvidenceSchema.parse({ ...validEvidence, type: 'video' })).toThrow();
  });

  it('rejects invalid submitted_by', () => {
    expect(() => EvidenceSchema.parse({ ...validEvidence, submitted_by: 'arbiter' })).toThrow();
  });
});

// ── ResolveTicketSchema ─────────────────────────────────────────────────────

describe('ResolveTicketSchema', () => {
  const validTicket = {
    schema: 'https://artha.network/schemas/resolve-ticket-v1.json',
    deal_id: 'test-deal-001',
    outcome: 'RELEASE' as const,
    reason_short: 'Seller delivered as agreed',
    rationale_cid: 'Full rationale text explaining the decision...',
    violated_rules: [],
    confidence: 0.95,
    nonce: '1234567890',
    expires_at_utc: new Date().toISOString(),
  };

  it('accepts a valid ticket', () => {
    expect(() => ResolveTicketSchema.parse(validTicket)).not.toThrow();
  });

  it('accepts REFUND outcome', () => {
    expect(() => ResolveTicketSchema.parse({ ...validTicket, outcome: 'REFUND' })).not.toThrow();
  });

  it('rejects confidence > 1', () => {
    expect(() => ResolveTicketSchema.parse({ ...validTicket, confidence: 1.5 })).toThrow();
  });

  it('rejects confidence < 0', () => {
    expect(() => ResolveTicketSchema.parse({ ...validTicket, confidence: -0.1 })).toThrow();
  });

  it('rejects invalid nonce (non-numeric)', () => {
    expect(() => ResolveTicketSchema.parse({ ...validTicket, nonce: 'abc' })).toThrow();
  });

  it('rejects reason_short > 200 chars', () => {
    expect(() =>
      ResolveTicketSchema.parse({ ...validTicket, reason_short: 'x'.repeat(201) })
    ).toThrow();
  });

  it('rejects wrong schema URL', () => {
    expect(() =>
      ResolveTicketSchema.parse({ ...validTicket, schema: 'https://wrong.url/schema' })
    ).toThrow();
  });
});

// ── ArbitrationRequestSchema ────────────────────────────────────────────────

describe('ArbitrationRequestSchema', () => {
  const validRequest = {
    deal: {
      deal_id: 'test-deal-001',
      seller: 'So11111111111111111111111111111111111111112',
      buyer: 'Bu11111111111111111111111111111111111111112',
      amount: 500,
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      dispute_by: Math.floor(Date.now() / 1000),
      fee_bps: 250,
      created_at: Math.floor(Date.now() / 1000) - 86400,
      status: 'Disputed' as const,
    },
    seller_claim: 'I delivered as agreed',
    buyer_claim: 'Product was defective',
    evidence: [
      {
        cid: 'evidence/deal-123/doc.pdf',
        type: 'pdf' as const,
        description: 'Invoice',
        submitted_by: 'seller' as const,
        submitted_at: Math.floor(Date.now() / 1000),
      },
    ],
  };

  it('accepts a valid request', () => {
    expect(() => ArbitrationRequestSchema.parse(validRequest)).not.toThrow();
  });

  it('rejects empty evidence array', () => {
    expect(() =>
      ArbitrationRequestSchema.parse({ ...validRequest, evidence: [] })
    ).toThrow();
  });

  it('rejects empty seller_claim', () => {
    expect(() =>
      ArbitrationRequestSchema.parse({ ...validRequest, seller_claim: '' })
    ).toThrow();
  });

  it('rejects empty buyer_claim', () => {
    expect(() =>
      ArbitrationRequestSchema.parse({ ...validRequest, buyer_claim: '' })
    ).toThrow();
  });

  it('rejects missing deal', () => {
    const { deal, ...rest } = validRequest;
    expect(() => ArbitrationRequestSchema.parse(rest)).toThrow();
  });
});
