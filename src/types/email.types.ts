import type { z } from "zod";
import type { emailPrioritySchema } from "../schemas/emailPriority.schema";

export type EmailAddress = {
    name?: string;
    email?: string;
};

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

export type ParsedAttachment = {
    filename: string;
    mimeType: string;
    text: string;
    parseStatus: "parsed" | "skipped" | "failed";
    error?: string;
};

export type PrioritizedEmail = z.infer<typeof emailPrioritySchema>;

export type EmailForAi = {
    email: IncomingEmail;
    parsedAttachments: ParsedAttachment[];
};

