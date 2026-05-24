export class ConcurrencySemaphore {
  private activeCount = 0;
  private queue: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.activeCount < this.limit) {
      this.activeCount += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    this.activeCount -= 1;
    const next = this.queue.shift();
    if (next) {
      this.activeCount += 1;
      next();
    }
  }
}
