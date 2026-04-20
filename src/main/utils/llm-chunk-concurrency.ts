/**
 * Parallelle chunk-LLM-requests (extractie / criteria-deelpassen).
 * Limiet houdt rekening met typische API-concurrency en rate limits (Moonshot/OpenAI).
 */
export const LLM_CHUNK_EXTRACTION_CONCURRENCY = 3

/**
 * Voert `worker` uit in batches van max `concurrency` gelijktijdige taken.
 * Garantie: `results[i]` hoort bij `items[i]`.
 */
export async function runBatchedParallel<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  const limit = Math.max(1, concurrency)
  for (let start = 0; start < items.length; start += limit) {
    const end = Math.min(start + limit, items.length)
    await Promise.all(
      Array.from({ length: end - start }, (_, k) => {
        const i = start + k
        return worker(items[i], i).then((r) => {
          results[i] = r
        })
      }),
    )
  }
  return results
}
