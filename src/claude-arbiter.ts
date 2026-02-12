import Anthropic from '@anthropic-ai/sdk';
import { sha256 } from '@noble/hashes/sha256';
import nacl from 'tweetnacl';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  ArbitrationRequest,
  ResolveTicket,
  SignedResolveTicket,
  ResolveTicketSchema,
} from './types.js';
import { SYSTEM_PROMPT, getPolicyForPrompt } from './policy.js';
import { CONFIG } from './config.js';

export class ClaudeArbiter {
  private client: Anthropic;
  private arbiterKeypair: nacl.SignKeyPair;
  private supabase: SupabaseClient | null;

  constructor() {
    this.client = new Anthropic({
      apiKey: CONFIG.ai.anthropic.apiKey,
    });

    if (CONFIG.supabase.url && CONFIG.supabase.serviceKey) {
      this.supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceKey);
    } else {
      this.supabase = null;
      console.warn('⚠️ Supabase client not initialized. Evidence fetching will be disabled.');
    }

    const secretKey = Uint8Array.from(Buffer.from(CONFIG.arbiter.secretHex, 'hex'));
    this.arbiterKeypair = nacl.sign.keyPair.fromSeed(secretKey.slice(0, 32));
  }

  async arbitrateCase(request: ArbitrationRequest): Promise<SignedResolveTicket> {
    this.validateBusinessRules(request);

    const evidenceText = this.prepareEvidenceText(request);
    const nonce = `${Date.now()}${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const systemPrompt = this.buildSystemPrompt(request, nonce, expiresAt.toISOString());

    const response = await this.client.messages.create({
      model: CONFIG.ai.anthropic.arbitrationModel,
      max_tokens: CONFIG.ai.anthropic.maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: evidenceText }],
    });

    const textBlock = response.content?.find((b: { type: string }) => b.type === 'text');
    const responseText = textBlock && typeof (textBlock as { text?: string }).text === 'string'
      ? (textBlock as { text: string }).text
      : null;

    if (!responseText) {
      throw new Error('Empty response from Claude');
    }

    const parsed = this.extractJson(responseText);
    const ticket = ResolveTicketSchema.parse({
      ...parsed,
      nonce,
      expires_at_utc: expiresAt.toISOString(),
    });

    const signedTicket = this.signTicket(ticket);

    console.log(`Arbitration Decision for ${request.deal.deal_id}:`, {
      outcome: ticket.outcome,
      confidence: ticket.confidence,
      reason: ticket.reason_short,
      violated_rules: ticket.violated_rules,
    });

    return signedTicket;
  }

  private validateBusinessRules(request: ArbitrationRequest): void {
    if (CONFIG.policy.disputeWindowCheck) {
      const now = Math.floor(Date.now() / 1000);
      if (now < request.deal.dispute_by) {
        throw new Error('Dispute period has not yet ended');
      }
    }
    if (request.deal.status !== 'Disputed') {
      throw new Error('Deal must be in Disputed status for arbitration');
    }
  }

  private buildSystemPrompt(
    request: ArbitrationRequest,
    nonce: string,
    expiresAt: string
  ): string {
    const dealInfo = `DEAL INFORMATION:
ID: ${request.deal.deal_id}
Seller: ${request.deal.seller}
Buyer: ${request.deal.buyer}
Amount: ${request.deal.amount} (${request.deal.mint})
Dispute Deadline: ${new Date(request.deal.dispute_by * 1000).toISOString()}
Current Status: ${request.deal.status}
Fee BPS: ${request.deal.fee_bps}`;

    return `${SYSTEM_PROMPT}

${getPolicyForPrompt()}

${dealInfo}

REQUIRED OUTPUT:
Return a single JSON object with these exact fields (no markdown, no code fence):
- schema: "https://artha.network/schemas/resolve-ticket-v1.json"
- deal_id: "${request.deal.deal_id}"
- outcome: "RELEASE" or "REFUND" (based on rule analysis)
- reason_short: Brief explanation (max 200 chars)
- rationale_cid: "pending"
- violated_rules: Array of rule IDs that were violated (strings)
- confidence: Number between 0 and 1
- nonce: "${nonce}"
- expires_at_utc: "${expiresAt}"

Analyze the evidence against the policy rules and return ONLY the JSON object.`;
  }

  private prepareEvidenceText(request: ArbitrationRequest): string {
    let out = `SELLER CLAIM:\n${request.seller_claim}\n\nBUYER CLAIM:\n${request.buyer_claim}\n\nEVIDENCE SUBMITTED:\n`;

    for (const evidence of request.evidence) {
      out += `\nEVIDENCE (${evidence.type}, submitted by ${evidence.submitted_by}):\nDescription: ${evidence.description}\nSubmitted: ${new Date(evidence.submitted_at * 1000).toISOString()}\n`;
      if (evidence.extracted_text) {
        out += `Content: ${evidence.extracted_text}\n`;
      } else if (evidence.type === 'text' && evidence.cid) {
        out += `Content: ${evidence.cid}\n`;
      }
      out += '\n---\n';
    }

    return out;
  }

  private extractJson(text: string): Record<string, unknown> {
    const trimmed = text.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('No JSON object found in Claude response');
    }
    const jsonStr = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(jsonStr) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`Invalid JSON from Claude: ${e instanceof Error ? e.message : 'parse error'}`);
    }
  }

  private signTicket(ticket: ResolveTicket): SignedResolveTicket {
    const canonical = Buffer.from(JSON.stringify(ticket, null, 0));
    const digest = Uint8Array.from(sha256(canonical));
    const signature = nacl.sign.detached(digest, this.arbiterKeypair.secretKey);

    return {
      ticket,
      arbiter_pubkey: Buffer.from(this.arbiterKeypair.publicKey).toString('hex'),
      ed25519_signature: Buffer.from(signature).toString('hex'),
    };
  }

  getArbiterPublicKey(): string {
    return Buffer.from(this.arbiterKeypair.publicKey).toString('hex');
  }

  async generateContract(dealDetails: unknown) {
    const response = await this.client.messages.create({
      model: CONFIG.ai.anthropic.arbitrationModel,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are an expert legal AI assistant for a smart contract escrow platform.

Generate a professional contract agreement for this deal:
${JSON.stringify(dealDetails, null, 2)}

Return a JSON object with:
{
  "contract": "markdown formatted contract text",
  "questions": ["question1", "question2", ...]
}

Return only the JSON object, no markdown code fence.`,
      }],
    });

    const textBlock = response.content?.find((b: { type: string }) => b.type === 'text');
    const text = textBlock && typeof (textBlock as { text?: string }).text === 'string'
      ? (textBlock as { text: string }).text
      : '';
    if (!text) throw new Error('Empty response from Claude');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON in response');
    return JSON.parse(text.slice(start, end + 1));
  }

  static verifyTicket(signedTicket: SignedResolveTicket): boolean {
    try {
      const canonical = Buffer.from(JSON.stringify(signedTicket.ticket, null, 0));
      const digest = Uint8Array.from(sha256(canonical));
      const signature = Uint8Array.from(Buffer.from(signedTicket.ed25519_signature, 'hex'));
      const publicKey = Uint8Array.from(Buffer.from(signedTicket.arbiter_pubkey, 'hex'));
      return nacl.sign.detached.verify(digest, signature, publicKey);
    } catch {
      return false;
    }
  }
}
