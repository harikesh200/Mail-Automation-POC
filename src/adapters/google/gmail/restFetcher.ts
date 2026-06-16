import type { EmailSummary } from "../../../types/gmail.types";
import { getRawMessage, listInboxMessages } from "./restClient";
import { isEmailSummary, parseRawGmailMessage } from "./messageParser";

async function fetchEmailSummaryById(id: string): Promise<EmailSummary | null> {
    const message = await getRawMessage(id);

    return parseRawGmailMessage(id, message);
}

export async function fetchLatestEmailsWithRest(
    maxResults: number,
): Promise<EmailSummary[]> {
    const messageList = await listInboxMessages(maxResults);
    const messages = messageList.messages ?? [];
    const emails = await Promise.all(
        messages.map((message) => {
            if (!message.id) {
                return Promise.resolve(null);
            }

            return fetchEmailSummaryById(message.id);
        }),
    );

    return emails.filter(isEmailSummary);
}

export async function fetchEmailByIdWithRest(
    id: string,
): Promise<EmailSummary | null> {
    return fetchEmailSummaryById(id);
}
