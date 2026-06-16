import type { IncomingEmail } from "../types/email.types";

/**
 * Parses a display sender string into the normalized email address shape.
 *
 * @param sender - Sender text from the Gmail MIME parser, usually `Name <email>`.
 * @returns Normalized sender details, or `undefined` when no sender was provided.
 */
function parseSender(sender?: string): IncomingEmail["from"] {
    if (!sender) {
        return undefined;
    }

    const match = sender.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
    if (!match) {
        return {
            name: sender,
            email: sender,
        };
    }

    return {
        name: match[1]?.trim() ?? "",
        email: match[2]?.trim() ?? "",
    };
}

/**
 * Parses a comma-separated display recipient string into normalized addresses.
 */
function parseRecipients(recipients?: string): IncomingEmail["to"] {
    if (!recipients) {
        return undefined;
    }

    return recipients.split(",").map((recipient) => {
        const parsed = parseSender(recipient.trim());

        if (!parsed || typeof parsed === "string") {
            return {
                name: recipient.trim(),
                email: recipient.trim(),
            };
        }

        return parsed;
    });
}

/**
 * Adapts Gmail API summaries into the internal prioritization email model.
 *
 * @returns Latest emails with attachment payloads mapped to parser-compatible fields.
 */
export async function fetchLatestEmails(): Promise<IncomingEmail[]> {
    const { fetchLatestEmails: fetchGmailLatestEmails } = await import(
        "../adapters/google/gmail/fetcher"
    );

    const emails = await fetchGmailLatestEmails();

    return emails.map((email) => ({
        id: email.id,
        threadId: email.threadId,
        messageId: email.messageId,
        references: email.references,
        inReplyTo: email.inReplyTo,
        subject: email.subject,
        from: parseSender(email.from),
        to: parseRecipients(email.to),
        cc: parseRecipients(email.cc),
        receivedDateTime: email.date?.toISOString(),
        bodyPreview: email.textPreview,
        body: email.text,
        importance: undefined,
        hasAttachments: email.attachments.length > 0,
        attachments: email.attachments.map((attachment) => ({
            name: attachment.filename ?? undefined,
            filename: attachment.filename ?? undefined,
            contentType: attachment.contentType,
            mimeType: attachment.contentType,
            size: attachment.size,
            contentBytes: attachment.contentBase64,
        })),
    }));
}
