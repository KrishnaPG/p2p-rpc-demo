import { decode } from "cbor-x";
import { FramedTransport, parseFrame } from "./transport";
import {
	FrameType,
	type TP2PEncryptedSocket,
	type TP2PHandler,
	type TP2PMethodSpec,
	type TP2PPayload,
	type TP2PStreamHandler,
} from "./types";
import { isStream } from "./utils";

export class RpcServer {
	private transport: FramedTransport;
	private activeStreams = new Map<number, AbortController>(); // TODO: cleaning up inactive steams?
	private closed = false;
  private static readonly MAX_STREAMS = 10_000;   // pick a sane limit
  private static readonly STREAM_TTL_MS = 60_000; // 1 min idle timeout
  
	constructor(
		conn: TP2PEncryptedSocket,
		private handlers: Record<string, TP2PMethodSpec>,
	) {
		conn.once("close", () => this.close());
		this.transport = new FramedTransport(conn, (f) => this.handleFrame(f));
	}

	private async handleFrame(frame: Uint8Array): Promise<void> {
		if (this.closed) return;

		const { streamId, type, payload } = parseFrame(frame);
		try {
			if (type === FrameType.Ping) {
				return this.transport.send(streamId, FrameType.Pong, null);
			}

			if (type === FrameType.Pong) return;

			if (type === FrameType.Close) {
				const controller = this.activeStreams.get(streamId);
				if (controller) {
					controller.abort();
					this.activeStreams.delete(streamId);
				}
				return;
			}

			if (type !== FrameType.Request && type !== FrameType.Faf) return;

			if (type === FrameType.Request && this.activeStreams.has(streamId)) {
				return this.transport.send(streamId, FrameType.Error, {
					code: -32603,
					message: "streamId already in use",
				});
			}

			const body = payload.length > 0 ? decode(payload) : {};
			const { method, params } = body;

			if (!method) {
				return this.transport.send(streamId, FrameType.Error, {
					code: -32600,
					message: "Invalid request",
				});
			}

			const handler = this.handlers[method];
			if (!handler) {
				return this.transport.send(streamId, FrameType.Error, {
					code: -32601,
					message: `Method not found: ${method}`,
				});
			}

			if (isStream(handler)) {
				return this.runStream(streamId, handler as TP2PStreamHandler, params);
			} else {
				return this.runUnary(streamId, handler, params);
			}
		} catch (err: any) {
			console.error("Frame handling error:", err);
			// send a proper RPC error frame so the caller sees something
			// use streamId 0 only if we failed to parse one
			const id = typeof streamId === "number" ? streamId : 0;
			await this.transport.send(id, FrameType.Error, {
				code: -32700, // parse/error standard code
				message: "Server error",
				data: process.env.NODE_ENV !== "production" ? err.stack : (err.message || err),
			});
		}
	}

	private async runUnary(
		id: number,
		handler: TP2PHandler,
		req: TP2PPayload,
	): Promise<void> {
		try {
			const result = await handler(req);
			return this.transport.send(id, FrameType.Response, result ?? null);
		} catch (err: any) {
			return this.transport.send(id, FrameType.Error, {
				code: err.code ?? -32603,
				message: err.message ?? "Internal error",
				data: err.data,
			});
		}
	}

	private async runStream(
		id: number,
		handler: TP2PStreamHandler,
		req: TP2PPayload,
	): Promise<void> {
		const controller = new AbortController();
		this.activeStreams.set(id, controller);

		try {
			for await (const item of handler(req)) {
				if (controller.signal.aborted) return;
				await this.transport.send(id, FrameType.StreamItem, item);
			}
			/* do NOT send StreamEnd after abort */
			if (!controller.signal.aborted)
				return this.transport.send(id, FrameType.StreamEnd, null);
		} catch (err: any) {
			if (!controller.signal.aborted) {
				return this.transport.send(id, FrameType.Error, {
					code: err.code ?? -32603,
					message: err.message ?? "Internal error",
					data: err.data,
				});
			}
		} finally {
			this.activeStreams.delete(id);
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;

		this.activeStreams.forEach((controller) => controller.abort());
		this.activeStreams.clear();
		this.transport.close();
	}
}
