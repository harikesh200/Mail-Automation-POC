import { z } from "zod";
import { env } from "../config/env";
import type { IncomingEmail } from "../types/email.types";
import {
    DEFAULT_CALENDAR_TIMEZONE,
    DEFAULT_EVENT_DURATION_MINUTES,
} from "../adapters/google/calendar/events";

const MAX_EMAIL_BODY_CHARS = 8000;
const MAX_ATTACHMENT_TEXT_CHARS = 4000;

const meetingPlatformSchema = z.enum([
    "Google Meet",
    "Zoom",
    "Microsoft Teams",
]);

const meetingEventCandidateSchema = z.object({
    shouldCreate: z.boolean(),
    reason: z.string().nullable(),
    title: z.string().nullable(),
    startDateTime: z.string().nullable(),
    endDateTime: z.string().nullable(),
    timeZone: z.string().default(DEFAULT_CALENDAR_TIMEZONE),
    meetingUrl: z.string().nullable(),
    platform: meetingPlatformSchema.nullable(),
    description: z.string().nullable(),
});

const SYSTEM_PROMPT = `
You extract calendar events from emails for automatic Google Calendar creation.

Only set shouldCreate=true when all of these are present in the supplied email context:
- A clear meeting invitation or scheduled meeting.
- A clear start date.
- A clear start time.
- A supported online meeting URL for Google Meet, Zoom, or Microsoft Teams.

Supported meeting links:
- Google Meet: meet.google.com
- Zoom: zoom.us, *.zoom.us
- Microsoft Teams / Microsoft Meet / Microsoft meeting invites: teams.microsoft.com, teams.live.com, aka.ms/JoinTeamsMeeting, outlook.office.com/meet, or Outlook Safe Links that encode a Teams URL.

Do not create events for vague scheduling emails, tentative discussions, newsletters, webinars without a clear start time, or emails that only ask to schedule later.

Date/time rules:
- Use ISO 8601 date-time strings.
- If the email states a timezone or offset, include it in the ISO string, such as 2026-06-15T14:00:00+05:30 or 2026-06-15T08:30:00Z.
- If the email does not state a timezone, use the supplied default timezone and return a local ISO string, such as 2026-06-15T14:00:00.
- You may resolve clear relative dates like "tomorrow at 3 PM" using the supplied reference date.
- If the date or start time is ambiguous, set shouldCreate=false.
- If no end time or duration is stated, leave endDateTime=null. The backend will apply the default duration.

Output rules:
- Return only structured JSON matching the schema.
- Do not invent missing details.
- Keep title concise.
- Description should briefly say what the meeting is about using only email context.
`;

export type MeetingEventCandidate = z.infer<typeof meetingEventCandidateSchema>;

export type ExtractMeetingEventInput = {
    email: IncomingEmail;
    attachmentText?: string;
    referenceDate: Date;
};

/**
 * Creates the configured Gemini model instance for meeting extraction.
 */
async function getModel() {
    const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
    const google = createGoogleGenerativeAI({
        apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
    });

    return google("gemini-2.5-flash");
}

function truncateText(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
        return value;
    }

    return `${value.slice(0, maxChars)}\n[truncated]`;
}

function buildPrompt(input: ExtractMeetingEventInput): string {
    return JSON.stringify(
        {
            task: "Extract one auto-addable calendar event from the email, if safe.",
            referenceDate: input.referenceDate.toISOString(),
            defaultTimeZone: DEFAULT_CALENDAR_TIMEZONE,
            defaultDurationMinutes: DEFAULT_EVENT_DURATION_MINUTES,
            email: {
                id: input.email.id,
                subject: input.email.subject ?? "",
                from: input.email.from ?? "",
                receivedDateTime: input.email.receivedDateTime ?? "",
                bodyPreview: input.email.bodyPreview ?? "",
                body: truncateText(input.email.body ?? "", MAX_EMAIL_BODY_CHARS),
            },
            attachmentText: truncateText(
                input.attachmentText ?? "",
                MAX_ATTACHMENT_TEXT_CHARS,
            ),
        },
        null,
        2,
    );
}

/**
 * Extracts a candidate event from an email. The caller still validates the
 * candidate before creating a Calendar event.
 */
export async function extractMeetingEventWithAi(
    input: ExtractMeetingEventInput,
): Promise<MeetingEventCandidate> {
    const [{ generateText, Output }, model] = await Promise.all([
        import("ai"),
        getModel(),
    ]);
    const result = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(input),
        output: Output.object({
            schema: meetingEventCandidateSchema,
            name: "MeetingEventCandidate",
            description: "Candidate calendar event extracted from an email.",
        }),
    });

    return meetingEventCandidateSchema.parse(result.output);
}
