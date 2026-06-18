import { simpleParser, type AddressObject, type Attachment } from "mailparser";
import type { EmailSummary } from "../../../types/gmail.types";

const PREVIEW_LENGTH = 500;

export type RawGmailMessage = {
    id?: string;
    threadId?: string;
    raw?: string;
    internalDate?: string | null;
};

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
 * Excludes inline related parts such as signature images from attachment logic.
 */
function isUserVisibleAttachment(attachment: Attachment): boolean {
    const contentDisposition = attachment.contentDisposition?.toLowerCase();
    const contentType = attachment.contentType.toLowerCase();

    if (attachment.related) {
        return false;
    }

    return !(
        contentDisposition === "inline" &&
        Boolean(attachment.cid) &&
        contentType.startsWith("image/")
    );
}

/**
 * Parses a raw Gmail MIME payload into the normalized summary shape.
 */
export async function parseRawGmailMessage(
    id: string,
    message: RawGmailMessage,
): Promise<EmailSummary | null> {
    if (!message.raw) {
        return null;
    }

    const parsed = await simpleParser(decodeBase64Url(message.raw));
    const text = parsed.text ?? "";
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
        textPreview: text.slice(0, PREVIEW_LENGTH),
        text,
        htmlLength: typeof parsed.html === "string" ? parsed.html.length : 0,
        attachments: parsed.attachments
            .filter(isUserVisibleAttachment)
            .map((attachment: Attachment) => ({
                filename: attachment.filename ?? null,
                contentType: attachment.contentType,
                size: attachment.size,
                contentBase64: attachment.content.toString("base64"),
            })),
    };
}

export function isEmailSummary(
    email: EmailSummary | null,
): email is EmailSummary {
    return email !== null;
}
