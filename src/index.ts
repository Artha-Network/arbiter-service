import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { GeminiArbiter } from './gemini-arbiter.js';
import { ClaudeArbiter } from './claude-arbiter.js';
import { ArbitrationRequestSchema } from './types.js';
import { CONFIG } from './config.js';

const isProduction = CONFIG.server.env === 'production';

// Require admin key in production
if (isProduction && !CONFIG.security.adminKey) {
  console.error('ARBITER_ADMIN_KEY is required in production. Exiting.');
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

const arbiter = CONFIG.ai.provider === 'claude'
  ? new ClaudeArbiter()
  : new GeminiArbiter();

// API Key Authentication Middleware
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.path === '/health' || req.path === '/arbiter/pubkey') {
    return next();
  }

  // Skip auth only in non-production when no admin key is configured
  if (!isProduction && !CONFIG.security.adminKey) {
    return next();
  }

  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== CONFIG.security.adminKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

const arbitrateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many arbitration requests, please try again later' },
});

app.use(generalLimiter);
app.use(requireAuth);

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'ai-arbiter-service',
    arbiter_pubkey: arbiter.getArbiterPublicKey(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/arbiter/pubkey', (_req, res) => {
  res.json({ arbiter_pubkey: arbiter.getArbiterPublicKey() });
});

app.post('/generate-contract', async (req, res) => {
  try {
    const result = await arbiter.generateContract(req.body);
    res.json(result);
  } catch (error) {
    console.error('Contract generation error:', error);
    res.status(500).json({
      error: 'Contract generation failed',
      ...(isProduction ? {} : { message: error instanceof Error ? error.message : 'Unknown error' }),
    });
  }
});

app.post('/arbitrate', arbitrateLimiter, async (req, res) => {
  try {
    const request = ArbitrationRequestSchema.parse(req.body);
    const signedTicket = await arbiter.arbitrateCase(request);
    res.json(signedTicket);
  } catch (error: any) {
    console.error('Arbitration error:', error);
    if (error.name === 'ZodError') {
      res.status(400).json({ error: 'Invalid request format', ...(isProduction ? {} : { details: error.errors }) });
    } else {
      res.status(500).json({
        error: 'Arbitration failed',
        ...(isProduction ? {} : { message: error instanceof Error ? error.message : 'Unknown error' }),
      });
    }
  }
});

app.post('/verify', (req, res) => {
  try {
    const isValid = CONFIG.ai.provider === 'claude'
      ? ClaudeArbiter.verifyTicket(req.body)
      : GeminiArbiter.verifyTicket(req.body);
    res.json({ valid: isValid });
  } catch {
    res.status(400).json({ error: 'Invalid ticket format' });
  }
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const server = app.listen(CONFIG.server.port, () => {
  console.log(`AI Arbiter Service running on port ${CONFIG.server.port}`);
  console.log(`Arbiter Public Key: ${arbiter.getArbiterPublicKey()}`);
});

// Graceful shutdown
const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${CONFIG.server.port} is already in use.`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});
