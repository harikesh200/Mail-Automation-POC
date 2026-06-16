import { env } from "../../../config/env";

type GmailMessageListResponse = {
    messages?: Array<{
        id?: string;
        threadId?: string;
    }>;
};

type GmailRawMessageResponse = {
    id?: string;
    threadId?: string;
    raw?: string;
    internalDate?: string;
};

type GoogleTokenResponse = {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    error?: string;
    error_description?: string;
};

function createTimeoutSignal(): AbortSignal {
    return AbortSignal.timeout(env.GOOGLE_API_TIMEOUT_MS);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};

    if (!response.ok) {
        const message =
            typeof body.error_description === "string"
                ? body.error_description
                : typeof body.error === "string"
                  ? body.error
                  : `Google API request failed with ${response.status}`;

        throw new Error(message);
    }

    return body as T;
}

async function getGoogleAccessToken(): Promise<string> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            refresh_token: env.GOOGLE_REFRESH_TOKEN,
            grant_type: "refresh_token",
        }),
        signal: createTimeoutSignal(),
    });
    const tokenResponse = await parseJsonResponse<GoogleTokenResponse>(response);

    if (!tokenResponse.access_token) {
        throw new Error("Google OAuth token response did not include access_token.");
    }

    return tokenResponse.access_token;
}

async function gmailGet<T>(
    path: string,
    params: Record<string, string | number | string[]>,
): Promise<T> {
    const accessToken = await getGoogleAccessToken();
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/${path}`);

    for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                url.searchParams.append(key, item);
            }
            continue;
        }

        url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
        headers: {
            authorization: `Bearer ${accessToken}`,
        },
        signal: createTimeoutSignal(),
    });

    return parseJsonResponse<T>(response);
}

export async function listInboxMessages(
    maxResults: number,
): Promise<GmailMessageListResponse> {
    return gmailGet<GmailMessageListResponse>("users/me/messages", {
        labelIds: ["INBOX"],
        maxResults,
    });
}

export async function getRawMessage(
    id: string,
): Promise<GmailRawMessageResponse> {
    return gmailGet<GmailRawMessageResponse>(
        `users/me/messages/${encodeURIComponent(id)}`,
        {
            format: "raw",
        },
    );
}
