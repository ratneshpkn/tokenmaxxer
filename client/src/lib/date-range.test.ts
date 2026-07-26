import { describe, expect, it } from "bun:test"
import {
	addDays,
	daysBetween,
	firstOfMonth,
	isValidYmd,
	parseSearch,
	resolvePreset,
} from "./date-range"

// Pin "now" to a deterministic instant so tests aren't time-dependent.
// 2026-04-29 12:00:00 UTC = 2026-04-29 05:00:00 PT (still 04-29 in PT).
const NOW = new Date("2026-04-29T12:00:00Z")

describe("addDays", () => {
	it("adds positive days", () => {
		expect(addDays("2026-04-28", 1)).toBe("2026-04-29")
	})
	it("subtracts days", () => {
		expect(addDays("2026-04-01", -1)).toBe("2026-03-31")
	})
	it("crosses month boundary", () => {
		expect(addDays("2026-02-28", 1)).toBe("2026-03-01")
	})
})

describe("daysBetween", () => {
	it("counts inclusive days", () => {
		expect(daysBetween("2026-04-01", "2026-04-01")).toBe(1)
		expect(daysBetween("2026-04-01", "2026-04-07")).toBe(7)
	})
	it("clamps to >= 1 even if from > to", () => {
		expect(daysBetween("2026-04-15", "2026-04-01")).toBe(1)
	})
})

describe("firstOfMonth", () => {
	it("returns YYYY-MM-01", () => {
		expect(firstOfMonth("2026-04-29")).toBe("2026-04-01")
	})
})

describe("isValidYmd", () => {
	it("accepts real dates", () => {
		expect(isValidYmd("2026-04-29")).toBe(true)
	})
	it("rejects malformed", () => {
		expect(isValidYmd("2026-4-29")).toBe(false)
		expect(isValidYmd("2026/04/29")).toBe(false)
	})
	it("rejects impossible dates", () => {
		expect(isValidYmd("2026-02-30")).toBe(false)
		expect(isValidYmd("2026-13-01")).toBe(false)
	})
})

describe("resolvePreset", () => {
	it("7d covers today and the 6 preceding days", () => {
		const r = resolvePreset("7d", NOW)
		expect(r.to).toBe("2026-04-29")
		expect(r.from).toBe("2026-04-23")
		expect(r.preset).toBe("7d")
	})
	it("30d covers 30 days ending today", () => {
		const r = resolvePreset("30d", NOW)
		expect(r.to).toBe("2026-04-29")
		expect(r.from).toBe("2026-03-31")
	})
	it("mtd starts at the first of the current month", () => {
		const r = resolvePreset("mtd", NOW)
		expect(r.from).toBe("2026-04-01")
		expect(r.to).toBe("2026-04-29")
	})
	it("90d covers 90 days ending today", () => {
		const r = resolvePreset("90d", NOW)
		expect(r.to).toBe("2026-04-29")
		expect(r.from).toBe("2026-01-30") // today - 89
	})
	it("6m covers 180 days ending today", () => {
		const r = resolvePreset("6m", NOW)
		expect(r.to).toBe("2026-04-29")
		expect(r.from).toBe("2025-11-01") // today - 179
	})
	it("mtd on the 1st of the month returns the first day of the current month", () => {
		const MAY_1 = new Date("2026-05-01T12:00:00Z")
		const r = resolvePreset("mtd", MAY_1)
		expect(r.from).toBe("2026-05-01")
		expect(r.to).toBe("2026-05-01")
	})
})

describe("parseSearch", () => {
	it("empty input → 30d default", () => {
		const r = parseSearch("", NOW)
		expect(r.preset).toBe("30d")
		expect(r.to).toBe("2026-04-29")
	})
	it("?range=7d → resolves preset", () => {
		expect(parseSearch("?range=7d", NOW).preset).toBe("7d")
	})
	it("?range=junk → falls back to 30d", () => {
		expect(parseSearch("?range=junk", NOW).preset).toBe("30d")
	})
	it("?from=&to= → custom", () => {
		const r = parseSearch("?from=2026-04-01&to=2026-04-15", NOW)
		expect(r.preset).toBe("custom")
		expect(r.from).toBe("2026-04-01")
		expect(r.to).toBe("2026-04-15")
	})
	it("inverted from/to → swaps them", () => {
		const r = parseSearch("?from=2026-04-15&to=2026-04-01", NOW)
		expect(r.preset).toBe("custom")
		expect(r.from).toBe("2026-04-01")
		expect(r.to).toBe("2026-04-15")
	})
	it("?range wins when both are present", () => {
		const r = parseSearch("?range=7d&from=2026-04-01&to=2026-04-15", NOW)
		expect(r.preset).toBe("7d")
	})
	it("clamps a future `to` to today", () => {
		const r = parseSearch("?from=2026-04-01&to=2030-01-01", NOW)
		expect(r.preset).toBe("custom")
		expect(r.to).toBe("2026-04-29")
	})
	it("from after the clamped to → clamps from to today as well", () => {
		const r = parseSearch("?from=2026-04-30&to=2030-01-01", NOW)
		expect(r.preset).toBe("custom")
		expect(r.from).toBe("2026-04-29")
		expect(r.to).toBe("2026-04-29")
	})
	it("partial (only `from`) → default", () => {
		expect(parseSearch("?from=2026-04-01", NOW).preset).toBe("30d")
	})
})
