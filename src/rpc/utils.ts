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