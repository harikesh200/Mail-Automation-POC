import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";
import { env } from "../config/env";
import type { EmailSummary } from "../types/gmail.types";

const MAX_EMAIL_BODY_CHARS = 6000;

const draftReplySchema = z.object({
    bodyText: z.string().trim().min(1),
});

const SYSTEM_PROMPT = `
You draft plain-text Gmail replies for one selected email.

Use only the supplied source email, optional thread context, and optional user instructions. Do not invent facts, commitments, dates, approvals, attachments, prices, or decisions that are not present. If the user instructions are vague, write a safe, useful acknowledgement or follow-up.

Output rules:
- Return only structured JSON matching the schema.
- bodyText must contain only the email reply body.
- Do not include a subject line.
- Do not include markdown, bullets unless they are natural for the reply, code fences, or quoted original email text.
- Keep the reply concise and professional by default.
- Match the language and level of formality of the source email when clear.
- Do not mention that AI generated the reply.
- Do not add placeholders like "[Your Name]" unless the supplied content requires a missing value.

Reply policy:
- This is a normal reply, not reply-all.
- Address the sender naturally when their name is available.
- Acknowledge the key request or point from the selected email.
- If action is requested, respond with the most helpful next step supported by the supplied context.
- If the user provided instructions, follow them unless they conflict with the email context or require unsupported facts.
`;

export type GenerateDraftReplyInput = {
    sourceEmail: EmailSummary;
    threadEmails: EmailSummary[];
    instructions?: string;
    tone?: string;
};

export type GeneratedDraftReply = z.infer<typeof draftReplySchema>;

/**
 * Creates the configured Gemini model instance for reply drafting.
 */
function getModel() {
    const google = createGoogleGenerativeAI({
        apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
    });

    return google("gemini-2.5-flash");
}

/**
 * Truncates long email bodies so thread prompts stay bounded.
 */
function truncateText(value: string, maxChars: number): string {
    if (value.length <= maxChars) {
        return value;
    }

    return `${value.slice(0, maxChars)}\n[truncated]`;
}

/**
 * Builds the JSON prompt payload for one selected email and its thread context.
 */
function buildPrompt(input: GenerateDraftReplyInput): string {
    return JSON.stringify(
        {
            task: "Generate a plain-text reply body for the selected source email.",
            userPreferences: {
                instructions: input.instructions ?? null,
                tone: input.tone ?? "professional",
            },
            sourceEmail: {
                id: input.sourceEmail.id,
                threadId: input.sourceEmail.threadId ?? null,
                subject: input.sourceEmail.subject ?? "",
                from: input.sourceEmail.from ?? "",
                to: input.sourceEmail.to ?? "",
                cc: input.sourceEmail.cc ?? "",
                date: input.sourceEmail.date?.toISOString() ?? "",
                body: truncateText(
                    input.sourceEmail.text,
                    MAX_EMAIL_BODY_CHARS,
                ),
            },
            threadContext: input.threadEmails.map((email) => ({
                id: email.id,
                isSourceEmail: email.id === input.sourceEmail.id,
                subject: email.subject ?? "",
                from: email.from ?? "",
                to: email.to ?? "",
                date: email.date?.toISOString() ?? "",
                body: truncateText(email.text, MAX_EMAIL_BODY_CHARS),
            })),
        },
        null,
        2,
    );
}

/**
 * Generates a plain-text reply body for frontend review.
 */
export async function generateDraftReplyWithAi(
    input: GenerateDraftReplyInput,
): Promise<GeneratedDraftReply> {
    const result = await generateText({
        model: getModel(),
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(input),
        output: Output.object({
            schema: draftReplySchema,
            name: "DraftReply",
            description: "Plain-text email reply body for frontend review.",
        }),
    });

    return draftReplySchema.parse(result.output);
}
