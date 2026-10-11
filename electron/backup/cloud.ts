import { ipcMain, app, BrowserWindow, shell } from 'electron';
import { google } from 'googleapis';
import cron from 'node-cron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDatabase, getDatabasePath } from '../db/connection.js';

// ─── CONSTANTS ───────────────────────────────────────────────────────
const BACKUP_FOLDER = 'SheikhAhmedMobilePOS-Backups';
const RETENTION_DAYS = 30;
const BACKUP_DIR = path.join(app.getPath('userData'), 'backups');
const TOKEN_FILE = path.join(app.getPath('userData'), '.backup-tokens');
const CONFIG_FILE = path.join(app.getPath('userData'), '.backup-config.json');

// ─── STATE ───────────────────────────────────────────────────────────
let driveClient: any = null;
let lastBackupTime: string | null = null;
let backupInProgress = false;

// ─── ENCRYPTION HELPERS ──────────────────────────────────────────────
function getEncryptionKey(): Buffer {
  const seed = app.getPath('userData') + '-sheikh-ahmed-mobile-pos-backup-key';
  return crypto.createHash('sha256').update(seed).digest();
}

function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(data: string): string {
  const key = getEncryptionKey();
  const [ivHex, encrypted] = data.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ─── TOKEN PERSISTENCE ──────────────────────────────────────────────
function saveTokens(tokens: any): void {
  fs.writeFileSync(TOKEN_FILE, encrypt(JSON.stringify(tokens)), 'utf8');
}

function loadTokens(): any | null {
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
    return JSON.parse(decrypt(raw));
  } catch {
    return null;
  }
}

function clearTokens(): void {
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  } catch { /* ignore */ }
}

// ─── CONFIG PERSISTENCE (Client ID / Secret) ────────────────────────
function saveConfig(config: { clientId: string; clientSecret: string }): void {
  const trimmed = {
    clientId: config.clientId.trim(),
    clientSecret: config.clientSecret.trim(),
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
  console.log('[Backup] Config saved to', CONFIG_FILE);
}

function loadConfig(): { clientId: string; clientSecret: string } | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      console.log('[Backup] Config file not found at', CONFIG_FILE);
      return null;
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    console.log('[Backup] Config loaded — clientId:', parsed.clientId?.substring(0, 20) + '...');
    return parsed;
  } catch (err: any) {
    console.error('[Backup] Failed to load config:', err.message);
    return null;
  }
}

// ─── OAUTH2 CLIENT ───────────────────────────────────────────────────
function createOAuth2Client(config: { clientId: string; clientSecret: string }) {
  return new google.auth.OAuth2(
    config.clientId.trim(),
    config.clientSecret.trim(),
    'http://localhost'
  );
}

export async function initializeDriveClient(): Promise<boolean> {
  const config = loadConfig();
  if (!config) {
    console.log('[Backup] No config found — Drive not initialized');
    return false;
  }

  const tokens = loadTokens();
  if (!tokens) {
    console.log('[Backup] No tokens found — Drive not initialized');
    return false;
  }

  try {
    const oauth2Client = createOAuth2Client(config);
    oauth2Client.setCredentials(tokens);

    // Check if token needs refresh
    if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
      console.log('[Backup] Token expired, refreshing...');
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);
      saveTokens(credentials);
    }

    driveClient = oauth2Client;
    console.log('[Backup] Drive client initialized successfully');
    return true;
  } catch (err: any) {
    console.error('[Backup] Failed to initialize Drive client:', err.message);
    clearTokens();
    return false;
  }
}

// ─── OAUTH2 CONSENT FLOW ────────────────────────────────────────────
async function performOAuthFlow(): Promise<{ success: boolean; error?: string }> {
  const config = loadConfig();
  if (!config) return { success: false, error: 'Google Drive not configured. Please enter Client ID and Secret in Settings.' };

  console.log('[Backup] Starting OAuth flow with clientId:', config.clientId?.substring(0, 20) + '...');
  const oauth2Client = createOAuth2Client(config);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.file'],
    prompt: 'consent',
  });

  console.log('[Backup] Auth URL generated:', authUrl.substring(0, 80) + '...');

  return new Promise((resolve) => {
    let resolved = false;
    const authWindow = new BrowserWindow({
      width: 600,
      height: 700,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
      title: 'Connect Google Drive',
      autoHideMenuBar: true,
    });

    authWindow.loadURL(authUrl);

    // Intercept redirect BEFORE navigation — prevent Electron from loading http://localhost
    authWindow.webContents.on('will-redirect', (event, url) => {
      console.log('[Backup] will-redirect intercepted:', url.substring(0, 80));
      const codeMatch = url.match(/[?&]code=([^&]+)/);
      if (codeMatch && !resolved) {
        event.preventDefault();
        resolved = true;
        const code = decodeURIComponent(codeMatch[1]);
        console.log('[Backup] Got auth code, exchanging for tokens...');

        oauth2Client.getToken(code)
          .then(({ tokens }) => {
            console.log('[Backup] Tokens received — refresh_token:', !!tokens.refresh_token);
            oauth2Client.setCredentials(tokens);
            saveTokens(tokens);
            driveClient = oauth2Client;
            authWindow.close();
            resolve({ success: true });
          })
          .catch((err: any) => {
            console.error('[Backup] Token exchange failed:', err.message);
            authWindow.close();
            resolve({ success: false, error: `Token exchange failed: ${err.message}` });
          });
      }
    });

    // Handle window close
    authWindow.on('closed', () => {
      if (!resolved) {
        resolved = true;
        resolve({ success: false, error: 'Authentication cancelled' });
      }
    });
  });
}

// ─── ZIP COMPRESSION ─────────────────────────────────────────────────
async function zipFile(inputPath: string): Promise<{ success: boolean; outputPath?: string; error?: string }> {
  try {
    const archiver = (await import('archiver')).default;
    const outputPath = inputPath.replace(/\.db$/, '.zip');
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    return new Promise((resolve) => {
      output.on('close', () => resolve({ success: true, outputPath }));
      archive.on('error', (err: any) => resolve({ success: false, error: err.message }));
      archive.pipe(output);
      archive.file(inputPath, { name: path.basename(inputPath) });
      archive.finalize();
    });
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ─── CREATE BACKUP ───────────────────────────────────────────────────
export async function createBackup(): Promise<{ success: boolean; filename?: string; error?: string }> {
  if (backupInProgress) return { success: false, error: 'Backup already in progress' };

  try {
    backupInProgress = true;

    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const filename = `data_${timestamp}.db`;
    const backupPath = path.join(BACKUP_DIR, filename);

    // Use SQLite safe backup API
    const db = getDatabase();
    const sourcePath = getDatabasePath();

    // Use better-sqlite3 backup method
    await new Promise<void>((resolve, reject) => {
      const backup = db.backup(backupPath);
      backup.then(() => resolve()).catch((err: any) => reject(err));
    });

    lastBackupTime = new Date().toISOString();
    return { success: true, filename };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    backupInProgress = false;
  }
}

// ─── UPLOAD TO GOOGLE DRIVE ─────────────────────────────────────────
export async function uploadToDrive(filePath: string): Promise<{ success: boolean; error?: string }> {
  if (!driveClient) {
    return { success: false, error: 'Google Drive not connected' };
  }

  try {
    const drive = google.drive({ version: 'v3', auth: driveClient });

    // Find or create backup folder
    const folderRes = await drive.files.list({
      q: `name='${BACKUP_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
    });

    let folderId = folderRes.data.files?.[0]?.id;
    if (!folderId) {
      const newFolder = await drive.files.create({
        requestBody: { name: BACKUP_FOLDER, mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id',
      });
      folderId = newFolder.data.id!;
    }

    // Compress to ZIP before upload
    const zipResult = await zipFile(filePath);
    const uploadPath = zipResult.success && zipResult.outputPath ? zipResult.outputPath : filePath;
    const uploadName = path.basename(uploadPath);

    // Upload file
    const fileMetadata = { name: uploadName, parents: [folderId] };
    const media = { mimeType: 'application/zip', body: fs.createReadStream(uploadPath) };

    await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id',
    });

    // Clean up ZIP if we created one
    if (zipResult.success && zipResult.outputPath && zipResult.outputPath !== filePath) {
      try { fs.unlinkSync(zipResult.outputPath); } catch { /* ignore */ }
    }

    return { success: true };
  } catch (err: any) {
    // If token expired, try refreshing once
    if (err.code === 401 || err.message?.includes('invalid_grant')) {
      try {
        const config = loadConfig();
        if (config && driveClient) {
          const { credentials } = await driveClient.refreshAccessToken();
          driveClient.setCredentials(credentials);
          saveTokens(credentials);
          // Retry upload
          return uploadToDrive(filePath);
        }
      } catch { /* refresh failed */ }
    }
    return { success: false, error: err.message };
  }
}

// ─── CLEANUP OLD LOCAL BACKUPS ──────────────────────────────────────
function cleanupOldBackups(): void {
  if (!fs.existsSync(BACKUP_DIR)) return;

  const files = fs.readdirSync(BACKUP_DIR);
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  for (const file of files) {
    const filePath = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(filePath);
    if (stat.mtimeMs < cutoff) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }
}

// ─── SCHEDULED BACKUP WORKER ────────────────────────────────────────
export function startBackupWorker(): void {
  // Run every hour during business hours (6am - 11pm)
  cron.schedule('0 6-23 * * *', async () => {
    if (!driveClient) return; // Not connected, skip

    const result = await createBackup();
    if (result.success && result.filename) {
      const backupPath = path.join(BACKUP_DIR, result.filename);
      await uploadToDrive(backupPath);
    }
    cleanupOldBackups();
  });
}

// ─── IPC HANDLERS ────────────────────────────────────────────────────
export function registerBackupHandlers(): void {
  // Save Google OAuth credentials
  ipcMain.handle('backup:configure', (_e, config: { clientId: string; clientSecret: string }) => {
    try {
      const existing = loadConfig();
      const toSave = {
        clientId: config.clientId.trim(),
        clientSecret: config.clientSecret.trim() || (existing?.clientSecret ?? ''),
      };
      if (!toSave.clientId) return { success: false, error: 'Client ID is required' };
      if (!toSave.clientSecret) return { success: false, error: 'Client Secret is required' };
      saveConfig(toSave);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Get saved config (masked)
  ipcMain.handle('backup:get-config', () => {
    const config = loadConfig();
    if (!config) return { configured: false };
    return {
      configured: true,
      clientId: config.clientId,
      hasSecret: !!config.clientSecret,
    };
  });

  // Connect to Google Drive (OAuth flow)
  ipcMain.handle('backup:connect-drive', async () => {
    const result = await performOAuthFlow();
    return result;
  });

  // Disconnect from Google Drive
  ipcMain.handle('backup:disconnect-drive', async () => {
    try {
      if (driveClient) {
        // Revoke the token
        const tokens = loadTokens();
        if (tokens?.access_token) {
          try {
            await fetch(`https://oauth2.googleapis.com/revoke?token=${tokens.access_token}`, {
              method: 'POST',
            });
          } catch { /* ignore revocation errors */ }
        }
      }
      driveClient = null;
      clearTokens();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Manual backup now
  ipcMain.handle('backup:now', async () => {
    const result = await createBackup();
    if (result.success && result.filename) {
      const backupPath = path.join(BACKUP_DIR, result.filename);
      const uploadResult = await uploadToDrive(backupPath);
      return { ...result, uploaded: uploadResult.success, uploadError: uploadResult.error };
    }
    return result;
  });

  // Get backup status
  ipcMain.handle('backup:status', () => {
    const tokens = loadTokens();
    const connected = !!driveClient && !!tokens;
    return {
      lastBackupTime,
      isDriveConnected: connected,
      localBackupCount: fs.existsSync(BACKUP_DIR)
        ? fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db') || f.endsWith('.zip')).length
        : 0,
    };
  });

  // List local backups
  ipcMain.handle('backup:list', () => {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.db') || f.endsWith('.zip'))
      .map((f) => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: stat.size, date: stat.mtime.toISOString() };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });

  // Open backup folder in file explorer
  ipcMain.handle('backup:open-folder', () => {
    if (fs.existsSync(BACKUP_DIR)) {
      shell.openPath(BACKUP_DIR);
    }
    return { success: true };
  });
}
