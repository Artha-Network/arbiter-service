import 'dotenv/config';
import express from 'express';
import { GeminiArbiter } from './gemini-arbiter.js';
import { ArbitrationRequestSchema } from './types.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

// Environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const ARBITER_SECRET_HEX = process.env.ARBITER_ED25519_SECRET_HEX!;
const PORT = process.env.PORT || 3001;

if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is required');
}

if (!ARBITER_SECRET_HEX) {
  throw new Error('ARBITER_ED25519_SECRET_HEX environment variable is required');
}

// Initialize Gemini arbiter
const arbiter = new GeminiArbiter(GEMINI_API_KEY, ARBITER_SECRET_HEX);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'ai-arbiter-service',
    arbiter_pubkey: arbiter.getArbiterPublicKey(),
    timestamp: new Date().toISOString()
  });
});

// Get arbiter public key
app.get('/arbiter/pubkey', (req, res) => {
  res.json({
    arbiter_pubkey: arbiter.getArbiterPublicKey()
  });
});

// Main arbitration endpoint
app.post('/arbitrate', async (req, res) => {
  try {
    // Validate request body
    const request = ArbitrationRequestSchema.parse(req.body);
    
    console.log(`Arbitration request received for deal: ${request.deal.deal_id}`);
    
    // Perform arbitration
    const signedTicket = await arbiter.arbitrateCase(request);
    
    console.log(`Arbitration completed for deal: ${request.deal.deal_id}, outcome: ${signedTicket.ticket.outcome}`);
    
    res.json(signedTicket);
    
  } catch (error) {
    console.error('Arbitration error:', error);
    
    if (error.name === 'ZodError') {
      res.status(400).json({
        error: 'Invalid request format',
        details: error.errors
      });
    } else {
      res.status(500).json({
        error: 'Arbitration failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
});

// Verify ticket endpoint (for testing)
app.post('/verify', (req, res) => {
  try {
    const isValid = GeminiArbiter.verifyTicket(req.body);
    res.json({ valid: isValid });
  } catch (error) {
    res.status(400).json({
      error: 'Invalid ticket format',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

app.listen(PORT, () => {
  console.log(`🤖 AI Arbiter Service running on port ${PORT}`);
  console.log(`🔑 Arbiter Public Key: ${arbiter.getArbiterPublicKey()}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});