import dotenv from "dotenv";
import express from "express";
import { google } from "googleapis";

dotenv.config();

function requireEnv(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }

    return value;
}

const oauth2Client = new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    requireEnv("GOOGLE_REDIRECT_URI"),
);

const scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
];

const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
});

const app = express();

app.get("/", (_req, res) => {
    res.redirect(authUrl);
});

app.get("/oauth2callback", async (req, res) => {
    const code = req.query.code;

    if (typeof code !== "string") {
        res.status(400).send("Missing authorization code");
        return;
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);

        oauth2Client.setCredentials(tokens);

        console.log("\nToken response:\n");
        console.log(JSON.stringify(tokens, null, 2));

        if (!tokens.refresh_token) {
            console.log("\nNo refresh token was returned.");
            console.log(
                "Go to your Google Account > Security > Third-party access, remove this app, then run this script again.",
            );
        } else {
            console.log("\nAdd this to your .env:\n");
            console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
        }

        if (tokens.access_token) {
            const tokenInfo = await oauth2Client.getTokenInfo(
                tokens.access_token,
            );

            console.log("\nGranted scopes:\n");
            console.log(tokenInfo.scopes);

            const requiredScopes = [
                "https://www.googleapis.com/auth/gmail.readonly",
                "https://www.googleapis.com/auth/gmail.send",
                "https://www.googleapis.com/auth/calendar.readonly",
                "https://www.googleapis.com/auth/calendar.events",
            ];

            console.log("\nScope verification:\n");

            for (const scope of requiredScopes) {
                console.log(`${scope}: ${tokenInfo.scopes.includes(scope)}`);
            }
        }

        res.send("Token flow completed. Check your terminal output.");
    } catch (error) {
        console.error(error);
        res.status(500).send("Failed to get token");
    }
});

app.listen(3000, () => {
    console.log("Open this URL:");
    console.log("http://localhost:3000");
});
