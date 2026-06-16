# Gmail Email Prioritizer Backend

Node.js/TypeScript backend for ranking the latest Gmail emails as `High`, `Medium`, or `Low` priority.

## Architecture

- `src/mail.ts`: CLI-compatible Gmail fetch wrapper for `bun run fetch:gmail`.
- `src/server.ts`: Express app bootstrapping.
- `src/routes/prioritize.routes.ts`: API route declarations.
- `src/controllers/prioritize.controller.ts`: HTTP request/response handling.
- `src/adapters/google/gmail/client.ts`: Creates authenticated Gmail API clients.
- `src/adapters/google/gmail/fetcher.ts`: Fetches latest, single-message, and thread Gmail messages.
- `src/adapters/google/gmail/reply.ts`: Builds and sends plain-text Gmail replies.
- `src/adapters/google/calendar/events.ts`: Searches and creates Google Calendar events.
- `src/services/mailbox.service.ts`: Adapts Gmail messages into the backend email shape.
- `src/services/emailPrioritizer.service.ts`: Orchestrates fetching, parsing, AI prioritization, fallback handling, and sorting.
- `src/services/attachmentParser.service.ts`: Parses supported attachments with LiteParse v2.
- `src/services/aiPrioritizer.service.ts`: Uses Vercel AI SDK structured object generation with `@ai-sdk/google`.
- `src/services/aiDraftReply.service.ts`: Generates plain-text reply previews for frontend review.
- `src/services/emailReply.service.ts`: Orchestrates selected-message fetch, thread context, AI draft generation, and approved reply sending.
- `src/services/aiMeetingExtractor.service.ts`: Extracts auto-addable online meeting details from email context.
- `src/services/calendarSync.service.ts`: Orchestrates latest-email calendar sync with duplicate prevention.
- `src/schemas/emailPriority.schema.ts`: Zod validation for AI output and API response shape.
- `src/config/env.ts`: Environment variable validation.
- `src/middleware/errorHandler.ts`: Centralized error responses.

## Setup

```bash
bun install
cp .env.example .env
```

Set your environment variables in `.env`:

```bash
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:5173
GOOGLE_GENERATIVE_AI_API_KEY=your_google_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback
GOOGLE_REFRESH_TOKEN=your_google_refresh_token
MAX_EMAILS_TO_PROCESS=20
MAX_ATTACHMENT_CHARS=12000
```

Generate `GOOGLE_REFRESH_TOKEN` once after setting `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`:

```bash
bun run mail:auth
```

Open `http://localhost:3000`, authorize Gmail and Calendar access, then copy the
printed `GOOGLE_REFRESH_TOKEN` into `.env`.

Reply sending and calendar sync require the refresh token to include:

```bash
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/calendar.events
```

`CORS_ORIGIN` supports:
- `*` to allow all origins
- One origin URL (for example `http://localhost:5173`)
- Multiple origins separated by commas (for example `http://localhost:5173,https://app.example.com`)

Start the backend:

```bash
bun run dev
```

Type-check:

```bash
bun run typecheck
```

## Deploy to AWS Lambda with ECR

This backend can run on AWS Lambda as a container image without rewriting the
Express server. `Dockerfile` follows Bun's AWS Lambda deployment pattern: it
uses the Bun runtime, copies AWS Lambda Web Adapter into `/opt/extensions`,
starts `src/bootstrap.ts`, and listens on port `8080`. The bootstrap points
Lambda temp/cache paths at `/tmp` before loading the server.

Prerequisites:

- Docker installed and running.
- AWS CLI configured with credentials for the target account.
- An ECR repository and Lambda function in the same AWS Region.
- A Lambda execution role with the AWS managed `AWSLambdaBasicExecutionRole`
  policy attached.

Create the Lambda environment file:

```powershell
Copy-Item lambda-env.example.json lambda-env.json
```

Fill `lambda-env.json` with production values. Do not bake secrets into the
container image.

Recommended Lambda settings:

- Memory: `1024 MB` or higher.
- Timeout: `300` seconds.
- Ephemeral storage: `1024 MB` if parsing larger PDFs.
- `GMAIL_FETCH_CLIENT`: `googleapis` or `rest`.
- `LITEPARSE_TESSDATA_PATH`: `/opt/tessdata`.

Build the Lambda image locally:

```bash
bun run docker:lambda:build
```

Optionally test the container locally:

```bash
docker run --rm -p 3000:8080 --env-file .env -e NODE_ENV=production -e PORT=8080 mail-automation-poc-backend:local
```

Create or update the ECR image and Lambda function:

```powershell
.\scripts\deploy-lambda-ecr.ps1 `
  -Region ap-south-1 `
  -RepositoryName mail-automation-poc-backend `
  -FunctionName mail-automation-poc-backend `
  -RoleArn arn:aws:iam::<account-id>:role/<lambda-execution-role> `
  -EnvFile .\lambda-env.json `
  -EnableFunctionUrl
```

If your AWS CLI uses SSO or a named profile, add `-Profile <profile-name>`.

For later deployments to an existing function, `-RoleArn` is not required:

```powershell
.\scripts\deploy-lambda-ecr.ps1 `
  -Region ap-south-1 `
  -RepositoryName mail-automation-poc-backend `
  -FunctionName mail-automation-poc-backend `
  -EnvFile .\lambda-env.json
```

If you do not use `-EnableFunctionUrl`, expose the function through API Gateway
or another Lambda-supported HTTP integration. Lambda resolves image tags to an
image digest during deployment, so push a new image and run
`update-function-code` again for every backend release.

## API

### `GET /api/emails/prioritized`

Fetches the latest Gmail inbox emails through the Gmail API from `src/mail.ts`, processes up to `MAX_EMAILS_TO_PROCESS`, parses supported attachments, prioritizes each email with Gemini, applies fallback handling per email, and returns results sorted by score descending.

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

Generates a plain-text reply body for frontend review. This endpoint does not
create a Gmail draft and does not send anything.

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

Sends the final user-approved plain-text reply through Gmail. The backend fetches
the selected message again, addresses the reply to the original sender, and uses
Gmail thread metadata when available.

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

Scans recent inbox emails and automatically adds clear online meeting invitations
to the authenticated user's primary Google Calendar.

Calendar sync rules:

- Only creates an event when a clear meeting date and start time are present.
- Supports Google Meet, Zoom, and Microsoft Teams links.
- Adds the event only to the authenticated user's calendar.
- Does not add attendees.
- Does not send invite/update emails.
- Uses `Asia/Kolkata` when the email does not specify a timezone.
- Uses 30 minutes when the email does not specify an end time.
- Prevents duplicates by searching Calendar for `Source Gmail Message ID: <emailId>`.

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
      "reason": null
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

Supported formats include PDF, DOCX, XLS, XLSX, and ICS calendar files. PDF parsing uses LiteParse v2 with bundled English Tesseract data at `/opt/tessdata`; if OCR fails, the parser retries without OCR so text-based PDFs can still be parsed. If an attachment is unsupported or parsing fails, the request continues and the parser marks that attachment as `skipped` or `failed`.

Attachment content from `src/adapters/google/gmail/fetcher.ts` is passed as base64 (`contentBase64`) and adapted to `contentBytes` for the backend parser.

## Gmail Fetcher Integration

The adapter lives in `src/services/mailbox.service.ts` and lazy-loads
`fetchLatestEmails` from `src/adapters/google/gmail/fetcher.ts`. The fetcher can
use either the `googleapis` client or the lightweight REST client through
`GMAIL_FETCH_CLIENT`.

The Gmail integration services use OAuth credentials and a refresh token to call the Gmail API.
Prioritization needs Gmail readonly access. Reply sending needs `gmail.send`.
Calendar sync needs Calendar readonly/events scopes generated by `src/mailApi.ts`.

## AI Provider

This backend uses Gemini through `@ai-sdk/google`.

Current model:

```ts
gemini-2.5-flash
```
