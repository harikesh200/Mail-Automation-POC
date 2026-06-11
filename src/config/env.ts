import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

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
    MAX_EMAILS_TO_PROCESS: z.coerce.number().int().min(10).max(20).default(20),
    MAX_ATTACHMENT_CHARS: z.coerce
        .number()
        .int()
        .min(1000)
        .max(50000)
        .default(12000),
});

/**
 * Parsed environment configuration for the application.
 *
 * Importing this value fails fast when required settings are missing or invalid.
 */
export const env = envSchema.parse(process.env);
