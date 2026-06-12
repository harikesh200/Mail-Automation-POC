import type { RequestHandler } from "express";
import {
    draftReplyRequestSchema,
    draftReplyResponseSchema,
    emailIdParamSchema,
    sendReplyRequestSchema,
    sendReplyResponseSchema,
} from "../schemas/emailReply.schema";
import {
    generateDraftReply,
    sendApprovedReply,
} from "../services/emailReply.service";
import { logger } from "../utils/logger";

/**
 * Generates a plain-text reply preview for frontend review.
 */
export const generateDraftReplyController: RequestHandler = async (
    req,
    res,
    next,
) => {
    try {
        const { emailId } = emailIdParamSchema.parse(req.params);
        const request = draftReplyRequestSchema.parse(req.body ?? {});

        logger.info("Draft reply generation started", { emailId });

        const response = await generateDraftReply(emailId, request);

        logger.success("Draft reply generation completed", {
            emailId,
            isThread: response.isThread,
        });

        res.json(draftReplyResponseSchema.parse(response));
    } catch (error) {
        next(error);
    }
};

/**
 * Sends a user-approved plain-text reply through Gmail.
 */
export const sendReplyController: RequestHandler = async (req, res, next) => {
    try {
        const { emailId } = emailIdParamSchema.parse(req.params);
        const request = sendReplyRequestSchema.parse(req.body ?? {});

        logger.info("Approved reply send started", { emailId });

        const response = await sendApprovedReply(emailId, request);

        logger.success("Approved reply sent", {
            emailId,
            sentMessageId: response.sentMessageId,
            isThread: response.isThread,
        });

        res.json(sendReplyResponseSchema.parse(response));
    } catch (error) {
        next(error);
    }
};
