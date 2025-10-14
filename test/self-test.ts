import { type ISocketLike, RpcClient, RpcServer } from "../src/rpc";

const run = async () => {
	// fake socket: two queues
	const q1: Uint8Array[] = [];
	const q2: Uint8Array[] = [];
	const fake1: ISocketLike = {
		send: async (d) => q2.push(d),
		onData: (cb) => setInterval(() => q1.length && cb(q1.shift()!), 0),
	};
	const fake2: ISocketLike = {
		send: async (d) => q1.push(d),
		onData: (cb) => setInterval(() => q2.length && cb(q2.shift()!), 0),
	};
	// server
	new RpcServer(fake1.send, fake1.onData, {
		echo: async (x) => x,
		count: async function* ({ n }) {
			for (let i = 0; i < n; i++) yield { i };
		},
		job: async () => "tok-123",
		"tok-123.result": async () => Buffer.from("done"),
	});
	// client
	const c = new RpcClient(fake2.send, fake2.onData);
	console.log("echo =", await c.call("echo", { hello: "world" }));
	for await (const x of c.stream("count", { n: 3 })) console.log("stream", x);
	const tok = await c.job("job", {});
	console.log("job result =", await c.result(tok));
	process.exit(0);
};

run();
