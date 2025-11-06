# AI Arbiter Service

A Gemini-powered AI arbitration service for Artha Network escrow disputes. This service provides deterministic, policy-driven dispute resolution with cryptographic signatures.

## Overview

The AI Arbiter Service implements a **policy-first approach** to automated dispute resolution:

- 🧠 **Gemini 1.5 Pro**: Advanced AI for evidence analysis and reasoning
- ⚖️ **Deterministic Policies**: Fixed rules prevent AI from "improvising" decisions
- 🔐 **Cryptographic Signing**: Ed25519 signatures ensure authenticity
- 📊 **Structured Output**: JSON Schema enforces valid response format
- 🛡️ **Safety Filters**: Multiple layers of content moderation

## Architecture

```
Evidence Input → Policy Engine → Gemini Analysis → Structured Output → Ed25519 Signature → Onchain Verification
```

### Key Components

1. **Policy Engine** (`src/policy.ts`): Immutable rules with precedence ordering
2. **Gemini Arbiter** (`src/gemini-arbiter.ts`): Core AI reasoning and signing
3. **Type System** (`src/types.ts`): Zod schemas for validation
4. **Express Server** (`src/index.ts`): HTTP API endpoints

## Installation

```bash
cd ai-arbiter-service
npm install
```

## Configuration

Copy and configure environment variables:

```bash
cp .env.example .env
```

Required environment variables:

```env
GEMINI_API_KEY=your_gemini_api_key
ARBITER_ED25519_SECRET_HEX=your_64_char_hex_secret
PORT=3001
NODE_ENV=development
```

### Generating Arbiter Keys

```bash
# Generate a new ed25519 keypair
node -e "
const nacl = require('tweetnacl');
const keypair = nacl.sign.keyPair();
console.log('Secret (hex):', Buffer.from(keypair.secretKey).toString('hex'));
console.log('Public (hex):', Buffer.from(keypair.publicKey).toString('hex'));
"
```

## Usage

### Start the Service

```bash
npm run dev  # Development with hot reload
npm start    # Production
```

### API Endpoints

#### `GET /health`
Health check and service info

#### `GET /arbiter/pubkey`
Get the arbiter's public key

#### `POST /arbitrate`
Main arbitration endpoint

**Request Body:**
```json
{
  "deal": {
    "deal_id": "string",
    "seller": "PublicKey",
    "buyer": "PublicKey", 
    "amount": 1000,
    "mint": "USDCMint",
    "dispute_by": 1234567890,
    "fee_bps": 250,
    "created_at": 1234567890,
    "status": "Disputed"
  },
  "evidence": [
    {
      "cid": "QmExample...",
      "type": "pdf",
      "description": "Delivery confirmation",
      "submitted_by": "seller",
      "submitted_at": 1234567890,
      "extracted_text": "DELIVERY CONFIRMED..."
    }
  ],
  "seller_claim": "I delivered the item successfully",
  "buyer_claim": "The item was damaged on arrival"
}
```

**Response:**
```json
{
  "ticket": {
    "schema": "https://artha.network/schemas/resolve-ticket-v1.json",
    "deal_id": "string",
    "outcome": "RELEASE",
    "reason_short": "Seller provided valid delivery proof",
    "rationale_cid": "pending",
    "violated_rules": ["buyer_damage_claim_insufficient"],
    "confidence": 0.85,
    "nonce": "1234567890123",
    "expires_at_utc": "2024-01-16T14:30:00.000Z"
  },
  "arbiter_pubkey": "hex_public_key",
  "ed25519_signature": "hex_signature"
}
```

#### `POST /verify`
Verify a signed ticket

## Policy Rules

The arbiter follows a strict precedence-based policy system:

### Rule Precedence (Higher = Higher Priority)

1. **seller_deadline_miss** (100): Seller misses dispute deadline → REFUND
2. **seller_fraud_proof** (95): Clear seller fraud → REFUND  
3. **buyer_fraud_proof** (95): Clear buyer fraud → RELEASE
4. **seller_delivery_proof** (90): Valid delivery confirmation → RELEASE
5. **buyer_item_not_as_described** (80): Item differs from description → REFUND
6. **buyer_damage_proof** (75): Shipping damage evidence → REFUND
7. **insufficient_evidence** (10): Default case → REFUND

### Evidence Types

- **delivery_proof**: Tracking confirmations, delivery receipts
- **tracking_number**: Valid shipping tracking numbers  
- **photo_evidence**: Images of items vs. descriptions
- **damage_photos**: Images showing shipping damage
- **fraud_evidence**: Clear proof of intentional deception

## Security Features

### AI Safety
- Gemini safety settings block harmful content
- System prompts prevent rule invention or speculation
- Structured output enforces valid JSON responses
- Temperature set low (0.1) for consistency

### Cryptographic Security
- Ed25519 signatures over canonical JSON
- Nonce prevents replay attacks
- Time-based expiry prevents stale tickets
- Deterministic signing ensures reproducibility

### Policy Integrity
- Rules stored outside of prompts
- Version-controlled policy changes
- No dynamic rule generation
- Clear precedence ordering

## Testing

Run the test cases:

```bash
# Set API keys in src/test-cases.ts first
npm test

# Or run specific test scenarios:
node -r tsx/esm src/test-cases.ts
```

### Test Scenarios

1. **Delivery Proof**: Seller provides tracking → should RELEASE
2. **Damage Evidence**: Buyer shows damage → should REFUND  
3. **Conflicting Evidence**: Both submit evidence → higher precedence wins
4. **Insufficient Evidence**: Vague claims → defaults to REFUND

## Integration with Onchain Program

The signed tickets work with your Solana program's `resolve` instruction:

```rust
// In your Anchor program
pub fn resolve(ctx: Context<Resolve>, ticket: ResolveTicket) -> Result<()> {
    // 1. Verify arbiter is allowlisted
    require!(is_authorized_arbiter(&ticket.arbiter_pubkey), EscrowError::UnauthorizedArbiter);
    
    // 2. Verify signature over ticket
    require!(verify_ed25519_signature(&ticket), EscrowError::InvalidSignature);
    
    // 3. Check nonce hasn't been used
    require!(!ctx.accounts.escrow_state.nonce_used, EscrowError::NonceAlreadyUsed);
    
    // 4. Check expiry
    require!(ticket.expires_at > Clock::get()?.unix_timestamp, EscrowError::TicketExpired);
    
    // 5. Execute outcome
    ctx.accounts.escrow_state.status = match ticket.outcome {
        "RELEASE" => EscrowStatus::Resolved,
        "REFUND" => EscrowStatus::Resolved,
        _ => return Err(EscrowError::InvalidOutcome.into())
    };
    
    // Store verdict in reserved space
    ctx.accounts.escrow_state.reserved[0] = match ticket.outcome {
        "RELEASE" => 1,
        "REFUND" => 2,
        _ => 0
    };
    
    emit!(DisputeResolved {
        deal_id: ticket.deal_id,
        outcome: ticket.outcome,
        confidence: ticket.confidence
    });
    
    Ok(())
}
```

## Monitoring & Logging

The service logs all arbitration decisions with:
- Deal ID and outcome
- Confidence scores
- Violated rules
- Evidence hashes (for audit trails)
- Response times

For production, integrate with your preferred logging/monitoring solution.

## Development

### File Structure

```
src/
├── types.ts          # Zod schemas and TypeScript types
├── policy.ts         # Arbitration rules and policies  
├── gemini-arbiter.ts # Core AI reasoning and signing
├── index.ts          # Express server and API routes
└── test-cases.ts     # Test scenarios and examples
```

### Adding New Rules

1. Add rule to `ESCROW_POLICY_V1` in `src/policy.ts`
2. Set appropriate precedence level
3. Define required evidence types
4. Update system prompt if needed
5. Add test cases

### Customizing for Your Use Case

- **Evidence Processing**: Modify evidence text preparation
- **Policy Rules**: Adjust rules and precedence for your domain
- **Safety Settings**: Tune Gemini safety thresholds
- **Response Format**: Extend ticket schema if needed

## Production Deployment

### Environment Setup
- Use environment-specific Gemini API keys
- Secure secret key storage (AWS Secrets Manager, etc.)
- Enable structured logging
- Set up health monitoring

### Scaling Considerations
- Gemini API rate limits
- Evidence file size limits (50MB per file)
- Cache frequently accessed policies
- Monitor response times and accuracy

### Security Checklist
- [ ] Arbiter keys stored securely
- [ ] API keys rotated regularly  
- [ ] Evidence content filtered
- [ ] Audit logs enabled
- [ ] Rate limiting configured
- [ ] Input validation comprehensive

## Troubleshooting

### Common Issues

**"Empty response from Gemini"**
- Check API key validity
- Verify safety settings aren't blocking content
- Ensure evidence text isn't too long

**"Invalid signature verification"**
- Confirm ed25519 key format (64-byte hex)
- Check canonical JSON serialization
- Verify public key matches secret key

**"Arbitration engine error"**
- Review evidence text for policy-triggering keywords
- Check deal status is "Disputed" 
- Ensure dispute_by timestamp has passed

### Debugging

Enable verbose logging:
```bash
DEBUG=* npm run dev
```

Test signature verification:
```bash
curl -X POST http://localhost:3001/verify \
  -H "Content-Type: application/json" \
  -d @signed_ticket.json
```

## License

MIT - See LICENSE file for details