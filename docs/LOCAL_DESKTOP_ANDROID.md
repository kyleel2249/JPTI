# JPTI desktop, Android and hybrid deployment

JPTI is designed to support three deployment surfaces from the same React application:

1. **Windows desktop application** — Electron shell starts the Node/Express API locally and stores the event ledger in the user's private application-data directory.
2. **Android application** — Capacitor native Android shell packages the responsive React UI. It connects to a secured HTTPS JPTI API, normally the Cloudflare Pages origin. The API destination is configurable inside Connection Settings.
3. **Cloud web application** — Cloudflare Pages hosts the web UI and same-origin API proxy; the existing Node/Express API and PostgreSQL remain on a Node host.

The Windows desktop app runs its API and file ledger locally. The Android package is a locally installed native app, but it does not embed the Node/CCXT server. Android therefore needs a reachable API (Cloudflare, a secured remote server, or a trusted LAN/VPN endpoint). The mobile app shell can open offline, but live exchange data, cloud ledger queries and server-side analysis need API/network connectivity.

Changing the API destination does **not** automatically copy or synchronize a local ledger into the cloud database. Local and cloud ledgers remain separate until a separately designed, authenticated, conflict-safe sync service is enabled. Never assume that switching URLs has migrated transactions.

## Windows desktop

### Run from source

Requirements: Windows 10/11 64-bit, Node.js 22 LTS, npm.

```powershell
git clone https://github.com/kyleel2249/JPTI.git
cd JPTI
git checkout main
npm install
npm run desktop:dev
```

The desktop shell builds the Vite UI, starts the API on `127.0.0.1:8787`, waits for its health endpoint, then opens a secured Electron window. The API is loopback-only. In desktop mode private read-only portfolio/reconciliation actions may use loopback-only authorization; requests from other machines cannot use that exception. The desktop always forces paper mode and disables live execution.

### Build Windows installers

```powershell
npm install
npm run desktop:dist
```

Electron Builder writes the Windows NSIS installer and portable executable into `release/`. Use `npm run desktop:pack` for an unpacked diagnostic build. Keep the installer and application data on a trusted device.

### Local files and credentials

The desktop's append-only file ledger and sync cursors live in Electron's private `app.getPath('userData')/data` directory, not in the installation directory or the web build. This protects records from normal application upgrades. The optional local `.env` file is read from `app.getPath('userData')/.env`; it is not included in the installer or Git repository. Back up the application-data directory securely.

For exchange access, use read-only keys and disable withdrawals. Never put exchange keys into Vite variables, frontend source, or the API base URL. Desktop mode is paper-only in this build; it deliberately overrides live-trading environment flags.

## Android app

### Requirements

- Windows 10/11 64-bit
- Node.js 22 LTS and npm
- Android Studio (current stable release)
- Android SDK and platform/build tools installed through Android Studio
- A physical Android device with USB debugging or an Android emulator

### Generate the native Android project (one time)

```powershell
npm install
npm run build
npm run mobile:android:add
npm run mobile:sync
npm run mobile:android:open
```

This generates the native `android/` project from the checked-in Capacitor configuration. Open it in Android Studio, allow Gradle sync, install any SDK components it requests, then run on a connected device/emulator.

### Build a debug APK

```powershell
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

The debug APK is generated at:

`android/app/build/outputs/apk/debug/app-debug.apk`

Copy that APK to your Android device and install it (allow installation from that trusted source when Android asks). For a distributable release, use Android Studio **Build → Generate Signed Bundle / APK → APK** and protect your signing keystore and passwords. Do not share a debug APK as a production release.

### Connect Android to JPTI

1. Open the installed JPTI Android app.
2. Open **Connection Settings**.
3. Enter the HTTPS Cloudflare Pages URL, e.g. `https://your-jpti.pages.dev` (no `/api` suffix).
4. Tap **Test connection**, then **Save connection**.
5. Use the API token configured on the server when a private portfolio operation requests it.

The Pages Function forwards API calls to the Node API and injects the private edge secret. Configure the API host's `JPTI_CORS_ORIGINS` to include the Capacitor Android WebView origin `https://localhost` (default in `.env.example`). For iOS Capacitor clients, include `capacitor://localhost` as well. The Pages Function preserves the API response CORS headers.

Android cannot use `127.0.0.1` to reach your Windows PC; that address means the phone itself. For phone-to-PC local use, both devices must be on the same trusted network and the PC must expose a secured HTTPS endpoint or VPN. Do not expose the unauthenticated local desktop API directly to Wi-Fi or the public internet.

## Browser / PWA install

The same responsive UI includes a web manifest and service worker. On supported desktop browsers use the browser's **Install app** option; on Android Chrome use **Install app** or **Add to Home screen**. The service worker caches only the application shell/static assets. It deliberately does not cache `/api/*`, exchange responses, private account data or ledger records. Offline shell access is not offline market data.

## Connection settings

The new Connection Settings workspace stores only the API base URL in browser/device local storage. It never stores the private API token or exchange credentials.

- Blank API base: use the current origin. On Electron desktop this is the embedded local API.
- Cloudflare Pages HTTPS URL: use the hosted API through the Pages Function.
- Other remote endpoints: HTTPS is required by the client URL validator.
- `localhost` HTTP is allowed for local development only.

Private API tokens remain in the relevant workflow's in-memory input state. For a cloud API, the server must set `JPTI_API_TOKEN`. The local desktop can authorize private read-only actions from loopback only; it does not enable live trading.

## Cloud API CORS

For the Node API host, set:

```env
JPTI_CORS_ORIGINS=https://localhost,capacitor://localhost
JPTI_REQUIRE_EDGE_SECRET=true
JPTI_EDGE_SECRET=<same secret configured in Cloudflare Pages>
JPTI_API_TOKEN=<separate strong private token>
JPTI_TRADING_MODE=paper
JPTI_ENABLE_LIVE_TRADING=false
```

Add additional origins only when you have a specific trusted client. Keep the API token and edge secret different. The Android client should use the Cloudflare Pages origin rather than the direct API hostname when the trusted-edge lock is enabled.

## Local data versus cloud data

- Windows desktop default: local JSONL event ledger in the private user-data directory.
- Cloud deployment: managed PostgreSQL database.
- Android: mobile UI client; private data is requested from the configured API service.
- PWA: shell/static assets cached only.

There is no automatic two-way local/cloud ledger synchronization in this phase. A future sync service must use stable event IDs, idempotent ingestion, explicit source/account identity, authenticated device registration, conflict handling, encryption in transit, and auditable import/export. Until then, choose one authoritative ledger for each trading account and do not operate the same exchange account from separate uncoordinated local and cloud schedulers.

## Safety boundaries

- Desktop mode is local and paper-only.
- Android uses remote API permissions configured by the server.
- Live orders remain disabled by default.
- Exchange credentials must remain server-side and read-only where possible.
- The mobile app does not contain exchange API keys.
- Do not expose the local Express API to the internet or an untrusted LAN.
