import Anthropic from '@anthropic-ai/sdk';
import { sha256 } from '@noble/hashes/sha256';
import nacl from 'tweetnacl';
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

  constructor() {
    this.client = new Anthropic({
      apiKey: CONFIG.ai.anthropic.apiKey,
    });

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
- rationale_cid: Detailed reasoning and analysis explaining your decision (2-4 paragraphs)
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

  private extractJsonFromText(text: string): string | null {
    let s = text.trim();
    const codeFenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeFenceMatch) s = codeFenceMatch[1].trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    const raw = s.slice(start, end + 1);

    // Try parsing as-is first
    try {
      JSON.parse(raw);
      return raw;
    } catch {
      // LLM often produces unescaped newlines/quotes inside JSON string values.
      // Attempt repair: find string values and escape problematic characters.
      try {
        const repaired = raw.replace(
          /("(?:contract|questions)":\s*")([^]*?)("(?:\s*[,}]))/g,
          (_match, prefix, value, suffix) => {
            const escaped = value
              .replace(/\\/g, '\\\\')
              .replace(/"/g, '\\"')
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r')
              .replace(/\t/g, '\\t');
            return prefix + escaped + suffix;
          }
        );
        JSON.parse(repaired);
        return repaired;
      } catch {
        // Fallback: extract contract text manually
        const contractMatch = raw.match(/"contract"\s*:\s*"([\s\S]*?)"\s*,\s*"questions"/);
        const questionsMatch = raw.match(/"questions"\s*:\s*\[([\s\S]*?)\]/);
        if (contractMatch) {
          const contractText = contractMatch[1]
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
          const questions = questionsMatch ? questionsMatch[1] : '';
          return `{"contract":"${contractText}","questions":[${questions}]}`;
        }
        return raw; // Return raw and let caller handle the parse error
      }
    }
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
    const dealJson = JSON.stringify(dealDetails, null, 2);
    if (!dealJson || dealJson === '{}') {
      throw new Error('No deal details provided for contract generation');
    }

    const now = new Date();
    const todayIso = now.toISOString().split('T')[0];
    const todayLong = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const response = await this.client.messages.create({
      model: CONFIG.ai.anthropic.contractModel,
      max_tokens: CONFIG.ai.anthropic.contractMaxTokens,
      messages: [{
        role: 'user',
        content: `You are an expert legal AI assistant for a smart contract escrow platform.

TODAY'S DATE: ${todayLong} (${todayIso}). Use THIS date as the contract execution / effective date. Do NOT invent or use any other date for "Date", "Effective Date", or "Executed on". Only use the deadline dates from the deal details for delivery/dispute deadlines.

Generate a professional contract agreement customized for THIS SPECIFIC deal. You MUST incorporate all of the following deal details into the contract - do not use a generic template:

${dealJson}

Include in the contract: the exact title, amount (USDC), role (buyer/seller), counterparty address, description of work, initiatorDeadline (funding deadline), and completionDeadline (delivery deadline) where applicable.

OUTPUT FORMAT — your ENTIRE response MUST be a single JSON object and nothing else:
- No preamble like "Here is the contract:" or "Sure, I'll generate...".
- No trailing commentary.
- No markdown code fences (no \`\`\`json, no \`\`\`).
- The first character of your response MUST be { and the last character MUST be }.

The JSON object MUST be shaped EXACTLY like this:
{
  "contract": "<HTML string — see rules below>",
  "questions": ["question1", "question2", ...]
}

CONTRACT HTML RULES (the contract field is DISPLAY-READY HTML — the frontend renders it directly with dangerouslySetInnerHTML, so send exactly the tags you want shown):
- The contract value MUST start with the literal characters \`<article class="contract">\` and end with \`</article>\`. No leading text. No leading whitespace. No code fences inside the string.
- Self-contained HTML fragment only — do NOT include <html>, <head>, <body>, <script>, <style>, <iframe>, or inline event handlers (no on* attributes).
- Use semantic, well-structured tags:
  - <h1> for the contract title, <h2> for top-level sections (Parties, Scope of Work, Financial Terms, Deadlines, Dispute Resolution, Signatures, etc.), <h3> for subsections.
  - <p> for paragraphs.
  - <ul>/<ol> + <li> for lists. Never emit list items as plain text with bullets.
  - <table> with <thead>/<tbody>/<tr>/<th>/<td> for tabular data (e.g. parties table, fee/timeline table).
  - <strong> for emphasis on key terms (amounts, deadlines, addresses), <em> for definitions, <code> for wallet addresses and on-chain identifiers.
  - <hr> to separate major sections where appropriate.
- Write valid, properly nested HTML. Inside text content, escape any literal &, <, > as &amp;, &lt;, &gt;. Do NOT escape the HTML tags themselves — they must remain real \`<\` and \`>\` characters so the browser renders them.
- Inside the JSON string value, escape every double quote as \\" and every newline as \\n. The output must be valid JSON parseable by JSON.parse.
- Do NOT include any CSS, classes other than the wrapper "contract", or inline styles — the frontend handles styling.
- Aim for a polished, lawyer-grade document: clear hierarchy, numbered clauses where natural, no walls of text.`,
      }],
    });

    const textBlocks = (response.content || []).filter((b: any) => b.type === 'text');
    const text = textBlocks
      .map((b: any) => (typeof b.text === 'string' ? b.text : ''))
      .join('\n');
    if (!text) throw new Error('Empty response from Claude');

    const jsonStr = this.extractJsonFromText(text);
    if (!jsonStr) {
      console.error('[ClaudeArbiter] Failed to extract JSON. Raw response (first 500 chars):', text.slice(0, 500));
      throw new Error('No JSON in response');
    }
    try {
      return JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('[ClaudeArbiter] JSON parse failed. Extracted string (first 500 chars):', jsonStr.slice(0, 500));
      throw parseErr;
    }
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
