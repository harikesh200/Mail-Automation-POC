import type {
    IncomingEmail,
    ParsedAttachment,
    PrioritizedEmail,
} from "../types/email.types";

type AttachmentInsight = PrioritizedEmail["attachmentInsights"][number];

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

function hasMeaningfulAttachmentText(attachment: ParsedAttachment): boolean {
    return (
        attachment.parseStatus === "parsed" && attachment.text.trim().length > 0
    );
}

function buildFallbackAttachmentInsight(
    attachment: ParsedAttachment,
): AttachmentInsight {
    const normalizedText = attachment.text.replace(/\s+/g, " ").trim();
    const preview =
        normalizedText.length > 240
            ? `${normalizedText.slice(0, 237)}...`
            : normalizedText;

    return {
        filename: attachment.filename,
        summary: preview || "Attachment text was parsed but empty.",
        keyRisks: [],
        keyDates: [],
        financialImpact: null,
    };
}

function ensureAttachmentInsights(
    insights: AttachmentInsight[],
    parsedAttachments: ParsedAttachment[],
): AttachmentInsight[] {
    const output = [...insights];
    const filenamesWithInsights = new Set(
        output.map((insight) => insight.filename.toLowerCase()),
    );

    for (const attachment of parsedAttachments) {
        if (!hasMeaningfulAttachmentText(attachment)) {
            continue;
        }

        if (filenamesWithInsights.has(attachment.filename.toLowerCase())) {
            continue;
        }

        output.push(buildFallbackAttachmentInsight(attachment));
        filenamesWithInsights.add(attachment.filename.toLowerCase());
    }

    return output;
}

/**
 * Creates a safe priority result when AI analysis fails for an email.
 */
export function buildFallbackPriority(
    email: IncomingEmail,
    parsedAttachments: ParsedAttachment[] = [],
): PrioritizedEmail {
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
        attachmentInsights: ensureAttachmentInsights([], parsedAttachments),
    };
}
