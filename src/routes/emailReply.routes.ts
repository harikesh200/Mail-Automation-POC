import { Router } from "express";
import {
    generateDraftReplyController,
    sendReplyController,
} from "../controllers/emailReply.controller";

/**
 * Routes for generating and sending user-approved email replies.
 */
export const emailReplyRouter = Router();

emailReplyRouter.post(
    "/emails/:emailId/draft-reply",
    generateDraftReplyController,
);
emailReplyRouter.post("/emails/:emailId/reply/send", sendReplyController);
