/** Serializes one private display and pauses queued agent operations during takeover. */
export class Control {
  owner: 'agent' | 'human' = 'agent';
  version = 0;
  private closed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private resumed?: { promise: Promise<void>; resolve: () => void };

  constructor(private readonly changed: (owner: 'agent' | 'human') => void) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => {
      if (this.closed) throw new Error('Private desktop closed');
      return work();
    });
    this.tail = result.catch(() => undefined);
    return result;
  }

  async agent<T>(work: () => Promise<T>): Promise<T> {
    for (;;) {
      if (this.closed) throw new Error('Private desktop closed');
      if (this.resumed) await this.resumed.promise;
      const result = await this.serial(async () => (this.owner === 'human' ? undefined : { value: await work() }));
      if (result) return result.value;
    }
  }

  preview<T>(work: () => Promise<T>): Promise<T> {
    return this.serial(work);
  }

  human<T>(work: () => Promise<T>): Promise<T> {
    return this.serial(async () => {
      if (this.owner !== 'human') throw new Error('Take over before sending input');
      return work();
    });
  }

  change(owner: 'agent' | 'human'): Promise<void> {
    return this.serial(async () => {
      if (owner === this.owner) return;
      this.owner = owner;
      this.version++;
      if (owner === 'human') {
        let resume!: () => void;
        const promise = new Promise<void>((resolve) => {
          resume = resolve;
        });
        this.resumed = { promise, resolve: resume };
      } else {
        this.resumed?.resolve();
        this.resumed = undefined;
      }
      this.changed(owner);
    });
  }

  close(): void {
    this.closed = true;
    this.resumed?.resolve();
    this.resumed = undefined;
  }
}
