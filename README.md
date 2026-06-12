# Gmail Email Prioritizer Backend

Node.js/TypeScript backend for ranking the latest Gmail emails as `High`, `Medium`, or `Low` priority.

## Architecture

- `src/mail.ts`: Gmail API fetcher. It exports `fetchLatestEmails()` and still runs as a standalone script when executed directly.
- `src/server.ts`: Express app bootstrapping.
- `src/routes/prioritize.routes.ts`: API route declarations.
- `src/controllers/prioritize.controller.ts`: HTTP request/response handling.
- `src/services/mailFetcher.integration.ts`: Adapts the existing Gmail fetcher output into the backend email shape.
- `src/services/emailPrioritizer.service.ts`: Orchestrates fetching, parsing, AI prioritization, fallback handling, and sorting.
- `src/services/attachmentParser.service.ts`: Parses supported attachments with LiteParse v2.
- `src/services/aiPrioritizer.service.ts`: Uses Vercel AI SDK structured object generation with `@ai-sdk/google`.
- `src/services/aiDraftReply.service.ts`: Generates plain-text reply previews for frontend review.
- `src/services/emailReply.service.ts`: Orchestrates selected-message fetch, thread context, AI draft generation, and approved reply sending.
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

Open `http://localhost:3000`, authorize Gmail read/send access, then copy the printed
`GOOGLE_REFRESH_TOKEN` into `.env`.

The reply send endpoint requires the refresh token to include:

```bash
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
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

## Attachment Parsing

Supported formats include PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, ODT, ODS, and ODP. LiteParse can require LibreOffice for Office/OpenDocument files. If an attachment is unsupported or parsing fails, the request continues and the parser marks that attachment as `skipped` or `failed`.

Attachment content from `src/mail.ts` is passed as base64 (`contentBase64`) and adapted to `contentBytes` for the backend parser.

## Gmail Fetcher Integration

The backend is already wired to:

```ts
import { fetchLatestEmails as fetchGmailLatestEmails } from "../mail";
```

The adapter lives in `src/services/mailFetcher.integration.ts` and imports `fetchLatestEmails` from `src/mail.ts`.

`src/mail.ts` uses OAuth credentials and a refresh token to call the Gmail API.
Prioritization needs readonly access. Reply sending needs the additional
`gmail.send` scope generated by `src/mailApi.ts`.

## AI Provider

This backend uses Gemini through `@ai-sdk/google`.

Current model:

```ts
gemini-2.5-flash
```
