import { encode } from "cbor-x";
import { TransportError } from "./errors";
import { gFramePool, MAX_FRAME_SIZE } from "./frame-pool";
import { RingBuffer } from "./ring-buffer";
import type { FrameType, ISocketLike, TP2PPayload } from "./types";
import { concat } from "./utils";

export function makeFrame(
	streamId: number,
	type: FrameType,
	payload: Uint8Array,
): Uint8Array {
	const totalSize = 8 + payload.length;

	if (totalSize > MAX_FRAME_SIZE + 8) {
		throw new TransportError(`Frame too large: ${totalSize} bytes`);
	}

	// Allocate from pool
	const buf = gFramePool.alloc(totalSize);

	// Build frame header
	const v = new DataView(buf.buffer, buf.byteOffset);
	v.setUint32(0, streamId, true);
	v.setUint8(4, payload.length & 0xff);
	v.setUint8(5, (payload.length >>> 8) & 0xff);
	v.setUint8(6, (payload.length >>> 16) & 0xff);
	v.setUint8(7, type);

	// Copy payload
	buf.set(payload, 8);

	// Return slice (caller is responsible for releasing)
	return buf.subarray(0, totalSize);
}

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
			// 1. PEEK: Get a temporary copy of the header from the pool.
			const header = this.buffer.peek(8);
			if (!header) break;

			// 2. READ: Read the length from the temporary copy.
			const v = new DataView(header.buffer, header.byteOffset);
			const len = v.getUint8(4) | (v.getUint8(5) << 8) | (v.getUint8(6) << 16);

			// 3. RELEASE: We are done with the header copy. Return it to the pool.
			// This does NOT affect the data inside the RingBuffer.
			this.buffer.releasePeekBuffer(header);

			if (len > MAX_FRAME_SIZE) {
				throw new TransportError(`Frame too large: ${len} bytes`);
			}

			const totalLen = 8 + len;
			if (this.buffer.available < totalLen) break; // Not enough data to construct frames yet

			// 4. PEEK: Get a temporary copy of the full frame from the pool.
			const frame = this.buffer.peek(totalLen);
			if (!frame) break;

			// 5. PROCESS: Give the temporary frame copy to the handler.
			// handler must NOT release the frame, since we release it below;
			this.onFrameHandler(frame);

			// 6. CONSUME: This is the crucial step. We now tell the RingBuffer
			// to discard its original data (header + payload). This advances the
			// read pointer and frees up space in the RingBuffer's internal memory.
			this.buffer.consume(totalLen);

			// 7. RELEASE (Conditional): If the handler signaled it's done with the
			// frame copy, we can now return it to the pool.
			this.buffer.releasePeekBuffer(frame);
		}
	}

	reset(): void {
		this.buffer.destroy();
		this.buffer = new RingBuffer();
	}
}

export class FramedTransport {
	private parser: FrameParser;
	private closed = false;

	constructor(
		private socket: ISocketLike,
		onFrame: (f: Uint8Array) => void,
	) {
		this.parser = new FrameParser(onFrame);
		socket.onData((data) => this.feed(data));
		socket.onClose?.(() => this.handleClose());
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

	async send(
		streamId: number,
		type: FrameType,
		body: TP2PPayload,
	): Promise<void> {
		if (this.closed) throw new TransportError("Transport closed");

		let pooledBuffer: Uint8Array | null = null;
		try {
			const payload =
				body !== null && body !== undefined ? encode(body) : new Uint8Array(0);
			const frame = makeFrame(streamId, type, payload);

			// Keep reference to the underlying pooled buffer
			pooledBuffer = new Uint8Array(frame.buffer);

			await this.socket.send(frame);

			// Successfully sent - release back to pool
			return gFramePool.release(pooledBuffer);
		} catch (err) {
			// Release on error too
			if (pooledBuffer) {
				gFramePool.release(pooledBuffer);
			}
			throw new TransportError(`Send failed: ${err}`);
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.parser.reset();
	}

	private handleClose(): void {
		this.close();
	}

	get isClosed(): boolean {
		return this.closed;
	}

	// Expose pool stats for monitoring
	getPoolStats() {
		return gFramePool.stats();
	}
}
