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

Policies are expressed as ordered rule sets backed by Zod schemas:
- **Deal Requirements**: Ensures mint, amount, dispute windows are valid
- **Evidence Validation**: MIME types, size limits, and required proofs
- **Outcome Rules**: Deterministic precedence (e.g., missing delivery proof → refund)
- **Confidence Heuristics**: Penalizes ambiguous or conflicting evidence

## Development

```bash
npm run lint      # ESLint checks
npm run format    # Prettier formatting
npm run test      # Unit tests (Zod schemas, policy evaluation)
npm run test:e2e  # End-to-end ticket signing & verification
```

## Project Structure

```
├─ scripts/
│  └─ generate-keypair.js   # Utility for ed25519 key generation
├─ src/
│  ├─ index.ts              # Express server & routes
│  ├─ gemini-arbiter.ts     # Core arbitration logic
│  ├─ policy.ts             # Policy evaluation engine
│  ├─ test-cases.ts         # Fixtures for testing and prompts
│  └─ types.ts              # Shared types & Zod schemas
└─ tsconfig.json            # TypeScript configuration
```

## Testing

```bash
npm test
```
