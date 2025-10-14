import { decode } from "cbor-x";
import {
	FramedTransport,
	FrameType,
	type TP2PHandler,
	type TP2PMethodSpec,
	type TP2PPayload,
	type TP2PStreamHandler,
} from "./transport";
import { isStream } from "./utils";

export class RpcServer {
	private t: FramedTransport;
	private handlers = new Map<string, TP2PMethodSpec>();
	private streams = new Map<number, AsyncGenerator>();

	constructor(
		send: (d: Uint8Array) => Promise<void>,
		recv: (cb: (d: Uint8Array) => void) => void,
		spec: Record<string, TP2PMethodSpec>,
	) {
		Object.entries(spec).forEach(([k, v]) => this.handlers.set(k, v));
		this.t = new FramedTransport({ send, onData: recv }, (f) => this.handle(f));
	}

	private async handle(frame: Uint8Array) {
		const v = new DataView(frame.buffer, frame.byteOffset);
		const streamId = v.getUint32(0, true);
		const type = v.getUint8(7);
		if (type !== FrameType.Request && type !== FrameType.Faf) return;
		const { method, params } = decode(frame.subarray(8));
		const h = this.handlers.get(method);
		if (!h && method.endsWith(".result")) {
			const token = method.slice(0, -7);
			const h2 = this.handlers.get(`${token} + ".result`);
			if (h2) return this.runUnary(streamId, h2 as TP2PHandler, params);
		}
		if (!h)
			return this.t.send(streamId, FrameType.Error, {
				code: -32601,
				message: "Method not found",
			});
		if (h === null) return; // faf
		if (isStream(h)) return this.runStream(streamId, h, params);
		return this.runUnary(streamId, h, params);
	}

	private async runUnary(id: number, h: TP2PHandler, req: TP2PPayload) {
		try {
			this.t.send(id, FrameType.Ack, null);
			const res = await h(req);
			this.t.send(id, FrameType.Response, res ?? null);
		} catch (e: any) {
			this.t.send(id, FrameType.Error, { code: -32603, message: e.message });
		}
	}

	private async runStream(id: number, h: TP2PStreamHandler, req: TP2PPayload) {
		try {
			this.t.send(id, FrameType.Ack, null);
			for await (const item of h(req))
				await this.t.send(id, FrameType.StreamItem, item);
			await this.t.send(id, FrameType.Response, null); // EOF marker
		} catch (e: any) {
			await this.t.send(id, FrameType.Error, {
				code: -32603,
				message: e.message,
			});
		}
	}
}
