import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "../utils/httpError";
import { logger } from "../utils/logger";

/**
 * Converts thrown application errors into consistent JSON error responses.
 *
 * Zod validation errors become `400`, `HttpError` instances preserve their
 * status code, and unexpected errors are logged before returning `500`.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
    if (error instanceof ZodError) {
        logger.warn("Request validation failed", {
            method: req.method,
            path: req.path,
            statusCode: 400,
            issues: error.issues.map((issue) => ({
                path: issue.path.join("."),
                code: issue.code,
                message: issue.message,
            })),
        });

        res.status(400).json({
            success: false,
            error: "Invalid request or configuration.",
        });
        return;
    }

    if (error instanceof HttpError) {
        logger.warn("Handled request error", {
            method: req.method,
            path: req.path,
            statusCode: error.statusCode,
            message: error.message,
        });

        res.status(error.statusCode).json({
            success: false,
            error: error.message,
        });
        return;
    }

    logger.error("Unhandled request error", {
        method: req.method,
        path: req.path,
        statusCode: 500,
        name: error instanceof Error ? error.name : undefined,
        message: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
        success: false,
        error: "Internal server error.",
    });
};
