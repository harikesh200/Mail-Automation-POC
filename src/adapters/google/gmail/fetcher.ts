import { simpleParser, type AddressObject, type Attachment } from "mailparser";
import type { EmailSummary } from "../../../types/gmail.types";
import { createGmailClient, type GmailClient } from "./client";

const DEFAULT_MAX_RESULTS = 20;
const PREVIEW_LENGTH = 500;

/**
 * Converts MailParser address objects into a display string.
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
 * Resolves how many Gmail messages to request.
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
 * Fetches and parses a single Gmail message as raw MIME.
 */
async function fetchEmailSummaryById(
    gmail: GmailClient,
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
 */
export async function fetchEmailById(id: string): Promise<EmailSummary | null> {
    const gmail = createGmailClient();

    return fetchEmailSummaryById(gmail, id);
}

/**
 * Fetches all messages in a Gmail thread and parses them as email summaries.
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
