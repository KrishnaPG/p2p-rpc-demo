const STREAM_HIGH_WATER_MARK = 100;

export class AsyncSink<T = any> {
  private queue: T[] = [];
  private ended = false;
  private error: Error | null = null;
  private waiters: Array<() => void> = [];
  private consumers = 0;
  private highWaterMark: number;

  constructor(highWaterMark = STREAM_HIGH_WATER_MARK) {
    this.highWaterMark = highWaterMark;
  }

  async push(value: T): Promise<void> {
    if (this.ended) throw new Error("Cannot push to ended sink");
    this.queue.push(value);
    this.notifyWaiters();

    // Backpressure: wait if queue is too large
    if (this.queue.length > this.highWaterMark) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (this.queue.length <= this.highWaterMark / 2) {
            resolve();
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      });
    }
  }

  end(error?: Error): void {
    this.ended = true;
    if (error) this.error = error;
    this.notifyWaiters();
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
    this.consumers++;
    try {
      while (true) {
        while (this.queue.length > 0) {
          const value = this.queue.shift()!;
          yield value;
        }

        if (this.ended) {
          if (this.error) throw this.error;
          return;
        }

        await new Promise<void>((resolve) => this.waiters.push(resolve));
      }
    } finally {
      this.consumers--;
    }
  }

  private notifyWaiters(): void {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => w());
  }

  get length(): number {
    return this.queue.length;
  }
}
