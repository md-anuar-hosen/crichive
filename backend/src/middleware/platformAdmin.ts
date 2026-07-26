import type { NextFunction, Request, Response } from 'express';

export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  if (!req.user.is_platform_admin) {
    res.status(403).json({ error: 'Platform admin only' });
    return;
  }
  next();
}
