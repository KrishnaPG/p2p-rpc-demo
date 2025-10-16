import type NoiseSecretStream from "@hyperswarm/secret-stream";

export const PING_INTERVAL = 30000; // 30s
export const PONG_TIMEOUT = 10000; // 10s
export const MAX_PENDING_REQUESTS = 25; // on the client side
export const MAX_ACTIVE_STREAMS = 10; // on the server side, per connection
export const MAX_REQUEST_SIZE = 1 * 1024 * 1024; // 1 MB – make it configurable

export type TP2PPayload = unknown;
export type TP2PHandler = (req: TP2PPayload) => Promise<TP2PPayload | void>;
export type TP2PStreamHandler = (
	req: TP2PPayload,
) => AsyncIterable<TP2PPayload>;
export type TP2PMethodSpec = TP2PHandler | TP2PStreamHandler;

// export interface ISocketLike {
// 	send(data: Uint8Array): Promise<void>;
// 	onMessage: (cb: (msgBuf: Buffer) => void) => void; // unordered messages on UDX
// 	onData?: (cb: (data: Uint8Array) => void) => void;
// 	onClose?: (cb: () => void) => void;
// }

export type TP2PEncryptedSocket = NoiseSecretStream;

export enum FrameType {
	Request = 0,
	Response = 1,
	StreamItem = 2,
	Error = 3,
	Close = 4,
	Ack = 5,
	Ping = 6,
	Pong = 7,
	Faf = 8,
	StreamEnd = 9,
}
