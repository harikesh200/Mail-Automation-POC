import { google } from "googleapis";
import { env } from "../../../config/env";

export const DEFAULT_CALENDAR_ID = "primary";
export const DEFAULT_CALENDAR_TIMEZONE = "Asia/Kolkata";
export const DEFAULT_EVENT_DURATION_MINUTES = 30;

const SOURCE_MARKER_PREFIX = "Source Gmail Message ID:";

export type CalendarEventInput = {
    sourceEmailId: string;
    title: string;
    startDateTime: string;
    endDateTime: string;
    timeZone: string;
    meetingUrl?: string | null;
    platform?: string | null;
    description?: string | null;
};

export type CalendarEventSummary = {
    id: string;
};

/**
 * Creates an authenticated Google Calendar client using the shared OAuth token.
 */
function createCalendarClient() {
    const oauth2Client = new google.auth.OAuth2(
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET,
        env.GOOGLE_REDIRECT_URI,
    );

    oauth2Client.setCredentials({
        refresh_token: env.GOOGLE_REFRESH_TOKEN,
    });

    return google.calendar({
        version: "v3",
        auth: oauth2Client,
    });
}

/**
 * Stable marker used for best-effort duplicate detection.
 */
export function buildSourceEmailMarker(emailId: string): string {
    return `${SOURCE_MARKER_PREFIX} ${emailId}`;
}

/**
 * Detects the common Calendar API error returned when the refresh token lacks
 * calendar scopes.
 */
export function isMissingCalendarScope(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);

    return /insufficient|scope|forbidden|permission/i.test(message);
}

/**
 * Searches the primary calendar for an event that already references the Gmail
 * message id marker in its searchable fields.
 */
export async function findCalendarEventBySourceEmailId(
    emailId: string,
): Promise<CalendarEventSummary | null> {
    const calendar = createCalendarClient();
    const marker = buildSourceEmailMarker(emailId);
    const response = await calendar.events.list({
        calendarId: DEFAULT_CALENDAR_ID,
        q: marker,
        singleEvents: true,
        maxResults: 10,
    });

    const event = (response.data.items ?? []).find((item) => {
        return (
            item.id &&
            (item.description?.includes(marker) ||
                item.summary?.includes(marker) ||
                item.location?.includes(marker))
        );
    });

    return event?.id ? { id: event.id } : null;
}

/**
 * Creates a primary-calendar event without attendees or invite notifications.
 */
export async function createCalendarEvent(
    input: CalendarEventInput,
): Promise<CalendarEventSummary> {
    const calendar = createCalendarClient();
    const marker = buildSourceEmailMarker(input.sourceEmailId);
    const descriptionParts = [
        input.description?.trim(),
        input.meetingUrl ? `Meeting link: ${input.meetingUrl}` : null,
        input.platform ? `Platform: ${input.platform}` : null,
        marker,
    ].filter(Boolean);

    const response = await calendar.events.insert({
        calendarId: DEFAULT_CALENDAR_ID,
        sendUpdates: "none",
        requestBody: {
            summary: input.title,
            description: descriptionParts.join("\n\n"),
            location: input.meetingUrl ?? undefined,
            start: {
                dateTime: input.startDateTime,
                timeZone: input.timeZone,
            },
            end: {
                dateTime: input.endDateTime,
                timeZone: input.timeZone,
            },
        },
    });

    if (!response.data.id) {
        throw new Error("Google Calendar did not return an event id.");
    }

    return {
        id: response.data.id,
    };
}
