import { z } from "zod";

export const prioritySchema = z.enum(["High", "Medium", "Low"]);

export const emailCategorySchema = z.enum([
    "Business Proposal",
    "Leave Approval",
    "Meeting Invitation",
    "General",
    "Other",
]);

export const attachmentInsightSchema = z.object({
    filename: z.string(),
    summary: z.string(),
    keyRisks: z.array(z.string()).default([]),
    keyDates: z.array(z.string()).default([]),
    financialImpact: z.string().nullable(),
});

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

export const prioritizedEmailsResponseSchema = z.object({
    success: z.literal(true),
    count: z.number().int().nonnegative(),
    emails: z.array(emailPrioritySchema),
});
