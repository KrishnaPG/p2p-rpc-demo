//import { RPCClient } from "@agree-able/rpc";
import Hyperswarm from "hyperswarm";
import type { IProviderAPI } from "../interfaces/provider";

const MARKET_TOPIC = Buffer.alloc(32).fill("p2p-market-demo");

export class Consumer {
	async start() {
		console.log("[CONSUMER] Searching for providers...");
		const swarm = new Hyperswarm();
		swarm.join(MARKET_TOPIC, { server: false, client: true });

		swarm.on("connection", async (conn, peerInfo) => {
			console.log(`[CONSUMER] Connected to a provider: ${peerInfo.publicKey.toString("hex")}`); 
			conn.on("data", d => console.log(`[CONSUMER] received: ${d.toString()}`))
		});

		await swarm.flush();
	}
}
