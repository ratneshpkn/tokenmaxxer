import { describe, expect, it } from "bun:test"
import { isEmailDomainAllowed, parseAllowedDomains } from "./config"

describe("domains unit tests", () => {
	it("parseAllowedDomains handles null, undefined, empty, and messy strings", () => {
		expect(parseAllowedDomains(null)).toEqual([])
		expect(parseAllowedDomains(undefined)).toEqual([])
		expect(parseAllowedDomains("")).toEqual([])
		expect(parseAllowedDomains("   ")).toEqual([])
		expect(parseAllowedDomains("acme.com")).toEqual(["acme.com"])
		expect(parseAllowedDomains("acme.com, example.com, @test.org")).toEqual([
			"acme.com",
			"example.com",
			"test.org",
		])
		expect(parseAllowedDomains("acme.com\nexample.com\t@test.org,  sub.domain.co ")).toEqual([
			"acme.com",
			"example.com",
			"test.org",
			"sub.domain.co",
		])
	})

	it("isEmailDomainAllowed accurately matches allowed domain list and fails closed when empty", () => {
		// Empty allowed list fails closed (denies all)
		expect(isEmailDomainAllowed("john@acme.com", [])).toBe(false)
		expect(isEmailDomainAllowed("john@acme.com", null as unknown as string[])).toBe(false)
		expect(isEmailDomainAllowed("john@acme.com", undefined as unknown as string[])).toBe(false)

		const domains = ["acme.com", "example.org", "company.co.uk"]

		expect(isEmailDomainAllowed("alice@acme.com", domains)).toBe(true)
		expect(isEmailDomainAllowed("ALICE@ACME.COM", domains)).toBe(true)
		expect(isEmailDomainAllowed("bob@EXAMPLE.ORG", domains)).toBe(true)
		expect(isEmailDomainAllowed("charlie@company.co.uk", domains)).toBe(true)

		// Mismatched domains
		expect(isEmailDomainAllowed("mallory@evil.com", domains)).toBe(false)
		expect(isEmailDomainAllowed("attacker@notacme.com", domains)).toBe(false)
		expect(isEmailDomainAllowed("attacker@acme.com.evil.com", domains)).toBe(false)
		expect(isEmailDomainAllowed("attacker@fake-acme.com", domains)).toBe(false)
		expect(isEmailDomainAllowed("invalid-email-format", domains)).toBe(false)
		expect(isEmailDomainAllowed("alice@", domains)).toBe(false)
		expect(isEmailDomainAllowed("@acme.com", domains)).toBe(false)
		expect(isEmailDomainAllowed("", domains)).toBe(false)
	})
})
