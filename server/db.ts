import * as schema from "@shared/schema"
import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"

const { Pool } = pg

if (!process.env.DATABASE_URL) {
	throw new Error("DATABASE_URL must be set")
}

let connectionString = process.env.DATABASE_URL
if (process.env.NODE_ENV === "test") {
	try {
		const url = new URL(connectionString)
		if (!url.pathname.endsWith("_test")) {
			url.pathname = `${url.pathname}_test`
		}
		connectionString = url.toString()
	} catch (_err) {
		// Fallback if not a standard URL string
		if (!connectionString.includes("_test")) {
			connectionString = connectionString.replace(/\/([a-zA-Z0-9_-]+)(?=\?|$)/, "/$1_test")
		}
	}
}

export const pool = new Pool({ connectionString })
export const db = drizzle(pool, { schema })
export type Db = typeof db
