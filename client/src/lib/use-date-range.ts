import { useCallback } from "react"
import { useLocation, useSearch } from "wouter"
import {
	customSearch,
	type DateRange,
	daysBetween,
	type Preset,
	parseSearch,
	presetSearch,
} from "./date-range"

export interface UseDateRangeReturn extends DateRange {
	/** Inclusive day count for the current window, e.g. 7, 30. */
	days: number
	/** Short human label for the window, e.g. "1D", "7D", "30D". */
	winLabel: string
	/** Click a preset chip — writes "?range=<preset>", clearing any from/to. */
	setPreset(preset: Preset): void
	/** Apply a custom calendar selection — writes "?from=&to=", clearing any range. */
	setCustom(from: string, to: string): void
	/** Reset the URL to no search params (canonical default view). */
	clear(): void
}

export function useDateRange(): UseDateRangeReturn {
	const search = useSearch()
	const [path, setLocation] = useLocation()

	const resolved = parseSearch(search)
	const days = daysBetween(resolved.from, resolved.to)
	const winLabel = days === 1 ? "1D" : `${days}D`

	const setPreset = useCallback(
		(preset: Preset) => {
			setLocation(`${path}${presetSearch(preset)}`, { replace: true })
		},
		[path, setLocation],
	)

	const setCustom = useCallback(
		(from: string, to: string) => {
			setLocation(`${path}${customSearch(from, to)}`, { replace: true })
		},
		[path, setLocation],
	)

	const clear = useCallback(() => {
		setLocation(path, { replace: true })
	}, [path, setLocation])

	return { ...resolved, days, winLabel, setPreset, setCustom, clear }
}
