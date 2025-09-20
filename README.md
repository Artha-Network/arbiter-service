# arbiter-service
AI pipeline that evaluates evidence &amp; chat, produces a ResolveTicket (CBOR), signs with ed25519.

---

```md
# Arbiter Service (AI Decision Engine)

Evaluates disputes using **Gemini** or **ChatGPT**, produces a signed **ResolveTicket** (CBOR + ed25519), and stores a rationale CID on Arweave/IPFS.

## Pipeline
1. **Fetch Evidence** (CIDs → bytes; size/type checks)
2. **Feature Extraction** (EXIF, timestamps, shipping codes, USD snapshot)
3. **Model Inference** (Gemini/OpenAI; deterministic system prompt)
4. **Rationale Store** (upload final rationale; get CID)
5. **Ticket Sign** (ed25519 over canonical CBOR)
6. **Publish** (optional webhook/event)

## Repo Layout
src/
adapters/ # openai, gemini
pipeline/ # evidenceFetcher, featureExtraction, inference, rationaleStore, ticketSigner
domain/ # ResolveTicket types & rules
ports/ # interfaces (EvidenceStore, PriceOracle, Publisher)
infra/ # arweave/ipfs, pyth oracle, http publisher

## ResolveTicket (schema)
```json
{
  "schema": "escrow.v1.ResolveTicket",
  "deal_id": "base58",
  "action": "RELEASE|REFUND|SPLIT",
  "split_bps": 5000,
  "rationale_cid": "bafy...",
  "confidence": 0.86,
  "nonce": 1234,
  "expires_at": 1735689600
}
Environment
| Var                                 | Description              |
| ----------------------------------- | ------------------------ |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | AI provider              |
| `TICKET_SIGNING_SECRET`             | ed25519 seed             |
| `ARWEAVE_*` / `IPFS_*`              | storage backends         |
| `PYTH_ENDPOINT`                     | price oracle (if needed) |

Run
pnpm i
pnpm dev    # mocks AI by default; set REAL_AI=true to hit provider

Test
pnpm test          # unit + signature vectors
pnpm test:e2e      # end-to-end ticket sign/verify

Security

Logs store only rationale CID (not raw prompts)

Nonce/expiry enforced; signer rotation supported

License

MIT
