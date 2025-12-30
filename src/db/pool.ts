import { config } from "dotenv";
import { Pool, type PoolClient } from "pg";

config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const dbUrl = new URL(databaseUrl);
console.log("PG config", { host: dbUrl.hostname, port: dbUrl.port || dbUrl.protocol });

const ssl =
  process.env.PGSSLMODE === "disable"
    ? false
    : {
        rejectUnauthorized: false,
      };

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (err) => {
  console.error("Unexpected PG pool error", err);
});

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
