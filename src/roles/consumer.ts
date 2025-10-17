//import { RPCClient } from "@agree-able/rpc";
import Hyperswarm from "hyperswarm";
import type { IProviderAPI } from "../interfaces/provider";

const MARKET_TOPIC = Buffer.alloc(32).fill("p2p-market-demo");

/**
 * Servers are configured to Kick the clients out after inactivity;
 * But clients (being in swarm) tend to reconnect automatically!
 */
export class Consumer {
	async start() {
		console.log("[CONSUMER] Searching for providers...");
		const swarm = new Hyperswarm();
		swarm.join(MARKET_TOPIC, { server: false, client: true });

		swarm.on("connection", async (conn, peerInfo) => {

			// we do not set conn.setTimeout() here, as clients anyway reconnect no matter what;
			// instead, the client need to shutoff the connection when not needed;
			// Server anyway resets the connection after some inactivity (i.e. server reclaims its memory)
			conn.setKeepAlive(0); // do not swamp the server
			peerInfo.reconnect(0);// we have to do this on server's kick or when we have no further business

			console.log(
				`[CONSUMER] Connected to a provider: ${peerInfo.publicKey.toString("hex")}`,
			);
			conn.on("data", (d) =>
				console.log(`[CONSUMER] received: ${d.toString()}`),
			);
			conn.on("error", (err) => {
				console.log("------error: ", err);
			});
		});

		await swarm.flush();
	}
}
