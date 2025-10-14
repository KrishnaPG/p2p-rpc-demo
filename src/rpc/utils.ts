import type { TP2PMethodSpec, TP2PStreamHandler } from "./transport";

export class RpcError extends Error {
	constructor(
		public code: number,
		message: string,
	) {
		super(message);
	}
}

export class AsyncSink<T = any> {
	private q: T[] = [];
	private ended = false;
	private wait?: () => void;
	async *getIterator() {
		while (true) {
			while (this.q.length) yield this.q.shift();
			if (this.ended) return;
			await new Promise<void>((r) => (this.wait = r));
		}
	}
	push(v: T) {
		this.q.push(v);
		this.wait?.();
	}
	end(e?: T) {
		this.ended = true;
		if (e) this.q.push(Promise.reject(e));
		this.wait?.();
	}
	[Symbol.asyncIterator]() {
		return this.getIterator();
	}
}

export function isStream(h: TP2PMethodSpec): h is TP2PStreamHandler {
	return h != null && (h as any).constructor.name === "AsyncGeneratorFunction";
}

export function methodWithToken(method: string, token: string): string {
	return `${token}.result`;
}

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
	const c = new Uint8Array(a.length + b.length);
	c.set(a, 0);
	c.set(b, a.length);
	return c;
}