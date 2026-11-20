# JPTI Cloudflare deployment

## Recommended production topology

Deploy the **React/Vite frontend to Cloudflare Pages**. Keep the existing **Node.js/Express + CCXT API on a Node.js host** (Railway, Render, Fly.io or a managed VPS) and use managed PostgreSQL for durable storage. A Pages Function in this repository proxies same-origin `/api/*` requests to the API host, so the browser does not need a separate API URL and existing relative fetches continue to work.

Do not deploy the existing API by uploading the repository to Pages as static assets. Pages does not run `api/server.js` as a persistent Node server. Cloudflare Workers can run Express in a specifically adapted Worker project, but JPTI currently uses Node filesystem persistence, PostgreSQL's `pg` pool, CCXT adapters and a background scheduler/lease. That backend needs a separate compatibility and persistence design before it can replace the Node service.

## 1. Prepare the API service first

Use Node.js 22. Create a managed PostgreSQL database and deploy this repository's API service with:

- Repository: `kyleel2249/JPTI`
- Runtime: Node.js 22
- Install/build command: `npm ci`
- Start command: `npm run start:api`
- Health check: `/api/health`
- Bind host: `0.0.0.0`

Set these server-side environment variables (never add them to Git or a `VITE_*` variable):

```env
NODE_ENV=production
JPTI_API_HOST=0.0.0.0
JPTI_API_PORT=8787
JPTI_ALLOW_REMOTE_API=true
JPTI_TRADING_MODE=paper
JPTI_ENABLE_LIVE_TRADING=false
JPTI_API_TOKEN=<long-random-private-token>
JPTI_REQUIRE_EDGE_SECRET=true
JPTI_EDGE_SECRET=<independent-random-secret-at-least-32-characters>
JPTI_STORAGE_BACKEND=postgres
DATABASE_URL=<managed-postgresql-connection-string>
JPTI_DATABASE_SSL=true
JPTI_DATABASE_SSL_REJECT_UNAUTHORIZED=true
JPTI_SCHEDULER_ENABLED=true
```

Generate two different secrets. For example, on Windows PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

Run it twice: one output becomes `JPTI_API_TOKEN`, the other becomes `JPTI_EDGE_SECRET`. Put the same `JPTI_EDGE_SECRET` value in the API host and the Cloudflare Pages secret in the next section. Keep `JPTI_API_TOKEN` only on the API host and in the JPTI operator interface when needed. Do not use the same secret for both.

The API host must provide persistent storage and must not scale to multiple replicas unless PostgreSQL scheduler leasing is enabled and verified. Keep exchange keys server-side, start with read-only permissions, disable withdrawals, and retain paper mode. Do not enable live orders for this deployment merely to make the dashboard work.

## 2. Create the Cloudflare Pages project

1. Sign in to the Cloudflare dashboard.
2. Open **Workers & Pages**.
3. Select **Create application** → **Pages** → **Connect to Git**.
4. Authorize GitHub if requested and choose repository **`kyleel2249/JPTI`**.
5. Choose production branch **`main`**.
6. Set the build configuration exactly as follows:

| Setting | Value |
| --- | --- |
| Framework preset | React (Vite) |
| Production branch | `main` |
| Root directory | `/` (repository root; leave default) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js version | `22` |

The repository includes `.node-version` and `wrangler.toml`; still verify the dashboard shows the settings above. Do not set `npm run dev`, `npm run dev:all`, or `npm run start:api` as the Pages build command. Pages only builds and serves the frontend plus its Pages Functions.

7. Click **Save and Deploy**. The first build should produce a `*.pages.dev` URL.

## 3. Add the Pages runtime variables/secrets

In Cloudflare:

1. Open **Workers & Pages** → select the new JPTI Pages project.
2. Open **Settings** → **Variables and Secrets** (in some dashboard layouts this appears under Settings → Environment variables).
3. Add the following for **Production** and, if you will test preview deployments, add the appropriate preview values too:

| Name | Type | Value |
| --- | --- | --- |
| `JPTI_API_ORIGIN` | Variable | API origin only, e.g. `https://your-jpti-api-host.example` |
| `JPTI_EDGE_SECRET` | Secret | The exact same independent secret as the API host's `JPTI_EDGE_SECRET` |

For `JPTI_API_ORIGIN`, enter only the HTTPS origin: no trailing API path, no `/api`, no credentials, and no query string. The Pages Function forwards the incoming path and query to that origin and injects the edge secret server-side. The secret is not sent to browser JavaScript.

4. Trigger a new deployment after saving the variables.

## 4. Verify deployment

Open these URLs, replacing the hostname:

- `https://YOUR-PROJECT.pages.dev/` — JPTI frontend.
- `https://YOUR-PROJECT.pages.dev/api/health` — should return the API health JSON through the Pages proxy.
- `https://YOUR-API-HOST/api/health` — direct API access should return HTTP 403 while `JPTI_REQUIRE_EDGE_SECRET=true`, because it does not include the trusted edge header.

Then sign in to the dashboard workflow using your `JPTI_API_TOKEN` when a private portfolio action asks for it. Verify exchange connections with read-only credentials and confirm PostgreSQL storage is active.

If the Pages health route returns 503, check both Pages runtime variables/secrets and redeploy. If it returns 502/504, check that the API service is running, its public HTTPS origin is correct, and the host allows inbound requests from Cloudflare. If direct API health is not blocked, confirm `JPTI_REQUIRE_EDGE_SECRET=true` and that the API and Pages secrets match exactly.

## 5. Custom domain

In the Pages project, open **Custom domains** → **Set up a custom domain**, enter a domain/subdomain you control (for example `trade.example.com`), and follow Cloudflare's DNS instructions. Keep the API on a separate service hostname and configure that exact HTTPS origin as `JPTI_API_ORIGIN`.

## 6. Workers vs Pages decision

- **Use Pages now** for the Vite frontend and the included Pages Function proxy. This matches the existing application with minimal changes.
- **Do not deploy the current Express backend as a plain Pages site.** It needs a server runtime.
- **A dedicated Cloudflare Worker backend is a later migration option**, not a drop-in switch. It requires replacing or adapting Node filesystem operations, database connection management, CCXT exchange support, scheduler leadership/background jobs and any unsupported Node APIs. Cloudflare's Express-on-Workers path exists, but compatibility must be proven for JPTI's actual dependency and workload set before moving production traffic.

## Security and operations checklist

- [ ] PostgreSQL backups and restore test configured.
- [ ] API host uses HTTPS and persistent disk is not used as the only production ledger store.
- [ ] `JPTI_API_TOKEN` and `JPTI_EDGE_SECRET` are unique, high-entropy secrets.
- [ ] `JPTI_REQUIRE_EDGE_SECRET=true` on the API host.
- [ ] The Pages Function's `JPTI_EDGE_SECRET` matches the API host secret.
- [ ] Exchange keys are read-only; withdrawals disabled; IP restrictions enabled where supported.
- [ ] Live order execution remains disabled.
- [ ] API host logs, uptime monitoring, rate limiting and database backups are enabled.
- [ ] Preview deployments do not receive production exchange credentials or production secrets unless intentionally secured.

The edge secret blocks direct API access that lacks the Cloudflare proxy header; it is not a substitute for user accounts, per-user authorization, CSRF controls, exchange-key vaulting, audit review or independent security testing. JPTI's current operator-token model is suitable for controlled single-operator testing, not an open public multi-user trading service.
