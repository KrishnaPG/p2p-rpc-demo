import { decode } from "cbor-x";
import {
	FramedTransport,
	parseFrame,
} from "./transport";
import { FrameType, type TP2PEncryptedSocket, type TP2PHandler, type TP2PMethodSpec, type TP2PPayload, type TP2PStreamHandler } from "./types";
import { isStream } from "./utils";

export class RpcServer {
  private transport: FramedTransport;
  private activeStreams = new Map<number, AbortController>(); // TODO: cleaning up inactive steams?
  private closed = false;

  constructor(conn: TP2PEncryptedSocket, private handlers: Record<string, TP2PMethodSpec>) {
    conn.on("close", ()=>this.close());
    this.transport = new FramedTransport(conn, (f) => this.handleFrame(f));
  }

  private async handleFrame(frame: Uint8Array): Promise<void> {
    if (this.closed) return;

    try {
      const { streamId, type, payload } = parseFrame(frame);

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

      const body = payload.length > 0 ? decode(payload) : {};
      const { method, params } = body;

      if (!method) {
        await this.transport.send(streamId, FrameType.Error, {
          code: -32600,
          message: "Invalid request",
        });
        return;
      }

      const handler = this.handlers[method];
      if (!handler) {
        if (type === FrameType.Faf) return;
        await this.transport.send(streamId, FrameType.Error, {
          code: -32601,
          message: `Method not found: ${method}`,
        });
        return;
      }

      if (handler === null) return; // Fire-and-forget

      if (isStream(handler)) {
        await this.runStream(streamId, handler as TP2PStreamHandler, params);
      } else {
        await this.runUnary(streamId, handler, params);
      }
    } catch (err) {
      console.error("Frame handling error:", err);
    }
  }

  private async runUnary(id: number, handler: TP2PHandler, req: TP2PPayload): Promise<void> {
    try {
      const result = await handler(req);
      await this.transport.send(id, FrameType.Response, result ?? null);
    } catch (err: any) {
      await this.transport.send(id, FrameType.Error, {
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
        if (controller.signal.aborted) break;
        await this.transport.send(id, FrameType.StreamItem, item);
      }
      await this.transport.send(id, FrameType.StreamEnd, null);
    } catch (err: any) {
      if (!controller.signal.aborted) {
        await this.transport.send(id, FrameType.Error, {
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