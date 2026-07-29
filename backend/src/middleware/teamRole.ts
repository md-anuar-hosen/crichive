import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/index';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireTeamManagement: which role satisfied the check. */
      teamManagementRole?: 'organizer' | 'team_manager';
    }
  }
}

/**
 * Squad management is authorized for the tournament's organizer (any team)
 * or that specific team's team_manager (their own team only) — never a
 * team_manager acting on a different team in the same tournament. Route
 * must be keyed by :slug (tournament) and :teamId. Resolves the tournament
 * and stashes its id on req.params.tournamentId for the handler to reuse.
 */
export async function requireTeamManagement(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const tournament = await db.selectFrom('tournaments').select('id').where('slug', '=', req.params.slug).executeTakeFirst();
  if (!tournament) {
    res.status(404).json({ error: 'Tournament not found' });
    return;
  }
  req.params.tournamentId = tournament.id;

  if (req.user.is_platform_admin) {
    req.teamManagementRole = 'organizer';
    next();
    return;
  }

  const teamId = Array.isArray(req.params.teamId) ? req.params.teamId[0] : req.params.teamId;
  const membership = await db
    .selectFrom('tournament_memberships')
    .select('role')
    .where('tournament_id', '=', tournament.id)
    .where('user_id', '=', req.user.sub)
    .where((eb) => eb.or([eb('role', '=', 'organizer'), eb.and([eb('role', '=', 'team_manager'), eb('team_id', '=', teamId)])]))
    .executeTakeFirst();

  if (!membership) {
    res.status(403).json({ error: 'Insufficient role for this team' });
    return;
  }

  req.teamManagementRole = membership.role as 'organizer' | 'team_manager';
  next();
}
