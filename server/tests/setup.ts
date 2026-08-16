process.env.NODE_ENV = "test"

const { sql } = await import("drizzle-orm")
const { migrate } = await import("drizzle-orm/node-postgres/migrator")
const { db } = await import("../db")

console.log("[test-setup] Running migrations on test database...")
await migrate(db, { migrationsFolder: "./migrations" })
console.log("[test-setup] Migrations applied successfully.")

await db.execute(sql`
	insert into app_config (id) values (1)
	on conflict (id) do nothing
`)

export {}
