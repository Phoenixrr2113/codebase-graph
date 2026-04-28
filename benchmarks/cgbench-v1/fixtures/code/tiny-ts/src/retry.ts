export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) { last = err; }
  }
  throw last;
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 2 ** i * 100));
    }
  }
  throw last;
}
