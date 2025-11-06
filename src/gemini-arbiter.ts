import { GoogleGenerativeAI } from '@google/generative-ai';
import { sha256 } from '@noble/hashes/sha256';
import nacl from 'tweetnacl';
import { 
  ArbitrationRequest, 
  ResolveTicket, 
  SignedResolveTicket,
  responseJsonSchema,
  ResolveTicketSchema 
} from './types.js';
import { SYSTEM_PROMPT, getPolicyForPrompt } from './policy.js';

export class GeminiArbiter {
  private genai: GoogleGenerativeAI;
  private arbiterKeypair: nacl.SignKeyPair;

  constructor(
    private geminiApiKey: string,
    private arbiterSecretHex: string
  ) {
    this.genai = new GoogleGenerativeAI(geminiApiKey);
    
    // Generate keypair from secret
    const secretKey = Uint8Array.from(Buffer.from(arbiterSecretHex, 'hex'));
    this.arbiterKeypair = nacl.sign.keyPair.fromSeed(secretKey.slice(0, 32));
  }

  /**
   * Main arbitration function - takes case data and returns signed decision
   */
  async arbitrateCase(request: ArbitrationRequest): Promise<SignedResolveTicket> {
    // 1. Validate input
    this.validateRequest(request);

    // 2. Prepare evidence text
    const evidenceText = this.prepareEvidenceText(request);

    // 3. Generate nonce and expiry
    const nonce = Date.now().toString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    // 4. Call Gemini with structured output
    const model = this.genai.getGenerativeModel({ 
      model: 'gemini-1.5-pro',
      generationConfig: {
        temperature: 0.1, // Low temperature for consistency
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema: responseJsonSchema
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
      ]
    });

    const prompt = this.buildPrompt(request, evidenceText, nonce, expiresAt.toISOString());
    
    try {
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      
      if (!responseText) {
        throw new Error('Empty response from Gemini');
      }

      // 5. Parse and validate the response
      const ticket = JSON.parse(responseText) as ResolveTicket;
      const validatedTicket = ResolveTicketSchema.parse(ticket);

      // 6. Sign the ticket
      const signedTicket = this.signTicket(validatedTicket);

      // 7. Log the decision (in production, store securely)
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
   * Validate the arbitration request
   */
  private validateRequest(request: ArbitrationRequest): void {
    if (!request.deal.deal_id) {
      throw new Error('Deal ID is required');
    }

    if (request.deal.status !== 'Disputed') {
      throw new Error('Deal must be in Disputed status for arbitration');
    }

    if (request.evidence.length === 0) {
      throw new Error('At least some evidence must be provided');
    }

    // Check if dispute is still within arbitration window
    const now = Math.floor(Date.now() / 1000);
    if (now < request.deal.dispute_by) {
      throw new Error('Dispute period has not yet ended');
    }
  }

  /**
   * Prepare evidence text for the model
   */
  private prepareEvidenceText(request: ArbitrationRequest): string {
    const evidenceTexts = request.evidence.map(evidence => {
      return `EVIDENCE ${evidence.cid} (${evidence.type}, submitted by ${evidence.submitted_by}):
Description: ${evidence.description}
Submitted: ${new Date(evidence.submitted_at * 1000).toISOString()}
${evidence.extracted_text ? `Content: ${evidence.extracted_text}` : 'Content: [Raw file - not processed]'}
---`;
    }).join('\n\n');

    return `SELLER CLAIM:
${request.seller_claim}

BUYER CLAIM:
${request.buyer_claim}

EVIDENCE SUBMITTED:
${evidenceTexts}`;
  }

  /**
   * Build the complete prompt for Gemini
   */
  private buildPrompt(
    request: ArbitrationRequest, 
    evidenceText: string, 
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

${evidenceText}

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

Analyze the evidence against the policy rules and return ONLY the JSON response.`;
  }

  /**
   * Sign the resolve ticket with ed25519
   */
  private signTicket(ticket: ResolveTicket): SignedResolveTicket {
    // Create canonical JSON representation
    const canonical = Buffer.from(JSON.stringify(ticket, null, 0));
    const digest = Uint8Array.from(sha256(canonical));

    // Sign with ed25519
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