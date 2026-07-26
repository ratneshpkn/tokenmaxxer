import { describe, expect, it } from "bun:test"
import { formatDuration } from "./utils"

describe("formatDuration", () => {
	it("returns '—' if startedAt or completedAt is missing", () => {
		expect(formatDuration(null, null)).toBe("—")
		expect(formatDuration("2026-04-29T10:00:00Z", null)).toBe("—")
		expect(formatDuration(null, "2026-04-29T10:00:00Z")).toBe("—")
	})

	it("returns '—' if dates are invalid or completion is before start", () => {
		expect(formatDuration("invalid", "2026-04-29T10:00:00Z")).toBe("—")
		expect(formatDuration("2026-04-29T10:05:00Z", "2026-04-29T10:00:00Z")).toBe("—")
	})

	it("formats sub-second durations in milliseconds", () => {
		const start = "2026-04-29T10:00:00.000Z"
		const end = "2026-04-29T10:00:00.350Z"
		expect(formatDuration(start, end)).toBe("350ms")
	})

	it("formats single digit seconds with decimal", () => {
		const start = "2026-04-29T10:00:00.000Z"
		const end = "2026-04-29T10:00:02.400Z"
		expect(formatDuration(start, end)).toBe("2.4s")
	})

	it("formats seconds under a minute as whole seconds", () => {
		const start = "2026-04-29T10:00:00.000Z"
		const end = "2026-04-29T10:00:15.000Z"
		expect(formatDuration(start, end)).toBe("15s")
	})

	it("formats minutes and seconds", () => {
		const start = "2026-04-29T10:00:00.000Z"
		const end = "2026-04-29T10:02:05.000Z"
		expect(formatDuration(start, end)).toBe("2m 5s")
	})

	it("formats hours and minutes", () => {
		const start = "2026-04-29T10:00:00.000Z"
		const end = "2026-04-29T11:12:00.000Z"
		expect(formatDuration(start, end)).toBe("1h 12m")
	})
})
