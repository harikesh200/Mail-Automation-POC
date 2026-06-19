# Mail Automation POC Backend

Node.js/TypeScript backend for a single-user Gmail automation proof of concept.

The backend currently:

- Fetches recent Gmail inbox messages.
- Parses supported attachments.
- Uses Gemini to prioritize emails as `High`, `Medium`, or `Low`.
- Generates plain-text reply drafts for frontend review.
- Sends user-approved replies through Gmail.
- Extracts clear online meeting details from emails and attachments.
- Creates matching events in the authenticated user's Google Calendar.
- Runs locally with Bun/Express or as an AWS Lambda container image.

## Current Scope

This is currently a **single configured Google account** backend. Gmail and Google Calendar access are driven by one Google OAuth refresh token stored in runtime configuration.

It does **not** currently include:

- Multi-user sign-in.
- Per-user token storage.
- Microsoft Outlook / Microsoft 365 support.
- Provider selection between Gmail and Outlook.
- Persistent application database.

The Microsoft Outlook / Microsoft 365 migration proposal is documented in:

- `OUTLOOK_M365_MIGRATION_PROPOSAL.md`

## Tech Stack

- Runtime: Bun
- Server: Express 5
- Language: TypeScript
- Validation: Zod
- Logging: Pino
- Mail/calendar provider: Gmail API + Google Calendar API via `googleapis`
- AI provider: Gemini via Vercel AI SDK and `@ai-sdk/google`
- Attachment parsing: LiteParse, Mammoth, XLSX, text/ICS parsing
- Deployment target: AWS Lambda container image with AWS Lambda Web Adapter

## Runtime Flow

### Email Prioritization

1. `GET /api/emails/prioritized` calls `prioritizeLatestEmails`.
2. `mailbox.service.ts` fetches latest Gmail messages through the Gmail adapter.
3. Gmail messages are normalized into `IncomingEmail`.
4. Attachments are parsed where supported.
5. Gemini scores and explains each email.
6. Failures are isolated per email and fall back to deterministic priority logic.
7. Results are sorted by score and recency.

### Draft Reply

1. `POST /api/emails/:emailId/draft-reply` loads the selected email.
2. If available, recent thread context is fetched.
3. Gemini generates a plain-text reply body.
4. The backend returns the reply text only; it does not create a Gmail draft.

### Send Reply

1. `POST /api/emails/:emailId/reply/send` loads the selected email and thread context.
2. The backend builds a plain-text MIME reply.
3. Gmail sends the reply using the authenticated account.
4. Gmail thread metadata is used when available.

### Calendar Sync

1. `POST /api/emails/calendar/sync` fetches recent emails.
2. Attachments are parsed.
3. Gemini extracts one clear online meeting candidate when safe.
4. The service checks Google Calendar for existing matching events.
5. It creates a primary-calendar event only when a clear meeting date/time/link exists.

## Source Map

### Entry Points

- `src/server.ts`: Express app, CORS, health routes, API routers, error handling.
- `src/bootstrap.ts`: Lambda-safe bootstrap that moves temp/cache paths to `/tmp` before loading the server.
- `src/mail.ts`: CLI-compatible Gmail fetch/reply wrapper for development.
- `src/mailApi.ts`: Local Google OAuth helper that prints a `GOOGLE_REFRESH_TOKEN`.

### Routes and Controllers

- `src/routes/prioritize.routes.ts`: `GET /api/emails/prioritized`.
- `src/routes/emailReply.routes.ts`: reply draft/send routes.
- `src/routes/calendarSync.routes.ts`: calendar sync route.
- `src/controllers/prioritize.controller.ts`: prioritized email HTTP handler.
- `src/controllers/emailReply.controller.ts`: reply draft/send HTTP handlers.
- `src/controllers/calendarSync.controller.ts`: calendar sync HTTP handler.

### Google Adapters

- `src/adapters/google/gmail/client.ts`: authenticated Gmail API client.
- `src/adapters/google/gmail/fetcher.ts`: public Gmail fetch API.
- `src/adapters/google/gmail/googleapisFetcher.ts`: Gmail list/get/thread API calls.
- `src/adapters/google/gmail/messageParser.ts`: raw Gmail MIME parsing through `mailparser`.
- `src/adapters/google/gmail/reply.ts`: MIME reply construction and Gmail send.
- `src/adapters/google/calendar/events.ts`: Google Calendar search and event creation.

### Services

- `src/services/mailbox.service.ts`: adapts Gmail summaries into the internal `IncomingEmail` model.
- `src/services/emailPrioritizer.service.ts`: fetch, parse, AI prioritize, fallback, sort.
- `src/services/attachmentParser.service.ts`: extracts text from supported attachments.
- `src/services/aiPrioritizer.service.ts`: Gemini structured output for priority analysis.
- `src/services/fallbackPriority.service.ts`: safe deterministic priority result when AI/parsing fails.
- `src/services/aiDraftReply.service.ts`: Gemini-generated plain-text reply body.
- `src/services/emailReply.service.ts`: selected email/thread loading, AI draft generation, approved reply send.
- `src/services/aiMeetingExtractor.service.ts`: Gemini extraction of meeting candidates.
- `src/services/calendarSync.service.ts`: email-to-calendar sync orchestration and duplicate prevention.

### Shared Code

- `src/config/env.ts`: runtime environment validation and coercion.
- `src/types/email.types.ts`: provider-normalized email and priority types.
- `src/types/gmail.types.ts`: Gmail adapter email/reply types.
- `src/schemas/*.ts`: API request/response and AI output schemas.
- `src/utils/concurrency.ts`: bounded concurrency helper.
- `src/utils/httpError.ts`: HTTP error type.
- `src/utils/logger.ts`: Pino logger.
- `src/utils/scoring.ts`: priority sorting and score helpers.

## Setup

### Prerequisites

- Bun installed.
- Google Cloud OAuth client configured for Gmail and Calendar scopes.
- Gemini API key.
- Gmail account authorized through the local OAuth helper.

Install dependencies:

```bash
bun install
```

Create local environment:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

## Environment Variables

Required for local use:

```env
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:5173

GOOGLE_GENERATIVE_AI_API_KEY=your_google_gemini_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback
GOOGLE_REFRESH_TOKEN=your_google_refresh_token

MAX_EMAILS_TO_PROCESS=20
GMAIL_MESSAGE_FETCH_CONCURRENCY=10
EMAIL_PRIORITIZATION_CONCURRENCY=5
ATTACHMENT_PARSE_CONCURRENCY=1
CALENDAR_SYNC_CONCURRENCY=4
MAX_ATTACHMENT_CHARS=12000
GOOGLE_API_TIMEOUT_MS=10000

LITEPARSE_OCR_ENABLED=true
LITEPARSE_OCR_LANGUAGE=eng
LITEPARSE_OCR_SERVER_URL=
LITEPARSE_TESSDATA_PATH=
LITEPARSE_MAX_PAGES=20
LITEPARSE_NUM_WORKERS=1
```

### Important Env Notes

- `GOOGLE_REFRESH_TOKEN` must include Gmail read, Gmail send, Calendar read, and Calendar event scopes for full functionality.
- `MAX_EMAILS_TO_PROCESS` is capped at 20 by `src/config/env.ts`.
- `GMAIL_MESSAGE_FETCH_CONCURRENCY`, `EMAIL_PRIORITIZATION_CONCURRENCY`, and `CALENDAR_SYNC_CONCURRENCY` should be kept conservative in Lambda.
- `LITEPARSE_TESSDATA_PATH` should be `/opt/tessdata` in the Docker/Lambda image.
- `CORS_ORIGIN` supports `*`, one origin, or comma-separated origins.
- Do not commit real `.env` files or OAuth tokens.

## Google OAuth Token Setup

Generate `GOOGLE_REFRESH_TOKEN` after setting:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

Run:

```bash
bun run mail:auth
```

Open the printed local URL, authorize Gmail and Calendar access, then copy the printed `GOOGLE_REFRESH_TOKEN` into `.env`.

Required Google scopes:

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/calendar.events
```

If new scopes are added later, remove the app from Google Account third-party access and regenerate the refresh token.

## Commands

```bash
bun run dev
```

Starts the Express server in watch mode.

```bash
bun run start
```

Starts the Lambda-compatible bootstrap.

```bash
bun run typecheck
```

Runs TypeScript type checking.

```bash
bun run fetch:gmail
```

Runs the Gmail fetch development wrapper.

```bash
bun run mail:auth
```

Runs the Google OAuth refresh-token helper.

```bash
bun run docker:lambda:build
```

Builds the local AWS Lambda container image.

## API

Base path:

```text
/api
```

Health routes:

```text
GET /
GET /health
```

Both return:

```json
{
  "success": true,
  "status": "ok"
}
```

### `GET /api/emails/prioritized`

Fetches the latest Gmail inbox emails, parses supported attachments, prioritizes each email with Gemini, applies per-email fallback handling, and returns sorted results.

Example response:

```json
{
  "success": true,
  "count": 1,
  "emails": [
    {
      "emailId": "571",
      "subject": "Proposal approval needed today",
      "from": {
        "name": "Asha Rao",
        "email": "asha@example.com"
      },
      "receivedDateTime": "2026-06-10T09:30:00.000Z",
      "priority": "High",
      "score": 8,
      "reasoning": "The email requests approval today and includes a proposal with business impact.",
      "suggestedAction": "Review the proposal and respond with approval or questions today.",
      "category": "Business Proposal",
      "deadlineDetected": "Today",
      "attachmentInsights": [
        {
          "filename": "proposal.docx",
          "summary": "Proposal document outlining scope, pricing, and delivery timeline.",
          "keyRisks": ["Approval delay may affect delivery timeline"],
          "keyDates": ["Today"],
          "financialImpact": "Pricing terms are included in the proposal."
        }
      ]
    }
  ]
}
```

### `POST /api/emails/:emailId/draft-reply`

Generates a plain-text reply body for frontend review. This endpoint does not create a Gmail draft and does not send anything.

Example request:

```json
{
  "instructions": "Politely confirm that we will review and respond tomorrow.",
  "tone": "professional"
}
```

Both fields are optional.

Example response:

```json
{
  "success": true,
  "emailId": "18f...",
  "threadId": "18f...",
  "isThread": true,
  "reply": {
    "bodyText": "Hi Asha,\n\nThanks for sharing this. We will review it and get back to you tomorrow.\n\nRegards,"
  }
}
```

### `POST /api/emails/:emailId/reply/send`

Sends the final user-approved plain-text reply through Gmail. The backend fetches the selected message again, addresses the reply to the original sender, and uses Gmail thread metadata when available.

Example request:

```json
{
  "bodyText": "Hi Asha,\n\nThanks for sharing this. We will review it and get back to you tomorrow.\n\nRegards,"
}
```

Example response:

```json
{
  "success": true,
  "emailId": "18f...",
  "threadId": "18f...",
  "isThread": true,
  "sentMessageId": "190..."
}
```

### `POST /api/emails/calendar/sync`

Scans recent inbox emails and automatically adds clear online meeting invitations to the authenticated user's primary Google Calendar.

Rules:

- Only creates an event when a clear meeting date and start time are present.
- Supports Google Meet, Zoom, and Microsoft Teams links.
- Adds the event only to the authenticated user's primary calendar.
- Does not add attendees.
- Does not send invite/update emails.
- Uses `Asia/Kolkata` when the email does not specify a timezone.
- Uses 30 minutes when the email does not specify an end time.
- Prevents duplicates by searching Calendar for `Source Gmail Message ID: <emailId>` and by matching meeting details.

Example response:

```json
{
  "success": true,
  "count": 3,
  "results": [
    {
      "emailId": "18f...",
      "status": "created",
      "eventId": "calendar-event-id",
      "reason": null
    },
    {
      "emailId": "18e...",
      "status": "already_exists",
      "eventId": "existing-calendar-event-id",
      "reason": "Matching event already exists in Google Calendar."
    },
    {
      "emailId": "18d...",
      "status": "skipped",
      "eventId": null,
      "reason": "No clear meeting date and start time found."
    }
  ]
}
```

## Attachment Parsing

Supported attachment families:

- PDF
- DOC/DOCX
- XLS/XLSX
- PPT/PPTX
- ODT/ODS/ODP
- ICS/calendar files
- TXT/CSV/JSON

Parser behavior:

- Spreadsheet files are converted to CSV-like text.
- DOCX files are parsed with Mammoth.
- ICS files are read as calendar text.
- Text-like files are decoded as UTF-8.
- Other supported document formats use LiteParse.
- PDF parsing uses LiteParse with OCR when enabled.
- OCR initialization failures are retried without OCR.
- Unsupported, unavailable, or failed attachments are marked as `skipped` or `failed`; one bad attachment does not fail the whole request.
- Parsed attachment text is capped by `MAX_ATTACHMENT_CHARS`.

## AI Provider

This backend uses Gemini through `@ai-sdk/google`.

Current model:

```ts
gemini-2.5-flash
```

AI is used for:

- Email prioritization.
- Attachment insight generation.
- Draft reply generation.
- Meeting detail extraction.

## AWS Lambda Deployment

This backend can run on AWS Lambda as a container image without rewriting the Express server.

The Docker image:

- Uses Bun.
- Copies AWS Lambda Web Adapter into `/opt/extensions`.
- Installs English Tesseract data into `/opt/tessdata`.
- Starts `src/bootstrap.ts`.
- Listens on port `8080`.
- Uses `/health` as the Lambda Web Adapter readiness check.
- Redirects temp/cache paths to `/tmp` when running in Lambda.

### Prerequisites

- Docker installed and running.
- AWS CLI configured with credentials for the target account.
- ECR repository and Lambda function in the same AWS Region.
- Lambda execution role with `AWSLambdaBasicExecutionRole`.

Create Lambda env file:

```powershell
Copy-Item lambda-env.example.json lambda-env.json
```

Fill `lambda-env.json` with production values. Do not bake secrets into the container image.

Recommended Lambda settings:

- Memory: `1024 MB` or higher.
- Timeout: `300` seconds.
- Ephemeral storage: `1024 MB` if parsing larger PDFs.
- `LITEPARSE_TESSDATA_PATH`: `/opt/tessdata`.

Build image:

```bash
bun run docker:lambda:build
```

Optional local container test:

```bash
docker run --rm -p 3000:8080 --env-file .env -e NODE_ENV=production -e PORT=8080 mail-automation-poc-backend:local
```

Create or update ECR image and Lambda function:

```powershell
.\scripts\deploy-lambda-ecr.ps1 `
  -Region ap-south-1 `
  -RepositoryName mail-automation-poc-backend `
  -FunctionName mail-automation-poc-backend `
  -RoleArn arn:aws:iam::<account-id>:role/<lambda-execution-role> `
  -EnvFile .\lambda-env.json `
  -EnableFunctionUrl
```

For later deployments to an existing function, `-RoleArn` is not required:

```powershell
.\scripts\deploy-lambda-ecr.ps1 `
  -Region ap-south-1 `
  -RepositoryName mail-automation-poc-backend `
  -FunctionName mail-automation-poc-backend `
  -EnvFile .\lambda-env.json `
  -EnableFunctionUrl
```

If using AWS SSO or a named profile, add:

```powershell
-Profile <profile-name>
```

When `-EnableFunctionUrl` is used, the script also applies Function URL CORS from `CORS_ORIGIN`. If not using Function URLs, expose the Lambda through API Gateway or another HTTP integration.

Lambda resolves image tags to image digests during deployment. Push a new image and run `update-function-code` for each backend release.

## Operational Notes

- This backend is stateless except for external Google OAuth/API state.
- There is no database.
- There is no persistent queue.
- All API workflows are request-driven.
- Per-email fallback handling prevents one failing email from failing an entire prioritization response.
- Concurrency knobs should be tuned based on Lambda memory, timeout, API quotas, and attachment sizes.

## Current Limitations

- Single Google account only.
- No user authentication layer.
- No per-user mailbox isolation.
- No Microsoft Graph support yet.
- No real Gmail draft creation; draft replies are generated as API responses only.
- Calendar sync creates events only on the authenticated Google Calendar.
- Calendar sync does not add attendees and does not send invite/update emails.
- Attachment parsing is best-effort and text-oriented.
- Large/complex attachments may be skipped, truncated, or fail parsing.

## Related Documents

- `OUTLOOK_M365_MIGRATION_PROPOSAL.md`: manager-ready proposal for adding Microsoft sign-in and Outlook/Microsoft 365 support.
