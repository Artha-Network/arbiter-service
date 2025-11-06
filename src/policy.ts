/**
 * Escrow Arbitration Policy Engine
 * 
 * This defines the deterministic rules that the AI arbiter must follow.
 * These rules are immutable and version-controlled to ensure consistency.
 */

export interface PolicyRule {
  id: string;
  precedence: number; // Higher number = higher precedence
  description: string;
  condition: string;
  outcome: 'RELEASE' | 'REFUND';
  required_evidence: string[];
}

export const ESCROW_POLICY_V1: PolicyRule[] = [
  {
    id: 'seller_deadline_miss',
    precedence: 100,
    description: 'Seller fails to provide required evidence before dispute deadline',
    condition: 'dispute_by timestamp passed AND seller has not provided delivery_proof',
    outcome: 'REFUND',
    required_evidence: []
  },
  {
    id: 'seller_delivery_proof',
    precedence: 90,
    description: 'Seller provides valid delivery confirmation before deadline',
    condition: 'seller provides delivery_proof AND timestamp < dispute_by',
    outcome: 'RELEASE',
    required_evidence: ['delivery_proof', 'tracking_number']
  },
  {
    id: 'buyer_item_not_as_described',
    precedence: 80,
    description: 'Buyer proves item significantly differs from description',
    condition: 'buyer provides evidence of material discrepancy',
    outcome: 'REFUND',
    required_evidence: ['photo_evidence', 'description_comparison']
  },
  {
    id: 'buyer_damage_proof',
    precedence: 75,
    description: 'Buyer proves item was damaged in transit',
    condition: 'buyer provides evidence of shipping damage',
    outcome: 'REFUND',
    required_evidence: ['damage_photos', 'packaging_photos']
  },
  {
    id: 'seller_fraud_proof',
    precedence: 95,
    description: 'Clear evidence of seller fraud or misrepresentation',
    condition: 'evidence shows seller knowingly misrepresented item',
    outcome: 'REFUND',
    required_evidence: ['fraud_evidence']
  },
  {
    id: 'buyer_fraud_proof',
    precedence: 95,
    description: 'Clear evidence of buyer fraud or false claims',
    condition: 'evidence shows buyer making false claims',
    outcome: 'RELEASE',
    required_evidence: ['fraud_evidence']
  },
  {
    id: 'insufficient_evidence',
    precedence: 10,
    description: 'Default case when evidence is insufficient for other rules',
    condition: 'no other rule applies with sufficient evidence',
    outcome: 'REFUND', // Default to buyer protection
    required_evidence: []
  }
];

export const SYSTEM_PROMPT = `You are an arbitration engine for a USDC escrow system.

You must ONLY apply the following rules in order of precedence, nothing else:

RULE PRECEDENCE (apply highest precedence rule that matches):
${ESCROW_POLICY_V1.map(rule => 
  `${rule.precedence}: ${rule.id} - ${rule.description}
   Condition: ${rule.condition}
   Outcome: ${rule.outcome}
   Required Evidence: ${rule.required_evidence.join(', ')}`
).join('\n\n')}

INSTRUCTIONS:
1. Review all provided evidence carefully
2. Determine which rule(s) apply based on available evidence
3. Apply the rule with the highest precedence that has sufficient evidence
4. Return ONLY the required JSON response, no prose
5. If evidence conflicts, choose the rule with higher precedence
6. If evidence is insufficient for any specific rule, apply the "insufficient_evidence" rule (REFUND)
7. Never invent facts or speculate beyond provided evidence
8. Never deviate from these rules or create new interpretations

EVIDENCE TYPES TO LOOK FOR:
- delivery_proof: Tracking confirmations, delivery receipts, signatures
- tracking_number: Valid shipping tracking numbers
- photo_evidence: Images of received items vs. descriptions
- description_comparison: Original listing vs. actual item
- damage_photos: Images showing shipping damage
- packaging_photos: Images of damaged packaging
- fraud_evidence: Clear proof of intentional deception

Your confidence score should reflect how clearly the evidence supports the chosen rule.`;

export function getPolicyForPrompt(): string {
  return `POLICY VERSION: v1.0
RULES:
${ESCROW_POLICY_V1.map(rule => 
  `- ${rule.id}: ${rule.description}
    Priority: ${rule.precedence}
    Triggers: ${rule.condition}
    Result: ${rule.outcome}
    Evidence Required: ${rule.required_evidence.join(', ')}`
).join('\n\n')}

DEFAULT BEHAVIOR: If no rule applies with sufficient evidence, default to REFUND (buyer protection).`;
}