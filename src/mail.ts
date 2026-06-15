import {
    fetchEmailById,
    fetchLatestEmails,
    fetchThreadEmails,
} from "./adapters/google/gmail/fetcher";
import { sendReply } from "./adapters/google/gmail/reply";

export { fetchEmailById, fetchLatestEmails, fetchThreadEmails, sendReply };
export type {
    EmailAttachmentSummary,
    EmailSummary,
    SendReplyInput,
    SentEmailSummary,
} from "./types/gmail.types";

if (import.meta.main) {
    fetchLatestEmails()
        .then((emails) => {
            console.log(JSON.stringify(emails, null, 2));
        })
        .catch((error) => {
            console.error("Failed to fetch emails:", error);
        });
}
