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

function getAttachmentFilename(attachment: EmailAttachment): string {
    return attachment.filename ?? attachment.name ?? "unnamed-attachment";
}

function getAttachmentMimeType(attachment: EmailAttachment): string {
    return (
        attachment.mimeType ??
        attachment.contentType ??
        "application/octet-stream"
    );
}

function getFileExtension(filename: string): string {
    const dotIndex = filename.lastIndexOf(".");
    return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
}

function isSupportedAttachment(filename: string, mimeType: string): boolean {
    return (
        supportedMimeTypes.has(mimeType) ||
        supportedExtensions.has(getFileExtension(filename))
    );
}

function isSpreadsheetAttachment(filename: string, mimeType: string): boolean {
    return (
        spreadsheetMimeTypes.has(mimeType) ||
        spreadsheetExtensions.has(getFileExtension(filename))
    );
}

function isDocxAttachment(filename: string, mimeType: string): boolean {
    return (
        docxMimeTypes.has(mimeType) ||
        docxExtensions.has(getFileExtension(filename))
    );
}

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

function limitText(text: string): string {
    return text.slice(0, env.MAX_ATTACHMENT_CHARS);
}

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

async function parseDocx(buffer: Buffer): Promise<string> {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
}

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

export async function parseAttachments(
    attachments: EmailAttachment[] = [],
): Promise<ParsedAttachment[]> {
    return Promise.all(
        attachments.map((attachment) => parseAttachment(attachment)),
    );
}
