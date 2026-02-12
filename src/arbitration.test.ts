/**
 * AI Arbitration test suite – all policy use cases and API behaviour.
 * Requires ANTHROPIC_API_KEY (when AI_PROVIDER=claude) or GEMINI_API_KEY (when AI_PROVIDER=gemini).
 * Run: npm test -- --run
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import { ClaudeArbiter } from './claude-arbiter.js';
import { GeminiArbiter } from './gemini-arbiter.js';
import { CONFIG } from './config.js';
import { ArbitrationRequestSchema } from './types.js';
import { ARBITRATION_TEST_CASES } from './test-fixtures.js';

const hasApiKey =
  (CONFIG.ai.provider === 'claude' && !!CONFIG.ai.anthropic?.apiKey) ||
  (CONFIG.ai.provider === 'gemini' && !!CONFIG.gemini?.apiKey);

const arbiter = hasApiKey
  ? (CONFIG.ai.provider === 'claude' ? new ClaudeArbiter() : new GeminiArbiter())
  : null;

const verifyTicket = (signed: { ticket: unknown; arbiter_pubkey: string; ed25519_signature: string }) =>
  CONFIG.ai.provider === 'claude'
    ? ClaudeArbiter.verifyTicket(signed)
    : GeminiArbiter.verifyTicket(signed);

describe('AI Arbitration – config and health', () => {
  it('loads config and has API key for selected provider', () => {
    expect(CONFIG.ai.provider).toBeDefined();
    expect(['claude', 'gemini']).toContain(CONFIG.ai.provider);
    if (CONFIG.ai.provider === 'claude') {
      expect(CONFIG.ai.anthropic?.apiKey).toBeTruthy();
    } else {
      expect(CONFIG.gemini?.apiKey).toBeTruthy();
    }
  });

  it('arbiter instance is created when API key is present', () => {
    if (!hasApiKey) {
      console.warn('Skipping: no API key set. Set ANTHROPIC_API_KEY or GEMINI_API_KEY to run arbitration tests.');
      return;
    }
    expect(arbiter).toBeDefined();
    expect(arbiter!.getArbiterPublicKey()).toBeTruthy();
    expect(arbiter!.getArbiterPublicKey().length).toBeGreaterThan(10);
  });
});

describe('AI Arbitration – policy use cases', () => {
  beforeAll(() => {
    if (!hasApiKey || !arbiter) {
      console.warn('Skipping arbitration use-case tests: no API key or arbiter.');
    }
  });

  ARBITRATION_TEST_CASES.forEach((tc) => {
    it(tc.name, async () => {
      if (!arbiter) return;
      const res = await arbiter.arbitrateCase(tc.request);
      expect(res.ticket.outcome).toBe(tc.expectedOutcome);
      expect(['RELEASE', 'REFUND']).toContain(res.ticket.outcome);
      expect(res.ticket.deal_id).toBe(tc.request.deal.deal_id);
      expect(res.ticket.confidence).toBeGreaterThanOrEqual(0);
      expect(res.ticket.confidence).toBeLessThanOrEqual(1);
      expect(res.ticket.reason_short).toBeTruthy();
      expect(res.ticket.violated_rules).toBeDefined();
      expect(Array.isArray(res.ticket.violated_rules)).toBe(true);
      const valid = verifyTicket(res);
      expect(valid).toBe(true);
      // Optional: when AI returns violated_rules, expect the rule ID to be mentioned (for REFUND cases).
      // For RELEASE, violated_rules is often empty so we only assert outcome above.
      if (tc.expectedRule && res.ticket.violated_rules && res.ticket.violated_rules.length > 0) {
        const ruleMentioned =
          res.ticket.violated_rules.some((r) => r.toLowerCase().includes(tc.expectedRule!.toLowerCase())) ||
          res.ticket.reason_short.toLowerCase().includes(tc.expectedRule!.toLowerCase());
        expect(ruleMentioned).toBe(true);
      }
    }, 60_000);
  });
});

describe('AI Arbitration – request validation', () => {
  it('validates ArbitrationRequestSchema (valid request passes)', () => {
    const valid = {
      deal: {
        deal_id: 'uuid-deal-123',
        seller: 'So11111111111111111111111111111111111111112',
        buyer: 'Bu11111111111111111111111111111111111111112',
        amount: 100,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        dispute_by: Math.floor(Date.now() / 1000) - 100,
        fee_bps: 0,
        created_at: Math.floor(Date.now() / 1000) - 200,
        status: 'Disputed',
      },
      evidence: [
        {
          cid: 'c1',
          type: 'text' as const,
          description: 'd',
          submitted_by: 'seller' as const,
          submitted_at: Math.floor(Date.now() / 1000),
        },
      ],
      seller_claim: 's',
      buyer_claim: 'b',
    };
    const parsed = ArbitrationRequestSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it('rejects empty evidence', () => {
    const invalid = {
      deal: {
        deal_id: 'uuid-deal-123',
        seller: 'So11111111111111111111111111111111111111112',
        buyer: 'Bu11111111111111111111111111111111111111112',
        amount: 100,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        dispute_by: Math.floor(Date.now() / 1000) - 100,
        fee_bps: 0,
        created_at: Math.floor(Date.now() / 1000) - 200,
        status: 'Disputed',
      },
      evidence: [],
      seller_claim: 's',
      buyer_claim: 'b',
    };
    const parsed = ArbitrationRequestSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it('schema accepts status Funded (arbiter enforces Disputed at runtime)', () => {
    // DealSchema allows any valid enum status; business rule "must be Disputed" is enforced in arbiter.arbitrateCase()
    const withFunded = {
      deal: {
        deal_id: 'uuid-deal-123',
        seller: 'So11111111111111111111111111111111111111112',
        buyer: 'Bu11111111111111111111111111111111111111112',
        amount: 100,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        dispute_by: Math.floor(Date.now() / 1000) - 100,
        fee_bps: 0,
        created_at: Math.floor(Date.now() / 1000) - 200,
        status: 'Funded',
      },
      evidence: [{ cid: 'c1', type: 'text', description: 'd', submitted_by: 'seller', submitted_at: Math.floor(Date.now() / 1000) }],
      seller_claim: 's',
      buyer_claim: 'b',
    };
    const parsed = ArbitrationRequestSchema.safeParse(withFunded);
    expect(parsed.success).toBe(true);
  });
});

describe('AI Arbitration – business rule errors', () => {
  it('rejects when dispute window has not ended', async () => {
    if (!arbiter) return;
    const futureDeadline = Math.floor(Date.now() / 1000) + 86400;
    const request = ARBITRATION_TEST_CASES[0].request;
    const invalidRequest = {
      ...request,
      deal: { ...request.deal, dispute_by: futureDeadline },
    };
    await expect(arbiter.arbitrateCase(invalidRequest)).rejects.toThrow(/Dispute period has not yet ended/i);
  });

  it('rejects when deal status is not Disputed', async () => {
    if (!arbiter) return;
    const request = ARBITRATION_TEST_CASES[0].request;
    const invalidRequest = {
      ...request,
      deal: { ...request.deal, status: 'Funded' as const },
    };
    await expect(arbiter.arbitrateCase(invalidRequest)).rejects.toThrow(/Disputed status/i);
  });
});

describe('Verify ticket', () => {
  it('verifies a freshly signed ticket', async () => {
    if (!arbiter) return;
    const request = ARBITRATION_TEST_CASES[0].request;
    const signed = await arbiter.arbitrateCase(request);
    expect(verifyTicket(signed)).toBe(true);
  });

  it('rejects tampered ticket', async () => {
    if (!arbiter) return;
    const request = ARBITRATION_TEST_CASES[0].request;
    const signed = await arbiter.arbitrateCase(request);
    const tampered = {
      ...signed,
      ticket: { ...signed.ticket, outcome: signed.ticket.outcome === 'RELEASE' ? 'REFUND' : 'RELEASE' },
    };
    expect(verifyTicket(tampered)).toBe(false);
  });
});
