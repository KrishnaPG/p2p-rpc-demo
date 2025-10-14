import { host, loadAgreement } from "@agree-able/rpc";
import Hyperswarm from "hyperswarm";
import type { IProviderAPI, Service } from "../interfaces/provider";

const MARKET_TOPIC = Buffer.alloc(32).fill("p2p-market-demo");

export class Provider implements IProviderAPI {
	private catalog: Service[] = [
		{ service: "Web Development", rate: "50 ETH/hr" },
		{ service: "Smart Contract Audit", rate: "100 ETH/hr" },
	];

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
		swarm.on("connection", (conn, peerInfo) => {
			console.log(`[PROVIDER] Consumer connected: ${peerInfo.publicKey.toString("hex")}`);
			conn.on("data", (d) =>
				console.log(`[PROVIDER] received: ${d.toString()}`),
			);
		});

		await swarm.flush();
		console.log("[PROVIDER] Announced on the network.");
	}
}
