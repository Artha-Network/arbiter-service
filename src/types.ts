import { z } from 'zod';

// Resolve Ticket Schema - matches the onchain program expectations
export const ResolveTicketSchema = z.object({
  schema: z.literal('https://artha.network/schemas/resolve-ticket-v1.json'),
  deal_id: z.string().min(1),
  outcome: z.enum(['RELEASE', 'REFUND']),
  reason_short: z.string().max(200),
  rationale_cid: z.string(), // IPFS/Arweave CID
  violated_rules: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  nonce: z.string().regex(/^[0-9]+$/),
  expires_at_utc: z.string().datetime()
});

export type ResolveTicket = z.infer<typeof ResolveTicketSchema>;

// Deal metadata structure
export const DealSchema = z.object({
  deal_id: z.string(),
  seller: z.string(), // PublicKey
  buyer: z.string(),  // PublicKey
  amount: z.number(),
  mint: z.string(),   // PublicKey
  dispute_by: z.number(), // Unix timestamp
  fee_bps: z.number(),
  created_at: z.number(),
  status: z.enum(['Init', 'Funded', 'Disputed', 'Resolved', 'Released', 'Refunded'])
});

export type Deal = z.infer<typeof DealSchema>;

// Evidence structure
export const EvidenceSchema = z.object({
  cid: z.string(), // IPFS/Arweave CID
  type: z.enum(['pdf', 'image', 'text', 'json']),
  description: z.string(),
  submitted_by: z.enum(['seller', 'buyer']),
  submitted_at: z.number(), // Unix timestamp
  extracted_text: z.string().optional() // Pre-processed text content
});

export type Evidence = z.infer<typeof EvidenceSchema>;

// Arbitration request
export const ArbitrationRequestSchema = z.object({
  deal: DealSchema,
  evidence: z.array(EvidenceSchema),
  seller_claim: z.string(),
  buyer_claim: z.string()
});

export type ArbitrationRequest = z.infer<typeof ArbitrationRequestSchema>;

// Signed resolve ticket (what gets returned to client)
export const SignedResolveTicketSchema = z.object({
  ticket: ResolveTicketSchema,
  arbiter_pubkey: z.string(), // hex
  ed25519_signature: z.string() // hex
});

export type SignedResolveTicket = z.infer<typeof SignedResolveTicketSchema>;

// Gemini response schema for structured output
export const responseJsonSchema = {
  type: "object" as const,
  required: ["schema", "deal_id", "outcome", "reason_short", "rationale_cid", "violated_rules", "confidence", "nonce", "expires_at_utc"],
  properties: {
    schema: { type: "string" as const, const: "https://artha.network/schemas/resolve-ticket-v1.json" },
    deal_id: { type: "string" as const, minLength: 1 },
    outcome: { type: "string" as const, enum: ["RELEASE", "REFUND"] },
    reason_short: { type: "string" as const, maxLength: 200 },
    rationale_cid: { type: "string" as const },
    violated_rules: { type: "array" as const, items: { type: "string" as const } },
    confidence: { type: "number" as const, minimum: 0, maximum: 1 },
    nonce: { type: "string" as const, pattern: "^[0-9]+$" },
    expires_at_utc: { type: "string" as const, format: "date-time" }
  }
};