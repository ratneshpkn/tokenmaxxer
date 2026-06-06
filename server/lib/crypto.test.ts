import { afterEach, describe, expect, it } from "bun:test"

// Clear any pre-existing environment variable to start clean
delete process.env.CONFIG_ENCRYPTION_KEY

describe("crypto", () => {
	afterEach(() => {
		delete process.env.CONFIG_ENCRYPTION_KEY
		delete process.env.NODE_ENV
		// Restore test environment
		process.env.NODE_ENV = "test"
	})

	it("falls back to development key if unset in dev/test", async () => {
		const { getMasterKey } = await import(`./crypto?t1=${Date.now()}`)
		const key = getMasterKey()
		expect(key.length).toBe(32)
		expect(key.toString("hex")).toBe("00".repeat(32))
	})

	it("uses CONFIG_ENCRYPTION_KEY if set in the environment", async () => {
		const hexKey = "aa".repeat(32)
		process.env.CONFIG_ENCRYPTION_KEY = hexKey
		const { getMasterKey } = await import(`./crypto?t2=${Date.now()}`)
		const key = getMasterKey()
		expect(key.length).toBe(32)
		expect(key.toString("hex")).toBe(hexKey)
	})

	it("throws in production mode if CONFIG_ENCRYPTION_KEY is missing", async () => {
		process.env.NODE_ENV = "production"
		const { getMasterKey } = await import(`./crypto?t3=${Date.now()}`)
		expect(() => getMasterKey()).toThrow(/CONFIG_ENCRYPTION_KEY must be set in production/)
	})

	it("round-trips a string", async () => {
		const { encrypt, decrypt } = await import(`./crypto?t4=${Date.now()}`)
		const ct = encrypt("hello world")
		expect(ct).not.toBe("hello world")
		expect(decrypt(ct)).toBe("hello world")
	})

	it("ciphertext is non-deterministic (random IV)", async () => {
		const { encrypt, decrypt } = await import(`./crypto?t5=${Date.now()}`)
		const a = encrypt("same plaintext")
		const b = encrypt("same plaintext")
		expect(a).not.toBe(b)
		expect(decrypt(a)).toBe("same plaintext")
		expect(decrypt(b)).toBe("same plaintext")
	})

	it("throws on tampered ciphertext", async () => {
		const { encrypt, decrypt } = await import(`./crypto?t6=${Date.now()}`)
		const ct = encrypt("secret")
		const tampered = `${ct.slice(0, -2)}AA`
		expect(() => decrypt(tampered)).toThrow()
	})
})
