import { env } from "../config/env";
import { emailPrioritySchema } from "../schemas/emailPriority.schema";
import type {
    IncomingEmail,
    ParsedAttachment,
    PrioritizedEmail,
} from "../types/email.types";
import { logger } from "../utils/logger";
import { sortPrioritizedEmails } from "../utils/scoring";
import { buildFallbackPriority } from "./fallbackPriority.service";
import { mapWithConcurrency } from "../utils/concurrency";

/**
 * Orders source emails by received time before limiting how many are processed.
 *
 * @param emails - Emails returned from the mailbox adapter.
 * @returns A new array with newest emails first.
 */
function sortLatestEmails(emails: IncomingEmail[]): IncomingEmail[] {
    return [...emails].sort((left, right) => {
        return (
            Date.parse(right.receivedDateTime ?? "") -
            Date.parse(left.receivedDateTime ?? "")
        );
    });
}

/**
 * Fetches, parses, prioritizes, and sorts the latest mailbox emails.
 *
 * Each email is isolated behind its own fallback path: attachment parsing or AI
 * failures for one message do not prevent other messages from being prioritized.
 *
 * @returns Prioritized emails sorted by score and recency.
 */
export async function prioritizeLatestEmails(): Promise<PrioritizedEmail[]> {
    const { fetchLatestEmails } = await import("./mailbox.service");

    const fetchedEmails = await fetchLatestEmails();

    const emailsToProcess = sortLatestEmails(fetchedEmails).slice(
        0,
        env.MAX_EMAILS_TO_PROCESS,
    );

    const prioritizedEmails = await mapWithConcurrency(
        emailsToProcess,
        env.EMAIL_PRIORITIZATION_CONCURRENCY,
        async (email) => {
            let parsedAttachments: ParsedAttachment[] = [];

            try {
                const { parseAttachments } = await import(
                    "./attachmentParser.service"
                );

                parsedAttachments = await parseAttachments(email.attachments ?? []);

                const { prioritizeEmailWithAi } = await import(
                    "./aiPrioritizer.service"
                );

                const aiResult = await prioritizeEmailWithAi({
                    email,
                    parsedAttachments,
                });
                return emailPrioritySchema.parse(aiResult);
            } catch (error) {
                logger.warn("Email prioritization failed; using fallback", {
                    emailId: email.id,
                    message:
                        error instanceof Error ? error.message : String(error),
                });

                return buildFallbackPriority(email, parsedAttachments);
            }
        },
    );

    const sortedEmails = sortPrioritizedEmails(prioritizedEmails);
    return sortedEmails;
}
