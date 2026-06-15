import type { RequestHandler } from "express";
import { calendarSyncResponseSchema } from "../schemas/calendarSync.schema";
import { syncLatestEmailMeetingsToCalendar } from "../services/calendarSync.service";
import { logger } from "../utils/logger";

/**
 * Syncs clear online meeting invitations from recent emails into Google Calendar.
 */
export const syncEmailMeetingsToCalendarController: RequestHandler = async (
    _req,
    res,
    next,
) => {
    try {
        logger.info("Calendar sync request received");

        const response = await syncLatestEmailMeetingsToCalendar();

        res.json(calendarSyncResponseSchema.parse(response));
    } catch (error) {
        next(error);
    }
};
