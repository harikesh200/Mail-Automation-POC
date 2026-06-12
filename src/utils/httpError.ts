/**
 * Error type for expected HTTP failures.
 */
export class HttpError extends Error {
    /**
     * Creates an HTTP-aware error that the centralized error handler can map to
     * a response status code.
     */
    constructor(
        public readonly statusCode: number,
        message: string,
    ) {
        super(message);
        this.name = "HttpError";
    }
}
