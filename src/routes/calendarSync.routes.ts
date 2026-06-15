import { Router } from "express";
import { syncEmailMeetingsToCalendarController } from "../controllers/calendarSync.controller";

/**
 * Routes for syncing email meeting invitations into Google Calendar.
 */
export const calendarSyncRouter = Router();

calendarSyncRouter.post(
    "/emails/calendar/sync",
    syncEmailMeetingsToCalendarController,
);
