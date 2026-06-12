import cors, { type CorsOptions } from "cors";
import express from "express";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
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

app.use("/api", prioritizeRouter);
app.use("/api", emailReplyRouter);
app.use(errorHandler);

app.listen(env.PORT, () => {
    logger.info(`Email prioritizer backend listening on port ${env.PORT}`, {
        corsOrigin: env.CORS_ORIGIN,
    });
});
