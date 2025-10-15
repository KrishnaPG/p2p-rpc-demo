import type { TP2PMethodSpec, TP2PStreamHandler } from "./types";

export class RpcError extends Error {
	constructor(
		public code: number,
		message: string,
	) {
		super(message);
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