import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

const REQUIRED_ENV_VARS = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "GOOGLE_REFRESH_TOKEN",
] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

/**
 * Reads a required Gmail OAuth environment variable.
 */
function requireEnv(name: RequiredEnvVar): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

/**
 * Creates an authenticated Gmail API client using a stored OAuth refresh token.
 */
export function createGmailClient() {
    const oauth2Client = new google.auth.OAuth2(
        requireEnv("GOOGLE_CLIENT_ID"),
        requireEnv("GOOGLE_CLIENT_SECRET"),
        requireEnv("GOOGLE_REDIRECT_URI"),
    );

    oauth2Client.setCredentials({
        refresh_token: requireEnv("GOOGLE_REFRESH_TOKEN"),
    });

    return google.gmail({
        version: "v1",
        auth: oauth2Client,
    });
}

export type GmailClient = ReturnType<typeof createGmailClient>;
