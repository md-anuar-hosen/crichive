import bcrypt from 'bcrypt';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db/index';
import { requireAuth, signAuthToken } from '../middleware/auth';

const BCRYPT_COST = 12;

const router = Router();

// Credential-guessing endpoints need a much tighter limit than ordinary
// public reads — 100/min (the general publicRateLimit these routes also
// sit behind) is far too permissive for brute-forcing a login.
const authAttemptLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

// A fixed, precomputed hash to compare against when no such user exists, so
// a login attempt takes the same time either way — without this, "no such
// user" returns instantly while "wrong password" waits on a real bcrypt
// comparison, letting an attacker enumerate registered emails by timing.
const DUMMY_PASSWORD_HASH = await bcrypt.hash('no-such-user-timing-safety', BCRYPT_COST);

function zodFieldErrors(error: z.ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({ field: issue.path.join('.') || '(root)', message: issue.message }));
}

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  display_name: z.string().trim().min(1),
});

router.post('/register', authAttemptLimit, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  const { email, password, display_name } = parsed.data;

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  try {
    const user = await db
      .insertInto('users')
      .values({ email, password_hash: passwordHash, display_name })
      .returning(['id', 'email', 'display_name', 'is_platform_admin', 'created_at'])
      .executeTakeFirstOrThrow();

    res.status(201).json({ user });
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }
    throw err;
  }
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

router.post('/login', authAttemptLimit, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', fields: zodFieldErrors(parsed.error) });
    return;
  }
  const { email, password } = parsed.data;

  const user = await db
    .selectFrom('users')
    .select(['id', 'password_hash', 'is_platform_admin', 'deleted_at'])
    .where('email', '=', email)
    .executeTakeFirst();

  const validCredential = user?.password_hash && !user.deleted_at;
  // Always run a real bcrypt comparison, even for a nonexistent account —
  // otherwise a nonexistent email returns instantly while a wrong password
  // waits on bcrypt, and that timing gap alone reveals which emails are
  // registered.
  const valid = await bcrypt.compare(password, validCredential ? user.password_hash! : DUMMY_PASSWORD_HASH);

  if (!validCredential || !valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const token = signAuthToken({ sub: user.id, is_platform_admin: user.is_platform_admin });
  res.json({ token });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await db
    .selectFrom('users')
    .select(['id', 'email', 'display_name', 'is_platform_admin', 'created_at'])
    .where('id', '=', req.user!.sub)
    .executeTakeFirst();

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({ user });
});

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === '23505';
}

export default router;
