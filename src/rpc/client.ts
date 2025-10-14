import { decode } from "cbor-x";
import { FramedTransport, FrameType, type TP2PPayload } from "./transport";
import { AsyncSink, methodWithToken, RpcError } from "./utils";

export class RpcClient {
	private t: FramedTransport;
	private pend = new Map<
		number,
		{ res: (v: any) => void; rej: (e: any) => void; stream?: AsyncSink }
	>();
	private nextId = 1;
	constructor(
		send: (d: Uint8Array) => Promise<void>,
		recv: (cb: (d: Uint8Array) => void) => void,
	) {
		this.t = new FramedTransport({ send, onData: recv }, (f) => this.handle(f));
	}
	/* ---------- unary ---------- */
	call(
		method: string,
		params: TP2PPayload,
		opts?: { timeout?: number; signal?: AbortSignal },
	): Promise<TP2PPayload> {
		const id = this.allocId();
		const obj = { method, params };
		return new Promise((res, rej) => {
			this.pend.set(id, { res, rej });
			this.t.send(id, FrameType.Request, obj).catch(rej);
			if (opts?.signal)
				opts.signal.addEventListener("abort", () => this.cancel(id));
			if (opts?.timeout) setTimeout(() => this.cancel(id), opts.timeout);
		});
	}
	/* ---------- server stream ---------- */
	stream(method: string, params: TP2PPayload, opts?: { signal?: AbortSignal }) {
		const id = this.allocId();
		const obj = { method, params };
		const iter = new AsyncSink();
		this.pend.set(id, {
			res: iter.push.bind(iter),
			rej: iter.end.bind(iter),
			stream: iter,
		});
		this.t.send(id, FrameType.Request, obj);
		if (opts?.signal)
			opts.signal.addEventListener("abort", () => this.cancel(id));
		return iter[Symbol.asyncIterator]();
	}
	/* ---------- fire-and-forget ---------- */
	faf(method: string, params: TP2PPayload) {
		this.t.send(0, FrameType.Faf, { method, params });
	}
	/* ---------- job ---------- */
	async job(method: string, params: TP2PPayload): Promise<string> {
		return (await this.call(method, params)) as string;
	}
	async result(token: string): Promise<TP2PPayload> {
		return this.call(methodWithToken(method, token), {});
	}
	/* ---------- cancel ---------- */
	async cancel(streamId: number) {
		this.t.send(streamId, FrameType.Close, null);
		const p = this.pend.get(streamId);
		if (p) {
			p.rej(new Error("cancelled"));
			this.pend.delete(streamId);
		}
	}
	/* ---------- internals ---------- */
	private allocId() {
		const id = this.nextId;
		this.nextId += 2; // client keeps odd
		return id;
	}
	private handle(frame: Uint8Array) {
		const v = new DataView(frame.buffer, frame.byteOffset);
		const streamId = v.getUint32(0, true);
		const type = v.getUint8(7);
		const body = decode(frame.subarray(8));
		const p = this.pend.get(streamId);
		if (!p) return;
		switch (type) {
			case FrameType.Response:
			case FrameType.StreamItem:
				p.res(body);
				if (type === FrameType.Response) this.pend.delete(streamId);
				break;
			case FrameType.Error:
				p.rej(new RpcError(body.code, body.message));
				this.pend.delete(streamId);
				break;
			case FrameType.Close:
				p.rej(new Error("server closed"));
				this.pend.delete(streamId);
				break;
		}
	}
}
