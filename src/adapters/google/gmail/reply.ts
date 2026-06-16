import { env } from "../../../config/env";
import type {
    EmailSummary,
    SendReplyInput,
    SentEmailSummary,
} from "../../../types/gmail.types";
import { createGmailClient, type GmailClient } from "./client";

const googleRequestOptions = {
    timeout: env.GOOGLE_API_TIMEOUT_MS,
};

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
 * Returns the authenticated Gmail account email address for the From header.
 */
async function getAuthenticatedEmailAddress(
    gmail: GmailClient,
): Promise<string> {
    const response = await gmail.users.getProfile(
        {
            userId: "me",
        },
        googleRequestOptions,
    );

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
    gmail: GmailClient,
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
 */
export async function sendReply(input: SendReplyInput): Promise<SentEmailSummary> {
    const gmail = await createGmailClient();
    const mimeMessage = await buildReplyMimeMessage(gmail, input);
    const response = await gmail.users.messages.send(
        {
            userId: "me",
            requestBody: {
                raw: encodeBase64Url(mimeMessage),
                threadId: input.sourceEmail.threadId ?? undefined,
            },
        },
        googleRequestOptions,
    );

    if (!response.data.id) {
        throw new Error("Gmail did not return a sent message id.");
    }

    return {
        id: response.data.id,
        threadId: response.data.threadId,
    };
}
