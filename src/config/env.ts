import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

/**
 * Validates and coerces all runtime configuration used by the backend.
 */
const envSchema = z.object({
    NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
        .enum([
            "fatal",
            "error",
            "warn",
            "success",
            "info",
            "debug",
            "trace",
            "silent",
        ])
        .default("info"),
    CORS_ORIGIN: z.string().default("*"),
    GOOGLE_GENERATIVE_AI_API_KEY: z
        .string()
        .min(1, "GOOGLE_GENERATIVE_AI_API_KEY is required"),
    GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
    GOOGLE_CLIENT_SECRET: z
        .string()
        .min(1, "GOOGLE_CLIENT_SECRET is required"),
    GOOGLE_REDIRECT_URI: z
        .string()
        .min(1, "GOOGLE_REDIRECT_URI is required"),
    GOOGLE_REFRESH_TOKEN: z
        .string()
        .min(1, "GOOGLE_REFRESH_TOKEN is required"),
    MAX_EMAILS_TO_PROCESS: z.coerce.number().int().min(1).max(20).default(20),
    MAX_ATTACHMENT_CHARS: z.coerce
        .number()
        .int()
        .min(1000)
        .max(50000)
        .default(12000),
    GOOGLE_API_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(1000)
        .max(30000)
        .default(10000),
    LITEPARSE_OCR_ENABLED: z
        .enum(["true", "false"])
        .default("true")
        .transform((value) => value === "true"),
    LITEPARSE_OCR_LANGUAGE: z.string().default("eng"),
    LITEPARSE_OCR_SERVER_URL: z.string().optional(),
    LITEPARSE_TESSDATA_PATH: z
        .string()
        .optional()
        .transform((value) => value?.trim() || undefined),
    LITEPARSE_MAX_PAGES: z.coerce.number().int().min(1).max(1000).default(20),
    LITEPARSE_NUM_WORKERS: z.coerce.number().int().min(1).max(4).default(1),
});

/**
 * Parsed environment configuration for the application.
 *
 * Importing this value fails fast when required settings are missing or invalid.
 */
export const env = envSchema.parse(process.env);
