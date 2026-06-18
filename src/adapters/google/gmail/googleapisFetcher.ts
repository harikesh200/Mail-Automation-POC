import { env } from "../../../config/env";
import type { EmailSummary } from "../../../types/gmail.types";
import { mapWithConcurrency } from "../../../utils/concurrency";
import { createGmailClient, type GmailClient } from "./client";
import { isEmailSummary, parseRawGmailMessage } from "./messageParser";

const googleRequestOptions = {
    timeout: env.GOOGLE_API_TIMEOUT_MS,
};

async function fetchEmailSummaryById(
    gmail: GmailClient,
    id: string,
): Promise<EmailSummary | null> {
    const response = await gmail.users.messages.get(
        {
            userId: "me",
            id,
            format: "raw",
        },
        googleRequestOptions,
    );

    return parseRawGmailMessage(id, {
        id: response.data.id ?? undefined,
        threadId: response.data.threadId ?? undefined,
        raw: response.data.raw ?? undefined,
        internalDate: response.data.internalDate ?? undefined,
    });
}

export async function fetchLatestEmailsWithGoogleApis(
    maxResults: number,
): Promise<EmailSummary[]> {
    const gmail = await createGmailClient();
    const messageList = await gmail.users.messages.list(
        {
            userId: "me",
            labelIds: ["INBOX"],
            maxResults,
        },
        googleRequestOptions,
    );
    const messages = messageList.data.messages ?? [];
    const emails = await mapWithConcurrency(
        messages,
        env.GMAIL_MESSAGE_FETCH_CONCURRENCY,
        async (message) => {
            if (!message.id) {
                return null;
            }

            return fetchEmailSummaryById(gmail, message.id);
        },
    );

    return emails.filter(isEmailSummary);
}

export async function fetchEmailByIdWithGoogleApis(
    id: string,
): Promise<EmailSummary | null> {
    const gmail = await createGmailClient();

    return fetchEmailSummaryById(gmail, id);
}

export async function fetchThreadEmailsWithGoogleApis(
    threadId: string,
): Promise<EmailSummary[]> {
    const gmail = await createGmailClient();
    const response = await gmail.users.threads.get(
        {
            userId: "me",
            id: threadId,
            format: "metadata",
        },
        googleRequestOptions,
    );
    const messages = response.data.messages ?? [];
    const emails = await mapWithConcurrency(
        messages,
        env.GMAIL_MESSAGE_FETCH_CONCURRENCY,
        async (message) => {
            if (!message.id) {
                return null;
            }

            return fetchEmailSummaryById(gmail, message.id);
        },
    );

    return emails.filter(isEmailSummary);
}
