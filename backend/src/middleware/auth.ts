import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/index';
import type { TournamentRole } from '../db/types';

export interface AuthPayload {
  sub: string;
  is_platform_admin: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthPayload;
  }
}

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

export function signAuthToken(payload: AuthPayload): string {
  return jwt.sign(payload, jwtSecret(), { expiresIn: '24h' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  try {
    const payload = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
    req.user = { sub: payload.sub as string, is_platform_admin: Boolean(payload.is_platform_admin) };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Roles live in tournament_memberships, not the JWT, since they can change
 * after a token is issued. Platform admins bypass every tournament check.
 */
export function requireTournamentRole(...allowedRoles: TournamentRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (req.user.is_platform_admin) {
      next();
      return;
    }

    const tournamentId = req.params.tournamentId;
    if (!tournamentId) {
      res.status(400).json({ error: 'Route is missing a tournamentId param' });
      return;
    }

    const membership = await db
      .selectFrom('tournament_memberships')
      .select('role')
      .where('tournament_id', '=', tournamentId)
      .where('user_id', '=', req.user.sub)
      .where('role', 'in', allowedRoles)
      .executeTakeFirst();

    if (!membership) {
      res.status(403).json({ error: 'Insufficient tournament role' });
      return;
    }

    next();
  };
}
