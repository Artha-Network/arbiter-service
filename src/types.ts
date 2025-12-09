import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

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
  deal_id: z.string().min(1),
  seller: z.string().min(1), // PublicKey
  buyer: z.string().min(1),  // PublicKey
  amount: z.number().positive(),
  mint: z.string().min(1),   // PublicKey
  dispute_by: z.number().int().positive(), // Unix timestamp
  fee_bps: z.number().int().nonnegative(),
  created_at: z.number().int().positive(),
  status: z.enum(['Init', 'Funded', 'Disputed', 'Resolved', 'Released', 'Refunded'])
});

export type Deal = z.infer<typeof DealSchema>;

// Evidence structure
export const EvidenceSchema = z.object({
  cid: z.string().min(1), // IPFS/Arweave CID
  type: z.enum(['pdf', 'image', 'text', 'json']),
  description: z.string(),
  submitted_by: z.enum(['seller', 'buyer']),
  submitted_at: z.number().int().positive(), // Unix timestamp
  extracted_text: z.string().optional() // Pre-processed text content
});

export type Evidence = z.infer<typeof EvidenceSchema>;

// Arbitration request
export const ArbitrationRequestSchema = z.object({
  deal: DealSchema,
  evidence: z.array(EvidenceSchema).min(1), // Require at least one piece of evidence
  seller_claim: z.string().min(1),
  buyer_claim: z.string().min(1)
});

export type ArbitrationRequest = z.infer<typeof ArbitrationRequestSchema>;

// Signed resolve ticket (what gets returned to client)
export const SignedResolveTicketSchema = z.object({
  ticket: ResolveTicketSchema,
  arbiter_pubkey: z.string().min(1), // hex
  ed25519_signature: z.string().min(1) // hex
});

export type SignedResolveTicket = z.infer<typeof SignedResolveTicketSchema>;

// Gemini response schema for structured output - DERIVED from Zod
// @ts-ignore - zod-to-json-schema creates excessively deep types
const rawSchema = zodToJsonSchema(ResolveTicketSchema, { target: 'jsonSchema7' });

// Sanitization for Gemini API (doesn't support 'const', 'additionalProperties', '$schema')
function sanitizeForGemini(schema: any): any {
  if (typeof schema !== 'object' || schema === null) return schema;

  const { $schema, additionalProperties, const: constVal, ...rest } = schema;

  if (constVal !== undefined) {
    rest.enum = [constVal];
  }

  if (schema.type === 'object') {
    // Recursively sanitize properties
    if (rest.properties) {
      for (const key in rest.properties) {
        rest.properties[key] = sanitizeForGemini(rest.properties[key]);
      }
    }
  } else if (schema.type === 'array') {
    if (rest.items) {
      rest.items = sanitizeForGemini(rest.items);
    }
  }

  return rest;
}

export const responseJsonSchema = sanitizeForGemini(rawSchema);