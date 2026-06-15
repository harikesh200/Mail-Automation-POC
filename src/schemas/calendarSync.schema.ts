import { z } from "zod";

export const calendarSyncStatusSchema = z.enum([
    "created",
    "already_exists",
    "skipped",
    "failed",
]);

export const calendarSyncResultSchema = z.object({
    emailId: z.string(),
    status: calendarSyncStatusSchema,
    eventId: z.string().nullable(),
    reason: z.string().nullable(),
});

/**
 * Runtime contract for `POST /api/emails/calendar/sync` responses.
 */
export const calendarSyncResponseSchema = z.object({
    success: z.literal(true),
    count: z.number().int().nonnegative(),
    results: z.array(calendarSyncResultSchema),
});

export type CalendarSyncStatus = z.infer<typeof calendarSyncStatusSchema>;
export type CalendarSyncResult = z.infer<typeof calendarSyncResultSchema>;
export type CalendarSyncResponse = z.infer<typeof calendarSyncResponseSchema>;
