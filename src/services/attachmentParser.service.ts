import { env } from "../config/env";
import type { EmailAttachment, ParsedAttachment } from "../types/email.types";
import { logger } from "../utils/logger";
import { mapWithConcurrency } from "../utils/concurrency";

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
    "text/calendar",
    "application/ics",
    "text/plain",
    "text/csv",
    "application/csv",
    "application/json",
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
    ".ics",
    ".txt",
    ".csv",
    ".json",
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
const calendarMimeTypes = new Set(["text/calendar", "application/ics"]);
const calendarExtensions = new Set([".ics"]);
const plainTextMimeTypes = new Set([
    "text/plain",
    "text/csv",
    "application/csv",
    "application/json",
]);
const plainTextExtensions = new Set([".txt", ".csv", ".json"]);

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
    const mimeType =
        attachment.mimeType ??
        attachment.contentType ??
        "application/octet-stream";

    return normalizeMimeType(mimeType);
}

/**
 * Normalizes MIME values that may include parameters or uppercase letters.
 */
function normalizeMimeType(mimeType: string): string {
    return (
        mimeType.split(";")[0]?.trim().toLowerCase() ||
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
 * Checks whether an attachment contains iCalendar text.
 */
function isCalendarAttachment(filename: string, mimeType: string): boolean {
    return (
        calendarMimeTypes.has(mimeType) ||
        calendarExtensions.has(getFileExtension(filename))
    );
}

/**
 * Checks whether an attachment can be decoded as UTF-8 text directly.
 */
function isPlainTextAttachment(filename: string, mimeType: string): boolean {
    return (
        plainTextMimeTypes.has(mimeType) ||
        plainTextExtensions.has(getFileExtension(filename))
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
 * Creates a parsed result only when extraction returned usable text.
 */
function buildParsedAttachmentResult(
    filename: string,
    mimeType: string,
    text: string,
): ParsedAttachment {
    const limitedText = limitText(text).trim();

    if (!limitedText) {
        return {
            filename,
            mimeType,
            text: "",
            parseStatus: "skipped",
            error: "No extractable attachment text was found.",
        };
    }

    return {
        filename,
        mimeType,
        text: limitedText,
        parseStatus: "parsed",
    };
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
 * Extracts readable iCalendar text for meeting date/link detection.
 */
function parseCalendarAttachment(buffer: Buffer): string {
    return buffer.toString("utf8");
}

/**
 * Extracts UTF-8 text from simple text-like attachments.
 */
function parsePlainTextAttachment(buffer: Buffer): string {
    return buffer.toString("utf8");
}

function getLiteParseConfig(ocrEnabled: boolean) {
    return {
        quiet: true,
        ocrEnabled,
        ocrLanguage: env.LITEPARSE_OCR_LANGUAGE,
        ocrServerUrl: env.LITEPARSE_OCR_SERVER_URL,
        tessdataPath: env.LITEPARSE_TESSDATA_PATH,
        maxPages: env.LITEPARSE_MAX_PAGES,
        numWorkers: env.LITEPARSE_NUM_WORKERS,
    };
}

function isOcrInitializationError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);

    return /ocr|builder|tesseract|tessdata/i.test(message);
}

async function parseWithLiteParse(buffer: Buffer): Promise<string> {
    const { LiteParse } = await import("@llamaindex/liteparse");
    const parser = new LiteParse(getLiteParseConfig(env.LITEPARSE_OCR_ENABLED));

    try {
        const result = await parser.parse(buffer);
        return result.text ?? "";
    } catch (error) {
        if (!env.LITEPARSE_OCR_ENABLED || !isOcrInitializationError(error)) {
            throw error;
        }

        logger.warn("LiteParse OCR failed; retrying without OCR", {
            message: error instanceof Error ? error.message : String(error),
        });

        const fallbackParser = new LiteParse(getLiteParseConfig(false));
        const fallbackResult = await fallbackParser.parse(buffer);
        return fallbackResult.text ?? "";
    }
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
    const fileExtension = getFileExtension(filename);

    if (!isSupportedAttachment(filename, mimeType)) {
        logger.debug("Attachment skipped because type is unsupported", {
            filename,
            mimeType,
            fileExtension,
            size: attachment.size,
        });

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
        logger.debug("Attachment skipped because content is unavailable", {
            filename,
            mimeType,
            fileExtension,
            size: attachment.size,
        });

        return {
            filename,
            mimeType,
            text: "",
            parseStatus: "skipped",
            error: "Attachment content was not available.",
        };
    }

    try {
        let text: string;

        if (isSpreadsheetAttachment(filename, mimeType)) {
            text = await parseSpreadsheet(buffer);
        } else if (isDocxAttachment(filename, mimeType)) {
            text = await parseDocx(buffer);
        } else if (isCalendarAttachment(filename, mimeType)) {
            text = parseCalendarAttachment(buffer);
        } else if (isPlainTextAttachment(filename, mimeType)) {
            text = parsePlainTextAttachment(buffer);
        } else {
            text = await parseWithLiteParse(buffer);
        }

        const result = buildParsedAttachmentResult(filename, mimeType, text);

        logger.debug("Attachment parsing completed", {
            filename,
            mimeType,
            fileExtension,
            size: attachment.size,
            parseStatus: result.parseStatus,
            textChars: result.text.length,
        });

        return result;
    } catch (error) {
        logger.warn("Attachment parsing failed", {
            filename,
            mimeType,
            fileExtension,
            size: attachment.size,
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
    return mapWithConcurrency(
        attachments,
        env.ATTACHMENT_PARSE_CONCURRENCY,
        (attachment) => parseAttachment(attachment),
    );
}
