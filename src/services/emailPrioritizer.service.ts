import { env } from "../config/env";
import { emailPrioritySchema } from "../schemas/emailPriority.schema";
import type { IncomingEmail, PrioritizedEmail } from "../types/email.types";
import { logger } from "../utils/logger";
import { sortPrioritizedEmails } from "../utils/scoring";
import {
    prioritizeEmailWithAi,
    buildFallbackPriority,
} from "./aiPrioritizer.service";
import { parseAttachments } from "./attachmentParser.service";
import { fetchLatestEmails } from "./mailFetcher.integration";

function sortLatestEmails(emails: IncomingEmail[]): IncomingEmail[] {
    return [...emails].sort((left, right) => {
        return (
            Date.parse(right.receivedDateTime ?? "") -
            Date.parse(left.receivedDateTime ?? "")
        );
    });
}

export async function prioritizeLatestEmails(): Promise<PrioritizedEmail[]> {
    const fetchedEmails = await fetchLatestEmails();
    const emailsToProcess = sortLatestEmails(fetchedEmails).slice(
        0,
        env.MAX_EMAILS_TO_PROCESS,
    );

    const prioritizedEmails = await Promise.all(
        emailsToProcess.map(async (email) => {
            try {
                const parsedAttachments = await parseAttachments(
                    email.attachments ?? [],
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

                return buildFallbackPriority(email);
            }
        }),
    );

    return sortPrioritizedEmails(prioritizedEmails);
}
