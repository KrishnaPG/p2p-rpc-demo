import { FramedTransport } from "./transport";
import type { TP2PEncryptedSocket } from "./types";

export abstract class PeerBase {
		protected transport: FramedTransport;
    
  constructor(
    conn: TP2PEncryptedSocket
  ) {
    conn.setKeepAlive(30000); // send ping every 30 s
    conn.once('timeout', () => conn.destroy()); // triggers `close` event
    conn.once("close", () => this.close()); // free everything
    // setup the socket read/send; transport owns the socket
    this.transport = new FramedTransport(conn, f => this.handleFrame(f));
  } 

  abstract handleFrame(buf: Uint8Array): Promise<void>;

  close(): void {
    this.transport.close(); // closes conn/socket also
  }
}