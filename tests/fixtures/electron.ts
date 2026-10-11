import { test as base, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

type ElectronFixtures = {
  electronApp: ElectronApplication;
  window: Page;
  testDbPath: string;
};

export const test = base.extend<ElectronFixtures>({
  // Playwright requires an object destructuring pattern even when a fixture
  // has no dependencies, hence the empty pattern.
  // eslint-disable-next-line no-empty-pattern
  testDbPath: async ({}, provide) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheikh-mobiles-pos-test-'));
    const dbPath = path.join(tmpDir, 'sheikh-mobiles.db');
    await provide(dbPath);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  },

  electronApp: async ({ testDbPath }, provide) => {
    const app = await electron.launch({
      args: ['.', `--test-db=${testDbPath}`],
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
      timeout: 30_000,
    });

    const firstWin = await app.firstWindow();
    firstWin.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`[ELECTRON ERROR] ${msg.text()}`);
      }
    });
    firstWin.on('pageerror', (err) => {
      console.log(`[PAGE ERROR] ${err.message}`);
    });

    await provide(app);
    await app.close();
  },

  window: async ({ electronApp }, provide) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('networkidle');
    await provide(window);
  },
});

export { expect } from '@playwright/test';
