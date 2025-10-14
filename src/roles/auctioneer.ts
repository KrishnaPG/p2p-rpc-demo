//import { RPCServer } from "@agree-able/rpc";
import crypto from "crypto";
import { EventEmitter } from "events";
import Hyperswarm from "hyperswarm";
import type { IAuctioneerAPI } from "../interfaces/aunctioneer";

export class Auctioneer extends EventEmitter implements IAuctioneerAPI {
	private highestBid = 0;
	private topic: Buffer;

	constructor() {
		super();
		this.topic = crypto.randomBytes(32);
	}

	async placeBid(bid: number): Promise<void> {
		if (bid > this.highestBid) {
			this.highestBid = bid;
			console.log(`[AUCTIONEER] New highest bid: ${bid}`);
			// Emit an event that the RPC server will broadcast
			this.emit("highestBidUpdate", this.highestBid);
		}
	}

	// The `on` method is part of EventEmitter, which we extend.
	// This allows the RPC library to automatically hook into it.
	on(event: "highestBidUpdate", listener: (bid: number) => void): this {
		return super.on(event, listener);
	}

	async start() {
		console.log(
			`[AUCTIONEER] Auction started! Topic: ${this.topic.toString("hex")}`,
		);
		const swarm = new Hyperswarm();
		swarm.join(this.topic);

    let highestBid = 0;
    const bidders = new Set();

		swarm.on("connection", (conn) => {
        bidders.add(conn);
        console.log(`[AUCTIONEER] Bidder joined. Total: ${bidders.size}`);
        conn.on('data', (data) => {
            const bid = parseInt(data.toString());
            if (bid > highestBid) {
                highestBid = bid;
                console.log(`[AUCTIONEER] New highest bid: ${bid}`);
                bidders.forEach(b => b.write(`Current highest: ${highestBid}`));
            }
        });		});

		await swarm.flush();
	}

	getTopic(): string {
		return this.topic.toString("hex");
	}
}
