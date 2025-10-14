import { RPCClient } from "@agree-able/rpc";
import Hyperswarm from "hyperswarm";
import type { IProviderAPI } from "../interfaces/provider";

const MARKET_TOPIC = Buffer.alloc(32).fill("p2p-market-demo");

export class Consumer {
	async start() {
		console.log("[CONSUMER] Searching for providers...");
		const swarm = new Hyperswarm();
		swarm.join(MARKET_TOPIC, { server: false, client: true });

		swarm.on("connection", async (conn) => {
			console.log("[CONSUMER] Connected to a provider.");
			const client = new RPCClient<IProviderAPI>(conn);

			try {
				const catalog = await client.getCatalog();
				console.log("[CONSUMER] Catalog Received:", catalog);

				const reply = await client.negotiate("Can you build a React app?");
				console.log("[CONSUMER] Negotiation reply:", reply);
			} catch (err) {
				console.error("[CONSUMER] Error during RPC call:", err);
			}
		});

		await swarm.flush();
	}
}
