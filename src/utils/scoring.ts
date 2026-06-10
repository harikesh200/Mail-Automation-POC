import type { PrioritizedEmail } from "../types/email.types";

/**
 * Orders prioritized emails by urgency score and then by recency.
 *
 * @param emails - Priority results to sort.
 * @returns A new array sorted by score descending, with newer emails first for ties.
 */
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

/**
 * Converts a normalized numeric score into the public priority label.
 *
 * @param score - Priority score on the 0-10 scale.
 * @returns `High` for scores 7-10, `Medium` for 4-6, and `Low` for 0-3.
 */
export function priorityFromScore(score: number): PrioritizedEmail["priority"] {
    if (score >= 7) {
        return "High";
    }

    if (score >= 4) {
        return "Medium";
    }

    return "Low";
}

/**
 * Normalizes model-provided scores to the supported integer range.
 *
 * Non-finite values fall back to `5` so malformed AI output remains reviewable
 * instead of becoming an extreme priority.
 *
 * @param score - Raw score value from AI output or fallback logic.
 * @returns An integer between 0 and 10.
 */
export function clampScore(score: number): number {
    if (!Number.isFinite(score)) {
        return 5;
    }

    return Math.max(0, Math.min(10, Math.round(score)));
}
