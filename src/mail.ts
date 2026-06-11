import dotenv from "dotenv";
import { google } from "googleapis";
import { simpleParser, type AddressObject, type Attachment } from "mailparser";

dotenv.config();

const REQUIRED_ENV_VARS = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "GOOGLE_REFRESH_TOKEN",
] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

const DEFAULT_MAX_RESULTS = 20;
const PREVIEW_LENGTH = 500;

/**
 * Reads a required environment variable and fails fast when it is missing.
 *
 * @param name - Required environment variable name.
 * @returns The configured environment value.
 * @throws When the variable is unset or empty.
 */
function requireEnv(name: RequiredEnvVar): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

/**
 * Attachment summary returned by the standalone Gmail fetcher.
 */
type EmailAttachmentSummary = {
    filename: string | null;
    contentType: string;
    size: number;
    contentBase64: string;
};

/**
 * Parsed Gmail message returned by the Gmail API fetcher.
 */
export type EmailSummary = {
    id: string;
    threadId?: string | null;
    subject?: string;
    from?: string;
    to?: string;
    date?: Date;
    textPreview: string;
    text: string;
    htmlLength: number;
    attachments: EmailAttachmentSummary[];
};

/**
 * Converts MailParser address objects into a display string.
 *
 * @param address - Parsed sender or recipient address data.
 * @returns A comma-separated address string, or `undefined` when absent.
 */
function getAddressText(
    address: AddressObject | AddressObject[] | undefined,
): string | undefined {
    if (!address) {
        return undefined;
    }

    if (Array.isArray(address)) {
        return address.map((item) => item.text).join(", ");
    }

    return address.text;
}

/**
 * Decodes Gmail API base64url strings into RFC 822 message bytes.
 */
function decodeBase64Url(value: string): Buffer {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
        Math.ceil(normalized.length / 4) * 4,
        "=",
    );

    return Buffer.from(padded, "base64");
}

/**
 * Resolves how many Gmail messages to request.
 *
 * The prioritizer processes at most 20 emails, so the fetcher keeps the same
 * upper bound and defaults to 20 when the environment value is absent.
 */
function getMaxResults(): number {
    const rawValue = process.env.MAX_EMAILS_TO_PROCESS;
    if (!rawValue) {
        return DEFAULT_MAX_RESULTS;
    }

    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
        return DEFAULT_MAX_RESULTS;
    }

    return Math.min(Math.trunc(value), DEFAULT_MAX_RESULTS);
}

/**
 * Creates an authenticated Gmail API client using a stored OAuth refresh token.
 */
function createGmailClient() {
    const oauth2Client = new google.auth.OAuth2(
        requireEnv("GOOGLE_CLIENT_ID"),
        requireEnv("GOOGLE_CLIENT_SECRET"),
        requireEnv("GOOGLE_REDIRECT_URI"),
    );

    oauth2Client.setCredentials({
        refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN"),
    });

    return google.gmail({
        version: "v1",
        auth: oauth2Client,
    });
}

/**
 * Fetches and parses a single Gmail message as raw MIME.
 */
async function fetchEmailById(
    gmail: ReturnType<typeof createGmailClient>,
    id: string,
): Promise<EmailSummary | null> {
    const response = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "raw",
    });
    const message = response.data;

    if (!message.raw) {
        return null;
    }

    const parsed = await simpleParser(decodeBase64Url(message.raw));
    const text = parsed.text ?? "";
    const textPreview = text.slice(0, PREVIEW_LENGTH);
    const htmlLength = typeof parsed.html === "string" ? parsed.html.length : 0;
    const internalDate = message.internalDate
        ? new Date(Number(message.internalDate))
        : undefined;

    return {
        id,
        threadId: message.threadId,
        subject: parsed.subject,
        from: parsed.from?.text,
        to: getAddressText(parsed.to),
        date: parsed.date ?? internalDate,
        textPreview,
        text,
        htmlLength,
        attachments: parsed.attachments.map((attachment: Attachment) => ({
            filename: attachment.filename ?? null,
            contentType: attachment.contentType,
            size: attachment.size,
            contentBase64: attachment.content.toString("base64"),
        })),
    };
}

function isEmailSummary(email: EmailSummary | null): email is EmailSummary {
    return email !== null;
}

/**
 * Fetches and parses the latest Gmail inbox messages through the Gmail API.
 *
 * Reads up to the latest 20 inbox messages, extracts plain text, creates a
 * short text preview, and base64-encodes attachment bodies for downstream
 * parsing.
 *
 * @returns Email summaries ordered newest first.
 * @throws When required Gmail API configuration is missing or the API request fails.
 */
export async function fetchLatestEmails(): Promise<EmailSummary[]> {
    const gmail = createGmailClient();
    const messageList = await gmail.users.messages.list({
        userId: "me",
        labelIds: ["INBOX"],
        maxResults: getMaxResults(),
    });

    const messages = messageList.data.messages ?? [];
    const emails = await Promise.all(
        messages.map((message) => {
            if (!message.id) {
                return Promise.resolve(null);
            }

            return fetchEmailById(gmail, message.id);
        }),
    );

    return emails
        .filter(isEmailSummary)
        .sort((left, right) => {
            return (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0);
        });
}

if (import.meta.main) {
    fetchLatestEmails()
        .then((emails) => {
            console.log(JSON.stringify(emails, null, 2));
        })
        .catch((error) => {
            console.error("Failed to fetch emails:", error);
        });
}
