import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outputDir = path.join(root, 'resources', 'app');
const outputFile = path.join(outputDir, 'sheikh-ahmed-mobile.db');

const userDataDir = path.join(os.homedir(), 'AppData', 'Roaming', 'sheikh-ahmed-mobile-pos');
const liveDb = path.join(userDataDir, 'sheikh-ahmed-mobile.db');

let source;
try {
  source = new Database(liveDb, { readonly: true });
} catch (err) {
  console.warn(`[snapshot] Could not open live DB at ${liveDb}: ${err.message}`);
  console.warn('[snapshot] Skipping snapshot; the exe will use built-in seed data.');
  process.exit(0);
}

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function computeDataVersion(db) {
  const json = JSON.stringify({
    menu: db.prepare('SELECT id, name, category, price, active FROM menu_items ORDER BY id').all(),
    categories: db.prepare('SELECT id, name, active FROM menu_categories ORDER BY id').all(),
    settings: db.prepare('SELECT key, value FROM app_settings ORDER BY key').all(),
  });
  return hash(json);
}

try {
  fs.mkdirSync(outputDir, { recursive: true });

  const version = computeDataVersion(source);
  console.log(`[snapshot] data_version=${version}`);

  // Remove any stale WAL/shm sidecars from a previous run before backing up,
  // so the bundle is always a single clean file.
  for (const suffix of ['-wal', '-shm']) {
    try {
      fs.unlinkSync(outputFile + suffix);
    } catch {
      /* not present */
    }
  }

  await source.backup(outputFile);

  const snapshot = new Database(outputFile);
  snapshot
    .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('bundled_data_version', version);
  // Force a checkpoint and remove WAL mode so the bundle ships as one file.
  snapshot.pragma('journal_mode = DELETE');
  snapshot.close();

  for (const suffix of ['-wal', '-shm']) {
    try {
      fs.unlinkSync(outputFile + suffix);
    } catch {
      /* not present */
    }
  }

  console.log(`[snapshot] Bundled DB snapshot written to ${outputFile}`);
} catch (err) {
  console.error(`[snapshot] Failed to write snapshot: ${err.message}`);
  process.exitCode = 1;
} finally {
  source.close();
}
