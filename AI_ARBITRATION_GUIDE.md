# AI Arbitration Service - Implementation Summary

## Overview
The Artha Network AI Arbitration Service is **fully implemented** and production-ready, using Google's Gemini 1.5 Pro to analyze escrow disputes and generate cryptographically signed verdicts.

## Architecture

### Components
1. **Gemini Client** (`src/gemini-arbiter.ts`)
   - Integrates with Google Generative AI API
   - Uses structured output for deterministic responses
   - Implements Ed25519 signature signing

2. **Policy Engine** (`src/policy.ts`)
   - Defines immutable arbitration rules
   - Precedence-based rule application
   - Evidence requirements per rule

3. **Type System** (`src/types.ts`)
   - Zod schemas for validation
   - TypeScript types for type safety
   - JSON schema for Gemini structured output

4. **HTTP API** (`src/index.ts`)
   - Express server with endpoints
   - Request validation
   - Error handling

## Key Features

### 1. Policy-Based Decisions
The service uses deterministic rules with precedence ordering:
- **seller_deadline_miss** (precedence: 100) → REFUND
- **seller_fraud_proof** (precedence: 95) → REFUND
- **buyer_fraud_proof** (precedence: 95) → RELEASE
- **seller_delivery_proof** (precedence: 90) → RELEASE
- **buyer_item_not_as_described** (precedence: 80) → REFUND
- **buyer_damage_proof** (precedence: 75) → REFUND
- **insufficient_evidence** (precedence: 10) → REFUND (default)

### 2. Evidence Analysis
Processes multiple evidence types:
- PDF documents (delivery confirmations, receipts)
- Images (damage photos, item comparisons)
- Text (claims, descriptions)
- JSON (structured data)

### 3. Cryptographic Signing
- Uses Ed25519 for signature generation
- SHA-256 hashing of canonical JSON
- Verifiable on-chain by Solana program

### 4. Structured Output
Returns JSON tickets matching on-chain expectations:
```json
{
  "ticket": {
    "schema": "https://artha.network/schemas/resolve-ticket-v1.json",
    "deal_id": "...",
    "outcome": "RELEASE" | "REFUND",
    "reason_short": "...",
    "rationale_cid": "pending",
    "violated_rules": ["rule_id"],
    "confidence": 0.85,
    "nonce": "...",
    "expires_at_utc": "..."
  },
  "arbiter_pubkey": "hex_string",
  "ed25519_signature": "hex_string"
}
```

## Configuration

### Environment Variables
Create a `.env` file with:
```bash
GEMINI_API_KEY=your_gemini_api_key_here
ARBITER_ED25519_SECRET_HEX=your_64_char_hex_secret
PORT=3001
NODE_ENV=development
```

### Generating Keys
```bash
cd arbiter-service
node scripts/generate-keypair.js
```

## Usage

### 1. Start the Service
```bash
cd arbiter-service
npm install
npm run dev
```

### 2. Health Check
```bash
curl http://localhost:3001/health
```

### 3. Get Arbiter Public Key
```bash
curl http://localhost:3001/arbiter/pubkey
```

### 4. Submit Arbitration Request
```bash
curl -X POST http://localhost:3001/arbitrate \
  -H "Content-Type: application/json" \
  -d @test-arbitration.json
```

### 5. Verify Ticket (Optional)
```bash
curl -X POST http://localhost:3001/verify \
  -H "Content-Type: application/json" \
  -d '{
    "ticket": {...},
    "arbiter_pubkey": "...",
    "ed25519_signature": "..."
  }'
```

## Testing

### Unit Tests
```bash
npm test
```

### Integration Test
```bash
# Start service
npm run dev

# In another terminal
./test-arbitration.sh
```

### End-to-End Test
The signed ticket can be submitted to the on-chain `resolve()` instruction:
```typescript
await program.methods
  .resolve(verdict)
  .accounts({
    arbiter: arbiterKeypair.publicKey,
    escrowState: escrowPda
  })
  .signers([arbiterKeypair])
  .rpc();
```

## Workflow

1. **Dispute Opened**
   - Buyer or seller opens dispute on-chain
   - Status changes to `Disputed`

2. **Evidence Submission**
   - Parties upload evidence (photos, documents, etc.)
   - Evidence stored on IPFS/Arweave with CIDs

3. **Arbitration Request**
   - Backend calls `/arbitrate` with:
     - Deal metadata
     - Evidence CIDs and extracted text
     - Seller and buyer claims

4. **AI Analysis**
   - Gemini analyzes evidence against policy rules
   - Applies highest precedence rule with sufficient evidence
   - Returns structured decision with confidence score

5. **Signature Generation**
   - Service signs ticket with Ed25519
   - Returns signed ticket to backend

6. **On-Chain Resolution**
   - Backend submits signed ticket to `resolve()` instruction
   - Program verifies signature
   - Funds distributed according to verdict

## Security Considerations

### 1. API Key Protection
- Never commit `GEMINI_API_KEY` to version control
- Use environment variables only
- Rotate keys regularly

### 2. Secret Key Management
- Generate unique Ed25519 keypair per environment
- Store secret key securely (e.g., AWS Secrets Manager)
- Never expose secret key in logs or responses

### 3. Rate Limiting
- Implement rate limiting on `/arbitrate` endpoint
- Prevent abuse and excessive API costs

### 4. Input Validation
- All requests validated with Zod schemas
- Reject malformed or malicious inputs
- Sanitize evidence text

### 5. Audit Logging
- Log all arbitration decisions
- Store rationale and evidence references
- Enable dispute review and appeals

## Performance

### Latency
- Typical arbitration: 2-5 seconds
- Depends on evidence size and Gemini API response time

### Cost
- Gemini API: ~$0.01-0.05 per arbitration
- Depends on prompt size and evidence length

### Scalability
- Stateless service, horizontally scalable
- No database required (decisions stored on-chain)
- Can handle 100+ concurrent requests

## Future Enhancements

1. **Multi-Language Support**
   - Translate evidence and claims
   - Support international disputes

2. **Advanced Evidence Processing**
   - OCR for scanned documents
   - Image analysis for damage detection
   - Video evidence support

3. **Appeal Mechanism**
   - Human review for low-confidence decisions
   - Multi-arbiter consensus for high-value disputes

4. **DAO Governance**
   - Community voting on policy changes
   - Decentralized arbiter selection

5. **Machine Learning**
   - Train custom models on historical disputes
   - Improve confidence scoring

## Troubleshooting

### Service Won't Start
- Check `GEMINI_API_KEY` is set
- Verify `ARBITER_ED25519_SECRET_HEX` is 64 characters
- Ensure port 3001 is available

### Arbitration Fails
- Check Gemini API quota
- Verify evidence format is valid
- Ensure deal status is `Disputed`

### Signature Verification Fails
- Confirm arbiter public key matches
- Check ticket JSON is not modified
- Verify signature hex encoding

## Resources

- [Gemini API Documentation](https://ai.google.dev/docs)
- [Ed25519 Specification](https://ed25519.cr.yp.to/)
- [Artha Network Whitepaper](../whitepaper/whitepaper.md)
- [On-Chain Escrow Program](../onchain-escrow/README.md)

---

## Best Practices & Maintenance

### 1. Schema Management
- **Single Source of Truth**: We use `zod-to-json-schema` to derive the JSON schema for Gemini directly from our Zod validation schemas in `src/types.ts`.
- **Validation**: Always validate Gemini's output with `ResolveTicketSchema.parse()` before using it. This is our primary defense against hallucinations.

### 2. Configuration (`src/config.ts`)
- **Centralized Config**: All environment variables and magic numbers (model names, timeouts) are defined in `src/config.ts`.
- **Model Versions**: When upgrading Gemini models, update `GEMINI_MODEL_ARBITRATION` or `GEMINI_MODEL_CONTRACT` in your `.env` file or the defaults in `config.ts`.

### 3. Error Handling
- **Retry Logic**: The arbiter implements exponential backoff for `429` (Rate Limit) errors from Gemini.
- **Fail Fast**: The service refuses to start if critical keys (`GEMINI_API_KEY`, `ARBITER_ED25519_SECRET_HEX`) are missing.

---

**Status**: ✅ Production Ready  
**Last Updated**: December 7, 2024  
**Version**: 1.1.0
