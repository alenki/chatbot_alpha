# Inbound AI Agent for Ad/Typography Agency — Design Spec

**Date:** 2026-06-13
**Status:** Approved by user (section-by-section), pending final spec review
**Research basis:** [docs/research/2026-06-13-inbound-ai-research.md](../../research/2026-06-13-inbound-ai-research.md)

## 1. Context & Goal

A Russia-based advertising & typography (print) agency receives client messages on Telegram, WhatsApp, and Max (VK's messenger). Build a system where an AI answers inbound messages: answers service/pricing questions, qualifies incoming orders, handles difficult clients, and hands off to human managers when needed.

**Confirmed requirements (from stakeholder Q&A):**
- Agency is registered in Russia; clients are domestic, Russian-speaking.
- Clients write to existing **company-owned** contact points (business WhatsApp number, Telegram business account) — not managers' personal accounts.
- AI autonomy: **qualify + hand off.** AI answers questions, collects full order details, gives ballpark prices from a price list (labeled preliminary), then hands a structured order to a human manager who confirms the final price. AI never gives binding quotes.
- Handoff target: **Telegram notifications to a managers' group + system's own Postgres DB with a minimal admin view.** No CRM dependency in v1.
- Stack: **TypeScript/Node**, 1–2 devs build and maintain.
- Knowledge: price list / service catalog exists only partially (docs + tribal knowledge) — catalog building is part of onboarding.
- Volume: **<20 conversations/day** (~600/month).
- LLM for the test phase: **smartest free connectable option → DeepSeek (free via OpenRouter).** GigaChat explicitly dropped per user decision. Production model decision deferred; architecture must keep models swappable by config.

**Channel landscape constraints (June 2026, verified by research):**
- WhatsApp is blocked in Russia (Feb 2026); audience decaying; only unofficial RU gateways (Green API ~690₽/mo) are viable. → WhatsApp is a phase-3 optional channel.
- Telegram works (anti-censorship clients, ~65M daily RU users) but `api.telegram.org` is unreachable from RU server IPs → host the backend abroad.
- Max is the growth channel (~85M DAU claimed); free Bot API; direct registration open to ООО and ИП via business.max.ru; official SDKs are JS/TS and Go; production webhooks require trusted-CA HTTPS; bots are strictly inbound-only.
- Telegram Business connected bot lets the AI answer the business account's personal DMs *as the owner* (requires one Telegram Premium sub; reply-only, no pre-connection history, 24h activity window).

## 2. Architecture Overview

One TypeScript monorepo, one foreign VPS (e.g. Timeweb Cloud Amsterdam — RUB billing, reaches Telegram + Max + OpenRouter simultaneously), Docker Compose.

```
Telegram ──┐                                          ┌─→ Postgres 16 + pgvector
Max ───────┼─→ Channel adapters → Conversation engine ┼─→ Managers' TG group (alerts)
WhatsApp ──┘   (normalize msgs)    (AI brain + tools) └─→ Admin web app (Fastify+React)
```

**Components:**
1. **Channel adapters** — one thin module per messenger; each converts inbound updates to a `NormalizedMessage` and exposes `sendReply` / `sendTyping`. Adapters are deliberately thin so regulatory volatility (the #1 project risk) stays contained: adding/removing a messenger touches one module.
   - **Telegram:** grammY; one bot, one codebase handling both `message` (standalone bot) and `business_message` (Business connection) updates.
   - **Max:** official Max JS/TS SDK against `platform-api.max.ru`; strict zod validation of payloads (documented docs-vs-reality mismatches); webhooks in production, long-polling in dev.
   - **WhatsApp (phase 3):** Green API webhooks, dedicated number (never the owner's personal one).
2. **Conversation engine** — per-chat in-process queue with a short debounce (~10s) to batch the multi-message bursts clients typically send; then the agent loop (section 3).
3. **Admin web app** — Fastify API + small React SPA (section 6).

**Phasing:**
- **Phase 1 (MVP):** standalone Telegram bot + full brain + price/FAQ tools + order intake + managers' group notifications + minimal admin. No external approvals needed; runs locally via long-polling during development.
- **Phase 2:** Telegram Business connection (needs Premium on the business account) + Max bot (needs business.max.ru verification — Gosuslugi/bank ID, ≤48h moderation; start paperwork at project start).
- **Phase 3:** WhatsApp via Green API; golden-dialogue eval suite hardening; polish.

## 3. AI Brain

**Model access:** one OpenAI-compatible client; every model is a named config profile (`base_url`, `api_key`, `model`, params). Swapping models is a config edit, never a code change.

- **Test phase (free):** DeepSeek chat-class free model on OpenRouter (no card; 20 req/min, 50 req/day — 1,000/day if $10 credit is ever parked). Must pick a free variant with **function calling** support (chat/V-series, not R1-style reasoning variants with weak tool support).
- **Production (deferred decision):** DeepSeek direct API is the cheap default (a few hundred ₽/mo at this volume; payment via foreign virtual card or RU aggregator such as AITunnel/Polza at x1.5–2 markup). Any OpenAI-compatible alternative drops in via config.
- **Fallback:** a second configured profile; on primary failure the engine retries, then falls back, then degrades (section 7).

**Agent loop:** build context (system prompt + summarized history + client profile) → model → execute tool calls → feed results back → repeat until final text reply. Long histories auto-summarize: turns older than a threshold are compressed into a running summary stored on the chat.

**Tools (5):**

| Tool | Behavior |
|---|---|
| `get_price_quote` | Deterministic SQL lookup against catalog tables (product × material × quantity tier × finishing). Returns price or `needs_manager` for off-catalog combos. The model is forbidden (prompt + the tool is the only price source surfaced) to state prices from memory. |
| `search_knowledge` | pgvector similarity search over FAQ/company-info chunks (deadlines, file requirements, delivery, portfolio). |
| `create_order` | Validates required fields (service, specs, quantity, deadline, contact, files); writes order; fires managers' group notification card. |
| `escalate_to_human` | Sets `bot_paused` on the chat; posts summary + reason card to managers' group. |
| `save_client_note` | Persists client facts (name, company, preferences) to the client profile. |

**Hard-situation policy** (system prompt + code enforcement):
- Escalate immediately on: explicit human request (code-enforced keyword check, not just prompt), aggression/complaint, payment disputes, legal threats, off-catalog pricing. The model is instructed to call `escalate_to_human` whenever unsure rather than guess — uncertainty handling is the model's prompted behavior, verified by the golden-dialogue evals.
- Ballpark quotes always labeled "предварительно, менеджер подтвердит итоговую цену".
- Files accepted in any state, stored, attached to the order; AI acknowledges but never judges print-readiness (v1).
- Hard cap ~30 AI turns per chat per day → polite handoff after; limits loops and injection-driven cost burn.
- All AI replies in Russian; tone: helpful, professional, concise.

## 4. Data Model (Postgres 16 + pgvector)

- `clients` — person identity: name, phone, company, AI-saved notes; merged across channels by phone when known (Max `request_contact` aids this).
- `chats` — one per (channel, external_chat_id): client_id, `bot_paused`, status (`ai`/`human`/`closed`), unanswered flag.
- `messages` — role (client/ai/manager/system), text, attachments ref, per-AI-turn token usage (cost visibility from day one).
- `orders` — service type, specs JSONB, quantity, deadline, files, status (`new → confirmed → in_work → done`), source chat.
- `catalog_services`, `catalog_options`, `catalog_price_tiers` — normalized price matrix maintained by managers via admin.
- `faq_chunks` — text + embedding vector; re-embedded on edit.
- `escalations` — chat, reason, AI summary, resolved_by, timestamps. Doubles as the QA dataset of AI failures.
- `outbox` — outbound send retry queue (in-Postgres; no broker at this volume).

Files stored on disk (S3-compatible later if needed), referenced from `messages`/`orders`.

## 5. Human Handoff & Order Flow

**One rule: when `bot_paused` is set, the AI never replies in that chat.** Three paths in:
1. **AI-initiated:** `escalate_to_human` → card in managers' Telegram group (client, channel, summary, reason, deep-link to admin chat view) with inline buttons: "Беру" (claim), "Вернуть боту" (unpause).
2. **Manager-initiated:** replying from the admin chat view auto-pauses the chat; explicit toggle resumes. On Telegram Business, the owner replying from their own phone also auto-pauses (bot observes owner's outgoing business messages).
3. **Client-initiated:** "позовите человека" and similar phrases always escalate — enforced in code.

**Order flow:** AI collects fields conversationally → `create_order` validates completeness → card in managers' group + row on admin orders board → manager confirms final price with the client (takeover or native reply) → status updated on the board.

## 6. Admin App

Fastify + React SPA behind a simple login (single shared manager role in v1):
- **Chats:** list with status/unanswered filters; live conversation viewer; reply box (sends through the chat's channel adapter; auto-pauses AI).
- **Orders:** kanban by status; order detail with files and source-chat link.
- **Catalog editor:** CRUD for services/options/price tiers — the table managers themselves maintain.
- **FAQ editor:** edit text chunks → automatic re-embedding.
- **Settings:** model profiles, system prompt, escalation keywords.
- **Usage:** messages/day, tokens/cost, escalation rate.

## 7. Error Handling

- **LLM failure:** retry with backoff → fallback profile → if all fail: send "Передал ваш вопрос менеджеру 👌", escalate, alert group. Client never sees an error or silence.
- **Webhook idempotency:** dedupe by channel update id before processing (Telegram and Max both redeliver).
- **Send failures:** outbound replies through the `outbox` retry queue.
- **Free-tier rate limits (test phase):** on OpenRouter daily-cap exhaustion, degrade to escalate-everything mode.
- **Prompt injection:** client text is data, never instructions (prompt-pinned); tools validate their own inputs (e.g. `create_order` scoped to the current chat); daily turn cap limits blast radius.

## 8. Testing

- **Unit:** price quoting, order validation, per-channel payload normalization (strict zod schemas; mismatches logged, not crashed).
- **Agent loop with mocked LLM:** tool dispatch, pause logic, escalation triggers, turn caps.
- **Golden-dialogue evals:** ~20 scripted conversations (typical order, vague client, angry client, off-catalog request, injection attempt, explicit human request) run on demand against the real model; pass/fail asserted on behavior (escalated? quoted only tool prices? collected all order fields?). This is the objective basis for model swaps.

## 9. Deployment & Ops

- Docker Compose on one foreign VPS: app, Postgres+pgvector, Caddy (auto trusted-CA HTTPS for webhooks + admin).
- GitHub Actions: test → build → SSH deploy.
- Nightly `pg_dump` to off-site storage.
- pino logs; `/health` endpoint + free external uptime monitor.
- Local dev: long-polling everywhere, no public URL required.
- **Test-phase cost: ~0₽.** Go-live infra: VPS ~550–1,500₽/mo + domain; per-channel costs only when phases 2–3 add them (Telegram Premium ~159–299₽/mo; Green API ~690₽/mo).

## 10. Risks

1. **Regulatory volatility** (channels appear/vanish, rules change) → thin adapter pattern; no channel logic outside adapters.
2. **OpenRouter free-tier limits or cutoff** → config-swap to another free/cheap profile; degrade-to-escalation mode.
3. **Max platform friction** (re-moderation on any profile change; payload quirks; possible future webhook geo-fencing) → strict validation, long-polling fallback, buffer time in phase 2.
4. **WhatsApp number ban** on unofficial gateway → dedicated number only; inbound-reply usage pattern; accept loss risk on a decaying channel.
5. **Catalog quality** is the single biggest determinant of answer quality → catalog building with managers is an explicit onboarding task, not an afterthought.

## 11. Out of Scope (v1)

- Payments in chat (YooKassa/SBP) — revisit after v1.
- Proactive outreach / order-status pushes on Max (requires paid "MAX для бизнеса" program).
- CRM integrations (amoCRM/Bitrix24) — own DB is the system of record.
- Multi-operator roles/permissions in admin.
- AI judging print-readiness of client files.
- Voice message transcription.
