/**
 * Date-range presets and URL-parameter helpers.
 * Pure functions only — no React, no DOM.
 *
 * Preset semantics: "yesterday" is `today_PT − 1 day` everywhere. "today_PT"
 * is the current calendar date in America/Los_Angeles. Matches existing
 * server-side `yesterday()` in server/scripts/lib/shared.ts.
 */

export const PRESETS = ["7d", "30d", "90d", "mtd", "6m"] as const
export type Preset = (typeof PRESETS)[number]
export type RangeMode = Preset | "custom"

export interface DateRange {
	from: string // YYYY-MM-DD inclusive
	to: string // YYYY-MM-DD inclusive
	preset: RangeMode
}

const TZ = "America/Los_Angeles"
const YMD = /^\d{4}-\d{2}-\d{2}$/

/** Today's date in PT as YYYY-MM-DD. */
export function todayPT(now: Date = new Date()): string {
	const fmt = new Intl.DateTimeFormat("en-CA", {
		timeZone: TZ,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	})
	return fmt.format(now)
}

/** Add `days` (negative for past) to a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function addDays(ymd: string, days: number): string {
	const d = new Date(`${ymd}T00:00:00Z`)
	d.setUTCDate(d.getUTCDate() + days)
	return d.toISOString().slice(0, 10)
}

/** Inclusive day count between two YYYY-MM-DD strings. Assumes from <= to. */
export function daysBetween(from: string, to: string): number {
	const a = new Date(`${from}T00:00:00Z`).getTime()
	const b = new Date(`${to}T00:00:00Z`).getTime()
	return Math.max(1, Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1)
}

/** First day of the calendar month for a YYYY-MM-DD string. */
export function firstOfMonth(ymd: string): string {
	return `${ymd.slice(0, 7)}-01`
}

/** Resolve a preset to {from, to} relative to a "now" instant (defaults to real now). */
export function resolvePreset(preset: Preset, now: Date = new Date()): DateRange {
	const today = todayPT(now)
	const yesterday = addDays(today, -1)
	switch (preset) {
		case "7d":
			return { from: addDays(yesterday, -6), to: yesterday, preset }
		case "30d":
			return { from: addDays(yesterday, -29), to: yesterday, preset }
		case "90d":
			return { from: addDays(yesterday, -89), to: yesterday, preset }
		case "6m":
			// 6m is approximated as 180 days (not calendar months) — matches existing
			// server-side conventions and avoids month-length edge cases.
			return { from: addDays(yesterday, -179), to: yesterday, preset }
		case "mtd": {
			const first = firstOfMonth(yesterday)
			return { from: first, to: yesterday, preset }
		}
	}
}

/** True if the string is a valid YYYY-MM-DD that parses to a real calendar date. */
export function isValidYmd(s: string): boolean {
	if (!YMD.test(s)) return false
	const d = new Date(`${s}T00:00:00Z`)
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * Parse a search-string ("?range=30d" or "?from=...&to=...") into a DateRange.
 * Falls back to the 30d preset for empty / invalid input. `range` wins if both
 * shapes are present (degenerate URL). Future `to` is clamped to yesterday.
 */
export function parseSearch(search: string, now: Date = new Date()): DateRange {
	const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)

	const rangeRaw = params.get("range")
	if (rangeRaw && (PRESETS as readonly string[]).includes(rangeRaw)) {
		return resolvePreset(rangeRaw as Preset, now)
	}
	if (rangeRaw) {
		// unknown preset → fall through to 30d default (don't try from/to)
		return resolvePreset("30d", now)
	}

	const from = params.get("from")
	const to = params.get("to")
	if (from && to && isValidYmd(from) && isValidYmd(to)) {
		let f = from
		let t = to
		if (f > t) {
			f = to
			t = from
		}

		const today = todayPT(now)
		const yesterday = addDays(today, -1)

		const clampedTo = t > yesterday ? yesterday : t
		const clampedFrom = f > yesterday ? yesterday : f

		return { from: clampedFrom, to: clampedTo, preset: "custom" }
	}

	// either both missing, or partial/invalid → default
	return resolvePreset("30d", now)
}

/** Build the search string for a preset URL: "?range=30d". */
export function presetSearch(preset: Preset): string {
	return `?range=${preset}`
}

/** Build the search string for a custom URL: "?from=YYYY-MM-DD&to=YYYY-MM-DD". */
export function customSearch(from: string, to: string): string {
	return `?from=${from}&to=${to}`
}
