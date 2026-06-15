import { env } from "../config/env";
import { emailPrioritySchema } from "../schemas/emailPriority.schema";
import type {
    IncomingEmail,
    ParsedAttachment,
    PrioritizedEmail,
} from "../types/email.types";
import { logger } from "../utils/logger";
import { sortPrioritizedEmails } from "../utils/scoring";
import {
    prioritizeEmailWithAi,
    buildFallbackPriority,
} from "./aiPrioritizer.service";
import { parseAttachments } from "./attachmentParser.service";
import { fetchLatestEmails } from "./mailFetcher.integration";

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
    const fetchedEmails = await fetchLatestEmails();
    logger.info("Fetched latest emails", {
        count: fetchedEmails.length,
    });

    const emailsToProcess = sortLatestEmails(fetchedEmails).slice(
        0,
        env.MAX_EMAILS_TO_PROCESS,
    );
    logger.info("Selected emails for prioritization", {
        count: emailsToProcess.length,
        maxEmailsToProcess: env.MAX_EMAILS_TO_PROCESS,
    });

    const prioritizedEmails = await Promise.all(
        emailsToProcess.map(async (email) => {
            let parsedAttachments: ParsedAttachment[] = [];

            try {
                parsedAttachments = await parseAttachments(email.attachments ?? []);
                logger.info("Email attachments parsed", {
                    emailId: email.id,
                    total: parsedAttachments.length,
                    parsed: parsedAttachments.filter(
                        (attachment) => attachment.parseStatus === "parsed",
                    ).length,
                    skipped: parsedAttachments.filter(
                        (attachment) => attachment.parseStatus === "skipped",
                    ).length,
                    failed: parsedAttachments.filter(
                        (attachment) => attachment.parseStatus === "failed",
                    ).length,
                });

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
        }),
    );

    const sortedEmails = sortPrioritizedEmails(prioritizedEmails);
    logger.success("Email prioritization completed", {
        count: sortedEmails.length,
    });

    return sortedEmails;
}
