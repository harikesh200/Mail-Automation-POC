import { z } from "zod";

/**
 * Priority labels exposed by the API.
 */
export const prioritySchema = z.enum(["High", "Medium", "Low"]);

/**
 * Business categories the AI model is allowed to assign to an email.
 */
export const emailCategorySchema = z.enum([
    "Business Proposal",
    "Leave Approval",
    "Meeting Invitation",
    "General",
    "Other",
]);

/**
 * Structured summary of useful evidence extracted from one parsed attachment.
 */
export const attachmentInsightSchema = z.object({
    filename: z.string(),
    summary: z.string(),
    keyRisks: z.array(z.string()).default([]),
    keyDates: z.array(z.string()).default([]),
    financialImpact: z.string().nullable(),
});

/**
 * Runtime contract for a single prioritized email.
 *
 * The same schema validates AI structured output, fallback results, and the API
 * response payload to keep service boundaries consistent.
 */
export const emailPrioritySchema = z.object({
    emailId: z.string(),
    subject: z.string(),
    from: z.object({
        name: z.string(),
        email: z.string(),
    }),
    receivedDateTime: z.string(),
    priority: prioritySchema,
    score: z.number().int().min(0).max(10),
    reasoning: z.string().min(1),
    suggestedAction: z.string().min(1),
    category: emailCategorySchema,
    deadlineDetected: z.string().nullable(),
    attachmentInsights: z.array(attachmentInsightSchema).default([]),
});

/**
 * Runtime contract for `GET /api/emails/prioritized` responses.
 */
export const prioritizedEmailsResponseSchema = z.object({
    success: z.literal(true),
    count: z.number().int().nonnegative(),
    emails: z.array(emailPrioritySchema),
});
