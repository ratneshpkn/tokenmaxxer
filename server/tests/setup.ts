process.env.NODE_ENV = "test"

const { migrate } = await import("drizzle-orm/node-postgres/migrator")
const { db } = await import("../db")

console.log("[test-setup] Running migrations on test database...")
await migrate(db, { migrationsFolder: "./migrations" })
console.log("[test-setup] Migrations applied successfully.")

export {}
