import type { PrioritizedEmail } from "../types/email.types";

export function sortPrioritizedEmails(
    emails: PrioritizedEmail[],
): PrioritizedEmail[] {
    return [...emails].sort((left, right) => {
        if (right.score !== left.score) {
            return right.score - left.score;
        }

        return (
            Date.parse(right.receivedDateTime) -
            Date.parse(left.receivedDateTime)
        );
    });
}

export function priorityFromScore(score: number): PrioritizedEmail["priority"] {
    if (score >= 7) {
        return "High";
    }

    if (score >= 4) {
        return "Medium";
    }

    return "Low";
}

export function clampScore(score: number): number {
    if (!Number.isFinite(score)) {
        return 5;
    }

    return Math.max(0, Math.min(10, Math.round(score)));
}
