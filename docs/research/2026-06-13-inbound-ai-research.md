# AI Inbound-Message Answering System for a Russian Ad/Typography Agency
## Research Synthesis Report — WhatsApp / Telegram / Max + LLM Layer (June 2026)

> Produced by a 31-agent research workflow (6 domain researchers, adversarial fact-checking of architecture-gating claims, synthesis). Claims marked REFUTED were corrected during verification.

---

## 1. Executive Summary — The 10 Most Decision-Relevant Facts

1. **WhatsApp is fully blocked in Russia since Feb 11–12, 2026.** Roskomnadzor removed whatsapp.com/web.whatsapp.com from the National DNS; access is VPN-only, and the Kremlin ties unblocking to Meta complying with Russian law ([RBC](https://prim.rbc.ru/prim/12/02/2026/698d79189a7947ffe922a0ef), [CNN](https://www.cnn.com/2026/02/12/tech/russia-whatsapp-social-media-clampdown-intl), [Vedomosti/Peskov](https://www.vedomosti.ru/technology/news/2026/02/12/1175750-peskov-razblokirovka-whatsapp)). WhatsApp **cannot be the primary channel**.
   - **CORRECTION (claim refuted in verification):** the "~80M users in May 2026" figure is wrong — 80.3M is the *February 2026* Mediascope number (Dec 2025: 94.47M → Jan: 89.42M → Feb: 80.30M, [Forbes.ru](https://www.forbes.ru/tekhnologii/556595-i-vtorye-stanut-pervymi-telegram-obosel-whatsapp-po-popularnosti-v-rossii)). The May 2026 audience is **unknown, likely 70–80M and falling** as the VPN crackdown escalates. Direction holds: WhatsApp = decaying secondary channel.
2. **Telegram is also heavily blocked (~95% of non-VPN access attempts fail since ~April 10, 2026), but Telegram's April 11 anti-censorship client update restored access for ~65M daily Russian users** ([OSW](https://www.osw.waw.pl/en/publikacje/analyses/2026-04-17/russia-blocks-telegram-and-cracks-down-vpns), [Meduza](https://meduza.io/en/feature/2026/06/11/russia-has-been-blocking-telegram-for-months-meduza-asked-five-popular-channel-admins-if-it-s-working)). Critically, **api.telegram.org is unreachable from RU-hosted servers** — the bot backend must run or egress from a foreign IP.
3. **Max (VK) is now the mandatory-to-support channel:** ~110–111M registrations (Apr 2026), 85M DAU (May 2026, VK's own figures — unaudited) driven by the legally mandated preinstall on all phones sold in RU since 01.09.2025 ([Vedomosti](https://www.vedomosti.ru/technology/news/2026/05/06/1195528-ezhednevnaya-auditoriya-max), [rg.ru](https://rg.ru/2026/04/07/auditoriia-messendzhera-max-dostigla-111-millionov-chelovek.html)). Its Bot API is free, with no per-message fees ([dev.max.ru](https://dev.max.ru/docs-api)).
4. **CORRECTION (claim refuted):** Max bot publishing is **no longer юрлицо-only**. Since ~March 20, 2026, **ИП (individual entrepreneurs) can register directly** on the Max partner platform; only self-employed, individuals, and non-residents remain excluded ([dev.max.ru/docs/maxbusiness/connection](https://dev.max.ru/docs/maxbusiness/connection), [ixbt](https://www.ixbt.com/news/2026/03/20/nacionalnyj-messendzher-max-otkryl-novye-vozmozhnosti-dlja-biznesa-integracija-dostupna-dlja-bolee-chem-8-mln-kompanij.html)). This materially strengthens the full-custom build option for a small agency.
5. **Telegram Business connected bot is the killer integration shape:** the AI answers in the owner's *personal DMs as the owner* (no bot label), with clean human takeover via per-chat pause. Official since Bot API 7.2; requires Telegram Premium on the owner account (~159–299 ₽/mo) ([core.telegram.org/api/business](https://core.telegram.org/api/business)). Limits: reply-only, no pre-connection history, 24h activity window, one bot per account ([connected-business-bots](https://core.telegram.org/api/bots/connected-business-bots)).
6. **OpenAI and Anthropic do not serve Russia** (absent from supported-country lists; Anthropic's Sept 2025 ToS bans >50%-RU-owned entities; April 2026 Persona ID verification locks out RU users) ([anthropic.com/supported-countries](https://www.anthropic.com/supported-countries), [Habr](https://habr.com/ru/companies/tsnis/articles/1042042/)). Frontier models are escalation-tier only, via OpenRouter (reachable from RU, USDC top-up +5%, [RBC](https://companies.rbc.ru/news/jOLqtSws4J/kak-popolnit-openrouter-iz-rossii-v-2026-godu/)) or RU aggregators.
7. **RU-native LLMs are adequate and legally clean:** GigaChat (Lite 0.065₽ / Pro 0.5₽ / Max 0.65₽ per 1K tokens, function calling on all models, [tariffs](https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs)) and YandexGPT 5.1 Pro (~0.40₽/1K, OpenAI-compatible endpoint with tool calling, [docs](https://aistudio.yandex.ru/docs/en/ai-studio/operations/generation/completions-function.html)). Both give ruble invoices, закрывающие документы, and 152-FZ residency.
   - **CORRECTION (claim refuted):** "RU models have no prompt caching" is **false for GigaChat** — it has request caching since Oct 2024 and **cached tokens are billed at 0₽** ([Sber docs](https://developers.sber.ru/docs/ru/gigachat/guides/counting-tokens)). The 10–30x cost gap vs DeepSeek applies only to *uncached* context; with caching, GigaChat's RAG cost picture is far better than initially modeled. No caching found for YandexGPT.
8. **Legal status is fine for this agency:** law 41-FZ (foreign-messenger ban, in force 01.06.2025) covers banks, state bodies, telecoms, marketplaces, etc. — **ad/print agencies are NOT covered**; client support over Telegram remains legal ([mosdigitals](https://mosdigitals.ru/blog/zapret-na-ispolzovanie-inostrannyh-messendzherov-aktualnye-ogranicheniya-2026-goda-i-otvetstvennost-biznesa)). Caveat: FAS deems *paid advertising placement* in Telegram a violation of advertising law since 10.03.2026 ([legalacademy.ru](https://legalacademy.ru/sphere/post/telegram-v-rossii-kak-zakonno-prodolzhat-rabotu-v-usloviyah-novyh-ogranichenii-2026-goda)) — support yes, ads no.
9. **A single foreign VPS reaches everything.** Empirically verified (June 2026, Swedish egress): platform-api.max.ru, api.telegram.org, openrouter.ai, api.openai.com all reachable; Max applies an account-level publishing restriction, not a network geo-block. Timeweb Cloud (Amsterdam/Almaty, paid in RUB, ~550–1,500₽/mo) is the recommended hedge ([timeweb.cloud](https://timeweb.cloud/services/vds-vps)).
10. **Total system cost is small.** Realistic monthly run-rate for the recommended architecture: ~3,000–6,000₽ infrastructure + 5,000–35,000₽ LLM usage depending on model tier and caching discipline — versus 8,000–14,000₽/mo for a buy-everything platform (Chat2Desk) with weaker AI control.

---

## 2. Channel Feasibility

### 2.1 WhatsApp — secondary, decaying channel; unofficial RU gateway if kept at all

**State of the channel.** Fully blocked since Feb 11–12, 2026 (National DNS removal; phased campaign since Aug 2025; delivery degraded ~70% even before the final block) ([RBC](https://prim.rbc.ru/prim/12/02/2026/698d79189a7947ffe922a0ef), [CNBC](https://www.cnbc.com/2026/02/12/russia-whatsapp-meta-max.html)). Audience: 80.3M MAU in Feb 2026 and falling (May figure unpublished; one estimate ~72M). The April 2026 VPN crackdown (439+ services blocked, IP-analysis user blocking, [Mediazona](https://en.zona.media/article/2026/04/07/russian_internet_censorship_2026)) will keep shrinking it. Using WhatsApp is not illegal for RU businesses — the messenger was explicitly exempted from Meta's extremist-org designation ([NPR](https://www.npr.org/2022/03/21/1087827003/facebook-instagram-russia-extremist-organization)).

**Integration routes, ranked:**

| Route | Cost | Verdict |
|---|---|---|
| **Wappi.pro (unofficial, multi-messenger)** | 700₽/mo per profile (550₽ annual) | **Best fit** — one API shape for WhatsApp + Telegram + Max, ruble billing, unlimited messages ([wappi.pro](https://wappi.pro/)) |
| **Green API (unofficial, RU market leader)** | 690₽/mo per instance | Cheapest, most mature, MIR cards, free dev tier ([green-api.com](https://green-api.com/)) |
| Official WABA via RU reseller (i2crm) | 4,950–7,450₽/mo + Meta fees | Only if ban-proof reliability is mandatory; weak ROI on a VPN-only audience ([i2crm.ru/waba](https://i2crm.ru/waba)) |
| Meta Cloud API direct / 360dialog / Twilio | — | **Not feasible**: no Visa/MC from Russia, providers won't onboard RU entities ([360dialog](https://360dialog.com/pricing)) |
| Self-hosted Baileys/whatsapp-web.js | free | **Not recommended** — highest ban risk (May 2026 enforcement wave targets modified clients), constant session maintenance for a 1–2 dev team |

**Risks:** all unofficial gateways violate WhatsApp ToS → linked-number ban risk. Inbound-reply customer-service bots are the lowest-risk usage pattern, but enforcement tightened in May 2026. Note: Meta's Jan 15, 2026 policy bans general-purpose AI assistants on the Business API but **explicitly permits purpose-specific support/order bots** (per Meta statements and dev docs, not a carve-out clause in the terms — borderline cases are at Meta's sole discretion) ([respond.io](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban), [TechCrunch](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform)) — relevant only if the official-WABA route is ever taken.

**Recommendation:** keep WhatsApp as a legacy/overseas-client channel via Wappi.pro or Green API. Do not invest in official WABA.

### 2.2 Telegram — primary channel; Business connected bot + standalone bot, no userbots

**State of the channel.** Throttled from Feb 10, 2026, ~95% blocked by April 10; Telegram's April 11 traffic-disguise update keeps ~65M daily RU users connected ([OSW](https://www.osw.waw.pl/en/publikacje/analyses/2026-04-17/russia-blocks-telegram-and-cracks-down-vpns)). Degraded but the largest working non-state channel. **Backend constraint:** api.telegram.org is blocked from RU server IPs — host abroad.

**Recommended shape — hybrid of two official mechanisms:**

1. **Telegram Business connected bot (primary).** The owner's personal account gets Premium (~159₽/mo Android direct; RU-card payment unreliable since Apr 2026 — pay via Stars/gift), connects the bot via @BotFather → Settings → Telegram Business → Chatbots. The bot receives `business_message` updates and replies **as the owner** via `business_connection_id` ([core.telegram.org/api/business](https://core.telegram.org/api/business)). Human takeover = the owner just replies (auto-pause pattern) or pauses the bot per chat. Verified limits: no pre-connection history, replies only in chats active in the last 24h, cannot initiate chats, inline keyboards yes / reply keyboards no, one bot per account ([connected-business-bots](https://core.telegram.org/api/bots/connected-business-bots), [telegrambots book](https://telegrambots.github.io/book/4/business.html)). Note: Bot API 10.0 (May 8, 2026) hints at relaxing the Premium requirement ("Allowed Business Bots to manage user accounts without a Telegram Premium subscription", [changelog](https://core.telegram.org/bots/api-changelog)) — wording is ambiguous; **budget one Premium sub anyway**.
2. **Standalone @agency_bot (secondary).** Free, full-featured: `sendMessageDraft` token streaming for AI replies (Bot API 9.3), YooKassa RUB invoices with 54-FZ fiscalization ([promo.yookassa.ru/telegram-bot](https://promo.yookassa.ru/telegram-bot)), and — key for a typography — a **self-hosted Bot API server raising file limits from 20/50 MB to ~2,000 MB** for print layouts. Also serves as the ops/escalation console.

**Do NOT use MTProto userbots** (Telethon/GramJS) on the main account: ban risk is documented first-party (Telethon FAQ: "any third-party library is prone to cause the accounts to appear banned"; [issue #3955](https://github.com/LonamiWebs/Telethon/issues/3955)). Verification nuance: rapid bans cluster on fresh/VoIP-number accounts and the risk to an aged personal account is lower than headline anecdotes — but losing the agency's main account means losing all client threads, and the official Business connection makes userbots pointless.

**Legal:** 41-FZ does not cover ad agencies — confirmed. Caveats: FAS's 10.03.2026 position bans *paid promotion* in Telegram; a second anti-fraud package (adopted 09.06.2026, effective H2 2026) may tighten messenger rules further.

### 2.3 Max — mandatory primary channel; direct Bot API now feasible for ООО **and ИП**

**State of the channel.** State-forced growth (preinstall law 156-FZ), Gosuslugi integration, ~110M registrations / 85M DAU claimed (VK press figures, unaudited). The only channel with zero blocking risk.

**Integration route: direct Bot API** (`platform-api.max.ru`, free, no per-message fees, [dev.max.ru/docs-api](https://dev.max.ru/docs-api)):
- **Registration:** verified RF legal entity **or ИП** via business.max.ru (Gosuslugi as director, or Alfa ID / T-Business / SberBusiness ID). Самозанятые/физлица/non-residents excluded. Max 5 bots/org; moderation up to 48 business hours; **any** profile change (even one character) triggers re-moderation; bot must display user agreement, privacy policy, requisites, support channel ([prepare docs](https://dev.max.ru/docs/chatbots/bots-coding/prepare), [Habr](https://habr.com/ru/articles/951326/)).
- **Mechanics:** webhooks mandatory for production; **since May 25, 2026** (not May 11 as initially researched — that claim was **REFUTED**) HTTP webhooks and self-signed certs are unsupported — trusted-CA HTTPS required. Long polling is dev-only; documented params are timeout 0–90s / batch 1–1000 events (the "2 RPS / 24h TTL" figures from initial research were **not found in any source — discard them**). Global limit 30 RPS. Inline keyboards (up to 210 buttons), media uploads, Markdown/HTML, `request_contact` (useful for phone-based identity merge across channels).
- **Hard constraints:** bots are strictly inbound-only — cannot message first; antispam auto-blocks violators. Proactive outreach only via the separate paid "MAX для бизнеса" program through aggregators (draft 8.50–12.20₽/client/mo, covers dialog + service notifications; OTP 5.5–7.9₽; first year planned free) ([Messaggio](https://messaggio.com/ru/blog/max-dlya-biznesa-chto-eto-i-kak-podklyuchit/)). **No bot payments API** — payments via mini-apps with SBP (VK Pay involvement uncorroborated) or SBP links in chat.
- **SDKs — CORRECTION (claim refuted):** official SDKs are **JS/TS and Go only**; `max-botapi-python` is explicitly unofficial (community fork verified by the MAX team, [repo](https://github.com/max-messenger/max-botapi-python)). Practitioners report docs-vs-reality payload mismatches (nesting, ms timestamps, `sender` vs `from`) — budget reverse-engineering time and strict payload validation ([Habr](https://habr.com/ru/articles/1005282/)).
- **Fallback route:** official partner-integration list now has **~65 services** (not ~15 as initially researched — **REFUTED**), including Salebot, Chat2Desk, BotHelp; **Wazzup is notably NOT on the official list** though it sells Max integration ([dev.max.ru/docs/partners-integration](https://dev.max.ru/docs/partners-integration)).

**Risks:** platform rules change abruptly (eligibility rules changed twice in 9 months); commercial tariffs announced for 2026–2027 (currently free); re-moderation friction; theoretical future geo-fencing of foreign webhook IPs (mitigate with long-polling fallback or RU relay).

---

## 3. AI Layer — Ranked LLM Options

**Access reality:** OpenAI/Anthropic unavailable directly (no RU cards/IPs; Anthropic ToS bans >50%-RU-owned entities; Persona ID checks from Apr 2026). OpenRouter is reachable from RU (only payment is restricted — USDC +5% works). RU aggregators: ProxyAPI (stable, but x3.7–4.3 markup), AITunnel (~x2), Polza.ai/Promptra (LLC, VAT invoices, x1.05–1.8 claimed, but low-margin players carry model-substitution risk per [sostav.ru](https://www.sostav.ru/blogs/289807/86785)).

Workload model used below: 3,000 conversations/mo × 15 turns, ~4K input + 250 output tokens/turn → ~180M in / 12M out per month. *(Illustrative — this agency's actual volume is ~600 conversations/mo, so divide costs ~5x.)*

| Rank | Option | Access from Russia | Tool calling | Est. monthly cost (full workload) |
|---|---|---|---|---|
| **1** | **GigaChat 2 Max/Pro (Sber)** — primary | Direct, rubles, EDO, 152-FZ ([tariffs](https://developers.sber.ru/docs/ru/gigachat/tariffs/legal-tariffs)) | Yes, JSON Schema, all models; OpenAI compat is **partial (~90%)** — Sber recommends native SDK ([docs](https://developers.sber.ru/docs/ru/gigachat/api/function-calling)); LiteLLM notes one function call per request, though 2.0 chains calls across an agent loop | Uncached: ~96–125K₽ (Pro/Max), ~12.5K₽ (Lite). **With request caching (cached tokens = 0₽) and lean context: realistically 10–40K₽** |
| **2** | **YandexGPT 5.1 Pro / Alice AI (Yandex AI Studio)** | Direct, rubles, 152-FZ; OpenAI-compatible endpoint `llm.api.cloud.yandex.net/v1` ([docs](https://aistudio.yandex.ru/docs/en/ai-studio/operations/generation/completions-function.html)) | Yes (tools + JSON-schema structured output) | ~77K₽ (Pro @0.40₽/1K — two sources conflict, 0.40 vs 0.80; verify on the official calculator), ~38K₽ (Lite). No caching found |
| **3** | **DeepSeek (workhorse/cost tier)** | Site not geo-blocked; payment via foreign virtual card or aggregator (AITunnel/Polza, x1.5–2) | Yes (improved in V4) | $25–55 direct (2–5K₽); 3–9K₽ via aggregator. **Note (verification):** V3.2-era models retire July 2026; current is V4-Flash ($0.14/1M in, $0.0028 cached) — price the current model |
| **4** | **Qwen3-235B / gpt-oss-120b hosted in Yandex AI Studio** | Direct, rubles, RF residency — cleanest legal route to open models ([Yandex](https://yandex.ru/company/news/25-07-2025-01)) | Yes | ~0.5₽/1K tokens; between GigaChat Lite and YandexGPT Pro |
| **5** | **GPT-5.x-mini / Claude — escalation tier only (~10% of dialogs)** | OpenRouter + USDC (+5%) or aggregator (ProxyAPI/Polza); permanent cutoff risk (Jan 2026 OAuth crackdown precedent) | Best in class | ~$105/mo via low-markup route for mini-class; Claude-class via ProxyAPI ≈500K₽/mo — **excluded** for volume use |

**Architectural directives:**
- Build on an **OpenAI-compatible client** so models swap by `base_url` (GigaChat compat layer + Yandex endpoint + OpenRouter all conform). Avoid the Claude Agent SDK (Anthropic-tied, RU-unsupported).
- **REFUTED-claim correction in cost logic:** the original "RU models have no caching → 10–30x more expensive for RAG" conclusion is wrong for GigaChat (cached tokens billed at 0₽ since Oct 2024, more generous than DeepSeek's 90% discount). The corrected guidance: keep context lean, exploit GigaChat caching, and the GigaChat-primary architecture is cheaper than initially modeled; a model router (Lite for intent → Max for dialogue → escalation tier for hard cases) still pays for itself.

---

## 4. Build vs Buy

| Dimension | Buy (Salebot / BotHelp / Chat2Desk) | Build (custom brain, official channel APIs) |
|---|---|---|
| Time to live | Days–2 weeks | 4–8 weeks (1–2 devs) |
| Monthly cost | Salebot ~1,990₽; BotHelp 1,990₽ incl. 150K LLM tokens; Chat2Desk 4,500–13,500₽ + add-ons (bot constructor +3,500₽) | ~1,500–3,000₽ infra + LLM usage |
| AI quality on hard cases | Constructor-grade, single-model (often locked to GigaChat); weak on nuanced print-pricing dialogs and difficult clients | Full prompt/tool control: deterministic SQL price quotes, escalation logic, model routing |
| Max channel access | Via vendor (Salebot/Chat2Desk/BotHelp are on the official ~65-service partner list) | Direct — now feasible for ИП as well as ООО (post-March 2026) |
| Operator/human takeover | Built-in inbox | Must build (per-chat pause flag + manager group alert) or bolt on Chatwoot/Wazzup |
| Lock-in / data | Vendor-held dialogs, vendor AI roadmap | None; Postgres you own |

**When buy wins:** no dev capacity, need to validate demand this month, requirements are FAQ-grade. Salebot (free tier, Max from 1,000₽/mo, [docs](https://docs.salebot.pro/chat-boty/podklyuchenie-messendzherov-i-kanalov/max)) is the cheapest credible v1 that can later be demoted to a channel layer.

**When build wins:** this agency's stated need — accurate price quoting (product × material × tirazh), order intake with file upload, difficult-client handling — is exactly what constructors do badly. With 1–2 devs available and the Max ИП relaxation removing the biggest structural blocker, build wins. The middle path (aggregator as channel plumbing + custom brain) buys an inbox, not AI quality: Wazzup explicitly has **no built-in LLM** (verified — only audio transcription on its top tier; it is designed as an API layer, [pricing](https://wazzup24.ru/pricing/), [webhooks](https://wazzup24.ru/help/api-ru/webhooks-2/)), so the brain is your code in every scenario except full-buy.

---

## 5. Candidate Architectures

### A. Platform-based ("buy")
- **Stack:** Salebot or BotHelp; built-in GPT/GigaChat blocks; native Max partner connection; amoCRM/Bitrix24 integration. WhatsApp via the platform where offered.
- **Cost:** ~2,000–4,000₽/mo. **Effort:** 3–10 days, no code.
- **Verdict:** acceptable only as a demand-validation v1. Constructor AI will fail on bespoke print-pricing dialogs; you'll rebuild within months.

### B. Aggregator + custom brain ("hybrid")
- **Stack:** Wazzup (Telegram + Max + residual WhatsApp channels, REST API + webhooks, ~2,000–8,000₽/mo per-channel pricing) or Umnico/Pact.im as plumbing → webhook into a custom service → GigaChat/YandexGPT tool loop → replies back through the aggregator API. Human takeover via the aggregator inbox / amoCRM (AmoChats added native MAX in Spring 2026, 999₽/account/mo).
- **Cost:** ~5,000–12,000₽/mo platform + LLM usage. **Effort:** ~3–5 weeks.
- **Caveats:** Wazzup is not on Max's official partner list (its Max integration sits outside it); its dedicated "MAX Bot" channel type is only on Free/Max tariffs; per-channel pricing multiplies (3 channels on Pro = 12,000₽/mo). You still write the entire AI layer.
- **Verdict:** best if the agency already lives in amoCRM and wants a ready operator inbox on day one.

### C. Full custom ("recommended")
- **Stack:**
  - **Hosting:** one Timeweb Cloud VPS in Amsterdam/Almaty (RUB billing, ~550–1,500₽/mo) — verified to reach Max API + Telegram API + OpenRouter + RU LLMs simultaneously. Fall back to Max long polling or an RU relay if Max ever geo-fences webhooks.
  - **Channels:** Telegram Business connection + standalone bot (one codebase handling `message` and `business_message`); Max via official JS/TS SDK or raw HTTP against platform-api.max.ru (strict payload validation); WhatsApp via Wappi.pro (700₽/mo) or Green API (690₽/mo).
  - **Brain:** plain tool-use loop over an OpenAI-compatible client. Primary: GigaChat 2 Max (exploit 0₽ cached tokens). Router: GigaChat Lite for intent. Escalation: OpenRouter frontier model for ~10% hard dialogs. ~5–6 tools: `price_quote` (SQL), `create_order`, `faq_search`, `escalate_to_human`, `crm_push`.
  - **Data:** Postgres 16 + pgvector on the same VPS (chats, orders, summaries, embeddings — the 2026 consensus is pgvector suffices under 2–3M vectors; no separate vector DB or queue). **Price list as normalized SQL tables, not RAG** — deterministic quotes, no hallucinated numbers. FAQ as a few hundred pgvector chunks via GigaChat Embeddings (0.014₽/1K).
  - **Handoff:** per-chat `bot_paused` flag + alert to a managers' Telegram/Max group + reply-through-bot; on the Telegram Business side, the owner replying manually auto-pauses the AI. Orders pushed to own DB + admin view (this agency's choice), with amoCRM REST v4 or Google Sheets as optional integrations.
  - **Prereq:** agency's ООО or ИП verifies on business.max.ru (Gosuslugi/bank ID, ≤48 working hours moderation).
- **Cost:** ~3,000–6,000₽/mo infra (VPS + Wappi/Green API + Telegram Premium) + LLM usage (at this agency's ~600 conversations/mo: roughly 2–8K₽/mo on GigaChat with caching). **Effort:** 4–8 weeks for 1–2 devs (budget ~1 extra week for Max payload reverse-engineering and moderation cycles).
- **Verdict — recommended.** Every architecture requires building the brain anyway; C eliminates aggregator fees and lock-in, gives full control over quoting/escalation, and the March 2026 ИП relaxation removed the legal-entity barrier that previously justified going through a partner platform. Choose B over C only if a polished multi-operator inbox on day one outweighs ~6,000₽/mo and the team's amoCRM usage is already deep.

---

## 6. Risks & Open Questions for the Agency

**Risks**
1. **Regulatory volatility is the #1 risk.** Three of the verified claims went stale within months (Max eligibility, webhook deadlines, audience figures). Telegram could be blocked harder; Max rules/commercial tariffs (announced for 2026–2027) could change; the H2 2026 anti-fraud package may add messenger restrictions. Mitigation: channel-adapter pattern so any messenger is a thin module.
2. **WhatsApp number ban** on the unofficial gateway (behavior-driven; inbound-reply bots are lowest-risk, but May 2026 enforcement tightened). Use a dedicated number, not the owner's personal one.
3. **Frontier-LLM cutoff risk** (Anthropic/OpenAI enforcement against resellers; OpenRouter payment friction; UDP/VPN degradation in RF since May 2026). Mitigation: GigaChat/YandexGPT primary, frontier as optional tier, swap by `base_url`.
4. **Max moderation friction:** every profile change triggers re-moderation; bot is inbound-only (no proactive order-status pushes without the paid MAX-для-бизнеса program).
5. **Telegram Business constraints:** no pre-connection history, 24h reply window, one connected bot — the AI cannot follow up with a silent client; re-engagement must happen on Max (paid notifications) or by the human owner.
6. **Aggregator-layer claims** (IntellectDialog multi-model AI, Promptra's x1.05 markup) come from self-promotional sources — verify before contracting.
7. **VK's Max audience figures are self-reported** — actual *reachable, active* client overlap for this agency is unverified.

**Open questions to confirm with the agency**
1. **Legal form:** ООО or ИП? (Either now works for direct Max API; самозанятый would force the partner-platform route.) Can the director pass Gosuslugi/bank-ID verification on business.max.ru?
2. **Where do clients actually write today?** Split across WhatsApp / Telegram personal DMs / Max / Avito / phone — this decides whether the Telegram Business connection (existing DM traffic) or the standalone bot leads, and whether WhatsApp is worth even 700₽/mo.
3. **Real volume:** the 3,000 conversations/mo cost model is illustrative. This agency reports <20 conversations/day (~600/mo) — LLM budget is roughly 5x smaller.
4. **Price-list structure:** can the print price matrix (product × material × tirazh × finishing) be normalized into SQL once? Who maintains it? This is the single biggest determinant of answer quality.
5. **CRM:** agency chose own DB + Telegram notifications — no CRM dependency for v1.
6. **File intake:** typical print-layout file sizes? >50 MB means budgeting the self-hosted Telegram Bot API server; Max upload limits should be load-tested.
7. **Escalation policy:** who answers when the AI bails, in what SLA, and on which device? (Defines whether a managers' group alert suffices or an inbox UI is required.)
8. **Payments in chat:** needed at all? If yes — YooKassa invoices on Telegram, SBP links on Max; confirm 54-FZ fiscalization setup.
9. **Data residency:** is 152-FZ residency for client PII a hard requirement? If yes, the DeepSeek tier is out and the RU-VPS+foreign-egress topology (Selectel + WireGuard proxy) replaces the single Amsterdam VPS.
10. **Proactive outreach ambitions:** if the agency wants order-status pushes on Max, it must enroll in "MAX для бизнеса" via an aggregator — budget and timeline for that program are still in draft.
