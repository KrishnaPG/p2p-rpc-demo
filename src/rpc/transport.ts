import { encode } from "cbor-x";
import { TransportError } from "./errors";
import { gFramePool, MAX_FRAME_SIZE } from "./frame-pool";
import { RingBuffer } from "./ring-buffer";
import type { FrameType, TP2PEncryptedSocket, TP2PPayload } from "./types";

// export function makeFrame(
// 	streamId: number,
// 	type: FrameType,
// 	payload: Uint8Array,
// ): Uint8Array {
// 	const totalSize = 8 + payload.length;

// 	if (totalSize > MAX_FRAME_SIZE + 8) {
// 		throw new TransportError(`Frame too large: ${totalSize} bytes`);
// 	}

// 	// Allocate from pool
// 	const buf = gFramePool.alloc(totalSize);

// 	// Build frame header
// 	const v = new DataView(buf.buffer, buf.byteOffset);
// 	v.setUint32(0, streamId, true);
// 	v.setUint8(4, payload.length & 0xff);
// 	v.setUint8(5, (payload.length >>> 8) & 0xff);
// 	v.setUint8(6, (payload.length >>> 16) & 0xff);
// 	v.setUint8(7, type);

// 	// Copy payload
// 	buf.set(payload, 8);

// 	// Return slice (caller is responsible for releasing)
// 	return buf.subarray(0, totalSize);
// }

export function parseFrame(frame: Uint8Array): {
	streamId: number;
	type: FrameType;
	payload: Uint8Array;
} {
	const v = new DataView(frame.buffer, frame.byteOffset);
	return {
		streamId: v.getUint32(0, true),
		type: v.getUint8(7) as FrameType,
		payload: frame.subarray(8),
	};
}

class FrameParser {
	private buffer = new RingBuffer();

	constructor(private onFrameHandler: (f: Uint8Array) => void) {}

	feed(chunk: Uint8Array): void {
		this.buffer.write(chunk);

		while (this.buffer.available >= 8) {
			// 1. peek header (no consume, no copy)
			const header = this.buffer.peekView(8);
			if (!header) break; // not enough contiguous bytes yet

			// 2. READ: Read the length from the temporary copy.
			const v = new DataView(header.buffer, header.byteOffset);
			const len = v.getUint8(4) | (v.getUint8(5) << 8) | (v.getUint8(6) << 16);

			const topByte = v.getUint8(6);
			if (topByte > 0xff || len >= MAX_FRAME_SIZE) {
				throw new TransportError(`Frame too large: ${len} bytes`);
			}

			const totalLen = 8 + len;
			if (this.buffer.available < totalLen) break; // not enough data yet

			// 4. consume the *whole* frame (header + payload) in one go
			const frame = this.buffer.readView(totalLen);
			this.onFrameHandler(frame);
		}
	}

	reset(): void {
		this.destroy();
		this.buffer = new RingBuffer();
	}

	destroy() {
		this.buffer.destroy();
	}
}

export class FramedTransport {
	private parser: FrameParser;
	private closed = false;

	constructor(
		private socket: TP2PEncryptedSocket,
		onFrame: (f: Uint8Array) => void,
	) {
		this.parser = new FrameParser(onFrame);
		socket.on("message", onFrame /** Direct messages */); // (buf: Buffer) => this.feed(buf));
	}

	feed(chunk: Uint8Array): void {
		if (this.closed) return;
		try {
			this.parser.feed(chunk);
		} catch (err) {
			console.error("Frame parsing error:", err);
			this.close();
		}
	}

	send(streamId: number, type: FrameType, body: TP2PPayload): Promise<void> {
		if (this.closed) throw new TransportError("Transport closed");

		const payload = body == null ? new Uint8Array(0) : encode(body);
		const needed = 8 + payload.length;
		if (needed >= MAX_FRAME_SIZE + 8)
			throw new TransportError("Frame too large");

		const frame = gFramePool.alloc(needed);
		{
			const v = new DataView(frame.buffer, frame.byteOffset);
			v.setUint32(0, streamId, true);
			v.setUint8(4, payload.length & 0xff);
			v.setUint8(5, (payload.length >>> 8) & 0xff);
			v.setUint8(6, (payload.length >>> 16) & 0xff);
			v.setUint8(7, type);
			frame.set(payload, 8); // single copy of payload bytes
		}
		return this.socket
			.send(frame)
			.catch((e: unknown) => {
				throw new TransportError(`Send failed: ${e}`);
			})
			.finally(() => gFramePool.release(frame));
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.parser.destroy();
		this.socket.destroy();
	}

	get isClosed(): boolean {
		return this.closed;
	}

	// Expose pool stats for monitoring
	getPoolStats() {
		return gFramePool.stats();
	}
}
