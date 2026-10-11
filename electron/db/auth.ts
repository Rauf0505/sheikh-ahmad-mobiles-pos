import { ipcMain } from 'electron';
import bcrypt from 'bcryptjs';
import { getDatabase } from './connection.js';

let currentSession: { userId: number; name: string; roleName: string; permissions: Record<string, boolean> } | null = null;

export function getCurrentSession() {
  return currentSession;
}

export function isViewAll(): boolean {
  return currentSession?.permissions?.['view_all_data'] === true;
}

export function registerAuthHandlers() {
  ipcMain.handle('auth:login', (_event, pin: string) => {
    console.log('[AUTH] auth:login called with pin length:', pin.length);
    const db = getDatabase();
    console.log('[AUTH] database ready:', !!db);
    const user = db.prepare(`
      SELECT u.id, u.name, u.pin, r.name as roleName, r.id as roleId
      FROM users u JOIN roles r ON u.role_id = r.id
      WHERE u.active = 1
    `).all() as Array<{ id: number; name: string; pin: string; roleName: string; roleId: number }>;

    console.log('[AUTH] active users found:', user.length);
    for (const u of user) {
      const match = bcrypt.compareSync(pin, u.pin);
      console.log('[AUTH] checking user:', u.name, 'match:', match, 'stored hash:', u.pin);
      if (match) {
        const permissions = getEffectivePermissions(db, u.id, u.roleId);
        currentSession = { userId: u.id, name: u.name, roleName: u.roleName, permissions };
        console.log('[AUTH] login success for:', u.name);
        return { success: true, user: { id: u.id, name: u.name, roleName: u.roleName }, permissions };
      }
    }
    console.log('[AUTH] login failed - no matching user');
    return { success: false, error: 'Invalid PIN' };
  });

  ipcMain.handle('auth:logout', () => {
    currentSession = null;
    return { success: true };
  });

  ipcMain.handle('auth:session', () => {
    return currentSession;
  });

  ipcMain.handle('auth:override', (_event, ownerPin: string, permissionKey: string) => {
    const db = getDatabase();
    const users = db.prepare(`
      SELECT u.id, u.pin, r.name as roleName, r.id as roleId
      FROM users u JOIN roles r ON u.role_id = r.id
      WHERE r.is_system = 1 AND u.active = 1
    `).all() as Array<{ id: number; pin: string; roleName: string; roleId: number }>;

    for (const u of users) {
      if (bcrypt.compareSync(ownerPin, u.pin)) {
        db.prepare(`
          INSERT INTO audit_log (user_id, action, entity, details)
          VALUES (?, 'pin_override', 'permission', ?)
        `).run(currentSession?.userId || 0, JSON.stringify({ permission: permissionKey, overriding_owner: u.id }));
        return { success: true };
      }
    }
    return { success: false, error: 'Invalid owner PIN' };
  });
}

function getEffectivePermissions(db: ReturnType<typeof getDatabase>, userId: number, roleId: number): Record<string, boolean> {
  const rolePerms = db.prepare(`
    SELECT p.key, rp.allowed
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ?
  `).all(roleId) as Array<{ key: string; allowed: number }>;

  const perms: Record<string, boolean> = {};
  for (const rp of rolePerms) {
    perms[rp.key] = rp.allowed === 1;
  }

  const overrides = db.prepare(`
    SELECT p.key, upo.allowed
    FROM user_permission_overrides upo
    JOIN permissions p ON p.id = upo.permission_id
    WHERE upo.user_id = ?
  `).all(userId) as Array<{ key: string; allowed: number }>;

  for (const o of overrides) {
    perms[o.key] = o.allowed === 1;
  }

  return perms;
}
