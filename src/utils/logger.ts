import pino from "pino";

type LogMetadata = Record<string, unknown>;

const pinoLogger = pino({
    level: process.env.LOG_LEVEL ?? "info",
    transport:
        process.env.NODE_ENV === "production"
            ? undefined
            : {
                  target: "pino-pretty",
                  options: {
                      colorize: true,
                      ignore: "pid,hostname",
                      translateTime: "SYS:standard",
                  },
              },
    redact: {
        paths: [
            "*.key",
            "*.apiKey",
            "*.token",
            "*.secret",
            "*.password",
            "key",
            "apiKey",
            "token",
            "secret",
            "password",
        ],
        censor: "[redacted]",
    },
});

function sanitizeMetadata(metadata?: LogMetadata): LogMetadata | undefined {
    if (!metadata) {
        return undefined;
    }

    return Object.fromEntries(
        Object.entries(metadata).map(([key, value]) => {
            if (/key|token|secret|password/i.test(key)) {
                return [key, "[redacted]"];
            }

            return [key, value];
        }),
    );
}

export const logger = {
    info(message: string, metadata?: LogMetadata) {
        pinoLogger.info(sanitizeMetadata(metadata) ?? {}, message);
    },

    warn(message: string, metadata?: LogMetadata) {
        pinoLogger.warn(sanitizeMetadata(metadata) ?? {}, message);
    },

    error(message: string, metadata?: LogMetadata) {
        pinoLogger.error(sanitizeMetadata(metadata) ?? {}, message);
    },
};
