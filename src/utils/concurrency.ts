/**
 * Maps items with a fixed upper bound on concurrently running async tasks.
 *
 * @param items - Items to process.
 * @param concurrency - Maximum number of mapper calls running at the same time.
 * @param mapper - Async function applied to each item.
 * @returns Results in the same order as the input items.
 */
export async function mapWithConcurrency<Input, Output>(
    items: Input[],
    concurrency: number,
    mapper: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
    if (items.length === 0) {
        return [];
    }

    const workerCount = Math.max(
        1,
        Math.min(Math.trunc(concurrency), items.length),
    );
    const results: Output[] = [];
    let nextIndex = 0;

    async function runWorker(): Promise<void> {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await mapper(
                items[currentIndex]!,
                currentIndex,
            );
        }
    }

    await Promise.all(
        Array.from({ length: workerCount }, () => runWorker()),
    );

    return results;
}
