import { host, loadAgreement } from "@agree-able/rpc";
import Hyperswarm from "hyperswarm";
import type { IProviderAPI, Service } from "../interfaces/provider";
import type { TP2PEncryptedSocket } from "../rpc/types";

const MAX_TOTAL_CONNECTIONS = 10000; // no. of connections (could be multiple from same client machine, diff socket)

const MARKET_TOPIC = Buffer.alloc(32).fill("p2p-market-demo");

export class Provider implements IProviderAPI {
	private catalog: Service[] = [
		{ service: "Web Development", rate: "50 ETH/hr" },
		{ service: "Smart Contract Audit", rate: "100 ETH/hr" },
	];
	private connsPerClient = new Map<Buffer, number>();

	async getCatalog(): Promise<Service[]> {
		console.log("[PROVIDER] Catalog requested.");
		return this.catalog;
	}

	async negotiate(request: string): Promise<string> {
		console.log(`[PROVIDER] Negotiation request: "${request}"`);
		return "Sure, I can do that for a 10% discount.";
	}

	async start() {
		console.log("[PROVIDER] Starting...");
		const swarm = new Hyperswarm();

		swarm.join(MARKET_TOPIC, { server: true, client: false });
		swarm.on("connection", (conn: TP2PEncryptedSocket, peerInfo) => {
			// limit the no. of conns; but can lead to DOS if not limited per client
			if(swarm.connections.size > MAX_TOTAL_CONNECTIONS) {
				return conn.destroy(); // reject
			}
			// limit per client conns (Based on IP and publicKey etc.), to avoid DOS;
			// a single conn can have multiple streams and pending requests;
			const remoteHost = conn.rawStream.remoteHost;
			const remotePort = conn.rawStream.remotePort;
			if(this.connsPerClient.has(remoteHost)) {
				return conn.destroy; // no more than one per ip-address (TDB: what about behind NAT/proxy ?)
				// TODO: what about a single machine with different publicKeys (i.e. aggregator or agent or cloud VM)?
				// I guess this may have to be dynamic, based on current load
			}
			this.connsPerClient.set(remoteHost, 1);
			conn.once("close", () => this.connsPerClient.delete(remoteHost));
			conn.on("error", (err:any) => {
				console.log("------- error: ", err.message);
				// if(err.code === "ETIMEDOUT") {
				// 	// happens when an active client goes away abruptly
				// 	console.log("closing down connection");
				// 	conn.destroy();
				// }
				conn.destroy();
			});

			console.log(`[PROVIDER] Consumer connected: ${peerInfo.publicKey.toString("hex")}`);
			conn.on("data", (d) =>
				console.log(`[PROVIDER] received: ${d.toString()}`),
			);
			conn.setKeepAlive(0); // do not hang around when there is no business
			conn.setTimeout(30000);	// Kick the client after 30s of inactivity (but they will reconnect immediately)
		});

		await swarm.flush();
		console.log("[PROVIDER] Announced on the network.");
	}
}
