import { Router } from "express";
import { getPrioritizedEmails } from "../controllers/prioritize.controller";

/**
 * Routes for email prioritization endpoints.
 */
export const prioritizeRouter = Router();

prioritizeRouter.get("/emails/prioritized", getPrioritizedEmails);
