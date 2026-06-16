import type { RequestHandler } from "express";
import { logger } from "../utils/logger";

/**
 * Handles requests for prioritized mailbox emails.
 *
 * Delegates the full fetch/parse/prioritize workflow to the service layer and
 * returns the normalized API payload.
 */
export const getPrioritizedEmails: RequestHandler = async (_req, res, next) => {
    try {
        const { prioritizeLatestEmails } = await import(
            "../services/emailPrioritizer.service"
        );

        logger.info("Prioritized emails workflow started");

        const emails = await prioritizeLatestEmails();

        logger.success("Prioritized emails workflow completed", {
            count: emails.length,
        });

        res.json({
            success: true,
            count: emails.length,
            emails,
        });
    } catch (error) {
        next(error);
    }
};
