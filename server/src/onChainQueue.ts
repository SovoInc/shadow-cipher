// Semaphore-based queue for on-chain transactions.
// Only one DUST coin is available at a time, so we serialize all on-chain ops.
// Player transactions (declare) get priority over pool refill.

type QueueEntry<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  priority: number; // lower = higher priority
};

const queue: QueueEntry<any>[] = [];
let running = false;

async function processQueue(): Promise<void> {
  if (running) return;
  running = true;

  while (queue.length > 0) {
    queue.sort((a, b) => a.priority - b.priority);
    const entry = queue.shift()!;
    try {
      const result = await entry.fn();
      entry.resolve(result);
    } catch (err) {
      entry.reject(err);
    }
  }

  running = false;
}

function enqueue<T>(fn: () => Promise<T>, priority: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ fn, resolve, reject, priority });
    void processQueue();
  });
}

/** High priority — player-facing operations (declare/guess). */
export const enqueueOnChain = <T>(fn: () => Promise<T>): Promise<T> => enqueue(fn, 0);

/** Low priority — pool refill operations. */
export const enqueuePoolRefill = <T>(fn: () => Promise<T>): Promise<T> => enqueue(fn, 10);
