import Redis from "ioredis";

const globalForRedis = globalThis as typeof globalThis & {
  playstageRedis?: Redis | null;
};

function createRedis() {
  if (!process.env.REDIS_URL) return null;
  const client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
  client.on("error", (error) => console.error("[realtime] Redis error", error));
  return client;
}

export const redis =
  globalForRedis.playstageRedis ??
  (globalForRedis.playstageRedis = createRedis());
