import { GoogleGenAI, Part } from '@google/genai';
import { sha256 } from '@noble/hashes/sha256';
import nacl from 'tweetnacl';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import {
  ArbitrationRequest,
  ResolveTicket,
  SignedResolveTicket,
  responseJsonSchema,
  ResolveTicketSchema
} from './types.js';
import { SYSTEM_PROMPT, getPolicyForPrompt } from './policy.js';
import { CONFIG } from './config.js';

export class GeminiArbiter {
  private ai: GoogleGenAI;
  private arbiterKeypair: nacl.SignKeyPair;
  private supabase: SupabaseClient | null;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: CONFIG.gemini.apiKey });

    // Initialize Supabase only if credentials are available
    if (CONFIG.supabase.url && CONFIG.supabase.serviceKey) {
      this.supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceKey);
    } else {
      this.supabase = null;
      console.warn('⚠️ Supabase client not initialized. Evidence fetching will be disabled.');
    }

    // Generate keypair from secret
    const secretKey = Uint8Array.from(Buffer.from(CONFIG.arbiter.secretHex, 'hex'));
    this.arbiterKeypair = nacl.sign.keyPair.fromSeed(secretKey.slice(0, 32));
  }

  /**
   * Main arbitration function - takes case data and returns signed decision
   */
  async arbitrateCase(request: ArbitrationRequest): Promise<SignedResolveTicket> {
    // 1. Validate input
    this.validateBusinessRules(request);

    // 2. Prepare evidence (Multimodal)
    const evidenceParts = await this.prepareEvidenceParts(request);

    // 3. Generate secure nonce and expiry
    const nonce = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    // 4. Build system instructions and context
    const contextPrompt = this.buildContextPrompt(request, nonce, expiresAt.toISOString());

    // Combine context with evidence parts
    const content = [
      { text: contextPrompt },
      ...evidenceParts
    ];

    try {
      // 5. Call Gemini using new SDK
      const response = await this.ai.models.generateContent({
        model: CONFIG.gemini.arbitrationModel,
        contents: [{ role: 'user', parts: content }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: responseJsonSchema as any
        }
      });

      const responseText = response.text;

      if (!responseText) {
        throw new Error('Empty response from Gemini');
      }

      // 6. Parse and validate the response
      const ticket = JSON.parse(responseText) as ResolveTicket;
      const validatedTicket = ResolveTicketSchema.parse(ticket);

      // 7. Sign the ticket
      const signedTicket = this.signTicket(validatedTicket);

      // 8. Log the decision
      console.log(`Arbitration Decision for ${request.deal.deal_id}:`, {
        outcome: validatedTicket.outcome,
        confidence: validatedTicket.confidence,
        reason: validatedTicket.reason_short,
        violated_rules: validatedTicket.violated_rules
      });

      return signedTicket;

    } catch (error) {
      console.error('Arbitration failed:', error);
      throw new Error(`Arbitration engine error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate business rules that Zod cannot easily capture
   */
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

  /**
   * Fetch file from Supabase and prepare as Gemini Part
   */
  private async fetchEvidenceFile(pathOrCid: string): Promise<Part | null> {
    if (!this.supabase) {
      console.warn(`Supabase not available. Cannot fetch evidence ${pathOrCid}`);
      return null;
    }

    try {
      // Assuming the 'cid' in the request is actually a path in the 'evidence' bucket
      // or we try to download it. 
      // For now, let's assume the 'cid' field holds the Supabase storage path.

      const { data, error } = await this.supabase
        .storage
        .from('evidence') // Uploads must go to 'evidence' bucket
        .download(pathOrCid);

      if (error || !data) {
        console.warn(`Failed to download evidence ${pathOrCid}:`, error);
        return null;
      }

      const arrayBuffer = await data.arrayBuffer();
      const base64Data = Buffer.from(arrayBuffer).toString('base64');
      return {
        inlineData: {
          mimeType: data.type,
          data: base64Data
        }
      };
    } catch (e) {
      console.error(`Error processing evidence ${pathOrCid}:`, e);
      return null;
    }
  }

  /**
   * Prepare evidence parts (Text + Images/Files)
   */
  private async prepareEvidenceParts(request: ArbitrationRequest): Promise<Part[]> {
    const parts: Part[] = [];

    // Add Claims as text
    parts.push({
      text: `SELLER CLAIM:\n${request.seller_claim}\n\nBUYER CLAIM:\n${request.buyer_claim}\n\nEVIDENCE SUBMITTED:`
    });

    for (const evidence of request.evidence) {
      // Add description first
      parts.push({
        text: `\nEVIDENCE ITEM (${evidence.type}, submitted by ${evidence.submitted_by}):\nDescription: ${evidence.description}\nSubmitted: ${new Date(evidence.submitted_at * 1000).toISOString()}\n`
      });

      // Try to fetch the actual file content if it's not just text
      if (evidence.type !== 'text' && evidence.cid) {
        const filePart = await this.fetchEvidenceFile(evidence.cid);
        if (filePart) {
          parts.push(filePart);
        } else {
          parts.push({ text: '[WARNING: Could not retrieve file content from storage]' });
        }
      } else if (evidence.extracted_text) {
        parts.push({ text: `Content: ${evidence.extracted_text}` });
      }

      parts.push({ text: '\n---\n' });
    }

    return parts;
  }

  /**
   * Build the Context Prompt (System + Deal Info)
   */
  private buildContextPrompt(
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
Generate a JSON response with these exact fields filled in:
- schema: "https://artha.network/schemas/resolve-ticket-v1.json"
- deal_id: "${request.deal.deal_id}"
- outcome: "RELEASE" or "REFUND" (based on rule analysis)
- reason_short: Brief explanation (max 200 chars)
- rationale_cid: "pending" (will be stored separately)
- violated_rules: Array of rule IDs that were violated
- confidence: Number between 0 and 1
- nonce: "${nonce}"
- expires_at_utc: "${expiresAt}"

Analyze the supplied evidence (including attached files) against the policy rules and return ONLY the JSON response.`;
  }

  /**
   * Sign the resolve ticket with ed25519
   */
  private signTicket(ticket: ResolveTicket): SignedResolveTicket {
    const canonical = Buffer.from(JSON.stringify(ticket, null, 0));
    const digest = Uint8Array.from(sha256(canonical));
    const signature = nacl.sign.detached(digest, this.arbiterKeypair.secretKey);

    return {
      ticket,
      arbiter_pubkey: Buffer.from(this.arbiterKeypair.publicKey).toString('hex'),
      ed25519_signature: Buffer.from(signature).toString('hex')
    };
  }

  /**
   * Get the arbiter's public key (for verification)
   */
  getArbiterPublicKey(): string {
    return Buffer.from(this.arbiterKeypair.publicKey).toString('hex');
  }

  /**
   * Generate contract for a deal
   */
  async generateContract(dealDetails: any) {
    const dealJson = JSON.stringify(dealDetails, null, 2);
    if (!dealJson || dealJson === '{}') {
      throw new Error('No deal details provided for contract generation');
    }

    const prompt = `You are an expert legal AI assistant for a smart contract escrow platform.

Generate a professional contract agreement customized for THIS SPECIFIC deal. You MUST incorporate all of the following deal details into the contract - do not use a generic template:

${dealJson}

Include in the contract: the exact title, amount (USDC), role (buyer/seller), counterparty address, description of work, initiatorDeadline (funding deadline), and completionDeadline (delivery deadline) where applicable.

Return a JSON object with:
{
  "contract": "markdown formatted contract text with the specific deal terms above",
  "questions": ["question1", "question2", ...]
}`;

    const response = await this.ai.models.generateContent({
      model: CONFIG.gemini.contractModel,
      contents: prompt,
      config: {
        temperature: 0.7,
        responseMimeType: 'application/json',
      }
    });

    const responseText = response.text;

    if (!responseText) {
      throw new Error('Empty response from Gemini');
    }

    return JSON.parse(responseText);
  }

  /**
   * Verify a signed ticket (for testing)
   */
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