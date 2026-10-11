import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { initDatabase } from './db/connection.js';
import { registerDatabaseHandlers } from './db/index.js';
import { registerAuthHandlers } from './db/auth.js';
import { registerBackupHandlers, startBackupWorker, initializeDriveClient } from './backup/cloud.js';
import { registerPrinterHandlers } from './printer/thermal.js';

let mainWindow: BrowserWindow | null = null;

function getTestDbPath(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith('--test-db='));
  return arg ? arg.split('=')[1] : undefined;
}

function resolveWindowIcon(): string | undefined {
  const candidates = [
    path.join(__dirname, '../public/logo.png'),
    path.join(__dirname, '../dist/logo.png'),
    path.join(process.resourcesPath, 'logo.png'),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch { /* ignore */ }
  }
  return undefined;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Sheikh Ahmad Mobiles POS',
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#f8faf7',
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  const testDbPath = getTestDbPath();
  initDatabase(testDbPath);
  registerAuthHandlers();
  registerDatabaseHandlers();
  registerBackupHandlers();
  registerPrinterHandlers();
  createWindow();
  initializeDriveClient();
  startBackupWorker();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('menu:export-file', async (_e, data: string, suggestedName: string) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showSaveDialog(win!, {
    title: 'Export Menu',
    defaultPath: suggestedName,
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });
  if (result.canceled || !result.filePath) return { success: false as const, canceled: true as const };
  fs.writeFileSync(result.filePath, data, 'utf-8');
  return { success: true as const, path: result.filePath };
});

ipcMain.handle('menu:import-file', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win!, {
    title: 'Import Menu',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return { success: false as const, canceled: true as const };
  const content = fs.readFileSync(result.filePaths[0], 'utf-8');
  return { success: true as const, path: result.filePaths[0], content };
});
