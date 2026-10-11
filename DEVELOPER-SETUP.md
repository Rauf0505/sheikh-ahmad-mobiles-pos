# Developer & Client Setup Guide

Complete setup instructions for **Sheikh Ahmed Mobile POS** — an Electron + React
desktop point‑of‑sale for a retail & wholesale mobile phone shop.

This guide covers two things:

1. **[Part A — Developer setup](#part-a--developer-setup)**: getting the source running on a development machine.
2. **[Part B — Client laptop setup](#part-b--client-laptop-setup)**: building the installer and configuring it on the shop's laptop (printer, business details, cloud backup).

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Part A — Developer setup](#part-a--developer-setup)
  - [1. Clone the repository](#1-clone-the-repository)
  - [2. Install dependencies](#2-install-dependencies)
  - [3. Run in development](#3-run-in-development)
  - [4. First‑run data & default login](#4-firstrun-data--default-login)
  - [5. Build the Windows installer](#5-build-the-windows-installer)
  - [⚠️ Shipping clean data to a client](#️-shipping-clean-data-to-a-client)
- [Part B — Client laptop setup](#part-b--client-laptop-setup)
  - [1. Install the app](#1-install-the-app)
  - [2. First login](#2-first-login)
  - [3. Business profile](#3-business-profile)
  - [4. Receipt settings](#4-receipt-settings)
  - [5. Thermal printer setup](#5-thermal-printer-setup)
  - [6. Google Drive cloud backup](#6-google-drive-cloud-backup)
  - [7. Day‑close checklist](#7-dayclose-checklist)
- [Where data lives](#where-data-lives)
- [Backup & restore](#backup--restore)
- [Updating a client machine](#updating-a-client-machine)
- [Testing & quality checks](#testing--quality-checks)
- [Project structure](#project-structure)
- [npm scripts reference](#npm-scripts-reference)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Target machine

| Requirement | Details |
| --- | --- |
| OS | Windows 10 or Windows 11, **64‑bit** |
| RAM | 4 GB minimum, 8 GB recommended |
| Disk | ~500 MB for the installed app + space for backups |
| Display | 1024 × 700 minimum (window is 1280 × 800 by default) |
| Printer | 80 mm ESC/POS thermal receipt printer (USB or network) |

### Software (development machine only)

Install these once:

| Tool | Version | Notes |
| --- | --- | --- |
| **Node.js** | `20.19+`, `22 LTS`, or `24` | Vite 8 requires `^20.19.0 \|\| >=22.12.0`. Download the LTS installer from <https://nodejs.org>. Verify with `node --version`. |
| **npm** | `10+` | Ships with Node.js. Verify with `npm --version`. |
| **Git** | Latest | <https://git-scm.com/download/win>. Verify with `git --version`. |
| **VS Code** (optional) | Latest | Recommended extensions: ESLint, Tailwind CSS IntelliSense. |

> **No C++ toolchain needed.** `better-sqlite3` ships N‑API prebuilt binaries
> (`node_modules/better-sqlite3/prebuilds/win32-x64.node`), so Python and
> Visual Studio Build Tools are **not** required.

---

## Part A — Developer setup

### 1. Clone the repository

```powershell
git clone https://github.com/Rauf0505/sheikh-ahmad-mobiles-pos.git
cd sheikh-ahmad-mobiles-pos
```

### 2. Install dependencies

```powershell
npm install
```

This installs all runtime and dev dependencies, including Electron (~44), Vite 8,
React 19, and TypeScript.

**If Git reports `detected dubious ownership`** (common on Windows when the folder
was copied from another user/account), allow it once:

```powershell
git config --global --add safe.directory "D:/path/to/sheikh-ahmad-mobiles-pos"
```

### 3. Run in development

```powershell
npm run dev
```

This starts the Vite dev server **and** launches the Electron window automatically
(`vite-plugin-electron` builds `electron/main.ts` and `electron/preload.ts` into
`dist-electron/` and boots Electron). DevTools open automatically.

- Change React code → hot reload in the window.
- Change `electron/**` → the Electron process restarts automatically.

Other dev commands:

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite + Electron desktop app in development |
| `npm run lint` | Run `oxlint` over the project |
| `npm run build` | Type‑check (`tsc -b`) and build the renderer to `dist/` |

### 4. First‑run data & default login

On first launch the app creates its SQLite database at:

```
%APPDATA%\sheikh-ahmed-mobile-pos\sheikh-ahmed-mobile.db
```

(`AppData\Roaming` on a standard Windows install.)

It is auto‑seeded with a full starter catalogue (phones, tablets, wearables,
accessories, chargers, cases, screen protectors, power banks, etc.), opening stock,
default suppliers, expense categories, roles, and permissions.

**Default login**

| Field | Value |
| --- | --- |
| User | `Owner` |
| PIN | `123456` |

> **Change the Owner PIN immediately** on any real installation, and create
> individual cashier/staff accounts under **Settings → Roles & Permissions / Staff**.

### 5. Build the Windows installer

```powershell
npm run dist
```

Produces an NSIS installer in `release/`:

```
release\Sheikh Ahmed Mobile POS-Setup-1.0.0.exe
```

- Supports choosing the install directory.
- Creates a Desktop shortcut and a Start‑menu shortcut.
- Uninstalling keeps application data (`deleteAppDataOnUninstall: false`).

| Command | Output |
| --- | --- |
| `npm run dist` | Full NSIS installer (runs the DB snapshot step first — see warning below) |
| `npm run electron:build` | Installer **without** refreshing the bundled DB snapshot |
| `npm run pack` | Unpacked app in `release/win-unpacked/` (fast, for smoke‑testing) |

### ⚠️ Shipping clean data to a client

`electron-builder.yml` bundles a **database snapshot** into the installer:

```
resources/app/sheikh-ahmed-mobile.db  →  <install>\resources\db\sheikh-ahmed-mobile.db
```

On first run, the app copies that snapshot into `%APPDATA%` if the local DB is
missing **or** its data version differs from the bundled one.

`npm run dist` runs `npm run predist`, which **copies the building machine's live
database** (`%APPDATA%\sheikh-ahmed-mobile-pos\sheikh-ahmed-mobile.db`) into that
snapshot file. That means your own sales records, customers, and PINs would ship
to the client.

**Before building for a client, choose one of these:**

- **Ship a clean catalogue:** delete or replace `resources/app/sheikh-ahmed-mobile.db`
  with a fresh, empty/seeded DB, then build with `npm run electron:build`
  (which skips the snapshot refresh). If the file is absent, the app seeds itself
  on first run.
- **Ship pre‑loaded data on purpose:** run `npm run dist` only when you intend the
  client to receive exactly the data currently on the build machine.

Always verify the resulting installer on a clean PC before delivering it.

---

## Part B — Client laptop setup

Do this once, on the shop's laptop, after installing the app.

### 1. Install the app

1. Copy `Sheikh Ahmed Mobile POS-Setup-1.0.0.exe` to the laptop.
2. Double‑click it. If Windows SmartScreen warns about an unknown publisher
   (the build is unsigned), click **More info → Run anyway**.
3. Choose the install directory (default is fine), finish the wizard.
4. Launch **Sheikh Ahmed Mobile POS** from the Desktop or Start menu.

> **Antivirus:** some suites flag unsigned Electron installers. If needed, add an
> exclusion for the install folder and for `%APPDATA%\sheikh-ahmed-mobile-pos`.

### 2. First login

- Sign in as **Owner** with PIN **`123456`**.
- Go to **Settings → Staff / Roles & Permissions** and:
  - Change the Owner PIN to something private.
  - Create a **Cashier** (or Salesperson) account for daily use.
  - Owners/Managers get approvals; Cashiers only ring up sales.

### 3. Business profile

**Settings → Business Profile** — fill in:

| Field | Used for |
| --- | --- |
| Business name | Receipt header |
| Address | Receipt contact line |
| Phone | Receipt contact line |
| NTN | Shown on receipts when set |

These values are stored in the `app_settings` table and printed on every receipt.

### 4. Receipt settings

**Settings → Receipt Settings**

- **Header** — printed under the logo (e.g. *"Thank you for shopping at …"*).
- **Footer** — printed above the developer credit (e.g. warranty/return policy).
- **Default sale type** — `Retail` or `Wholesale`.

The receipt also prints the shop logo (`logo.png`) automatically, resized for the
80 mm printer width.

### 5. Thermal printer setup

The app prints through the **Windows Print Spooler**, so the printer must first be
installed in Windows, and the app's printer name must match the Windows queue name
**exactly**.

**Step 1 — Install the printer driver in Windows**

- **USB:** connect the printer, power it on, and install the manufacturer's driver.
  Windows usually adds it automatically as *"Black Copper 80"* or similar.
- **Network (TCP/IP):** in **Settings → Bluetooth & devices → Printers & scanners
  → Add device → Add a printer using an IP address**, enter the printer's IP and
  create a queue.

**Step 2 — Note the exact queue name**

Go to **Settings → Bluetooth & devices → Printers & scanners** and copy the
printer's name verbatim (for example `Black Copper 80`).

**Step 3 — Point the app at it**

**Settings → Printer Settings**:

| Setting | Value |
| --- | --- |
| Printer model | `BlackCopper (BC-87AC / BC-98AC)` for most locally sold 80 mm units, else Epson/Star/TANCA/Daruma/Brother |
| Connection | `USB (via Windows Print Spooler)` — the app always sends through the Windows spooler, so **use this for network printers too**, after adding the TCP/IP queue in Windows |
| Printer name | The **exact** Windows queue name from Step 2 (default is `Black Copper 80`) |

**Step 4 — Verify**

- Click **Test Connection** → should report the printer was found.
- Click **Test Print** → a sample receipt with the logo should print and cut.

> If "Test Connection" lists *Available* printers, copy a name from that list into
> the Printer name field.

### 6. Google Drive cloud backup

The app backs up the database locally every hour between **06:00 and 23:00**, and
uploads a zipped copy to Google Drive (folder **`SheikhAhmedMobilePOS-Backups`**)
when connected. Local backups older than **30 days** are pruned automatically.

You need a Google OAuth **Desktop app** client. Do this once:

**A. Create OAuth credentials in Google Cloud Console**

1. Sign in at <https://console.cloud.google.com>.
2. Create (or pick) a project.
3. **APIs & Services → Library** → enable **Google Drive API**.
4. **APIs & Services → OAuth consent screen**:
   - User type: **External** (or **Internal** for a Workspace domain).
   - Fill in app name, support email, developer contact.
   - Add the shop's Gmail account under **Test users** (required while the app is
     unverified in testing mode).
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app**.
   - Name it (e.g. `Sheikh Ahmed Mobile POS`).
   - Google adds the installed‑app redirect automatically; the app uses
     `http://localhost` as its redirect URI, which the Desktop‑app client allows.
6. Copy the **Client ID** and **Client secret**.

**B. Configure the app**

1. **Settings → Cloud Backup**.
2. Paste the **Client ID** and **Client secret**, click **Save**.
3. Click **Connect Google Drive**. A window opens — sign in with the shop's Google
   account and approve access (`drive.file` scope only, so the app can only manage
   files it creates).
4. Confirm the status shows **Connected**.
5. Click **Back Up Now** once to verify a copy appears in
   **Google Drive → `SheikhAhmedMobilePOS-Backups`**.
6. Use **Open Backup Folder** to see local backups, and **Disconnect** to revoke
   access (this deletes the saved token).

**Cron / token files live in `%APPDATA%\sheikh-ahmed-mobile-pos\`:**

| File | Purpose |
| --- | --- |
| `.backup-config.json` | Stored Client ID / Client secret |
| `.backup-tokens` | AES‑256 encrypted OAuth tokens |

> Local tokens are encrypted with a key derived from the `userData` path. Moving or
> renaming the profile folder will invalidate saved tokens; reconnect Drive if the
> status shows disconnected.

### 7. Day‑close checklist

A suggested end‑of‑day routine for the shop:

1. Reconcile the cash drawer against recorded sales.
2. Run **Day Close** and print the consolidated retail receipt.
3. Confirm **Cloud Backup** shows a recent successful backup.
4. Log out the cashier account.

---

## Where data lives

Everything is stored per Windows user under `%APPDATA%\sheikh-ahmed-mobile-pos\`
(`C:\Users\<user>\AppData\Roaming\sheikh-ahmed-mobile-pos\`):

| Path | Contents |
| --- | --- |
| `sheikh-ahmed-mobile.db` | Main SQLite database (WAL mode) |
| `sheikh-ahmed-mobile.db-wal` / `-shm` | SQLite write‑ahead log sidecars |
| `backups\data_<timestamp>.db` | Local hourly backups (30‑day retention) |
| `.backup-config.json` | Google OAuth client ID / secret |
| `.backup-tokens` | Encrypted Google OAuth tokens |

> To copy data for a manual backup, **close the app first** so the WAL is
> checkpointed, then copy `sheikh-ahmed-mobile.db` (or simply use **Back Up Now**).

---

## Backup & restore

**Backup (in app):** **Settings → Cloud Backup → Back Up Now**. The zip is uploaded
to the Drive folder *and* kept locally in `backups\`.

**Manual backup:** close the app, then copy `%APPDATA%\sheikh-ahmed-mobile-pos\`
(specifically `sheikh-ahmed-mobile.db`).

**Restore:** close the app, replace
`%APPDATA%\sheikh-ahmed-mobile-pos\sheikh-ahmed-mobile.db` with the backup, and
delete any leftover `-wal` / `-shm` files. Relaunch the app.

> Do **not** restore by re‑baking a snapshot into the installer unless you
> intentionally want to overwrite the client's live data on next launch.

---

## Updating a client machine

1. On the dev machine, build with `npm run dist` (after [curating the bundled data](#️-shipping-clean-data-to-a-client)).
2. Copy the new `…-Setup-<version>.exe` to the client.
3. Run it — NSIS upgrades in place and **preserves** the existing database in
   `%APPDATA%`.
4. Keep the version in `package.json` (`version`) in step with the release you ship.

Schema changes are applied automatically on launch via `migrateSchema()` in
`electron/db/connection.ts` (additive `ALTER TABLE … ADD COLUMN` migrations), so
existing shops upgrade without data loss.

---

## Testing & quality checks

End‑to‑end tests use Playwright driving the real Electron build. **Build first**,
because the tests launch the packaged `dist/` + `dist-electron/` output.

```powershell
npm run build          # required: produces dist/ and dist-electron/
npm test               # headless-ish Playwright run (window visible)
npm run test:headed    # explicit headed run
```

- Tests each get an isolated temp SQLite DB via `--test-db=<path>`, so your real
  data is never touched.
- HTML report is written to `playwright-report/`; artifacts to `test-results/`.
- Login helper default PIN is `123456` (`tests/helpers/auth.ts`).

Type‑checking and linting:

```powershell
npx tsc -b             # type-check (also run by npm run build)
npm run lint           # oxlint
```

---

## Project structure

```
sheikh-ahmad-mobiles-pos/
├─ electron/                 # Electron main process (Node side)
│  ├─ main.ts                # App entry, window creation, IPC bootstrap
│  ├─ preload.ts             # contextBridge → window.electronAPI
│  ├─ db/
│  │  ├─ connection.ts       # SQLite init, schema, seeds, migrations
│  │  ├─ auth.ts             # PIN login, sessions, permissions
│  │  └─ index.ts            # Business IPC handlers (sales, stock, etc.)
│  ├─ backup/cloud.ts        # Google Drive backup + hourly cron worker
│  └─ printer/thermal.ts     # 80 mm ESC/POS receipt rendering
├─ src/                      # React renderer
│  ├─ pages/                 # POSPage, Dashboard, Products, Reports, etc.
│  ├─ components/ hooks/ lib/ types/
│  └─ main.tsx, App.tsx
├─ public/                   # logo.png, favicons (shipped to dist/)
├─ resources/app/            # DB snapshot bundled into the installer
├─ build/                    # electron-builder icons (icon.ico, icon.png)
├─ scripts/refresh-db-snapshot.mjs
├─ tests/                    # Playwright fixtures, helpers, e2e specs
├─ electron-builder.yml      # Installer configuration
├─ vite.config.ts            # Vite + electron() plugin wiring
└─ package.json
```

---

## npm scripts reference

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server + Electron app (development) |
| `npm run build` | Type‑check and build renderer + main to `dist/` and `dist-electron/` |
| `npm run preview` | Preview the built renderer in a browser (no Electron APIs) |
| `npm run pack` | Unpacked app in `release/win-unpacked/` for smoke testing |
| `npm run electron:build` | Build + NSIS installer (no DB snapshot refresh) |
| `npm run dist` | Refresh DB snapshot, build + NSIS installer |
| `npm run predist` | Refresh the bundled DB snapshot from the live local DB |
| `npm run lint` | `oxlint` |
| `npm test` | Playwright e2e suite |
| `npm run test:headed` | Playwright e2e, headed |

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `fatal: detected dubious ownership` | `git config --global --add safe.directory "<repo path>"` |
| `npm install` fails on `better-sqlite3` | Confirm 64‑bit Node/Windows. Prebuilt N‑API binaries are used; no compiler needed. If a stale `node_modules` is suspected, delete it and reinstall. |
| App window is blank in dev | Ensure `vite-plugin-electron` compiled without errors; check the terminal for TS errors in `electron/**`. |
| `Database not initialized` on launch | The DB failed to open — check write permissions on `%APPDATA%\sheikh-ahmed-mobile-pos\`. |
| Login fails with PIN `123456` | The DB may have a changed PIN, or a bundled snapshot overrode seeds. Reset via a fresh DB (rename the `.db` file and relaunch). |
| **Test Connection**: `Printer "<name>" not found` | The app's printer name must match a Windows queue exactly. Copy a name from the *Available* list into **Printer Settings → Printer name**. |
| Test print prints garbage | Wrong **Printer model** (ESC/POS command set). Try `Epson` or the exact brand. |
| Logo missing on receipt | Confirm `logo.png` exists in the install's `resources` folder (bundled from `public/logo.png`). |
| **Connect Google Drive** fails / no code returned | Client ID/secret must be an OAuth **Desktop app** client with the **Google Drive API** enabled, and the signing‑in Gmail must be added as a **Test user** on the consent screen. |
| Drive shows "disconnected" after moving the app/PC profile | Tokens are encrypted against the `userData` path. Reconnect via **Connect Google Drive**. |
| SmartScreen blocks the installer | Expected for unsigned builds: **More info → Run anyway**, or code‑sign the build (`CSC_*` env vars) before distribution. |
| Backups not appearing in Drive | Ensure status is **Connected**; the hourly worker only runs **06:00–23:00** and skips when Drive isn't connected. Use **Back Up Now** to test immediately. |

---

*Maintained by Abdul Rauf — 03336982272.*
