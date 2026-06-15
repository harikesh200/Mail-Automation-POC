/**
 * Attachment summary returned by the Gmail fetcher.
 */
export type EmailAttachmentSummary = {
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

/**
 * Gmail send result returned after a reply is sent.
 */
export type SentEmailSummary = {
    id: string;
    threadId?: string | null;
};

export type SendReplyInput = {
    sourceEmail: EmailSummary;
    bodyText: string;
};
