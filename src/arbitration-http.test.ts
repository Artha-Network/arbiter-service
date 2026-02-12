/**
 * HTTP integration tests for the arbiter service.
 * Start the server (npm run dev) then run: npm test -- --run arbitration-http
 * Or set ARBITER_SERVICE_URL to skip when server is not available.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import { ARBITRATION_TEST_CASES } from './test-fixtures.js';

const BASE_URL = process.env.ARBITER_SERVICE_URL || 'http://localhost:3001';

async function fetchHealth(): Promise<{ status: string; arbiter_pubkey?: string } | null> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { method: 'GET' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

describe('Arbiter HTTP API', () => {
  let serverUp = false;

  beforeAll(async () => {
    const health = await fetchHealth();
    serverUp = health?.status === 'healthy';
    if (!serverUp) {
      console.warn(`Arbiter server not reachable at ${BASE_URL}. Start with: npm run dev`);
    }
  });

  it('GET /health returns healthy and arbiter_pubkey', async () => {
    if (!serverUp) return;
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.status).toBe('healthy');
    expect(data.arbiter_pubkey).toBeTruthy();
  });

  it('GET /arbiter/pubkey returns hex pubkey', async () => {
    if (!serverUp) return;
    const res = await fetch(`${BASE_URL}/arbiter/pubkey`);
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.arbiter_pubkey).toBeTruthy();
    expect(/^[0-9a-f]+$/i.test(data.arbiter_pubkey)).toBe(true);
  });

  it('POST /arbitrate returns signed ticket for valid request', async () => {
    if (!serverUp) return;
    const tc = ARBITRATION_TEST_CASES[0];
    const res = await fetch(`${BASE_URL}/arbitrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tc.request),
    });
    expect(res.ok).toBe(true);
    const signed = await res.json();
    expect(signed.ticket).toBeDefined();
    expect(signed.ticket.outcome).toMatch(/^RELEASE|REFUND$/);
    expect(signed.arbiter_pubkey).toBeTruthy();
    expect(signed.ed25519_signature).toBeTruthy();
  });

  it('POST /verify validates a ticket from /arbitrate', async () => {
    if (!serverUp) return;
    const tc = ARBITRATION_TEST_CASES[0];
    const arbRes = await fetch(`${BASE_URL}/arbitrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tc.request),
    });
    expect(arbRes.ok).toBe(true);
    const signed = await arbRes.json();
    const verifyRes = await fetch(`${BASE_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signed),
    });
    expect(verifyRes.ok).toBe(true);
    const verifyData = await verifyRes.json();
    expect(verifyData.valid).toBe(true);
  });

  it('POST /arbitrate rejects invalid body (empty evidence)', async () => {
    if (!serverUp) return;
    const invalid = {
      deal: {
        deal_id: 'x',
        seller: 'So11111111111111111111111111111111111111112',
        buyer: 'Bu11111111111111111111111111111111111111112',
        amount: 1,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        dispute_by: Math.floor(Date.now() / 1000) - 1,
        fee_bps: 0,
        created_at: Math.floor(Date.now() / 1000) - 2,
        status: 'Disputed',
      },
      evidence: [],
      seller_claim: 's',
      buyer_claim: 'b',
    };
    const res = await fetch(`${BASE_URL}/arbitrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invalid),
    });
    expect(res.status).toBe(400);
  });
});
