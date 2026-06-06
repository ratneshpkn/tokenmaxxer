import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { sql } from "drizzle-orm"
import { db, pool } from "../db"

// Use a fixed key for standard test cases
process.env.CONFIG_ENCRYPTION_KEY = "00".repeat(32)

const { loadConfig, saveConfig } = await import("./config")

beforeAll(async () => {
	// Ensure migrations are applied + a singleton row exists
	await db.execute(sql`
    insert into app_config (id) values (1)
    on conflict (id) do nothing
  `)

	// Clear any pre-existing encrypted fields to avoid key decryption failures from other runs/keys
	await db.execute(sql`
		update app_config set 
			google_client_secret_enc = null,
			anthropic_admin_api_key_enc = null,
			cursor_admin_api_key_enc = null,
			slack_bot_token_enc = null
		where id = 1
	`)
})

afterAll(async () => {
	delete process.env.CONFIG_ENCRYPTION_KEY
	await pool.end()
})

describe("config", () => {
	it("loadConfig returns null secrets when not set", async () => {
		await db.execute(sql`update app_config set anthropic_admin_api_key_enc = null where id = 1`)
		const cfg = await loadConfig()
		expect(cfg.anthropicAdminApiKey).toBeNull()
	})

	it("saveConfig encrypts secrets at rest, loadConfig decrypts", async () => {
		await saveConfig({ anthropicAdminApiKey: "sk-ant-admin-test-12345" })
		// Read raw column directly — should NOT contain plaintext
		const raw = await db.execute<{ anthropic_admin_api_key_enc: string | null }>(
			sql`select anthropic_admin_api_key_enc from app_config where id = 1`,
		)
		expect(raw.rows?.[0]?.anthropic_admin_api_key_enc).not.toContain("sk-ant-admin")
		// But loadConfig returns plaintext
		const cfg = await loadConfig()
		expect(cfg.anthropicAdminApiKey).toBe("sk-ant-admin-test-12345")
	})

	it("saveConfig with null clears the secret", async () => {
		await saveConfig({ anthropicAdminApiKey: "sk-ant-admin-set" })
		await saveConfig({ anthropicAdminApiKey: null })
		const cfg = await loadConfig()
		expect(cfg.anthropicAdminApiKey).toBeNull()
	})

	it("non-secret fields round-trip without encryption", async () => {
		await saveConfig({ orgName: "Acme Co", allowedEmailDomain: "acme.test" })
		const cfg = await loadConfig()
		expect(cfg.orgName).toBe("Acme Co")
		expect(cfg.allowedEmailDomain).toBe("acme.test")
	})

	it("loadConfig throws a critical error if decryption fails due to key mismatch", async () => {
		const { resetCachedKey } = await import("./crypto")

		// 1. Save config with key A
		process.env.CONFIG_ENCRYPTION_KEY = "11".repeat(32)
		resetCachedKey()
		const { saveConfig: saveCfgA } = await import(`./config?keyA=${Date.now()}`)
		await saveCfgA({ anthropicAdminApiKey: "secret-key-a" })

		// 2. Try loading with key B (should throw)
		process.env.CONFIG_ENCRYPTION_KEY = "22".repeat(32)
		resetCachedKey()
		const { loadConfig: loadCfgB } = await import(`./config?keyB=${Date.now()}`)
		expect(loadCfgB()).rejects.toThrow(/CRITICAL: Decryption failed/)
	})
})
