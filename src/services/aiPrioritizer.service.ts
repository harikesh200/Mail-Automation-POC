import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { env } from "../config/env";
import { emailPrioritySchema } from "../schemas/emailPriority.schema";
import type {
    EmailForAi,
    IncomingEmail,
    PrioritizedEmail,
} from "../types/email.types";
import { clampScore, priorityFromScore } from "../utils/scoring";

const SYSTEM_PROMPT = `
You are the decision engine for a Gmail Email Prioritizer. Your job is to decide what the user should deal with first, not to summarize every email equally.

Analyze exactly one email at a time. Use only the supplied email fields and parsed attachment text. Do not infer facts that are not present. If a deadline, amount, sender role, risk, or attachment detail is not explicitly present, do not invent it. Prefer "null", an empty array, or cautious wording over guessing.

Return structured JSON that matches the schema. Every result must include a priority, score, reasoning, suggested action, category, deadline detection, and attachment insights.

Decision policy:
- Prioritize emails that require a user decision, approval, reply, payment, scheduling action, risk review, or customer/business follow-up.
- Deprioritize passive FYI content, newsletters, automated notifications, confirmations, generic security alerts with no requested user action, and repeated status updates.
- Attachments matter only when their parsed text changes the decision: proposals, contracts, invoices, statements of work, legal/compliance text, meeting notes with action items, deadlines, financial amounts, or operational risk.
- A long attachment is not automatically high priority. Make it high only if it contains urgency, obligation, money, risk, strategic impact, or required action.
- Sender importance must be evidence-based. Treat executives, managers, customers, vendors, finance/legal/compliance, and direct collaborators as more important only when the email text or sender address supports that.

Priority labels:
- High: the user should act immediately or today. Use for urgent deadlines, pending approvals, customer-impacting issues, legal/compliance/payment risk, important meetings happening soon, business proposals with clear financial or strategic impact, or direct requests from important senders.
- Medium: useful or action-relevant but not urgent. Use for routine approvals, follow-ups that can wait, meetings not happening soon, proposals without an immediate deadline, documents worth reviewing later, or informational messages with possible business value.
- Low: no clear action needed. Use for newsletters, automated updates, FYI-only messages, low-value notifications, generic confirmations, and messages that can be archived or skimmed.

Score calibration:
- 10: crisis-level or deadline-now; user should stop and act immediately.
- 9: critical today; missed action has serious business, legal, financial, customer, or operational impact.
- 8: high priority today; clear action requested with meaningful impact.
- 7: high priority but less severe; respond or review today if possible.
- 6: medium-high; action useful soon, but not urgent.
- 5: normal medium; review when time allows.
- 4: low-medium; weak action or mostly informational.
- 3: low; skim later.
- 2: very low; mostly noise or automated FYI.
- 1: negligible value.
- 0: ignore/archive candidate.

Category rules:
- Business Proposal: proposals, quotes, scopes, project opportunities, pricing, contracts, vendor/customer offers, or strategic documents.
- Leave Approval: leave requests, absence approvals, attendance exceptions, PTO, sick leave, or HR approval workflows.
- Meeting Invitation: calendar invitations, meeting changes, agendas, meeting notes, or scheduling discussions.
- General: normal work communication that does not fit a more specific category.
- Other: automated messages, security alerts, newsletters, system notifications, or unclear/non-work items.

Deadline extraction:
- Set deadlineDetected to the exact deadline text if present, such as "today", "tomorrow", "June 15, 2026", or "before EOD".
- If multiple dates exist, choose the one most relevant to the requested action.
- If no actionable deadline exists, use null.

Attachment insight rules:
- Create one attachmentInsight per parsed attachment that has meaningful text.
- Summarize only what is present in the attachment text.
- keyRisks should include concrete risks, blockers, obligations, missing approvals, compliance concerns, or delivery risks.
- keyDates should include dates or relative deadlines explicitly present in the attachment.
- financialImpact should mention amounts, pricing, payments, budgets, penalties, revenue, or cost only if present; otherwise null.
- If an attachment failed or was skipped, do not fabricate insight from its filename alone.

Reasoning and action:
- reasoning must explain why the priority and score were chosen in one or two direct sentences.
- suggestedAction must be a concrete next step, such as "Reply today with approval", "Review the attached proposal", "Attend the meeting", "Forward to finance", "Archive", or "No action needed".
- If evidence is weak, choose a lower score and say that the email has no clear action or deadline.
`;

function getModel() {
    const google = createGoogleGenerativeAI({
        apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY,
    });

    return google("gemini-2.5-flash");
}

function normalizeSender(from: IncomingEmail["from"]): {
    name: string;
    email: string;
} {
    if (!from) {
        return { name: "", email: "" };
    }

    if (typeof from === "string") {
        return { name: from, email: from };
    }

    return {
        name: from.name ?? from.email ?? "",
        email: from.email ?? "",
    };
}

function buildPrompt(input: EmailForAi): string {
    const { email, parsedAttachments } = input;

    return JSON.stringify(
        {
            email: {
                id: email.id,
                subject: email.subject ?? "",
                from: normalizeSender(email.from),
                receivedDateTime: email.receivedDateTime ?? "",
                bodyPreview: email.bodyPreview ?? "",
                body: email.body ?? "",
                importance: email.importance ?? "",
                hasAttachments: Boolean(email.hasAttachments),
            },
            attachments: parsedAttachments.map((attachment) => ({
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                parseStatus: attachment.parseStatus,
                text: attachment.text,
                error: attachment.error,
            })),
        },
        null,
        2,
    );
}

export function buildFallbackPriority(email: IncomingEmail): PrioritizedEmail {
    const sender = normalizeSender(email.from);

    return {
        emailId: email.id,
        subject: email.subject ?? "",
        from: sender,
        receivedDateTime: email.receivedDateTime ?? new Date(0).toISOString(),
        priority: "Medium",
        score: 5,
        reasoning: "AI prioritization failed; manual review recommended.",
        suggestedAction: "Review manually.",
        category: "Other",
        deadlineDetected: null,
        attachmentInsights: [],
    };
}

export async function prioritizeEmailWithAi(
    input: EmailForAi,
): Promise<PrioritizedEmail> {
    const result = await generateText({
        model: getModel(),
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(input),
        output: Output.object({
            schema: emailPrioritySchema,
            name: "EmailPriority",
            description: "Priority analysis for one Gmail email.",
        }),
    });

    const parsed = emailPrioritySchema.parse(result.output);
    const score = clampScore(parsed.score);

    return {
        ...parsed,
        emailId: input.email.id,
        subject: parsed.subject || input.email.subject || "",
        from:
            parsed.from.email || parsed.from.name
                ? parsed.from
                : normalizeSender(input.email.from),
        receivedDateTime:
            parsed.receivedDateTime ||
            input.email.receivedDateTime ||
            new Date(0).toISOString(),
        score,
        priority: priorityFromScore(score),
        reasoning: parsed.reasoning || "No reasoning provided by AI.",
        suggestedAction: parsed.suggestedAction || "Review manually.",
    };
}
