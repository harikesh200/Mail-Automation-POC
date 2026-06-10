# Gmail Email Prioritizer Backend

Node.js/TypeScript backend for ranking the latest Gmail emails as `High`, `Medium`, or `Low` priority.

## Architecture

- `src/mail.ts`: Existing Gmail IMAP fetcher. It exports `fetchLatestEmails()` and still runs as a standalone script when executed directly.
- `src/server.ts`: Express app bootstrapping.
- `src/routes/prioritize.routes.ts`: API route declarations.
- `src/controllers/prioritize.controller.ts`: HTTP request/response handling.
- `src/services/mailFetcher.integration.ts`: Adapts the existing Gmail fetcher output into the backend email shape.
- `src/services/emailPrioritizer.service.ts`: Orchestrates fetching, parsing, AI prioritization, fallback handling, and sorting.
- `src/services/attachmentParser.service.ts`: Parses supported attachments with LiteParse v2.
- `src/services/aiPrioritizer.service.ts`: Uses Vercel AI SDK structured object generation with `@ai-sdk/google`.
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
GOOGLE_GENERATIVE_AI_API_KEY=your_google_key
MAX_EMAILS_TO_PROCESS=20
MAX_ATTACHMENT_CHARS=12000
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
GMAIL_USER=your_gmail_address
GMAIL_APP_PASSWORD=your_gmail_app_password
```

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

Fetches the latest Gmail emails from `src/mail.ts`, processes up to `MAX_EMAILS_TO_PROCESS`, parses supported attachments, prioritizes each email with Gemini, applies fallback handling per email, and returns results sorted by score descending.

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

## Attachment Parsing

Supported formats include PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, ODT, ODS, and ODP. LiteParse can require LibreOffice for Office/OpenDocument files. If an attachment is unsupported or parsing fails, the request continues and the parser marks that attachment as `skipped` or `failed`.

Attachment content from `src/mail.ts` is passed as base64 (`contentBase64`) and adapted to `contentBytes` for the backend parser.

## Gmail Fetcher Integration

The backend is already wired to:

```ts
import { fetchLatestEmails as fetchGmailLatestEmails } from "../mail";
```

The adapter lives in `src/services/mailFetcher.integration.ts` and imports `fetchLatestEmails` from `src/mail.ts`.

## AI Provider

This backend uses Gemini through `@ai-sdk/google`.

Current model:

```ts
gemini-2.5-flash
```
