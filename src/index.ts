import { Auctioneer } from "./roles/auctioneer";
import { Bidder } from "./roles/bidder";
import { Consumer } from "./roles/consumer";
import { Provider } from "./roles/provider";

const role = process.argv[2] || "consumer";
const auctionTopicArg = process.argv[3];

const run = async () => {
	switch (role) {
		case "provider":
			await new Provider().start();
			break;

		case "consumer":
			await new Consumer().start();
			break;

		case "auctioneer": {
			const auctioneer = new Auctioneer();
			await auctioneer.start();
			console.log(
				"\n--- To run a bidder, use the topic above in a new terminal ---",
			);
			console.log(`Example: npm run bidder ${auctioneer.getTopic()}\n`);
			break;
		}

		case "bidder":
			if (!auctionTopicArg) {
				console.error("[BIDDER] Error: Auction topic is required.");
				console.log("Usage: npm run bidder <topic-hex>");
				process.exit(1);
			}
			await new Bidder().start(auctionTopicArg);
			break;

		default:
			console.log("Usage: npm run <role>");
			console.log("Roles: provider, consumer, auctioneer, bidder");
			console.log(
				"Example for bidder: npm run bidder <topic-hex-from-auctioneer>",
			);
			process.exit(1);
	}
};

run().catch(console.error);
