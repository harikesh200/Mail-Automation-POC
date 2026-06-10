import { env } from "../config/env";
import type { EmailAttachment, ParsedAttachment } from "../types/email.types";
import { logger } from "../utils/logger";

const supportedMimeTypes = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
]);

const supportedExtensions = new Set([
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".odt",
    ".ods",
    ".odp",
]);
const spreadsheetMimeTypes = new Set([
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const spreadsheetExtensions = new Set([".xls", ".xlsx"]);
const docxMimeTypes = new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const docxExtensions = new Set([".docx"]);

/**
 * Returns a stable filename for parser output and logs.
 */
function getAttachmentFilename(attachment: EmailAttachment): string {
    return attachment.filename ?? attachment.name ?? "unnamed-attachment";
}

/**
 * Returns the best available MIME type for parser selection.
 */
function getAttachmentMimeType(attachment: EmailAttachment): string {
    return (
        attachment.mimeType ??
        attachment.contentType ??
        "application/octet-stream"
    );
}

/**
 * Extracts a lowercase file extension, including the leading dot.
 */
function getFileExtension(filename: string): string {
    const dotIndex = filename.lastIndexOf(".");
    return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
}

/**
 * Checks whether an attachment is eligible for text extraction.
 */
function isSupportedAttachment(filename: string, mimeType: string): boolean {
    return (
        supportedMimeTypes.has(mimeType) ||
        supportedExtensions.has(getFileExtension(filename))
    );
}

/**
 * Checks whether an attachment should be parsed through the spreadsheet path.
 */
function isSpreadsheetAttachment(filename: string, mimeType: string): boolean {
    return (
        spreadsheetMimeTypes.has(mimeType) ||
        spreadsheetExtensions.has(getFileExtension(filename))
    );
}

/**
 * Checks whether an attachment should be parsed through the DOCX path.
 */
function isDocxAttachment(filename: string, mimeType: string): boolean {
    return (
        docxMimeTypes.has(mimeType) ||
        docxExtensions.has(getFileExtension(filename))
    );
}

/**
 * Converts the supported attachment content encodings into a `Buffer`.
 */
function getAttachmentBuffer(attachment: EmailAttachment): Buffer | null {
    if (Buffer.isBuffer(attachment.content)) {
        return attachment.content;
    }

    if (typeof attachment.contentBytes === "string") {
        return Buffer.from(attachment.contentBytes, "base64");
    }

    if (typeof attachment.content === "string") {
        return Buffer.from(attachment.content, "base64");
    }

    return null;
}

/**
 * Truncates parsed attachment text to the configured AI prompt budget.
 */
function limitText(text: string): string {
    return text.slice(0, env.MAX_ATTACHMENT_CHARS);
}

/**
 * Extracts workbook sheets as CSV text.
 *
 * @param buffer - Spreadsheet file contents.
 * @returns CSV-like text grouped by sheet name.
 */
async function parseSpreadsheet(buffer: Buffer): Promise<string> {
    const xlsx = await import("xlsx");
    const workbook = xlsx.read(buffer, {
        type: "buffer",
        cellDates: true,
        raw: false,
    });

    return workbook.SheetNames.map((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
            return "";
        }

        const csv = xlsx.utils.sheet_to_csv(worksheet, {
            blankrows: false,
        });

        return [`Sheet: ${sheetName}`, csv].filter(Boolean).join("\n");
    })
        .filter(Boolean)
        .join("\n\n");
}

/**
 * Extracts raw text from a DOCX document.
 *
 * @param buffer - DOCX file contents.
 * @returns Plain text extracted from the document.
 */
async function parseDocx(buffer: Buffer): Promise<string> {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
}

/**
 * Parses a single attachment into text suitable for AI prioritization.
 *
 * Unsupported or unavailable attachments are marked as `skipped`; parser errors
 * are logged and marked as `failed` so one bad file does not fail the email.
 *
 * @param attachment - Attachment payload from the email source.
 * @returns A normalized parse result containing text or failure metadata.
 */
export async function parseAttachment(
    attachment: EmailAttachment,
): Promise<ParsedAttachment> {
    const filename = getAttachmentFilename(attachment);
    const mimeType = getAttachmentMimeType(attachment);

    if (!isSupportedAttachment(filename, mimeType)) {
        return {
            filename,
            mimeType,
            text: "",
            parseStatus: "skipped",
            error: "Unsupported attachment type.",
        };
    }

    const buffer = getAttachmentBuffer(attachment);
    if (!buffer) {
        return {
            filename,
            mimeType,
            text: "",
            parseStatus: "skipped",
            error: "Attachment content was not available.",
        };
    }

    try {
        if (isSpreadsheetAttachment(filename, mimeType)) {
            return {
                filename,
                mimeType,
                text: limitText(await parseSpreadsheet(buffer)),
                parseStatus: "parsed",
            };
        }

        if (isDocxAttachment(filename, mimeType)) {
            return {
                filename,
                mimeType,
                text: limitText(await parseDocx(buffer)),
                parseStatus: "parsed",
            };
        }

        const { LiteParse } = await import("@llamaindex/liteparse");
        const parser = new LiteParse({ quiet: true });
        const result = await parser.parse(buffer);

        return {
            filename,
            mimeType,
            text: limitText(result.text ?? ""),
            parseStatus: "parsed",
        };
    } catch (error) {
        logger.warn("Attachment parsing failed", {
            filename,
            message: error instanceof Error ? error.message : String(error),
        });

        return {
            filename,
            mimeType,
            text: "",
            parseStatus: "failed",
            error: "Attachment parsing failed.",
        };
    }
}

/**
 * Parses all attachments for one email concurrently.
 *
 * @param attachments - Attachments from an incoming email. Defaults to an empty list.
 * @returns Parse results in the same order as the input attachments.
 */
export async function parseAttachments(
    attachments: EmailAttachment[] = [],
): Promise<ParsedAttachment[]> {
    return Promise.all(
        attachments.map((attachment) => parseAttachment(attachment)),
    );
}
