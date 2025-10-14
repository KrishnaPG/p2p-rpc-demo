//import { RPCClient } from "@agree-able/rpc";
import Hyperswarm from "hyperswarm";
import type { IAuctioneerAPI } from "../interfaces/aunctioneer";

export class Bidder {
	async start(topicHex: string) {
		console.log(`[BIDDER] Joining auction at topic: ${topicHex}`);
		const swarm = new Hyperswarm();
		swarm.join(Buffer.from(topicHex, "hex"));

		swarm.on("connection", (conn) => {
			console.log('[BIDDER] Connected to auctioneer.');
			conn.on('data', (data) => console.log('[BIDDER] Update:', data.toString()));
			const myBid = Math.floor(Math.random() * 100);
			console.log(`[BIDDER] Placing bid: ${myBid}`);
			conn.write(myBid.toString());
		});

		await swarm.flush();
	}
}
