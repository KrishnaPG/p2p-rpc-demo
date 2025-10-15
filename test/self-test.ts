import { type ISocketLike, RpcClient, RpcServer } from "../src/rpc";

const run = async () => {
  const { performance } = require('perf_hooks');
  const mem = () => (process as any).memoryUsage().heapUsed;
  const m0 = mem();
  const q1: Uint8Array[] = [];
  const q2: Uint8Array[] = [];
  const s1: ISocketLike = { send: async (b) => q2.push(b), onData: (cb) => setInterval(() => q2.length && cb(q2.shift()!), 0) };
  const s2: ISocketLike = { send: async (b) => q1.push(b), onData: (cb) => setInterval(() => q1.length && cb(q1.shift()!), 0) };
  new RpcServer(...s1, {
    echo: async (x) => x,
    ticks: async function* ({ n }) { for (let i = 0; i < n; i++) yield { i }; },
  });
  const c = new RpcClient(...s2);
  const rounds = 1_000_000;
  const payload = Buffer.from(JSON.stringify({ hello: 'world' }));
  const t0 = performance.now();
  for (let i = 0; i < rounds; i++) await c.call('echo', payload);
  const t1 = performance.now();
  const dt = (t1 - t0) / 1000;
  console.log('rate', (rounds / dt / 1e6).toFixed(2), 'M msg/s');
  console.log('latency', (dt * 1e6 / rounds).toFixed(1), 'µs');
  console.log('mem delta', ((mem() - m0) / 1024 / 1024).toFixed(1), 'MB');
  process.exit(0);
};

run();
