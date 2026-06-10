import type { z } from "zod";
import type { emailPrioritySchema } from "../schemas/emailPriority.schema";

/**
 * Normalized representation of an email sender or recipient.
 */
export type EmailAddress = {
    name?: string;
    email?: string;
};

/**
 * Attachment payload accepted by the prioritization pipeline.
 *
 * Supports both raw `Buffer` content and base64-encoded strings so the same
 * parser can handle IMAP and API-style attachment sources.
 */
export type EmailAttachment = {
    id?: string;
    name?: string;
    filename?: string;
    contentType?: string;
    mimeType?: string;
    size?: number;
    content?: Buffer | string;
    contentBytes?: string;
};

/**
 * Internal email shape consumed by attachment parsing and AI prioritization.
 */
export type IncomingEmail = {
    id: string;
    subject?: string;
    from?: EmailAddress | string;
    receivedDateTime?: string;
    bodyPreview?: string;
    body?: string;
    importance?: string;
    hasAttachments?: boolean;
    attachments?: EmailAttachment[];
};

/**
 * Text extraction result for a single attachment.
 *
 * `parseStatus` lets the AI prompt distinguish usable text from unsupported or
 * failed parses without treating filenames alone as evidence.
 */
export type ParsedAttachment = {
    filename: string;
    mimeType: string;
    text: string;
    parseStatus: "parsed" | "skipped" | "failed";
    error?: string;
};

/**
 * Validated priority analysis returned by the AI prioritizer and API.
 */
export type PrioritizedEmail = z.infer<typeof emailPrioritySchema>;

/**
 * Complete prompt input for prioritizing one email.
 */
export type EmailForAi = {
    email: IncomingEmail;
    parsedAttachments: ParsedAttachment[];
};
