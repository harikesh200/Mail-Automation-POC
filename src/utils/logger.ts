import pino from "pino";

type LogMetadata = Record<string, unknown>;
const customLevels = {
    success: 35,
} as const;

/**
 * Pino instance configured for local pretty logging, production JSON output,
 * and an application-specific `success` level.
 */
const pinoLogger = pino<keyof typeof customLevels>({
    level: process.env.LOG_LEVEL ?? "info",
    customLevels,
    transport:
        process.env.NODE_ENV === "production"
            ? undefined
            : {
                  target: "pino-pretty",
                  options: {
                      colorize: true,
                      ignore: "pid,hostname",
                      translateTime: "SYS:standard",
                      customLevels,
                      customColors:
                          "success:green,info:blue,warn:yellow,error:red",
                      useOnlyCustomProps: false,
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

/**
 * Redacts sensitive metadata keys before they reach the logger.
 *
 * @param metadata - Optional structured log metadata.
 * @returns Sanitized metadata, or `undefined` when no metadata was supplied.
 */
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

/**
 * Application logger facade with consistent metadata sanitization.
 */
export const logger = {
    success(message: string, metadata?: LogMetadata) {
        pinoLogger.success(sanitizeMetadata(metadata) ?? {}, message);
    },

    info(message: string, metadata?: LogMetadata) {
        pinoLogger.info(sanitizeMetadata(metadata) ?? {}, message);
    },

    debug(message: string, metadata?: LogMetadata) {
        pinoLogger.debug(sanitizeMetadata(metadata) ?? {}, message);
    },

    warn(message: string, metadata?: LogMetadata) {
        pinoLogger.warn(sanitizeMetadata(metadata) ?? {}, message);
    },

    error(message: string, metadata?: LogMetadata) {
        pinoLogger.error(sanitizeMetadata(metadata) ?? {}, message);
    },
};
