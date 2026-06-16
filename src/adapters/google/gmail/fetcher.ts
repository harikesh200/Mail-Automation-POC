import { env } from "../../../config/env";
import type { EmailSummary } from "../../../types/gmail.types";
import { logger } from "../../../utils/logger";

const DEFAULT_MAX_RESULTS = 20;

/**
 * Resolves how many Gmail messages to request.
 */
function getMaxResults(): number {
    const rawValue = process.env.MAX_EMAILS_TO_PROCESS;
    if (!rawValue) {
        return DEFAULT_MAX_RESULTS;
    }

    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
        return DEFAULT_MAX_RESULTS;
    }

    return Math.min(Math.trunc(value), DEFAULT_MAX_RESULTS);
}

function sortNewestFirst(emails: EmailSummary[]): EmailSummary[] {
    return emails.sort((left, right) => {
        return (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0);
    });
}

/**
 * Fetches and parses the latest Gmail inbox messages through the configured
 * Gmail client implementation.
 */
export async function fetchLatestEmails(): Promise<EmailSummary[]> {
    const maxResults = getMaxResults();
    const client = env.GMAIL_FETCH_CLIENT;

    logger.info("Fetching latest Gmail inbox messages", {
        maxResults,
        client,
    });

    const emails =
        client === "googleapis"
            ? await import("./googleapisFetcher").then((module) =>
                  module.fetchLatestEmailsWithGoogleApis(maxResults),
              )
            : await import("./restFetcher").then((module) =>
                  module.fetchLatestEmailsWithRest(maxResults),
              );

    logger.info("Fetched latest Gmail inbox messages", {
        count: emails.length,
        client,
    });

    return sortNewestFirst(emails);
}

/**
 * Fetches and parses a single Gmail message by id.
 */
export async function fetchEmailById(id: string): Promise<EmailSummary | null> {
    if (env.GMAIL_FETCH_CLIENT === "googleapis") {
        const { fetchEmailByIdWithGoogleApis } = await import(
            "./googleapisFetcher"
        );

        return fetchEmailByIdWithGoogleApis(id);
    }

    const { fetchEmailByIdWithRest } = await import("./restFetcher");

    return fetchEmailByIdWithRest(id);
}

/**
 * Fetches all messages in a Gmail thread and parses them as email summaries.
 */
export async function fetchThreadEmails(
    threadId: string,
): Promise<EmailSummary[]> {
    const { fetchThreadEmailsWithGoogleApis } = await import(
        "./googleapisFetcher"
    );
    const emails = await fetchThreadEmailsWithGoogleApis(threadId);

    return emails.sort((left, right) => {
        return (left.date?.getTime() ?? 0) - (right.date?.getTime() ?? 0);
    });
}
