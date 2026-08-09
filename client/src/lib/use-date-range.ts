import { useCallback, useEffect } from "react"
import { useLocation, useSearch } from "wouter"
import {
	type DateRange,
	daysBetween,
	PRESETS,
	type Preset,
	parseSearch,
	resolvePreset,
} from "./date-range"

const STORAGE_KEY = "tokenmaxxer_date_range"

interface StoredRange {
	preset: Preset | "custom"
	from?: string
	to?: string
}

function getStoredRange(): StoredRange | null {
	if (typeof window === "undefined" || !window.localStorage) return null
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return null
		const parsed = JSON.parse(raw) as StoredRange
		if (parsed.preset === "custom" && parsed.from && parsed.to) {
			return parsed
		}
		if (parsed.preset && (PRESETS as readonly string[]).includes(parsed.preset)) {
			return parsed
		}
		return null
	} catch {
		return null
	}
}

function setStoredRange(range: StoredRange): void {
	if (typeof window === "undefined" || !window.localStorage) return
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(range))
	} catch {
		// ignore
	}
}

function hasDateParamsInSearch(search: string): boolean {
	const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
	return params.has("range") || (params.has("from") && params.has("to"))
}

export interface UseDateRangeReturn extends DateRange {
	/** Inclusive day count for the current window, e.g. 7, 30. */
	days: number
	/** Short human label for the window, e.g. "1D", "7D", "30D". */
	winLabel: string
	/** Click a preset chip — writes "?range=<preset>", clearing any from/to. */
	setPreset(preset: Preset): void
	/** Apply a custom calendar selection — writes "?from=&to=", clearing any range. */
	setCustom(from: string, to: string): void
	/** Reset the URL and storage to canonical 30d view. */
	clear(): void
}

export function useDateRange(): UseDateRangeReturn {
	const search = useSearch()
	const [path, setLocation] = useLocation()

	const hasUrlDateParams = hasDateParamsInSearch(search)

	let resolved: DateRange
	if (hasUrlDateParams) {
		resolved = parseSearch(search)
	} else {
		const stored = getStoredRange()
		if (stored) {
			if (stored.preset === "custom" && stored.from && stored.to) {
				resolved = parseSearch(`?from=${stored.from}&to=${stored.to}`)
			} else if (stored.preset !== "custom") {
				resolved = resolvePreset(stored.preset)
			} else {
				resolved = parseSearch("")
			}
		} else {
			resolved = parseSearch("")
		}
	}

	const days = daysBetween(resolved.from, resolved.to)
	const winLabel = days === 1 ? "1D" : `${days}D`

	// Keep localStorage synced via side-effect hook (not during render phase)
	useEffect(() => {
		if (hasUrlDateParams) {
			setStoredRange(
				resolved.preset === "custom"
					? { preset: "custom", from: resolved.from, to: resolved.to }
					: { preset: resolved.preset },
			)
		}
	}, [hasUrlDateParams, resolved.preset, resolved.from, resolved.to])

	// Auto-sync missing search params to URL when URL is clean
	useEffect(() => {
		if (!hasUrlDateParams) {
			const currentParams = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
			if (resolved.preset === "custom") {
				currentParams.delete("range")
				currentParams.set("from", resolved.from)
				currentParams.set("to", resolved.to)
			} else {
				currentParams.delete("from")
				currentParams.delete("to")
				currentParams.set("range", resolved.preset)
			}
			const newSearch = `?${currentParams.toString()}`
			if (newSearch !== search) {
				setLocation(`${path}${newSearch}`, { replace: true })
			}
		}
	}, [hasUrlDateParams, path, search, resolved.preset, resolved.from, resolved.to, setLocation])

	const setPreset = useCallback(
		(preset: Preset) => {
			setStoredRange({ preset })
			const currentParams = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
			currentParams.delete("from")
			currentParams.delete("to")
			currentParams.set("range", preset)
			const qs = currentParams.toString()
			setLocation(qs ? `${path}?${qs}` : path, { replace: true })
		},
		[path, search, setLocation],
	)

	const setCustom = useCallback(
		(from: string, to: string) => {
			setStoredRange({ preset: "custom", from, to })
			const currentParams = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
			currentParams.delete("range")
			currentParams.set("from", from)
			currentParams.set("to", to)
			const qs = currentParams.toString()
			setLocation(qs ? `${path}?${qs}` : path, { replace: true })
		},
		[path, search, setLocation],
	)

	const clear = useCallback(() => {
		try {
			if (typeof window !== "undefined" && window.localStorage) {
				localStorage.removeItem(STORAGE_KEY)
			}
		} catch {
			// ignore
		}
		const currentParams = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
		currentParams.delete("range")
		currentParams.delete("from")
		currentParams.delete("to")
		const qs = currentParams.toString()
		setLocation(qs ? `${path}?${qs}` : path, { replace: true })
	}, [path, search, setLocation])

	return { ...resolved, days, winLabel, setPreset, setCustom, clear }
}
