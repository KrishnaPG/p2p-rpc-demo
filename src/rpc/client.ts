import { decode } from "cbor-x";
import { AsyncSink } from "./async-sink";
import { TransportError } from "./errors";
import { FramedTransport, parseFrame } from "./transport";
import {
	FrameType,
	MAX_PENDING_REQUESTS,
	PING_INTERVAL,
	PONG_TIMEOUT,
	type TP2PEncryptedSocket,
	type TP2PPayload,
} from "./types";
import { RpcError } from "./utils";

interface PendingRequest {
	resolve: (v: any) => void;
	reject: (e: any) => void;
	sink?: AsyncSink;
	timer?: NodeJS.Timeout;
}

export type TCloseCB = () => Promise<void>;

export class RpcClient {
	private transport: FramedTransport;
	private pending = new Map<number, PendingRequest>();
	private idCounter = new Int32Array(new SharedArrayBuffer(4));
	private heartbeatTimer?: NodeJS.Timeout;
	private lastActivityTime = Date.now();
	private closed = false;
	private closeCallbacks: Array<TCloseCB> = [];

	constructor(conn: TP2PEncryptedSocket, heartBeat: boolean = false) {
		this.idCounter[0] = 1; // Start at 1
		conn.on("close", ()=>this.close());
		this.transport = new FramedTransport(conn, (f) => this.handleFrame(f));
		if (heartBeat) this.startHeartbeat();
	}

	call(
		method: string,
		params: TP2PPayload,
		opts?: { timeout?: number; signal?: AbortSignal },
	): Promise<TP2PPayload> {
		if (this.closed) throw new TransportError("Client closed");

		if (this.pending.size >= MAX_PENDING_REQUESTS) {
			throw new TransportError("Too many pending requests");
		}

		const id = this.allocId();
		return new Promise<TP2PPayload>((resolve, reject) => {
			const req: PendingRequest = { resolve, reject };

			if (opts?.timeout) {
				req.timer = setTimeout(() => {
					this.cancelRequest(id, new RpcError(-32000, "Request timeout"));
				}, opts.timeout);
			}

			if (opts?.signal) {
				opts.signal.addEventListener("abort", () => {
					this.cancelRequest(id, new RpcError(-32000, "Request aborted"));
				});
			}

			this.pending.set(id, req);
			return this.transport
				.send(id, FrameType.Request, { method, params })
				.catch((err) => {
					this.cancelRequest(id, err);
				});
		});
	}
	// AsyncIterableIterator<TP2PPayload>
	stream(
		method: string,
		params: TP2PPayload,
		opts?: { signal?: AbortSignal },
	): AsyncIterableIterator<TP2PPayload> {
		if (this.closed) throw new TransportError("Client closed");

		const id = this.allocId();
		const sink = new AsyncSink();

		this.pending.set(id, {
			resolve: (v) => sink.push(v),
			reject: (e) => sink.end(e),
			sink,
		});

		if (opts?.signal) {
			opts.signal.addEventListener("abort", () => {
				this.cancelRequest(id, new RpcError(-32000, "Stream aborted"));
			});
		}

		this.transport
			.send(id, FrameType.Request, { method, params })
			.catch((err) => this.cancelRequest(id, err));

		return sink[Symbol.asyncIterator]();
	}

	// fire-and-forget
	faf(method: string, params: TP2PPayload): Promise<void> {
		if (this.closed) return Promise.reject(`Cannot send on closed connection`);
		return this.transport.send(-1, FrameType.Faf, { method, params });
	}

	onClose(cb: TCloseCB): void {
		this.closeCallbacks.push(cb);
	}

	close(): Promise<unknown> {
		if (this.closed) return Promise.resolve();
		this.closed = true;

		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

		const error = new TransportError("Client closed");
		this.pending.forEach((p) => p.reject(error));
		this.pending.clear();

		this.transport.close();
		return Promise.allSettled(this.closeCallbacks.map((cb) => cb()));
	}

	// TODO: the idCounter has to be reset to 1 when this.pending goes to zero
	private allocId(): number {
		// Atomic lock-free ID allocation
		// Atomics.add returns the OLD value, so we get unique IDs
		const id = Atomics.add(this.idCounter, 0, 2);

		// Ensure odd parity for client (server uses even)
		return id | 1;
	}

	private cancelRequest(streamId: number, error: Error): Promise<void> {
		const p = this.pending.get(streamId);
		if (!p)
			return Promise.reject(`No pending stream exits for id: ${streamId}`);

		if (p.timer) clearTimeout(p.timer);
		p.reject(error);
		this.pending.delete(streamId);

		return this.transport.send(streamId, FrameType.Close, null).catch(() => {});
	}

	private handleFrame(frame: Uint8Array): Promise<void> {
		const { streamId, type, payload } = parseFrame(frame);

		// Any incoming frame is proof of life
		this.lastActivityTime = Date.now();

		if (type === FrameType.Ping) {
			return this.transport
				.send(streamId, FrameType.Pong, null)
				.catch(() => {});
		}

		if (type === FrameType.Pong) return Promise.resolve();

		const p = this.pending.get(streamId);
		if (!p)
			return Promise.reject(`No pending stream exits for id: ${streamId}`);

		const body = payload.length > 0 ? decode(payload) : null;

		switch (type) {
			case FrameType.Response:
				if (p.timer) clearTimeout(p.timer);
				p.resolve(body);
				this.pending.delete(streamId);
				break;

			case FrameType.StreamItem:
				if (p.sink) p.sink.push(body);
				break;

			case FrameType.StreamEnd:
				if (p.sink) p.sink.end();
				if (p.timer) clearTimeout(p.timer);
				this.pending.delete(streamId);
				break;

			case FrameType.Error: {
				if (p.timer) clearTimeout(p.timer);
				const err = new RpcError(body.code, body.message);
				p.reject(err);
				this.pending.delete(streamId);
				break;
			}

			case FrameType.Close:
				if (p.timer) clearTimeout(p.timer);
				p.reject(new TransportError("Server closed stream"));
				this.pending.delete(streamId);
				break;
		}
		return Promise.resolve();
	}

	private startHeartbeat(): void {
		this.heartbeatTimer = setInterval(() => {
			if (this.closed) return;

			const timeSinceLastActivity = Date.now() - this.lastActivityTime;

			// Close if no incoming activity for longer than ping + pong timeout
			if (timeSinceLastActivity >= PING_INTERVAL + PONG_TIMEOUT) {
				console.error("Connection idle timeout - closing");
				this.close();
				return;
			}

			// Send explicit ping only if idle
			if (timeSinceLastActivity >= PING_INTERVAL) {
				this.transport.send(0, FrameType.Ping, null).catch(() => {});
			}
		}, PING_INTERVAL);
	}
}
