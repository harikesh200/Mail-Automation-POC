import dotenv from "dotenv";
import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject, type Attachment } from "mailparser";

dotenv.config();

const REQUIRED_ENV_VARS = [
    "IMAP_HOST",
    "IMAP_PORT",
    "GMAIL_USER",
    "GMAIL_APP_PASSWORD",
] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

function requireEnv(name: RequiredEnvVar): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

const imapPort = Number(requireEnv("IMAP_PORT"));
if (!Number.isFinite(imapPort) || imapPort <= 0) {
    throw new Error("IMAP_PORT must be a valid positive number");
}

type EmailAttachmentSummary = {
    filename: string | null;
    contentType: string;
    size: number;
    contentBase64: string;
};

export type EmailSummary = {
    uid: number;
    subject?: string;
    from?: string;
    to?: string;
    date?: Date;
    textPreview: string;
    text: string;
    htmlLength: number;
    attachments: EmailAttachmentSummary[];
};

const PREVIEW_LENGTH = 500;

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

function createClient(): ImapFlow {
    return new ImapFlow({
        host: requireEnv("IMAP_HOST"),
        port: imapPort,
        secure: true,
        logger: false,
        auth: {
            user: requireEnv("GMAIL_USER"),
            pass: requireEnv("GMAIL_APP_PASSWORD"),
        },
    });
}

export async function fetchLatestEmails(): Promise<EmailSummary[]> {
    const client = createClient();

    await client.connect();

    const lock = await client.getMailboxLock("INBOX");

    try {
        const mailbox = client.mailbox;
        if (!mailbox) {
            return [];
        }
        const totalMessages = mailbox.exists;

        const start = Math.max(1, totalMessages - 19);
        const range = `${start}:*`;

        const emails: EmailSummary[] = [];

        for await (const message of client.fetch(range, {
            envelope: true,
            source: true,
            flags: true,
        })) {
            if (!message.source) {
                continue;
            }

            const parsed = await simpleParser(message.source);
            const text = parsed.text ?? "";
            const textPreview = text.slice(0, PREVIEW_LENGTH);
            const htmlLength =
                typeof parsed.html === "string" ? parsed.html.length : 0;

            emails.push({
                uid: message.uid,
                subject: parsed.subject,
                from: parsed.from?.text,
                to: getAddressText(parsed.to),
                date: parsed.date,
                textPreview,
                text,
                htmlLength,
                attachments: parsed.attachments.map(
                    (attachment: Attachment) => ({
                        filename: attachment.filename ?? null,
                        contentType: attachment.contentType,
                        size: attachment.size,
                        contentBase64: attachment.content.toString("base64"),
                    }),
                ),
            });
        }

        return emails.reverse();
    } finally {
        lock.release();
        await client.logout();
    }
}

if (import.meta.main) {
    fetchLatestEmails()
        .then((emails) => {
            console.log(JSON.stringify(emails, null, 2));
        })
        .catch((error) => {
            console.error("Failed to fetch emails:", error);
        });
}
