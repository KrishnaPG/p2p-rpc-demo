import { RPCClient } from "@agree-able/rpc";
import Hyperswarm from "hyperswarm";
import type { IAuctioneerAPI } from "../interfaces/auctioneer.js";

export class Bidder {
	async start(topicHex: string) {
		console.log(`[BIDDER] Joining auction at topic: ${topicHex}`);
		const swarm = new Hyperswarm();
		swarm.join(Buffer.from(topicHex, "hex"));

		swarm.on("connection", (conn) => {
			console.log("[BIDDER] Connected to auctioneer.");
			const client = new RPCClient<IAuctioneerAPI>(conn);

			// Listen for updates from the auctioneer
			client.on("highestBidUpdate", (bid) => {
				console.log(`[BIDDER] Update: New highest bid is ${bid}`);
			});

			// Place a bid after a short delay
			setTimeout(() => {
				const myBid = Math.floor(Math.random() * 100);
				console.log(`[BIDDER] Placing bid: ${myBid}`);
				client.placeBid(myBid);
			}, 1000);
		});

		await swarm.flush();
	}
}
