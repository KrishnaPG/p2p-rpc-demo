import { RPCServer } from "@agree-able/rpc";
import crypto from "crypto";
import { EventEmitter } from "events";
import Hyperswarm from "hyperswarm";
import { IAuctioneerAPI } from "../interfaces/auctioneer.js";

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
		const server = new RPCServer();

		server.provide(IAuctioneerAPI, this);

		// Listen to our own event and broadcast it to all connected clients
		this.on("highestBidUpdate", (bid) => {
			server.broadcast("highestBidUpdate", [bid]);
		});

		swarm.join(this.topic);
		swarm.on("connection", (conn) => {
			console.log(`[AUCTIONEER] Bidder connected.`);
			server.setup(conn);
		});

		await swarm.flushed();
	}

	getTopic(): string {
		return this.topic.toString("hex");
	}
}
