import { Router } from "express";
import { getPrioritizedEmails } from "../controllers/prioritize.controller";

export const prioritizeRouter = Router();

prioritizeRouter.get("/emails/prioritized", getPrioritizedEmails);
