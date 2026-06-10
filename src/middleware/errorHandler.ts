import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../utils/logger";

export class HttpError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string,
    ) {
        super(message);
        this.name = "HttpError";
    }
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) {
        res.status(400).json({
            success: false,
            error: "Invalid request or configuration.",
        });
        return;
    }

    if (error instanceof HttpError) {
        res.status(error.statusCode).json({
            success: false,
            error: error.message,
        });
        return;
    }

    logger.error("Unhandled request error", {
        message: error instanceof Error ? error.message : String(error),
    });

    res.status(500).json({
        success: false,
        error: "Internal server error.",
    });
};
