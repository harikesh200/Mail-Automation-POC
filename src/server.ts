import express from "express";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { requestLogger } from "./middleware/requestLogger";
import { prioritizeRouter } from "./routes/prioritize.routes";
import { logger } from "./utils/logger";

/**
 * Express application instance for the email prioritizer API.
 */
const app = express();

app.use(requestLogger);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
    res.json({ success: true, status: "ok" });
});

app.use("/api", prioritizeRouter);
app.use(errorHandler);

app.listen(env.PORT, () => {
    logger.info(`Email prioritizer backend listening on port ${env.PORT}`);
});
