import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LEN = 12
const TAG_LEN = 16

let cachedKey: Buffer | null = null

function loadKey(): Buffer {
	const envKey = process.env.CONFIG_ENCRYPTION_KEY?.trim()
	if (envKey) {
		const buf = envKey.length === 64 ? Buffer.from(envKey, "hex") : Buffer.from(envKey, "base64")
		if (buf.length !== 32) {
			throw new Error(
				"CONFIG_ENCRYPTION_KEY must decode to exactly 32 bytes (64-char hex or 44-char base64)",
			)
		}
		return buf
	}

	if (process.env.NODE_ENV === "production") {
		throw new Error(
			"CRITICAL: CONFIG_ENCRYPTION_KEY must be set in production. " +
				"Provide a 32-byte hex string (64 characters) in your environment.",
		)
	}

	// Fallback for local development/testing only
	console.warn(
		"[crypto] ⚠️  WARNING: CONFIG_ENCRYPTION_KEY is unset. Using insecure development fallback key.",
	)
	return Buffer.from("00".repeat(32), "hex")
}

export function getMasterKey(): Buffer {
	if (!cachedKey) cachedKey = loadKey()
	return cachedKey
}

export function resetCachedKey(): void {
	cachedKey = null
}

/** Encrypt a UTF-8 string. Returns base64(`iv | tag | cipher`). */
export function encrypt(plaintext: string): string {
	const iv = randomBytes(IV_LEN)
	const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv)
	const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
	const tag = cipher.getAuthTag()
	return Buffer.concat([iv, tag, enc]).toString("base64")
}

/** Decrypt a value produced by `encrypt`. Throws on tamper. */
export function decrypt(ciphertext: string): string {
	const buf = Buffer.from(ciphertext, "base64")
	if (buf.length < IV_LEN + TAG_LEN) throw new Error("Ciphertext too short")
	const iv = buf.subarray(0, IV_LEN)
	const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
	const enc = buf.subarray(IV_LEN + TAG_LEN)
	const decipher = createDecipheriv(ALGORITHM, getMasterKey(), iv)
	decipher.setAuthTag(tag)
	const dec = Buffer.concat([decipher.update(enc), decipher.final()])
	return dec.toString("utf8")
}
