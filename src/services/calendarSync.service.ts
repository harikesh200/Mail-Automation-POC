import { env } from "../config/env";
import type {
    CalendarSyncResponse,
    CalendarSyncResult,
} from "../schemas/calendarSync.schema";
import type { IncomingEmail, ParsedAttachment } from "../types/email.types";
import { logger } from "../utils/logger";
import { parseAttachments } from "./attachmentParser.service";
import {
    createCalendarEvent,
    DEFAULT_CALENDAR_TIMEZONE,
    DEFAULT_EVENT_DURATION_MINUTES,
    findCalendarEventByMeetingDetails,
    findCalendarEventBySourceEmailId,
    isMissingCalendarScope,
} from "../adapters/google/calendar/events";
import {
    extractMeetingEventWithAi,
    type MeetingEventCandidate,
} from "./aiMeetingExtractor.service";
import { fetchLatestEmails } from "./mailbox.service";

const SUPPORTED_MEETING_LINK_PATTERN =
    /(?:https?:\/\/)?(?:meet\.google\.com|(?:[\w-]+\.)?zoom\.us|teams\.microsoft\.com|teams\.live\.com|aka\.ms\/jointeamsmeeting|outlook\.office\.com\/meet)[^\s<>"'&]*/i;
const ISO_DATE_TIME_WITH_OFFSET_PATTERN =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_LOCAL_DATE_TIME_PATTERN =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;
const DEFAULT_CALENDAR_OFFSET = "+05:30";
const inFlightCalendarSyncByEmailId = new Map<
    string,
    Promise<CalendarSyncResult>
>();

/**
 * Orders source emails by received time before limiting how many are processed.
 */
function sortLatestEmails(emails: IncomingEmail[]): IncomingEmail[] {
    return [...emails].sort((left, right) => {
        return (
            Date.parse(right.receivedDateTime ?? "") -
            Date.parse(left.receivedDateTime ?? "")
        );
    });
}

function getParsedAttachmentText(parsedAttachments: ParsedAttachment[]): string {
    return parsedAttachments
        .filter((attachment) => attachment.parseStatus === "parsed")
        .map((attachment) => {
            return [`Attachment: ${attachment.filename}`, attachment.text].join(
                "\n",
            );
        })
        .join("\n\n");
}

function hasSupportedMeetingLink(text: string): boolean {
    return Boolean(extractSupportedMeetingUrl(text));
}

function decodeRepeatedly(value: string): string {
    let output = value;

    for (let index = 0; index < 3; index += 1) {
        try {
            const decoded = decodeURIComponent(output);
            if (decoded === output) {
                break;
            }

            output = decoded;
        } catch {
            break;
        }
    }

    return output;
}

function buildMeetingSearchText(text: string): string {
    const decoded = decodeRepeatedly(text);

    return `${text}\n${decoded}`;
}

function extractSupportedMeetingUrl(text: string): string | null {
    const searchText = buildMeetingSearchText(text);
    const matches = searchText.match(
        new RegExp(SUPPORTED_MEETING_LINK_PATTERN.source, "gi"),
    );
    const preferredMatch = matches?.find((match) => {
        return !/safelinks\.protection\.outlook\.com/i.test(match);
    });
    const match = preferredMatch ?? matches?.[0];

    if (!match) {
        return null;
    }

    return /^https?:\/\//i.test(match) ? match : `https://${match}`;
}

function isValidDateTime(value: string | null | undefined): value is string {
    return Boolean(value && Number.isFinite(Date.parse(value)));
}

/**
 * Normalizes model-produced date-times before they are sent to Google Calendar.
 *
 * Offset-bearing ISO values are preserved. Local ISO values are only accepted
 * for the configured default timezone, where they are made explicit as +05:30.
 */
function normalizeCalendarDateTime(
    value: string | null,
    timeZone: string,
): string | null {
    const trimmed = value?.trim();
    if (!trimmed) {
        return null;
    }

    if (ISO_DATE_TIME_WITH_OFFSET_PATTERN.test(trimmed)) {
        return isValidDateTime(trimmed) ? trimmed : null;
    }

    if (
        timeZone === DEFAULT_CALENDAR_TIMEZONE &&
        ISO_LOCAL_DATE_TIME_PATTERN.test(trimmed)
    ) {
        const withDefaultOffset = `${trimmed}${DEFAULT_CALENDAR_OFFSET}`;

        return isValidDateTime(withDefaultOffset) ? withDefaultOffset : null;
    }

    return null;
}

function addDefaultDuration(startDateTime: string): string {
    const start = new Date(startDateTime);
    return new Date(
        start.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60 * 1000,
    ).toISOString();
}

function buildSkippedResult(
    emailId: string,
    reason: string,
): CalendarSyncResult {
    return {
        emailId,
        status: "skipped",
        eventId: null,
        reason,
    };
}

function validateCandidate(
    email: IncomingEmail,
    candidate: MeetingEventCandidate,
): CalendarSyncResult | null {
    if (!candidate.shouldCreate) {
        return buildSkippedResult(
            email.id,
            candidate.reason ?? "No auto-addable meeting invitation found.",
        );
    }

    if (!candidate.title?.trim()) {
        return buildSkippedResult(email.id, "Meeting title was not found.");
    }

    const meetingUrl = extractSupportedMeetingUrl(candidate.meetingUrl ?? "");
    if (!meetingUrl) {
        return buildSkippedResult(
            email.id,
            "No supported Google Meet, Zoom, or Microsoft Teams link found.",
        );
    }

    if (
        !normalizeCalendarDateTime(
            candidate.startDateTime,
            candidate.timeZone || DEFAULT_CALENDAR_TIMEZONE,
        )
    ) {
        return buildSkippedResult(
            email.id,
            "No clear meeting date and start time found.",
        );
    }

    return null;
}

function normalizeCandidateForCalendar(candidate: MeetingEventCandidate) {
    const timeZone = candidate.timeZone || DEFAULT_CALENDAR_TIMEZONE;
    const startDateTime = normalizeCalendarDateTime(
        candidate.startDateTime,
        timeZone,
    ) as string;
    const normalizedEndDateTime = normalizeCalendarDateTime(
        candidate.endDateTime,
        timeZone,
    );
    const endDateTime =
        normalizedEndDateTime &&
        Date.parse(normalizedEndDateTime) > Date.parse(startDateTime)
            ? normalizedEndDateTime
            : addDefaultDuration(startDateTime);

    const meetingUrl = extractSupportedMeetingUrl(candidate.meetingUrl ?? "");

    return {
        title: candidate.title?.trim() ?? "Meeting",
        startDateTime,
        endDateTime,
        timeZone,
        meetingUrl,
        platform: candidate.platform,
        description: candidate.description,
    };
}

async function syncCalendarForEmail(
    email: IncomingEmail,
    referenceDate: Date,
): Promise<CalendarSyncResult> {
    try {
        const parsedAttachments = await parseAttachments(email.attachments ?? []);
        const attachmentText = getParsedAttachmentText(parsedAttachments);
        const combinedText = [
            email.subject,
            email.bodyPreview,
            email.body,
            attachmentText,
        ]
            .filter(Boolean)
            .join("\n\n");

        if (!hasSupportedMeetingLink(combinedText)) {
            return buildSkippedResult(
                email.id,
                "No supported Google Meet, Zoom, or Microsoft Teams link found.",
            );
        }

        const candidate = await extractMeetingEventWithAi({
            email,
            attachmentText,
            referenceDate,
        });
        const skipResult = validateCandidate(email, candidate);

        if (skipResult) {
            return skipResult;
        }

        const existingEvent = await findCalendarEventBySourceEmailId(email.id);
        if (existingEvent) {
            return {
                emailId: email.id,
                status: "already_exists",
                eventId: existingEvent.id,
                reason: "Event already exists from a previous backend sync.",
            };
        }

        const eventInput = normalizeCandidateForCalendar(candidate);
        const existingMeetingEvent =
            await findCalendarEventByMeetingDetails(eventInput);
        if (existingMeetingEvent) {
            return {
                emailId: email.id,
                status: "already_exists",
                eventId: existingMeetingEvent.id,
                reason: "Matching event already exists in Google Calendar.",
            };
        }

        const event = await createCalendarEvent({
            sourceEmailId: email.id,
            ...eventInput,
        });

        return {
            emailId: email.id,
            status: "created",
            eventId: event.id,
            reason: null,
        };
    } catch (error) {
        const reason = isMissingCalendarScope(error)
            ? "Google Calendar permission is missing. Regenerate GOOGLE_REFRESH_TOKEN with calendar.events scope."
            : error instanceof Error
              ? error.message
              : String(error);

        logger.warn("Calendar sync failed for email", {
            emailId: email.id,
            reason,
        });

        return {
            emailId: email.id,
            status: "failed",
            eventId: null,
            reason,
        };
    }
}

async function syncCalendarForEmailOnce(
    email: IncomingEmail,
    referenceDate: Date,
): Promise<CalendarSyncResult> {
    const existingSync = inFlightCalendarSyncByEmailId.get(email.id);
    if (existingSync) {
        return existingSync;
    }

    const syncPromise = syncCalendarForEmail(email, referenceDate).finally(() => {
        inFlightCalendarSyncByEmailId.delete(email.id);
    });

    inFlightCalendarSyncByEmailId.set(email.id, syncPromise);

    return syncPromise;
}

/**
 * Scans recent emails and auto-adds clear online meeting invitations to the
 * authenticated user's primary Google Calendar.
 */
export async function syncLatestEmailMeetingsToCalendar(): Promise<CalendarSyncResponse> {
    const fetchedEmails = await fetchLatestEmails();
    const emailsToProcess = sortLatestEmails(fetchedEmails).slice(
        0,
        env.MAX_EMAILS_TO_PROCESS,
    );
    const referenceDate = new Date();

    logger.info("Calendar sync started", {
        count: emailsToProcess.length,
    });

    const results = await Promise.all(
        emailsToProcess.map((email) =>
            syncCalendarForEmailOnce(email, referenceDate),
        ),
    );

    logger.success("Calendar sync completed", {
        count: results.length,
        created: results.filter((result) => result.status === "created").length,
        alreadyExists: results.filter(
            (result) => result.status === "already_exists",
        ).length,
        skipped: results.filter((result) => result.status === "skipped").length,
        failed: results.filter((result) => result.status === "failed").length,
    });

    return {
        success: true,
        count: results.length,
        results,
    };
}
