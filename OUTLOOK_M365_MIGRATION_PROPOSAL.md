# Microsoft Outlook / Microsoft 365 Support - Migration Proposal

**Prepared for:** Engineering Management  
**Subject:** Adding "Sign in with Microsoft" + Outlook/Microsoft 365 support to the Email Prioritizer Backend  
**Status:** For decision and budget approval  
**Classification of effort:** Moderate (feasible; broader than a Gmail-to-Graph API swap)

---

## 0. Decision Required (Read This First)

This proposal asks management for **one decision** and **one unblock**. Everything else follows from them.

### The one decision

Choose the Microsoft account model we are building for:

| Path | Who can sign in | Use this if... | Consequence |
|---|---|---|---|
| **Single-tenant (work/school)** - *recommended* | Only users in our own Microsoft 365 tenant | This is an **internal Eduvance workflow tool** | Simplest consent, fastest to MVP |
| Multi-tenant (work/school) | Users from any Microsoft 365 organization | This is a **customer-facing / SaaS product** | Adds publisher verification + per-org admin consent |
| Personal Microsoft accounts | Outlook.com / Hotmail / Live users | Consumer testing only | Not representative of business behavior; weakest fit |

**Recommendation:** start **single-tenant work/school**. We can widen to multi-tenant later without rewriting the core.

### The one blocker

**We have no Microsoft footprint today** - no account, tenant, Exchange Online mailbox, Entra app registration, admin access, or licenses. Engineering effort cannot be validated end-to-end until at least one **licensed Outlook mailbox + an Entra app registration** exist. This is a procurement/IT dependency, not an engineering one, and it gates the timeline.

### At-a-glance numbers

| Milestone | Engineering effort | Calendar time |
|---|---:|---:|
| Minimal sign-in POC | 1-2 weeks | 1-2 weeks **after** a mailbox + app registration exist |
| Business MVP (pilot users) | 3-6 weeks | 4-8 weeks including expected setup/approval time |
| Production-ready | 6-10+ weeks | 8-12+ weeks including procurement, security, and UAT dependencies |

> **What we need from management:** (1) confirm the account model above, (2) authorize one licensed Microsoft 365 mailbox + Entra app-registration access for the POC, (3) approve the delegated Graph scopes in Section 7, and (4) acknowledge the compliance note in Section 8: business email content will be processed by Google Gemini.

---

## Plain-English Glossary (Skim This Before the Rest)

The proposal uses a handful of Microsoft and engineering terms. Here is what each one means in practice, so the rest of the document reads clearly.

| Term | What it actually means here |
|---|---|
| **Microsoft Graph** | Microsoft's single API for reading/sending Outlook mail and calendar - the Microsoft equivalent of the Gmail API we use today. |
| **Microsoft Entra** | Microsoft's identity system, formerly Azure AD. It is where we register our app and where users' Microsoft logins live. |
| **App registration** | A one-time entry we create in Entra that tells Microsoft "this app exists and is allowed to ask users to sign in." Produces an ID + secret the backend uses. |
| **Tenant** | One organization's Microsoft 365 environment. Single-tenant means only our company's users can sign in. Multi-tenant means users from other companies can too. |
| **Exchange Online mailbox** | A real, licensed Outlook mailbox. Without a license, a user can sign in but has no actual mail to read. This is the part that costs money. |
| **Delegated OAuth / "Sign in with Microsoft"** | The user logs in with their own Microsoft account and grants our app permission to act on their behalf. Same idea as "Sign in with Google." |
| **Scopes / permissions** | The specific things the user lets us do - for example read mail, send mail as me, and manage calendar. Nothing more. |
| **Access token / refresh token** | Short-lived vs. long-lived keys. The access token lets us call Microsoft for about an hour; the refresh token lets us quietly get a new one so the user does not re-login constantly. |
| **Token store** | A small database holding each user's tokens, so the right user always gets their own mailbox. The app has none today. |
| **Admin consent** | For sensitive permissions, an IT admin, not the end user, may have to approve the app once for the whole organization. |
| **Conditional Access / MFA** | Company security policies, such as requiring 2-factor authentication, that can affect whether sign-in succeeds. |
| **Throttling** | Microsoft temporarily slowing us down if we make too many requests too fast; we handle it with automatic retries. |
| **Provider abstraction** | A software layer that lets the same app talk to either Gmail or Outlook, so we do not rewrite the AI/attachment logic twice. |

---

## 1. Executive Summary

Supporting Microsoft Outlook / Microsoft 365 is **feasible from the current codebase**, but the scope is broader than replacing Gmail API calls with Microsoft Graph calls.

Today the backend is built around **one Google OAuth refresh token in environment variables** - enough for a single Gmail test user, but it cannot support multiple users signing in dynamically. The Microsoft target requires a **delegated "Sign in with Microsoft" flow**: each user authorizes the app, and the backend uses *that user's* Graph token to read their mailbox, summarize emails, parse attachments, create calendar events, and send approved replies on their behalf.

**Two distinct workstreams are bundled in this request:**

1. **A new identity capability** the app does not have today - per-user sign-in, sessions, and secure per-user token storage. This is the larger and more security-sensitive half.
2. **A provider swap** - Microsoft Graph adapters behind a provider-neutral interface, reusing the existing AI, attachment-parsing, routing, and Lambda layers.

Microsoft Graph provides functional equivalents for the required Gmail and Google Calendar capabilities: read inbox, read a message, read attachments, send replies, read calendar events, and create calendar events. However, behavior differs in important areas such as threading/conversations, attachment types, message IDs, throttling, and calendar event behavior. These differences must be validated on real Microsoft mailboxes before claiming full parity.

**Product recommendation:** **add Outlook as a second provider behind a provider-agnostic layer; do not hard-replace Gmail.** Keep Gmail working until Outlook is validated end-to-end.

---

## 2. Current Codebase Assessment

> **In plain terms:** this section says how much of what we already built can be kept. The short answer: the "brains" of the app - AI ranking/summarization, attachment reading, web routes, and cloud deployment - are reusable. What has to change is the part that talks specifically to Gmail, plus we have to add a sign-in system the app has never had.

### Architecture today

Bun + Express + TypeScript backend deployed as an **AWS Lambda container**. Routes cover prioritized emails, AI reply drafts, approved reply sending, and calendar sync from recent emails.

Current provider assumptions:

- Gmail API for mail read/send.
- Google Calendar API for calendar sync.
- **One** Google OAuth refresh token.
- `googleapis` client.
- Gemini via the Vercel AI SDK (`@ai-sdk/google`, model `gemini-2.5-flash`).

### Code that is provider-coupled (must change)

| File | Current role | Microsoft impact |
|---|---|---|
| `src/adapters/google/gmail/client.ts` | Creates Gmail client from Google OAuth env vars. | Add Graph client using Microsoft Identity Platform + per-user tokens. |
| `src/adapters/google/gmail/fetcher.ts` | Public fetch functions: latest, single, thread. | Add Outlook fetcher with equivalent functions. |
| `src/adapters/google/gmail/googleapisFetcher.ts` | Calls Gmail list/get/thread APIs. | Replace with Graph message list/get/conversation queries. |
| `src/adapters/google/gmail/messageParser.ts` | Decodes Gmail raw MIME and maps it to `EmailSummary`. | Reuse for Graph MIME `$value` path or replace with Graph JSON mapping. |
| `src/adapters/google/gmail/reply.ts` | Builds MIME reply, sends via Gmail. | Implement Graph reply/send. |
| `src/mail.ts` | Gmail CLI/dev wrapper. | Provider-neutral or provider-specific dev scripts. |
| `src/mailApi.ts` | Google OAuth refresh-token helper. | Replace with real Microsoft sign-in endpoint using auth-code flow. |
| `src/adapters/google/calendar/events.ts` | Searches/creates Google Calendar events. | Add Graph Calendar adapter. |
| `src/services/mailbox.service.ts` | Imports Gmail fetcher directly. | Resolve selected mail provider using current signed-in user. |
| `src/services/emailReply.service.ts` | Imports Gmail fetch/reply adapters directly. | Use provider-neutral fetch/thread/reply functions. |
| `src/services/calendarSync.service.ts` | Imports Google Calendar directly. | Refactor to selected calendar provider. |
| `src/services/aiMeetingExtractor.service.ts` | Google Calendar defaults + prompt wording. | Make defaults/prompt provider-neutral. |
| `src/config/env.ts` | Requires Google OAuth variables globally. | Add provider-aware validation for Microsoft config. |

### Code that is reusable

`emailPrioritizer.service.ts`, `attachmentParser.service.ts`, fallback priority handling, `aiPrioritizer.service.ts`, `aiDraftReply.service.ts`, `aiMeetingExtractor.service.ts`, all controllers, routes, schemas, utils, the `Dockerfile`, and Lambda deploy scripts are **mostly reusable**.

The AI services need prompt-wording changes from Gmail to "mailbox" and provider-neutral types. Attachment parsing is unchanged once Graph attachments are mapped to `EmailAttachment.contentBytes`.

### The major current limitation

The backend assumes **one configured mailbox via env vars**. It has **no** user login/session, no per-user token storage, no per-user provider selection, and no accounts/tokens database. For "Sign in with Microsoft," all of these become required features - this is the core of the new work.

---

## 3. Microsoft Environment Requirements (Starting From Zero)

> **In plain terms:** before any code can be tested, someone has to create the Microsoft side of things - an account, a paid Outlook mailbox, and a one-time app setup. This is the part that needs IT/procurement, not engineering, and it is the main thing that controls when we can start. The key cost surprise: the "free Microsoft developer tenant" people often assume exists is now restricted, so plan on a small paid license unless we already qualify.

### Correction vs. common assumption: the free developer tenant is gated

A frequent assumption is that a Microsoft 365 developer tenant can be spun up for free. This is no longer something we should rely on. Microsoft documentation currently indicates that Microsoft 365 developer sandbox access is limited to qualifying members, including Visual Studio Professional/Enterprise subscribers and other qualifying Microsoft partner/program channels. Personal accounts alone should not be assumed sufficient.

**Practical consequence:**

- An **Entra app registration is free** in the sense that the app registration itself has no standard per-app fee, but it only gives us identity - not a mailbox.
- **Reading real mail requires a licensed Exchange Online mailbox.**
- The realistic cheapest business-like path is **one paid Microsoft 365 Business Basic seat** or equivalent Exchange Online mailbox license.
- As of June 19, 2026, Microsoft India list pricing shows Microsoft 365 Business Basic at **about Rs. 145/user/month, paid yearly**, GST extra. This must be verified at purchase time with Microsoft or the organization's reseller. Microsoft has also announced commercial pricing/package updates effective July 1, 2026, so final procurement pricing may differ.

### Minimum setup for a technical POC

One licensed Outlook mailbox, Business Basic or equivalent is sufficient, plus:

- Entra app registration.
- Client ID.
- Client secret.
- Redirect URI.
- Supported-account-type setting.
- Delegated Graph scopes from Section 7.
- Local redirect URI such as `http://localhost:3000/auth/microsoft/callback`.
- One test mailbox seeded with inbox emails, threads, attachments, and meeting links.

**How many users this covers:** the POC validates **one real signed-in user**. The single Entra app registration can technically accept "Sign in with Microsoft" from any user in the tenant, but each user only ever sees their own mailbox, and a user needs a **licensed Exchange Online mailbox** to have real mail to read. With one license we prove the end-to-end flow for one user. To test genuine multi-user isolation, User A sees only A's mail and User B sees only B's, we need at least **2 licensed mailboxes**.

### Business MVP

Required:

- Microsoft 365 business tenant.
- **2-3 licensed pilot mailboxes** to exercise per-user behavior.
- Admin who can own the app registration and grant Graph consent.
- Redirect URIs for local/staging/production.
- Backend token store keyed by application user ID.
- Session management.
- Secure client-secret storage.
- Privacy/security review as described in Section 8.

### Production

Required:

- Production tenant decision.
- Production app registration.
- Publisher/domain verification if exposed to external tenants.
- Admin-consent strategy.
- Secure token storage with refresh/revocation handling.
- User disconnect/reconnect.
- Conditional Access / MFA compatibility.
- Audit logging.
- Graph throttling monitoring.
- Data-retention policy.
- AI-data-processing approval.
- UAT on production-like mailboxes.

---

## 4. Microsoft Sign-In Architecture

> **In plain terms:** today the app logs into one fixed Gmail account that we configured by hand. To let many people use it, the app needs a real "Sign in with Microsoft" button, a way to remember who each person is, and a secure place to keep each person's login so we always show them their own inbox and never mix users up. That whole capability is new - it is the biggest piece of work in this proposal.

Target: **delegated Microsoft OAuth using authorization-code flow** so each user sees only their own mailbox.

### User-facing flow

"Sign in with Microsoft" -> user authenticates -> user consents to scopes -> Microsoft redirects to our callback with an authorization code -> backend exchanges code for tokens -> backend stores tokens per user -> backend uses the user's Graph token for all Mail/Attachment/Calendar/Send calls.

### Required backend additions

- `GET /auth/microsoft/start`
- `GET /auth/microsoft/callback`
- Session or JWT issuance after successful sign-in.
- User-identity persistence.
- **Encrypted per-user token persistence.**
- Token-refresh logic.
- Logout/disconnect flow.
- Current-user middleware.
- Provider-aware service calls using the user's tokens.

### OAuth hardening

The authorization-code flow **must** include:

- Signed/validated `state` parameter on every authorize request and callback to prevent CSRF on the redirect.
- PKCE (`code_challenge` / `code_verifier`). We are a confidential client because the backend holds a client secret, so PKCE is defense-in-depth rather than the same requirement as for public clients, but it is worth adding from the start.
- No tokens in logs.
- Refresh-failure -> forced reconnect handling.

### Token model

Access tokens are short-lived. Refresh tokens require `offline_access` and are only issued when that scope is consented. Tokens are stored **per user**, never in a global `.env`.

Production requirements:

- Encrypted at rest.
- No token logging.
- Consent-revocation handling.
- Expiry handling.
- Reconnect flow.

### Recommended token storage

The store holds two relational-shaped entities: a **user** (app identity, linked Microsoft account) and that user's **provider tokens** (access token, refresh token, scopes, expiry, provider).

In both options, the Entra **client secret** belongs in **AWS Secrets Manager** or SSM Parameter Store with KMS - never in the container image or a plain Lambda env var.

#### Option A - DynamoDB + KMS

Matches the current Lambda-native deployment style.

- DynamoDB table keyed by application user ID.
- Encryption at rest with AWS KMS customer-managed key.
- Scales without connection management.
- Lowest-friction path on Lambda.

#### Option B - PostgreSQL

Recommended if we want a relational users/tokens model, or already run Postgres.

- `users` table.
- `provider_tokens` table foreign-keyed to the user.
- One row per linked provider.
- RDS/Aurora storage encryption with KMS.
- Optional defense-in-depth: encrypt refresh-token column with `pgcrypto` or app-level envelope encryption.

**Lambda + Postgres caveat:** Postgres relies on persistent connections, which do not pair well with Lambda burst concurrency. If we choose Postgres, plan for connection pooling through RDS Proxy, a serverless Postgres provider with a pooler/HTTP driver, or PgBouncer. Add 1-2 engineering days for this.

**Net:** choose **Postgres** if relational modelling or an existing Postgres instance is the priority; choose **DynamoDB** if minimizing Lambda operational overhead is the priority. The provider abstraction makes this a storage-layer detail, not an architectural one.

---

## 5. Microsoft Equivalent Architecture

> **In plain terms:** every major Gmail/Google Calendar capability has a Microsoft Graph equivalent, but not necessarily identical behavior. We should expect careful testing around message IDs, threading, attachments, and calendar events.

| Current Google stack | Microsoft equivalent |
|---|---|
| Gmail API | Microsoft Graph Mail API |
| Google Calendar API | Microsoft Graph Calendar API |
| Google OAuth | Microsoft Identity Platform OAuth |
| Google refresh token in `.env` | Per-user delegated refresh token in encrypted storage |
| `googleapis` client | Graph REST wrapper + `@azure/msal-node` for token acquisition/refresh |
| Gmail `message.id` | Graph message `id`; request immutable IDs with `Prefer: IdType="ImmutableId"` where supported |
| Gmail `threadId` | Graph `conversationId`; not identical to Gmail threading |
| Gmail raw MIME | Graph message JSON or `GET /messages/{id}/$value` raw MIME |
| Gmail attachments via MIME parser | Graph message attachment API (`/messages/{id}/attachments`) |
| Gmail reply MIME send | Graph `reply` / `createReply` / `sendMail` |
| Google Calendar event creation | Graph `POST /me/events` |

### Reuse opportunity

Our current pipeline already decodes **MIME**. Graph can return raw MIME via `GET /messages/{id}/$value`, which can feed the existing MIME parser with less change than rebuilding all attachment parsing around Graph JSON.

Trade-off:

- MIME `$value` path may reduce near-term adapter work.
- Structured Graph JSON (`/attachments`, typed fields) is cleaner long-term.

**Recommendation:** prototype the `$value` MIME path first to de-risk reuse, then decide per-feature. This choice materially affects the Phase 4 estimates below.

---

## 6. Feature-by-Feature Migration Mapping

> **In plain terms:** for each thing the app does today, this table says what changes and what stays. Most genuinely new work is concentrated in sign-in, mail fetching, reply sending, calendar, and token storage.

| Feature | Current | Microsoft equivalent | Impact |
|---|---|---|---|
| User authentication | One Google refresh token in env. | Per-user OAuth auth-code flow. | **New** auth routes, sessions, token store. |
| Fetch latest inbox | Gmail `messages.list` with `INBOX`. | `GET /me/mailFolders/inbox/messages`. | New Outlook fetcher. |
| Read single email | Gmail `messages.get`. | `GET /me/messages/{id}` or `/$value`. | New Outlook fetcher. |
| Conversation context | Gmail `threads.get`. | Query by `conversationId`. | New logic; test thread parity. |
| Read attachments | Gmail MIME via `mailparser`. | `/messages/{id}/attachments` with `contentBytes` or `$value` MIME. | New mapping; possible MIME reuse. |
| Parse attachments | `attachmentParser.service.ts`. | Same parser after mapping. | Mostly unchanged. |
| AI prioritization | Gemini via `aiPrioritizer.service.ts`. | Same AI flow. | Prompt wording + neutral types. |
| AI attachment summaries | Parsed attachment insights in prioritization prompt. | Same flow. | Mostly unchanged. |
| AI reply drafts | `aiDraftReply.service.ts`. | Same AI-only draft. | Change Gmail wording/types. |
| Send approved replies | Gmail MIME send. | Graph `reply` action. | New Outlook reply adapter. |
| Preserve threading | Gmail `threadId` + headers. | Prefer Graph `reply` action. | Test on Outlook conversations. |
| Meeting extraction | `aiMeetingExtractor.service.ts`. | Same AI extraction. | Neutral wording/defaults. |
| Calendar duplicate detection | `Source Gmail Message ID` marker. | Provider-neutral marker + Graph event search. | Refactor duplicate strategy. |
| Calendar event creation | Google `events.insert`. | Graph `POST /me/events`. | New calendar adapter. |
| Lambda deployment | Existing container. | Same container. | Add env/secrets + token store. |

---

## 7. Microsoft Graph Permissions (Delegated)

> **In plain terms:** these are the exact permissions a user/admin grants to the app. We ask only to confirm who the user is, read their mail, send replies as them, and manage calendar events for meeting sync. We deliberately do not ask for broader mailbox edit/delete access unless later required.

Delegated permissions are the correct model for "user signs in and sees own mail."

| Permission | Type | Admin consent likely? | Why |
|---|---|---|---|
| `openid`, `profile` | OIDC | Usually no, but tenant policy may vary. | Sign-in identity / profile claims. |
| `offline_access` | OIDC | Usually no, but tenant policy may vary. | Refresh token for continued access. |
| `User.Read` | Delegated | Usually no, but tenant policy may vary. | Read signed-in user's profile. |
| `Mail.Read` | Delegated | Tenant policy may require. | Read inbox, bodies, attachments. |
| `Mail.Send` | Delegated | Tenant policy may require. | Send approved replies as the user. |
| `Calendars.ReadWrite` | Delegated | Tenant policy may require. | Read for dedupe + create events. |
| `Mail.ReadWrite` | Delegated | More likely to need review. | Only if we create Outlook drafts; not needed for AI-only previews. |

**Recommended POC/MVP scope string:**

```text
openid profile offline_access User.Read Mail.Read Mail.Send Calendars.ReadWrite
```

Do **not** request `Mail.ReadWrite` unless real Outlook draft creation becomes a requirement.

Application (app-only) permissions are not recommended for the primary flow. They may suit admin-managed background automation later, but require admin consent and tight mailbox scoping.

---

## 8. Compliance & Data-Flow Review (Elevated - Read Before Approval)

This is the item most likely to require sign-off beyond engineering, so it is called out explicitly rather than buried under "security review."

**The data flow:** the backend reads **Microsoft 365 / Outlook email bodies and attachments** and sends extracted content to **Google Gemini** for prioritization, summarization, and reply drafting. This is a deliberate **cross-cloud flow: Microsoft -> Google**.

**Why this needs attention:**

- Business email and attachments may contain confidential, regulated, customer, or personal data such as PAN, Aadhaar, GSTIN, contracts, financials, or customer details.
- Microsoft offers data residency capabilities for eligible Microsoft 365 workloads, and Indian tenants may have Microsoft 365 data residency considerations. Exact workload/location commitments must be verified in Microsoft Trust Center and the organization's Microsoft agreement.
- Forwarding email content to a third-party AI provider is a data-processing decision that touches privacy, purpose limitation, processor terms, retention, and cross-border processing considerations under applicable law, including the Digital Personal Data Protection Act, 2023.
- This is independent of Microsoft tooling: **Microsoft 365 Copilot is not required** and would not remove the need for Graph integration. The AI provider remains Gemini unless separately changed.

**Recommended before production:** document a data-processing assessment covering what email content leaves the Microsoft boundary, Gemini data-handling terms, retention policy, logging policy, and whether any content categories must be excluded from AI processing.

---

## 9. Risks, Gotchas & Constraints

> **In plain terms:** the things that can slow us down or trip us up. The biggest ones are not coding problems - they are getting the Microsoft account/license/admin approval in the first place. The rest are known Microsoft differences from Gmail.

### Setup / procurement

- No tenant exists today.
- License + admin procurement can delay code validation.
- Admin consent or user consent may be disabled by tenant policy.
- Personal Outlook testing will not match business behavior.
- The free developer sandbox route should be assumed unavailable unless we already qualify.

### OAuth / identity

- No existing user/session/token model.
- Refresh tokens can expire or be revoked.
- Conditional Access / MFA can affect sign-in and silent refresh.
- Multi-tenant support adds consent + publisher-verification complexity.
- Storing tokens creates real security obligations.

### Graph specifics

- Graph throttles; retry/backoff with `Retry-After` is required.
- Outlook message IDs can change on folder move unless immutable IDs are requested where supported.
- Gmail threads are not Outlook conversations.
- Graph attachments come in file, item, and reference types. Only file attachments typically carry direct `contentBytes`; item and reference attachments need separate handling.
- Large attachments need special handling.
- Threaded replies should use the Graph `reply` action and be tested.

### Calendar

- Outlook event behavior differs from Google.
- Adding attendees can trigger notifications. The app intentionally avoids invite/update emails, and that behavior should remain.
- Creating a real Teams meeting is distinct from merely pasting a Teams link.
- The `Source Gmail Message ID` dedupe marker must become provider-neutral.

### Scale (future)

The app currently polls on demand, which is fine for POC/MVP. For many concurrent users, evaluate Graph change notifications (webhooks/subscriptions). They reduce polling load but add subscription lifecycle/renewal work. Not required now; flagged so it is not a surprise later.

---

## 10. Cost & Licensing

The project has no Microsoft setup, so cost is more than engineering time.

| Cost area | Notes |
|---|---|
| Entra app registration | No standard direct per-app fee; requires admin ownership. |
| Licensed mailbox (POC) | At least one Business Basic or equivalent Exchange Online mailbox license. Current Microsoft India list price as of June 19, 2026 is about Rs. 145/user/month paid yearly, GST extra; verify at purchase. |
| Pilot mailboxes (MVP) | 2-3 licensed seats to validate per-user behavior. |
| Free dev sandbox | Assume unavailable unless we hold qualifying Visual Studio Professional/Enterprise or other eligible Microsoft program entitlement. |
| Microsoft Graph API | Standard mail/calendar usage is generally covered by licensing; this proposal uses standard Graph APIs, not Graph Data Connect or other metered bulk APIs. |
| Microsoft 365 Copilot | Not required. |
| Engineering | Auth, user/session/token storage, provider abstraction, Graph adapters, tests, docs, deploy. |
| IT/admin | Tenant, licenses, app registration, consent, Conditional Access review. |
| Security/compliance | Required - see Section 8. |
| Ongoing | Token failures, Graph throttling, permission/policy changes. |

### Cost scenarios

| Scenario | Accounts/Licenses | Admin setup | Eng effort | Calendar time | Limitations |
|---|---|---|---:|---:|---|
| **Minimal POC** | At least 1 licensed Business Basic or equivalent mailbox. | Basic app reg, delegated scopes, local redirect. | 1-2 weeks. | 1-2 weeks after setup. | Low confidence vs. enterprise tenant policies. |
| **Business MVP** | M365 tenant, 2-3 pilot mailboxes. | Admin-owned app reg, consent, staging redirect, secure token store. | 3-6 weeks. | 4-8 weeks including setup/approvals. | Pilot only; production hardening incomplete. |
| **Production** | Production tenant, real licensed users, formal security approval. | Prod app reg, consent, monitoring, runbooks, secret/token rotation, UAT. | 6-10+ weeks. | 8-12+ weeks including procurement/security/UAT. | Timeline driven by organizational readiness. |

Verify exact license pricing against Microsoft's current India pricing or the organization's reseller before budget approval.

---

## 11. Implementation Timeline

### Phase 1 - Microsoft environment readiness (procurement/IT-gated)

| Task | POC | MVP/Prod |
|---|---:|---:|
| Obtain Microsoft account/tenant | 0.5-3 d | 1-3+ wks |
| Procure/assign mailbox license | 0.5-3 d | 1-3+ wks |
| Identify Microsoft admin owner | 0.5-2 d | 1-2+ wks |
| Create Entra app registration | 0.5 d | 1-3 d |
| Configure redirect URI | 0.5 d | 1-2 d |
| Configure delegated Graph permissions | 0.5 d | 1-3 d |
| Complete consent / admin approval | 0.5-3 d | 1-4+ wks |

### Phase 2 - Authentication & user model

| Task | Estimate |
|---|---:|
| Microsoft auth start/callback with `state`/PKCE | 1-2 d |
| Session/JWT handling | 1-3 d |
| User-identity persistence | 1-3 d |
| Encrypted token storage (DynamoDB or Postgres) | 2-5 d |
| Connection pooling if Postgres on Lambda | 1-2 d |
| Token refresh/reconnect logic | 2-5 d |
| Provider-aware current-user middleware | 1-2 d |

### Phase 3 - Codebase refactor

| Task | Estimate |
|---|---:|
| Provider-neutral mail types | 1-2 d |
| Provider-neutral calendar types | 1 d |
| Refactor `mailbox.service.ts` | 1-2 d |
| Refactor `emailReply.service.ts` | 2-3 d |
| Refactor `calendarSync.service.ts` | 2-3 d |
| Remove Gmail wording from AI prompts/docs | 1 d |

### Phase 4 - Microsoft Graph implementation

| Task | Estimate |
|---|---:|
| Graph client wrapper with MSAL and throttling | 1-2 d |
| Outlook latest-inbox fetch | 2-4 d |
| Single email fetch | 1-2 d |
| Conversation/thread context | 2-5 d |
| Attachment fetch + mapping | 2-5 d |
| Approved reply send | 2-4 d |
| Calendar search/create | 3-5 d |
| Duplicate prevention | 2-3 d |
| Retry/throttling handling | 2-4 d |

### Phase 5 - Testing, deployment, UAT

| Task | Estimate |
|---|---:|
| Unit/integration tests with mocked Graph | 3-5 d |
| E2E with a real Microsoft mailbox | 3-7 d |
| Lambda env/secrets update | 1-3 d |
| UAT with pilot users | 1-3+ wks |
| Security review remediation | Variable |
| Production handover/runbook | 2-5 d |

---

## 12. Suggested Refactor (Provider Abstraction)

> **For the engineering team - managers can skip.** This section is the internal code plan: folder layout, interfaces, and which files change.

### Folder structure

```text
src/adapters/mail/types.ts
src/adapters/calendar/types.ts

src/adapters/google/gmail/{client,fetcher,reply}.ts
src/adapters/google/calendar/events.ts

src/adapters/microsoft/graph/client.ts
src/adapters/microsoft/auth/oauth.ts
src/adapters/microsoft/outlook/{fetcher,reply}.ts
src/adapters/microsoft/calendar/events.ts

src/services/mailProvider.service.ts
src/services/calendarProvider.service.ts
src/services/auth/microsoftAuth.service.ts
src/services/userToken.service.ts
```

### Provider-neutral interfaces

```ts
export type MailProviderContext = { userId: string; accessToken: string };

export type MailProvider = {
  fetchLatestEmails(ctx: MailProviderContext): Promise<EmailSummary[]>;
  fetchEmailById(
    ctx: MailProviderContext,
    id: string,
  ): Promise<EmailSummary | null>;
  fetchThreadEmails(
    ctx: MailProviderContext,
    source: EmailSummary,
  ): Promise<EmailSummary[]>;
  sendReply(
    ctx: MailProviderContext,
    input: SendReplyInput,
  ): Promise<SentEmailSummary>;
};

export type CalendarProviderContext = { userId: string; accessToken: string };

export type CalendarProvider = {
  findEventBySourceEmailId(
    ctx: CalendarProviderContext,
    emailId: string,
  ): Promise<CalendarEventSummary | null>;
  findEventByMeetingDetails(
    ctx: CalendarProviderContext,
    input: FindCalendarEventInput,
  ): Promise<CalendarEventSummary | null>;
  createEvent(
    ctx: CalendarProviderContext,
    input: CalendarEventInput,
  ): Promise<CalendarEventSummary>;
};
```

### Key service changes

- `mailbox.service.ts` - resolve active provider from the signed-in user; fetch with the user's token; map into `IncomingEmail`.
- `emailReply.service.ts` - use neutral `fetchEmailById`, `fetchThreadEmails`, and `sendReply`; pass user/provider context.
- `calendarSync.service.ts` - neutral calendar provider; replace the Google-specific dedupe marker.
- `aiDraftReply`, `aiPrioritizer`, `aiMeetingExtractor` - neutral types, prompt wording, and timezone defaults.
- `config/env.ts` - add Microsoft + provider config; do not require Google vars when `MAIL_PROVIDER=microsoft`.
- `.env.example`, `lambda-env.example.json`, `README.md` - document the Microsoft flow, scopes, and secrets.

---

## 13. Proposed Environment Variables

> **For the engineering team - managers can skip.** The management-relevant point: real user logins are stored securely per user, never as a shared setting, and the Microsoft secret belongs in a protected vault.

```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:5173

MAIL_PROVIDER=microsoft
CALENDAR_PROVIDER=microsoft

# AI provider (unchanged)
GOOGLE_GENERATIVE_AI_API_KEY=

# Existing Google provider, retained while Gmail stays supported
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback
GOOGLE_REFRESH_TOKEN=
GMAIL_MESSAGE_FETCH_CONCURRENCY=10

# Microsoft sign-in / Graph
MICROSOFT_CLIENT_ID=
# Store the secret in AWS Secrets Manager / SSM, NOT here in production:
MICROSOFT_CLIENT_SECRET=
# For SINGLE-TENANT (recommended): use the actual tenant GUID, not "common".
# "common" = work/school + personal; "organizations" = work/school only.
MICROSOFT_TENANT_ID=<your-tenant-guid>
MICROSOFT_REDIRECT_URI=http://localhost:3000/auth/microsoft/callback
MICROSOFT_GRAPH_SCOPES=openid profile offline_access User.Read Mail.Read Mail.Send Calendars.ReadWrite
MICROSOFT_GRAPH_TIMEOUT_MS=10000
MICROSOFT_MESSAGE_FETCH_CONCURRENCY=5
MICROSOFT_DEFAULT_TIMEZONE=Asia/Kolkata

# Per-user token store - pick ONE backend (see Section 4)
TOKEN_STORE=dynamodb
# Option A - DynamoDB (Lambda-native; uses IAM, no connection string)
TOKEN_TABLE_NAME=user-provider-tokens
TOKEN_KMS_KEY_ID=
# Option B - PostgreSQL (use a pooled/serverless endpoint on Lambda, e.g. RDS Proxy)
# DATABASE_URL=postgres://user:pass@host:5432/dbname
# TOKEN_COLUMN_ENCRYPTION_KEY=

MAX_EMAILS_TO_PROCESS=20
EMAIL_PRIORITIZATION_CONCURRENCY=5
ATTACHMENT_PARSE_CONCURRENCY=1
CALENDAR_SYNC_CONCURRENCY=4
MAX_ATTACHMENT_CHARS=12000
```

**`MICROSOFT_TENANT_ID` correction:** the recommended account model is single-tenant, so this should be our **tenant GUID**, not `common`. Use `common` only if we deliberately support personal + work/school accounts; use `organizations` for work/school across multiple tenants.

Per-user refresh tokens are never global env vars in production. They live in the encrypted per-user store described in Section 4.

---

## 14. Recommended Approach (Sequencing)

1. **Decide the account model** - single-tenant work/school recommended.
2. **Stand up Microsoft setup** - tenant/mailbox, Entra app registration, redirect URI, delegated scopes.
3. **Build Microsoft sign-in** - auth start/callback with `state`/PKCE, session/JWT, per-user encrypted token storage, refresh.
4. **Refactor provider boundaries** - neutral mail/calendar interfaces and types.
5. **Implement Graph adapters** - mail fetch, single fetch, conversation context, attachments, reply send, calendar search/create. Prototype the `$value` MIME reuse path first.
6. **Test on a real Microsoft mailbox.**
7. **Harden for MVP/production** - secret management, retry/throttling, logging, reconnect, and the Section 8 compliance review.

**Product decision:** keep Gmail support, make Microsoft the active provider for the new sign-in flow, and **do not remove Gmail until Outlook is validated end-to-end.**

---

## 15. Manager-Ready Summary

The Microsoft Outlook / Microsoft 365 migration is **feasible and classified Moderate**. The work is genuinely two things: a **new per-user identity capability** the app lacks today - sign-in, sessions, encrypted per-user token storage - and a **provider swap** to Microsoft Graph behind a neutral abstraction. The AI and attachment-parsing core carries over largely unchanged.

The first real dependency is **environment, not code**: at least one licensed Outlook mailbox and an Entra app registration. The previously assumed free developer tenant route should be treated as unavailable unless we already have a qualifying Visual Studio or Microsoft program entitlement, so budget should assume a small paid license cost to start.

**Effort:** Minimal sign-in POC is **1-2 weeks of engineering after Microsoft setup exists**; Business MVP is **4-8 calendar weeks**; production is **8-12+ calendar weeks**, gated by procurement, tenant policy, admin consent, security review, compliance, and UAT.

**Compliance is the cross-functional item:** business email content will be processed by **Google Gemini** as a Microsoft-to-Google cross-cloud flow. This intersects with privacy, retention, processor terms, applicable data protection obligations including DPDP Act, 2023, and Microsoft 365 data-residency commitments. **Microsoft 365 Copilot is not required.**

**Next steps for approval:** (1) confirm the account model, (2) authorize one licensed mailbox + Entra app-registration access, (3) approve the delegated Graph scopes, and (4) acknowledge the compliance note in Section 8.

---

## References

- App registration: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app
- Delegated auth (auth-code): https://learn.microsoft.com/en-us/graph/auth-v2-user
- OAuth 2.0 authorization code flow: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Permissions reference: https://learn.microsoft.com/en-us/graph/permissions-reference
- Mail API overview: https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview
- List messages: https://learn.microsoft.com/en-us/graph/api/user-list-messages
- Get message / MIME (`$value`): https://learn.microsoft.com/en-us/graph/api/message-get
- Immutable IDs: https://learn.microsoft.com/en-us/graph/outlook-immutable-id
- List attachments: https://learn.microsoft.com/en-us/graph/api/message-list-attachments
- Send mail: https://learn.microsoft.com/en-us/graph/api/user-sendmail
- Reply to message: https://learn.microsoft.com/en-us/graph/api/message-reply
- Create event: https://learn.microsoft.com/en-us/graph/api/user-post-events
- Throttling: https://learn.microsoft.com/en-us/graph/throttling
- Change notifications (webhooks): https://learn.microsoft.com/en-us/graph/change-notifications-overview
- MSAL for Node: https://learn.microsoft.com/en-us/entra/msal/javascript/node/
- Microsoft 365 Developer Program: https://learn.microsoft.com/en-us/office/developer-program/microsoft-365-developer-program
- Microsoft 365 Developer Program FAQ: https://learn.microsoft.com/en-us/office/developer-program/microsoft-365-developer-program-faq
- Microsoft 365 Business plans India pricing: https://www.microsoft.com/en-in/microsoft-365/business/microsoft-365-plans-and-pricing
- Microsoft 365 packaging and pricing updates: https://www.microsoft.com/en-us/licensing/news/2026-m365-packaging-pricing-updates
- Microsoft Trust Center data location: https://www.microsoft.com/en-in/trust-center/privacy/data-location
- DPDP Act, 2023: https://www.meity.gov.in/data-protection-framework
