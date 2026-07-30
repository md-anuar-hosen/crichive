import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/index';
import type { TournamentRole } from '../db/types';
import { isUuid } from '../utils/validation';

/**
 * Like requireTournamentRole, but for routes keyed by :id = match id rather
 * than :tournamentId. Resolves the match's tournament before checking
 * tournament_memberships, since roles are tournament-scoped, not global.
 */
export function requireMatchRole(...allowedRoles: TournamentRole[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!isUuid(req.params.id as string)) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    const match = await db.selectFrom('matches').select(['id', 'tournament_id']).where('id', '=', req.params.id).executeTakeFirst();
    if (!match) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }

    if (req.user.is_platform_admin) {
      next();
      return;
    }

    const membership = await db
      .selectFrom('tournament_memberships')
      .select('role')
      .where('tournament_id', '=', match.tournament_id)
      .where('user_id', '=', req.user.sub)
      .where('role', 'in', allowedRoles)
      .executeTakeFirst();

    if (!membership) {
      res.status(403).json({ error: 'Insufficient tournament role' });
      return;
    }

    // A tournament-wide 'scorer' grant only makes someone eligible to be
    // assigned to specific matches (see routes/scorers.ts) — with several
    // matches running at once, letting any tournament scorer touch any
    // match is exactly the mix-up per-match assignment exists to prevent.
    // The organizer themselves is never restricted this way.
    if (membership.role === 'scorer') {
      const assignment = await db.selectFrom('match_scorers').select('user_id').where('match_id', '=', match.id).where('user_id', '=', req.user.sub).executeTakeFirst();
      if (!assignment) {
        res.status(403).json({ error: 'You are not assigned to score this match' });
        return;
      }
    }

    next();
  };
}
