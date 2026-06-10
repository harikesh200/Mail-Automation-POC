import { type ModelMessage, streamText } from "ai";
import { google } from "@ai-sdk/google";
import "dotenv/config";
import * as readline from "node:readline/promises";

const terminal = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const messages: ModelMessage[] = [];

/**
 * Runs a simple terminal chat loop against Gemini with Google Search enabled.
 */
async function main() {
    while (true) {
        const userInput = await terminal.question("You: ");

        messages.push({ role: "user", content: userInput });

        const result = streamText({
            model: google("gemini-2.5-flash"),
            messages,
            tools: {
                web_search: google.tools.googleSearch({}),
            },
        });

        let fullResponse = "";
        process.stdout.write("\nAssistant: ");
        for await (const delta of result.textStream) {
            fullResponse += delta;
            process.stdout.write(delta);
        }
        process.stdout.write("\n\n");

        messages.push({ role: "assistant", content: fullResponse });
    }
}

main().catch(console.error);
