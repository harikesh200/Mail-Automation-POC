import { z } from "zod";

/**
 * Runtime contract for route params that target a single Gmail message.
 */
export const emailIdParamSchema = z.object({
    emailId: z.string().trim().min(1, "emailId is required"),
});

/**
 * Request body accepted when generating a reply preview for frontend review.
 *
 * Instructions are optional because the model can draft a reasonable reply from
 * mailbox context alone.
 */
export const draftReplyRequestSchema = z
    .object({
        instructions: z.string().trim().max(2000).optional(),
        tone: z.string().trim().max(100).optional(),
    })
    .strict();

/**
 * Request body accepted when sending a user-approved reply.
 */
export const sendReplyRequestSchema = z
    .object({
        bodyText: z
            .string()
            .max(50000)
            .refine((value) => value.trim().length > 0, {
                message: "bodyText is required",
            }),
    })
    .strict();

const replyMetadataSchema = z.object({
    emailId: z.string(),
    threadId: z.string().nullable(),
    isThread: z.boolean(),
});

/**
 * Runtime contract for `POST /api/emails/:emailId/draft-reply` responses.
 */
export const draftReplyResponseSchema = replyMetadataSchema.extend({
    success: z.literal(true),
    reply: z.object({
        bodyText: z.string().min(1),
    }),
});

/**
 * Runtime contract for `POST /api/emails/:emailId/reply/send` responses.
 */
export const sendReplyResponseSchema = replyMetadataSchema.extend({
    success: z.literal(true),
    sentMessageId: z.string(),
});

export type DraftReplyRequest = z.infer<typeof draftReplyRequestSchema>;
export type DraftReplyResponse = z.infer<typeof draftReplyResponseSchema>;
export type SendReplyRequest = z.infer<typeof sendReplyRequestSchema>;
export type SendReplyResponse = z.infer<typeof sendReplyResponseSchema>;
