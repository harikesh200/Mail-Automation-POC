import type { RequestHandler } from "express";
import { logger } from "../utils/logger";

/**
 * Logs API request completion with status and latency.
 *
 * Request bodies and query strings are intentionally excluded to avoid leaking
 * email content, credentials, or tokens into logs.
 */
export const requestLogger: RequestHandler = (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const metadata = {
        method: req.method,
        path: req.path,
    };

    logger.info("API request received", metadata);

    res.on("finish", () => {
        const durationMs =
            Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        const responseMetadata = {
            ...metadata,
            statusCode: res.statusCode,
            durationMs: Math.round(durationMs),
        };

        if (res.statusCode >= 500) {
            logger.error("API request failed", responseMetadata);
            return;
        }

        if (res.statusCode >= 400) {
            logger.warn(
                "API request completed with client error",
                responseMetadata,
            );
            return;
        }

        logger.success("API request completed successfully", responseMetadata);
    });

    next();
};
