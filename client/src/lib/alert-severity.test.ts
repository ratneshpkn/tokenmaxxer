import { describe, expect, it } from "bun:test"
import { severity } from "./alert-severity"

describe("severity", () => {
	it("classifies ratios below 1.5 as the lightest tier", () => {
		expect(severity(0).text).toBe("text-amber/70")
		expect(severity(1).text).toBe("text-amber/70")
		expect(severity(1.49).text).toBe("text-amber/70")
	})

	it("classifies 1.5x..3x as the standard amber tier", () => {
		expect(severity(1.5).text).toBe("text-amber")
		expect(severity(2.9).text).toBe("text-amber")
	})

	it("classifies 3x..5x as the hot amber tier with a tinted row", () => {
		const s = severity(3.0)
		expect(s.text).toBe("text-amber-hot")
		expect(s.row).toBe("bg-amber/[0.04]")
		expect(s.pip).toBe("bg-amber-hot")
	})

	it("classifies 5x+ as peak severity with a stronger row tint", () => {
		const s = severity(5.0)
		expect(s.text).toBe("text-amber-hot")
		expect(s.row).toBe("bg-amber-hot/[0.06]")
		expect(s.pip).toBe("bg-amber-hot")
	})

	it("returns the three shape fields on every call", () => {
		const s = severity(0)
		expect(Object.keys(s).sort()).toEqual(["pip", "row", "text"])
	})
})
