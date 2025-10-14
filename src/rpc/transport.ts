import { encode } from "cbor-x";
import { concat } from "./utils";

/* ========== types ========== */
export type TP2PPayload = any;
export type TP2PHandler = (req: TP2PPayload) => Promise<TP2PPayload | void>;
export type TP2PStreamHandler = (
	req: TP2PPayload,
) => AsyncIterable<TP2PPayload>;
export type TP2PMethodSpec = TP2PHandler | TP2PStreamHandler | null; // null = fire-and-forget

export interface ISocketLike {
	send(data: Uint8Array): Promise<unknown>;
	onData: (cb: (data: Uint8Array) => void) => void;
	onClose?: (cb: () => void) => void;
}

/* ========== framing ========== */
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
}

function makeFrame(
	streamId: number,
	type: FrameType,
	payload: Uint8Array,
): Uint8Array {
	const frame = new Uint8Array(8 + payload.length);
	const v = new DataView(frame.buffer);
	v.setUint32(0, streamId, true);
	v.setUint8(4, (payload.length >>> 0) & 0xff);
	v.setUint8(5, (payload.length >>> 8) & 0xff);
	v.setUint8(6, (payload.length >>> 16) & 0xff);
	v.setUint8(7, type);
	frame.set(payload, 8);
	return frame;
}

function* parseFrames(chunk: Uint8Array): Generator<Uint8Array, void> {
	let off = 0;
	while (off + 8 <= chunk.length) {
		const v = new DataView(chunk.buffer, chunk.byteOffset);
		const streamId = v.getUint32(off, true);
		const len =
			v.getUint8(off + 4) +
			(v.getUint8(off + 5) << 8) +
			(v.getUint8(off + 6) << 16);
		const type = v.getUint8(off + 7);
		if (chunk.length < off + 8 + len) break; // need more
		yield chunk.subarray(off, off + 8 + len);
		off += 8 + len;
	}
	if (off < chunk.length) (parseFrames as any).remainder = chunk.subarray(off);
}

/* ========== shared transport ========== */
export class FramedTransport {
	private recvBuffer = new Uint8Array(0);
	constructor(
		private socket: ISocketLike,
		private onFrame: (f: Uint8Array) => void,
	) {
		socket.onData((b) => this.feed(b));
	}
	feed(chunk: Uint8Array) {
		const rem = (parseFrames as any).remainder;
		if (rem) chunk = concat(rem, chunk);
		for (const f of parseFrames(chunk)) this.onFrame(f);
		(parseFrames as any).remainder = undefined;
	}
	send(streamId: number, type: FrameType, body: TP2PPayload) {
		const payload = encode(body);
		return this.socket.send(makeFrame(streamId, type, payload));
	}
}

/* ========== client ========== */


/* ========== server ========== */


/* ========== helpers ========== */


/* ========== quick self-test ========== */

