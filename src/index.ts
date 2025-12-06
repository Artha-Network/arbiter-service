import 'dotenv/config';
import express from 'express';
import { GeminiArbiter } from './gemini-arbiter.js';
import { ArbitrationRequestSchema } from './types.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const ARBITER_SECRET_HEX = process.env.ARBITER_ED25519_SECRET_HEX!;
const PORT = process.env.PORT || 3001;

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

if (!ARBITER_SECRET_HEX) {
  throw new Error('ARBITER_ED25519_SECRET_HEX environment variable is required');
}

const arbiter = new GeminiArbiter(GEMINI_API_KEY, ARBITER_SECRET_HEX);

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ai-arbiter-service',
    arbiter_pubkey: arbiter.getArbiterPublicKey(),
    timestamp: new Date().toISOString()
  });
});

app.get('/arbiter/pubkey', (req, res) => {
  res.json({ arbiter_pubkey: arbiter.getArbiterPublicKey() });
});

app.post('/generate-contract', async (req, res) => {
  try {
    console.log('Contract generation request received:', req.body);
    const result = await arbiter.generateContract(req.body);
    console.log('Contract generated successfully');
    res.json(result);
  } catch (error) {
    console.error('Contract generation error:', error);
    res.status(500).json({
      error: 'Contract generation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.post('/arbitrate', async (req, res) => {
  try {
    const request = ArbitrationRequestSchema.parse(req.body);
    console.log(`Arbitration request received for deal: ${request.deal.deal_id}`);
    const signedTicket = await arbiter.arbitrateCase(request);
    console.log(`Arbitration completed for deal: ${request.deal.deal_id}, outcome: ${signedTicket.ticket.outcome}`);
    res.json(signedTicket);
  } catch (error: any) {
    console.error('Arbitration error:', error);
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Invalid request format', details: error.errors });
    } else {
      res.status(500).json({ error: 'Arbitration failed', message: error instanceof Error ? error.message : 'Unknown error' });
    }
  }
});

app.post('/verify', (req, res) => {
  try {
    const isValid = GeminiArbiter.verifyTicket(req.body);
    res.json({ valid: isValid });
  } catch (error) {
    res.status(400).json({ error: 'Invalid ticket format', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', message: `Route ${req.method} ${req.path} not found` });
});

app.listen(PORT, () => {
  console.log(`🤖 AI Arbiter Service running on port ${PORT}`);
  console.log(`🔑 Arbiter Public Key: ${arbiter.getArbiterPublicKey()}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});