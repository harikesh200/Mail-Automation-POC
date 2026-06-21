import cors, { type CorsOptions } from "cors";
import express from "express";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { calendarSyncRouter } from "./routes/calendarSync.routes";
import { emailReplyRouter } from "./routes/emailReply.routes";
import { prioritizeRouter } from "./routes/prioritize.routes";
import { logger } from "./utils/logger";

/**
 * Express application instance for the email prioritizer API.
 */
const app = express();

/**
 * Parses `CORS_ORIGIN` into a value supported by the CORS middleware.
 *
 * Supports a wildcard (`*`), a single origin URL, or a comma-separated list
 * of origins.
 */
function parseCorsOrigin(corsOrigin: string): CorsOptions["origin"] {
    const value = corsOrigin.trim();

    if (!value || value === "*") {
        return "*";
    }

    const origins = value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);

    return origins.length === 1 ? origins[0] : origins;
}

const corsOptions: CorsOptions = {
    origin: parseCorsOrigin(env.CORS_ORIGIN),
};

app.use(requestLogger);
app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
    res.json({ success: true, status: "ok" });
});

app.get("/", (_req, res) => {
    res.json({ success: true, status: "ok" });
});

app.use("/api", prioritizeRouter);
app.use("/api", emailReplyRouter);
app.use("/api", calendarSyncRouter);
app.use(errorHandler);

const server = app.listen(env.PORT, "0.0.0.0", () => {
    logger.info(`Email prioritizer backend listening on port ${env.PORT}`, {
        corsOrigin: env.CORS_ORIGIN,
    });
});

const shutdownTimeoutMs = 10_000;
let isShuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;
    logger.info("Shutdown signal received; closing HTTP server", { signal });

    const forceExitTimeout = setTimeout(() => {
        logger.error("Graceful shutdown timed out; forcing exit");
        process.exit(1);
    }, shutdownTimeoutMs);

    server.close((error) => {
        clearTimeout(forceExitTimeout);

        if (error) {
            logger.error("HTTP server shutdown failed", { error });
            process.exit(1);
        }

        logger.info("HTTP server closed gracefully");
        process.exit(0);
    });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
