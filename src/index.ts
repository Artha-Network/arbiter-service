import 'dotenv/config';
import express from 'express';
import { GeminiArbiter } from './gemini-arbiter.js';
import { ClaudeArbiter } from './claude-arbiter.js';
import { ArbitrationRequestSchema } from './types.js';
import { CONFIG } from './config.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

const arbiter = CONFIG.ai.provider === 'claude'
  ? new ClaudeArbiter()
  : new GeminiArbiter();

// Simple API Key Authentication Middleware
// Only enforce auth if ARBITER_ADMIN_KEY is configured
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Allow health check without auth
  if (req.path === '/health' || req.path === '/arbiter/pubkey') {
    return next();
  }

  // If no admin key is configured, skip authentication (development mode)
  if (!CONFIG.security.adminKey) {
    return next();
  }

  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== CONFIG.security.adminKey) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing Admin Key' });
    return;
  }
  next();
};

app.use(requireAuth);

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'ai-arbiter-service',
    arbiter_pubkey: arbiter.getArbiterPublicKey(),
    timestamp: new Date().toISOString(),
    env: CONFIG.server.env
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
    const isValid = CONFIG.ai.provider === 'claude'
      ? ClaudeArbiter.verifyTicket(req.body)
      : GeminiArbiter.verifyTicket(req.body);
    res.json({ valid: isValid });
  } catch (error) {
    res.status(400).json({ error: 'Invalid ticket format', message: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: CONFIG.server.env === 'development' ? err.message : 'Something went wrong' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', message: `Route ${req.method} ${req.path} not found` });
});

const server = app.listen(CONFIG.server.port, () => {
  console.log(`🤖 AI Arbiter Service running on port ${CONFIG.server.port}`);
  console.log(`🔑 Arbiter Public Key: ${arbiter.getArbiterPublicKey()}`);
  console.log(`🌐 Health check: http://localhost:${CONFIG.server.port}/health`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${CONFIG.server.port} is already in use. Stop the other process or set PORT to a different value.`);
    console.error('   Windows: netstat -ano | findstr :' + CONFIG.server.port + '  then  taskkill /PID <pid> /F');
    console.error('   macOS/Linux: lsof -i :' + CONFIG.server.port + '  then  kill <pid>\n');
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});