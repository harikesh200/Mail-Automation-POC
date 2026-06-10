import type { RequestHandler } from "express";
import { prioritizeLatestEmails } from "../services/emailPrioritizer.service";

export const getPrioritizedEmails: RequestHandler = async (_req, res, next) => {
    try {
        const emails = await prioritizeLatestEmails();

        res.json({
            success: true,
            count: emails.length,
            emails,
        });
    } catch (error) {
        next(error);
    }
};
