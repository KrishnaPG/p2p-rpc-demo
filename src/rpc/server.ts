import { decode } from "cbor-x";
import { PeerBase } from "./peer-base";
import { FramedTransport, parseFrame } from "./transport";
import {
	FrameType,
	MAX_ACTIVE_STREAMS,
	MAX_REQUEST_SIZE,
	type TP2PEncryptedSocket,
	type TP2PHandler,
	type TP2PMethodSpec,
	type TP2PPayload,
	type TP2PStreamHandler,
} from "./types";
import { isStream } from "./utils";

export class RpcServer extends PeerBase {
	private activeStreams = new Map<number, AbortController>();
	private closed = false;

	constructor(
		conn: TP2PEncryptedSocket,
		private handlers: Record<string, TP2PMethodSpec>,
	) {
		super(conn);
	}

	async handleFrame(frame: Uint8Array): Promise<void> {
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

			if (payload.length > MAX_REQUEST_SIZE)
				return this.sendError(
					streamId,
					-32600,
					`Payload exceeded ${MAX_REQUEST_SIZE} Bytes`,
				);

			const body = payload.length > 0 ? decode(payload) : {};
			const { method, params } = body;

			if (!method) {
				return this.sendError(streamId, -32600, "Invalid request");
			}

			const handler = this.handlers[method];
			if (!handler) {
				return this.sendError(streamId, -32601, `Method not found: ${method}`);
			}

			if (isStream(handler)) {
				return this.runStream(streamId, handler as TP2PStreamHandler, params);
			} else {
				return this.runUnary(streamId, handler, params, type === FrameType.Faf);
			}
		} catch (err: any) {
			console.error(err);
			// send a proper RPC error frame so the caller sees something
			// use streamId 0 only if we failed to parse one
			const id = typeof streamId === "number" ? streamId : 0;
			return this.sendError(id, err.code, err.message, err.data);
		}
	}

	private sendError(id: number, code?: number, message?: string, data?: any) {
		return this.transport.send(id, FrameType.Error, {
			code: code ?? -32603,
			message: message ?? "Server error",
			data: data,
		});
	}

	private async runUnary(
		id: number,
		handler: TP2PHandler,
		req: TP2PPayload,
		isFaF: boolean,
	): Promise<void> {
		const result = await handler(req);
		if (!isFaF)
			return this.transport.send(id, FrameType.Response, result ?? null);
	}

	/**
	 * Returns a stream of data to client;
	 * We limit the no. of simultaneous active streams. This ensures:
	 * 	- the chance of streamId number going out of range is limited;
	 * We do not actively purge the inactive streams, as we are ok with
	 * long running/idle streams, since:
	 * 	1. these are just multiplexed over a single socket;
	 *  2. they only limit one client's capability to add more active streams, and
	 *  3. client can always close an active stream if they choose to;
	 * 	4. idle connections are killed by underlying socket idle timeout
	 */
	private async runStream(
		id: number,
		handler: TP2PStreamHandler,
		req: TP2PPayload,
	): Promise<void> {
		// limit the simultaneous active connections (also resolves the streamId reuse issue)
		if (this.activeStreams.size >= MAX_ACTIVE_STREAMS) {
			return this.sendError(id, -32603, "Too many concurrent streams");
		}
		// avoid duplicate active ids
		if (this.activeStreams.has(id)) {
			return this.sendError(id, -32603, `streamId ${id} already in use`);
		}
		const controller = new AbortController();
		this.activeStreams.set(id, controller);

		try {
			// stream the result
			for await (const item of handler(req)) {
				if (controller.signal.aborted) return;
				await this.transport.send(id, FrameType.StreamItem, item);
			}
			/* do NOT send StreamEnd after abort */
			if (controller.signal.aborted) return;
			return this.transport.send(id, FrameType.StreamEnd, null);
		} catch (err: any) {
			if (controller.signal.aborted) return;
			return this.sendError(id, err.code, err.message, err.data);
		} finally {
			this.activeStreams.delete(id);
		}
	}

	override close(): void {
		if (this.closed) return;
		this.closed = true;

		this.activeStreams.forEach((controller) => controller.abort());
		this.activeStreams.clear();
		super.close();
	}
}
