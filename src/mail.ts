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
 * Gmail send result returned after a reply is sent.
 */
export type SentEmailSummary = {
    id: string;
    threadId?: string | null;
};

/**
 * Parsed Gmail message returned by the Gmail API fetcher.
 */
export type EmailSummary = {
    id: string;
    threadId?: string | null;
    messageId?: string;
    references: string[];
    inReplyTo?: string;
    subject?: string;
    from?: string;
    to?: string;
    cc?: string;
    date?: Date;
    textPreview: string;
    text: string;
    htmlLength: number;
    attachments: EmailAttachmentSummary[];
};

export type SendReplyInput = {
    sourceEmail: EmailSummary;
    bodyText: string;
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
 * Normalizes MailParser references into a simple string array.
 */
function normalizeReferences(references: string | string[] | undefined): string[] {
    if (!references) {
        return [];
    }

    return Array.isArray(references) ? references : [references];
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
 * Encodes bytes for Gmail API raw message payloads.
 */
function encodeBase64Url(value: string): string {
    return Buffer.from(value)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

/**
 * Removes line breaks from header values to avoid MIME header injection.
 */
function sanitizeHeader(value: string): string {
    return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Encodes non-ASCII header values using an RFC 2047 encoded-word.
 */
function encodeHeaderValue(value: string): string {
    const sanitized = sanitizeHeader(value);

    if (/^[\x00-\x7F]*$/.test(sanitized)) {
        return sanitized;
    }

    return `=?UTF-8?B?${Buffer.from(sanitized).toString("base64")}?=`;
}

/**
 * Wraps MIME base64 body content at a conservative line length.
 */
function wrapBase64(value: string): string {
    return value.match(/.{1,76}/g)?.join("\r\n") ?? value;
}

/**
 * Adds a reply prefix only when the subject is not already a reply.
 */
function buildReplySubject(subject?: string): string {
    const value = sanitizeHeader(subject ?? "");

    if (!value) {
        return "Re:";
    }

    return /^re:/i.test(value) ? value : `Re: ${value}`;
}

/**
 * Builds References header values for Gmail thread association.
 */
function buildReplyReferences(email: EmailSummary): string[] {
    const references = [...email.references];

    if (email.messageId && !references.includes(email.messageId)) {
        references.push(email.messageId);
    }

    return references;
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
async function fetchEmailSummaryById(
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
        messageId: parsed.messageId,
        references: normalizeReferences(parsed.references),
        inReplyTo: parsed.inReplyTo,
        subject: parsed.subject,
        from: parsed.from?.text,
        to: getAddressText(parsed.to),
        cc: getAddressText(parsed.cc),
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

            return fetchEmailSummaryById(gmail, message.id);
        }),
    );

    return emails
        .filter(isEmailSummary)
        .sort((left, right) => {
            return (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0);
        });
}

/**
 * Fetches and parses a single Gmail message by id.
 *
 * @param id - Gmail message id.
 * @returns Parsed email summary, or `null` when Gmail returns no raw payload.
 */
export async function fetchEmailById(id: string): Promise<EmailSummary | null> {
    const gmail = createGmailClient();

    return fetchEmailSummaryById(gmail, id);
}

/**
 * Fetches all messages in a Gmail thread and parses them as email summaries.
 *
 * Thread metadata gives the message ids; each message is then fetched as raw
 * MIME so the same parser path is used everywhere.
 *
 * @param threadId - Gmail thread id.
 * @returns Parsed thread messages ordered oldest first.
 */
export async function fetchThreadEmails(
    threadId: string,
): Promise<EmailSummary[]> {
    const gmail = createGmailClient();
    const response = await gmail.users.threads.get({
        userId: "me",
        id: threadId,
        format: "metadata",
    });

    const messages = response.data.messages ?? [];
    const emails = await Promise.all(
        messages.map((message) => {
            if (!message.id) {
                return Promise.resolve(null);
            }

            return fetchEmailSummaryById(gmail, message.id);
        }),
    );

    return emails
        .filter(isEmailSummary)
        .sort((left, right) => {
            return (left.date?.getTime() ?? 0) - (right.date?.getTime() ?? 0);
        });
}

/**
 * Returns the authenticated Gmail account email address for the From header.
 */
async function getAuthenticatedEmailAddress(
    gmail: ReturnType<typeof createGmailClient>,
): Promise<string> {
    const response = await gmail.users.getProfile({
        userId: "me",
    });

    const emailAddress = response.data.emailAddress;
    if (!emailAddress) {
        throw new Error("Unable to resolve authenticated Gmail address.");
    }

    return emailAddress;
}

/**
 * Builds a plain-text MIME reply that Gmail can send through `messages.send`.
 */
async function buildReplyMimeMessage(
    gmail: ReturnType<typeof createGmailClient>,
    input: SendReplyInput,
): Promise<string> {
    const from = await getAuthenticatedEmailAddress(gmail);
    const to = input.sourceEmail.from;

    if (!to) {
        throw new Error("Cannot send reply because the source email has no sender.");
    }

    const references = buildReplyReferences(input.sourceEmail);
    const bodyBase64 = wrapBase64(
        Buffer.from(input.bodyText, "utf8").toString("base64"),
    );
    const headers = [
        `From: ${sanitizeHeader(from)}`,
        `To: ${sanitizeHeader(to)}`,
        `Subject: ${encodeHeaderValue(buildReplySubject(input.sourceEmail.subject))}`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
    ];

    if (input.sourceEmail.messageId) {
        headers.push(`In-Reply-To: ${sanitizeHeader(input.sourceEmail.messageId)}`);
    }

    if (references.length > 0) {
        headers.push(`References: ${references.map(sanitizeHeader).join(" ")}`);
    }

    return `${headers.join("\r\n")}\r\n\r\n${bodyBase64}`;
}

/**
 * Sends a plain-text Gmail reply to the source email's sender.
 *
 * Gmail receives the original thread id plus reply headers so the message stays
 * in the existing conversation when possible.
 *
 * @param input - Source email and final user-approved reply body.
 * @returns Sent Gmail message id and thread id.
 */
export async function sendReply(input: SendReplyInput): Promise<SentEmailSummary> {
    const gmail = createGmailClient();
    const mimeMessage = await buildReplyMimeMessage(gmail, input);
    const response = await gmail.users.messages.send({
        userId: "me",
        requestBody: {
            raw: encodeBase64Url(mimeMessage),
            threadId: input.sourceEmail.threadId ?? undefined,
        },
    });

    if (!response.data.id) {
        throw new Error("Gmail did not return a sent message id.");
    }

    return {
        id: response.data.id,
        threadId: response.data.threadId,
    };
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
