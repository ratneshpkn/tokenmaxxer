import { describe, expect, it } from "bun:test"
import { computeQuartileBuckets } from "./ActivityHeatmap"

describe("computeQuartileBuckets", () => {
	it("assigns bucket 0 to zero-activity days", () => {
		const result = computeQuartileBuckets([0, 0, 100, 200])
		expect(result[0]).toBe(0)
		expect(result[1]).toBe(0)
	})

	it("assigns higher-value days to higher buckets", () => {
		// Eight non-zero days sorted: 1,2,3,4,5,6,7,8 → quartile cuts at 2.75, 4.5, 6.25
		const result = computeQuartileBuckets([1, 2, 3, 4, 5, 6, 7, 8])
		// Day with value 1 → bucket 1 (below Q1)
		expect(result[0]).toBe(1)
		// Day with value 8 → bucket 4 (peak)
		expect(result[7]).toBe(4)
	})

	it("returns all 4 when every non-zero day is equal", () => {
		const result = computeQuartileBuckets([0, 5, 5, 5])
		// Distribution is degenerate — every non-zero day should land in bucket 4.
		expect(result[0]).toBe(0)
		expect(result[1]).toBe(4)
		expect(result[2]).toBe(4)
		expect(result[3]).toBe(4)
	})

	it("returns bucket 0 for an all-zero series", () => {
		const result = computeQuartileBuckets([0, 0, 0])
		expect(result).toEqual([0, 0, 0])
	})

	it("never returns a bucket outside 0..4", () => {
		const result = computeQuartileBuckets([10, 20, 30, 40, 50])
		for (const b of result) {
			expect(b).toBeGreaterThanOrEqual(0)
			expect(b).toBeLessThanOrEqual(4)
		}
	})
})
