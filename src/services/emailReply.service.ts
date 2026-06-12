import {
    fetchEmailById,
    fetchThreadEmails,
    sendReply,
    type EmailSummary,
    type SentEmailSummary,
} from "../mail";
import type {
    DraftReplyRequest,
    DraftReplyResponse,
    SendReplyRequest,
    SendReplyResponse,
} from "../schemas/emailReply.schema";
import { HttpError } from "../utils/httpError";
import { generateDraftReplyWithAi } from "./aiDraftReply.service";

const MAX_THREAD_MESSAGES_FOR_REPLY = 10;

type ReplyContext = {
    sourceEmail: EmailSummary;
    threadEmails: EmailSummary[];
    isThread: boolean;
};

/**
 * Converts blank optional frontend fields into absent values before prompting AI.
 */
function normalizeOptionalText(value: string | undefined): string | undefined {
    const normalized = value?.trim();

    return normalized ? normalized : undefined;
}

/**
 * Detects the common Gmail error returned when the refresh token lacks send scope.
 */
function isMissingGmailSendScope(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);

    return /insufficient|scope|forbidden|permission/i.test(message);
}

/**
 * Keeps recent thread context bounded while ensuring the selected email remains
 * visible to the model.
 */
function selectThreadContext(
    threadEmails: EmailSummary[],
    sourceEmail: EmailSummary,
): EmailSummary[] {
    const selected = threadEmails.slice(-MAX_THREAD_MESSAGES_FOR_REPLY);

    if (!selected.some((email) => email.id === sourceEmail.id)) {
        selected.unshift(sourceEmail);
    }

    return selected.sort((left, right) => {
        return (left.date?.getTime() ?? 0) - (right.date?.getTime() ?? 0);
    });
}

/**
 * Loads the selected email and its thread metadata for reply generation/sending.
 */
async function loadReplyContext(emailId: string): Promise<ReplyContext> {
    const sourceEmail = await fetchEmailById(emailId);

    if (!sourceEmail) {
        throw new HttpError(404, "Email not found.");
    }

    if (!sourceEmail.threadId) {
        return {
            sourceEmail,
            threadEmails: [sourceEmail],
            isThread: false,
        };
    }

    const fetchedThreadEmails = await fetchThreadEmails(sourceEmail.threadId);
    const threadEmails =
        fetchedThreadEmails.length > 0 ? fetchedThreadEmails : [sourceEmail];

    return {
        sourceEmail,
        threadEmails: selectThreadContext(threadEmails, sourceEmail),
        isThread: threadEmails.length > 1,
    };
}

/**
 * Generates a plain-text reply body for frontend review without mutating Gmail.
 */
export async function generateDraftReply(
    emailId: string,
    request: DraftReplyRequest,
): Promise<DraftReplyResponse> {
    const context = await loadReplyContext(emailId);
    const reply = await generateDraftReplyWithAi({
        sourceEmail: context.sourceEmail,
        threadEmails: context.threadEmails,
        instructions: normalizeOptionalText(request.instructions),
        tone: normalizeOptionalText(request.tone),
    });

    return {
        success: true,
        emailId: context.sourceEmail.id,
        threadId: context.sourceEmail.threadId ?? null,
        isThread: context.isThread,
        reply,
    };
}

/**
 * Sends the final user-approved reply text through Gmail.
 */
export async function sendApprovedReply(
    emailId: string,
    request: SendReplyRequest,
): Promise<SendReplyResponse> {
    const context = await loadReplyContext(emailId);
    let sentEmail: SentEmailSummary;

    try {
        sentEmail = await sendReply({
            sourceEmail: context.sourceEmail,
            bodyText: request.bodyText,
        });
    } catch (error) {
        if (isMissingGmailSendScope(error)) {
            throw new HttpError(
                403,
                "Gmail send permission is missing. Regenerate GOOGLE_REFRESH_TOKEN with gmail.send scope.",
            );
        }

        throw error;
    }

    return {
        success: true,
        emailId: context.sourceEmail.id,
        threadId: sentEmail.threadId ?? context.sourceEmail.threadId ?? null,
        isThread: context.isThread,
        sentMessageId: sentEmail.id,
    };
}
