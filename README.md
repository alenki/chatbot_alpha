# Inbound AI Agent (Telegram) — Phase 1

A standalone Telegram bot for a Russian print/ad agency: answers client questions in Russian, quotes prices deterministically from a SQL catalog (always labeled "предварительная цена"), qualifies orders, escalates hard cases to a managers' Telegram group, and ships a minimal admin app. DeepSeek (free via OpenRouter) drives a tool-use agent loop over Postgres 16 + pgvector.

## Prerequisites

- **Node 22 LTS** and **pnpm 9+** (`corepack enable` provides pnpm).
- **Docker** with the Compose plugin (`docker compose`).
- A **Telegram bot token** (from @BotFather) and a **managers' group chat id**.
- An **OpenRouter API key** (free; no card required).

> **Note on this dev machine:** if `corepack enable` cannot create the global `pnpm` shim (no admin rights), invoke pnpm as `corepack pnpm …` everywhere below (e.g. `corepack pnpm install`). On a normal machine `pnpm …` works directly.

## 1. Telegram bot setup (BotFather)

1. In Telegram, open **@BotFather** → `/newbot` → choose a name and a `@username`. Copy the **bot token** (looks like `123456789:AA...`) → this is `TELEGRAM_BOT_TOKEN`.
2. Send `/setprivacy` to BotFather → select your bot → **Disable** group privacy (so the bot can read the managers'-group button presses and messages it needs).
3. **Create the managers' group** in Telegram and **add your bot** to it as a member.
4. **Get the group chat id (`MANAGER_GROUP_CHAT_ID`):**
   - Post any message in the group, then call `getUpdates`:
     `curl "https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates"`
   - Find `"chat":{"id":-1001234567890,...}` for your group. The id is **negative** for groups/supergroups (e.g. `-1001234567890`) → this is `MANAGER_GROUP_CHAT_ID`.
   - If `getUpdates` is empty, send another message in the group and retry. (If you later switch to webhooks you must first `deleteWebhook` before `getUpdates` works.)

## 2. OpenRouter LLM setup

1. Sign up at **openrouter.ai** and create an **API key** → this is `LLM_PRIMARY_API_KEY`.
2. Pick a **free, tools-capable DeepSeek model** from **openrouter.ai/models** (filter: free + supports tool/function calling — a `deepseek-chat`/V-series `:free` variant, NOT an R1-style reasoning variant). Put its id in `LLM_PRIMARY_MODEL` (default in `.env.example` is `deepseek/deepseek-chat:free` — **verify it still exists and supports tools at setup time**, free model ids rotate).
3. Free tier is ~20 req/min and ~50 req/day. Parking $10 of credit raises the daily cap to ~1000/day (useful for running the full eval suite). The app degrades to escalate-everything mode when the daily cap is hit.

## 3. Configure `.env`

Copy the example and fill it in:

```bash
cp .env.example .env
```

Required values: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `MANAGER_GROUP_CHAT_ID`, `LLM_PRIMARY_API_KEY`, `ADMIN_PASSWORD` (≥8 chars), `SESSION_SECRET` (≥16 chars). For local dev `DATABASE_URL` is `postgres://postgres:postgres@localhost:5432/chatbot`.

> The app only needs a **Postgres 16 + pgvector** connection string. Local Docker Postgres (below) and an external managed Postgres (e.g. Supabase) both work — just point `DATABASE_URL` / `TEST_DATABASE_URL` at whichever you use.

## 4. Local development

```bash
# install workspace deps
pnpm install

# start dev Postgres (creates chatbot + chatbot_test, enables pgvector)
docker compose -f docker-compose.dev.yml up -d

# apply migrations to both databases
pnpm --filter server exec drizzle-kit migrate
pnpm --filter server exec drizzle-kit migrate --config=drizzle-test.config.ts

# seed settings, catalog and FAQ (first run downloads the embedding model, ~100 MB)
pnpm seed

# run the app (Telegram long-polling + admin on http://localhost:8080)
pnpm dev
```

The two migrate commands use the workspace-locked `drizzle-kit` (`"drizzle-kit": "^0.28.1"` in `server/package.json`, resolved to `0.28.1` by the lockfile) — the same version CI and the prod container pin explicitly as `drizzle-kit@0.28.1`. `drizzle-test.config.ts` (the second command's `--config`) is created alongside `drizzle.config.ts` by the DB-schema task and simply points migrations at `chatbot_test` instead of `chatbot`.

Open the admin at **http://localhost:8080** and log in with `ADMIN_PASSWORD`.

## 5. Tests

```bash
# full server unit suite (DB tests use chatbot_test)
pnpm --filter server test -- run

# include the slow real-embedding tests (downloads model weights)
pnpm --filter server exec cross-env RUN_EMBEDDING_TESTS=1 vitest run
```

## 6. Golden-dialogue evals (real model)

The eval harness drives ~20 scripted Russian conversations through the **real** DeepSeek model against the test DB and asserts behavior (escalated? order created? quoted only tool prices? no invented prices?).

> **Free-tier cap:** each turn spends real OpenRouter requests (~50/day free). Running all 20 dialogues will exhaust the free quota. **Filter by name substring** to run a subset:

```bash
# run only dialogues whose name contains "листовки"
pnpm eval -- листовки

# run the whole suite (only with parked credit / a deliberate model-swap eval day)
pnpm eval
```

A `console.table` of PASS/FAIL per turn is printed; the process exits non-zero on any failure. Use this as the objective basis for swapping the model (`LLM_PRIMARY_MODEL`).

## 7. Production deploy (one VPS)

Host the backend **outside Russia** (e.g. an Amsterdam VPS) so it can reach `api.telegram.org` and OpenRouter.

1. **DNS:** point an A record for your domain (e.g. `bot.example.com`) at the VPS public IP. Caddy needs this resolvable to issue the TLS cert.
2. **Server prep:** install Docker + the Compose plugin on the VPS. Clone the repo to `/opt/chatbot_alpha`.
3. **Env:** create `/opt/chatbot_alpha/.env` (same keys as dev) plus production-only vars:
   - `DOMAIN=bot.example.com` (used by the Caddyfile)
   - `POSTGRES_PASSWORD=<strong-password>`
   - `ADMIN_BASE_URL=https://bot.example.com` (so manager-card deep links are public)
   - `NODE_ENV=production`

   The compose file overrides `DATABASE_URL` to reach the `postgres` service internally (`postgres://postgres:<POSTGRES_PASSWORD>@postgres:5432/chatbot`), so the `DATABASE_URL` in `.env` is ignored for prod.
4. **Build & start:**

```bash
docker compose build
docker compose up -d
```

   The server container applies migrations on start via the pinned `drizzle-kit@0.28.1 migrate` in its CMD (same version as CI) then launches. Seed once. The runtime image contains only the compiled output (`server/dist/`), not `src/` — run the built seed, mirroring the container's `node server/dist/index.js` entrypoint (the seed module's `import.meta.url === pathToFileURL(process.argv[1]).href` CLI guard fires the same way for `node server/dist/db/seed.js`):

```bash
docker compose exec server node server/dist/db/seed.js
```

5. **TLS:** Caddy automatically obtains and renews a trusted-CA certificate for `$DOMAIN` on first request — no manual cert steps. The admin app is then live at `https://bot.example.com`. (Telegram phase 1 uses long-polling, so no inbound webhook URL is needed yet; the HTTPS endpoint is ready for phase-2 webhooks.)

> **Runtime image layout (why the commands above use `server/dist/...`):** the image preserves the workspace's `server/` directory level. The compiled admin server resolves the built SPA from its own module path (`server/dist/admin/server.js` → `../../../admin/dist`), so the image keeps server output at `/app/server/dist` and the SPA at `/app/admin/dist`. The container working directory is `/app`, so the CWD-relative `FILES_DIR` default (`./data/files`) lands in the mounted `/app/data` volume, and one-off commands address the entrypoint/seed as `server/dist/...`.

## 8. Ops

**View logs:**

```bash
docker compose logs -f server      # app logs (pino)
docker compose logs -f caddy       # TLS / proxy
docker compose logs -f postgres    # database
```

**Nightly off-site backup (cron on the VPS).** Add to the deploy user's crontab (`crontab -e`):

```cron
0 3 * * * cd /opt/chatbot_alpha && docker compose exec -T postgres pg_dump -U postgres chatbot | gzip > /opt/backups/chatbot-$(date +\%F).sql.gz
```

(Ensure `/opt/backups` exists and is synced off-box — e.g. `rclone` to object storage.)

## 9. CI/CD

`.github/workflows/ci.yml` runs install → server tests → admin build on every push (spins up a pgvector service, applies migrations to `chatbot_test`). A commented-out `deploy` job in the same file is a template for SSH-deploying to the VPS on `main` — fill in the `VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY` GitHub secrets and uncomment when ready.

> The embedding-heavy and FAQ-seed tests are guarded by `RUN_EMBEDDING_TESTS=1` (unset in CI), so CI never downloads model weights. The eval harness is **not** run in CI (it needs a live LLM key and spends quota).

## Architecture

See [docs/superpowers/specs/2026-06-13-inbound-ai-agent-design.md](docs/superpowers/specs/2026-06-13-inbound-ai-agent-design.md) for the full design and [docs/superpowers/plans/2026-06-13-phase1-contracts.md](docs/superpowers/plans/2026-06-13-phase1-contracts.md) for the shared contracts.
