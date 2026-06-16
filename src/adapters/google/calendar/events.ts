import { google, type calendar_v3 } from "googleapis";
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

export type FindCalendarEventInput = {
    startDateTime: string;
    endDateTime: string;
    meetingUrl?: string | null;
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

function normalizeSearchText(value: string | null | undefined): string {
    return (value ?? "").toLowerCase();
}

function normalizeMeetingUrl(value: string | null | undefined): string {
    return normalizeSearchText(value).split(/[?#]/)[0]?.replace(/\/+$/, "") ?? "";
}

function getEventSearchText(
    event: calendar_v3.Schema$Event,
): string {
    const entryPointUris =
        event.conferenceData?.entryPoints
            ?.map((entryPoint) => entryPoint.uri ?? "")
            .join(" ") ?? "";

    return normalizeSearchText(
        [
            event.summary,
            event.description,
            event.location,
            event.hangoutLink,
            entryPointUris,
        ]
            .filter(Boolean)
            .join(" "),
    );
}

function hasOverlappingTime(
    eventStart: string | null | undefined,
    eventEnd: string | null | undefined,
    input: FindCalendarEventInput,
): boolean {
    if (!eventStart) {
        return false;
    }

    const existingStart = Date.parse(eventStart);
    const existingEnd = Date.parse(eventEnd ?? eventStart);
    const inputStart = Date.parse(input.startDateTime);
    const inputEnd = Date.parse(input.endDateTime);

    if (
        !Number.isFinite(existingStart) ||
        !Number.isFinite(existingEnd) ||
        !Number.isFinite(inputStart) ||
        !Number.isFinite(inputEnd)
    ) {
        return false;
    }

    return existingStart < inputEnd && inputStart < existingEnd;
}

/**
 * Searches for an existing Calendar event that likely came from Gmail or a
 * provider invite before this backend creates its own event.
 */
export async function findCalendarEventByMeetingDetails(
    input: FindCalendarEventInput,
): Promise<CalendarEventSummary | null> {
    const calendar = createCalendarClient();
    const start = new Date(input.startDateTime);
    const end = new Date(input.endDateTime);
    const timeMin = new Date(start.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(end.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const response = await calendar.events.list({
        calendarId: DEFAULT_CALENDAR_ID,
        timeMin,
        timeMax,
        singleEvents: true,
        maxResults: 50,
        orderBy: "startTime",
    });
    const normalizedMeetingUrl = normalizeMeetingUrl(input.meetingUrl);
    if (!normalizedMeetingUrl) {
        return null;
    }

    const event = (response.data.items ?? []).find((item) => {
        if (!item.id) {
            return false;
        }

        const eventStart = item.start?.dateTime ?? item.start?.date;
        const eventEnd = item.end?.dateTime ?? item.end?.date;
        if (!hasOverlappingTime(eventStart, eventEnd, input)) {
            return false;
        }

        const searchText = getEventSearchText(item);
        return searchText.includes(normalizedMeetingUrl);
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
