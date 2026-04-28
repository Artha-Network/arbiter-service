import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
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

const arbiter = new ClaudeArbiter();

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

// Contract generation also hits Claude — cap per-IP so a stuck client can't drain credits.
const contractLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many contract generation requests, please try again later' },
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

function buildFallbackContract(details: Record<string, unknown>): object {
  const title = details.title ?? 'Escrow Agreement';
  const amount = details.amount ?? '0';
  const role = details.role ?? 'party';
  const counterparty = details.counterparty ?? 'Counterparty';
  const description = details.description ?? 'As described by the initiating party.';
  const completionDeadline = details.completionDeadline ?? details.deliveryDeadline ?? 'As agreed';
  const disputeDeadline = details.disputeDeadline ?? '7';
  const today = new Date().toISOString().split('T')[0];

  return {
    source: 'fallback',
    contract: `# ${title}\n\n**Date:** ${today}\n\n## Parties\n- **Initiator (${role}):** Connected wallet\n- **Counterparty:** \`${counterparty}\`\n\n## Agreement\n\n${description}\n\n## Financial Terms\n- **Amount:** ${amount} USDC\n- **Held in:** On-chain escrow (Solana)\n\n## Deadlines\n- **Delivery:** ${completionDeadline}\n- **Dispute window:** ${disputeDeadline} days after delivery\n\n## Dispute Resolution\nDisputes will be reviewed by the Artha AI arbiter. The arbiter's signed resolution ticket will govern fund release.\n\n---\n*This is a template contract generated in fallback mode. Please review all terms before proceeding.*`,
    questions: [
      'Is the description of work complete and unambiguous?',
      'Have both parties agreed to the delivery deadline?',
    ],
  };
}

app.post('/generate-contract', contractLimiter, async (req, res) => {
  try {
    const result = await arbiter.generateContract(req.body);
    res.json(result);
  } catch (error) {
    console.error('Contract generation error:', error);
    if (isProduction) {
      return res.status(500).json({ error: 'Contract generation failed' });
    }
    // In development, return a fallback template so the UI can still proceed
    console.warn('[arbiter] AI call failed — returning fallback contract template');
    return res.json(buildFallbackContract(req.body as Record<string, unknown>));
  }
});

app.post('/arbitrate', arbitrateLimiter, async (req, res) => {
  try {
    const request = ArbitrationRequestSchema.parse(req.body);
    const signedTicket = await arbiter.arbitrateCase(request);
    res.json(signedTicket);
  } catch (error: unknown) {
    console.error('Arbitration error:', error);
    if (error instanceof Error && error.name === 'ZodError') {
      res.status(400).json({ error: 'Invalid request format', ...(isProduction ? {} : { details: (error as any).errors }) });
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
    const isValid = ClaudeArbiter.verifyTicket(req.body);
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

// Export app for serverless (Vercel) usage
export default app;

// Only start the server when run directly (not imported)
if (process.argv[1]?.replace(/\\/g, '/').endsWith('/index.ts') ||
    process.argv[1]?.replace(/\\/g, '/').endsWith('/index.js')) {
  const server = app.listen(CONFIG.server.port, () => {
    console.log(`AI Arbiter Service running on port ${CONFIG.server.port}`);
    console.log(`Arbiter Public Key: ${arbiter.getArbiterPublicKey()}`);
  });

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
}
