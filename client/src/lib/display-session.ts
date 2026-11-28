import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { api } from "./api"

// ── Typed Query Keys ────────────────────────────────────────────────────────

export const queryKeys = {
	me: ["me"] as const,
	config: ["config"] as const,
	alerts: ["alerts"] as const,
	alertsCount: ["alerts.count"] as const,
} as const

// ── Platform Metadata ───────────────────────────────────────────────────────

export type Platform = "claude_code" | "cursor"

export const PLATFORMS = {
	claude_code: { label: "CLAUDE CODE", short: "CC", color: "var(--amber)", colorVar: "amber" },
	cursor: { label: "CURSOR", short: "CU", color: "var(--sky)", colorVar: "sky" },
} as const

export function platformLabel(p: Platform): string {
	return PLATFORMS[p].label
}

// ── Synced localStorage Preferences ─────────────────────────────────────────

function readStorage<T>(key: string, parse: (raw: string | null) => T): T {
	if (typeof window === "undefined") return parse(null)
	try {
		return parse(window.localStorage.getItem(key))
	} catch {
		return parse(null)
	}
}

function writeStorage(key: string, event: string, value: string | null): void {
	if (typeof window === "undefined") return
	try {
		if (value === null) window.localStorage.removeItem(key)
		else window.localStorage.setItem(key, value)
	} catch {
		// Private browsing / storage quota — fall back gracefully.
	}
	window.dispatchEvent(new Event(event))
}

function useSyncedStorage<T>(
	key: string,
	event: string,
	parse: (raw: string | null) => T,
): [T, (next: string | null) => void] {
	const [value, setValue] = useState<T>(() => readStorage(key, parse))

	useEffect(() => {
		const sync = (): void => setValue(readStorage(key, parse))
		const onStorage = (e: StorageEvent): void => {
			if (e.key === null || e.key === key) sync()
		}
		window.addEventListener(event, sync)
		window.addEventListener("storage", onStorage)
		return () => {
			window.removeEventListener(event, sync)
			window.removeEventListener("storage", onStorage)
		}
	}, [key, event, parse])

	return [value, (next: string | null) => writeStorage(key, event, next)]
}

// ── Metric Mode, Privacy Mode & Theme ───────────────────────────────────────

export type MetricMode = "cost" | "tokens"
export type TrendMode = "usd" | "tokens"
export type Theme = "system" | "light" | "dark"

const METRIC_KEY = "tokenmaxxer.metricMode"
const METRIC_EVENT = "tokenmaxxer:metric-mode-changed"
const parseMetric = (v: string | null): MetricMode => (v === "tokens" ? "tokens" : "cost")

export function useMetricMode(): [MetricMode, () => void] {
	const [mode, setRaw] = useSyncedStorage(METRIC_KEY, METRIC_EVENT, parseMetric)
	const toggle = (): void => {
		const next: MetricMode = readStorage(METRIC_KEY, parseMetric) === "cost" ? "tokens" : "cost"
		setRaw(next)
	}
	return [mode, toggle]
}

const PRIVACY_KEY = "tokenmaxxer.privacyMode"
const PRIVACY_EVENT = "tokenmaxxer:privacy-changed"
const parsePrivacy = (v: string | null): boolean => v === "1"

export function usePrivacyMode(): [boolean, () => void] {
	const [on, setRaw] = useSyncedStorage(PRIVACY_KEY, PRIVACY_EVENT, parsePrivacy)
	const toggle = (): void => setRaw(readStorage(PRIVACY_KEY, parsePrivacy) ? "0" : "1")
	return [on, toggle]
}

const THEME_KEY = "tokenmaxxer.theme"
const THEME_EVENT = "tokenmaxxer:theme-changed"
const parseTheme = (v: string | null): Theme => (v === "light" || v === "dark" ? v : "system")

function resolveTheme(theme: Theme): "light" | "dark" {
	if (theme === "system") {
		return typeof window !== "undefined" &&
			window.matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light"
	}
	return theme
}

function applyTheme(theme: Theme): void {
	if (typeof document === "undefined") return
	document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark")
}

export function applyInitialTheme(): void {
	applyTheme(readStorage(THEME_KEY, parseTheme))
}

export function useTheme(): {
	theme: Theme
	effective: "light" | "dark"
	setTheme: (next: Theme) => void
} {
	const [theme, setRaw] = useSyncedStorage(THEME_KEY, THEME_EVENT, parseTheme)
	const [effective, setEffective] = useState<"light" | "dark">(() => resolveTheme(theme))

	useEffect(() => {
		setEffective(resolveTheme(theme))
		applyTheme(theme)
		if (theme !== "system") return
		const mq = window.matchMedia("(prefers-color-scheme: dark)")
		const onChange = (): void => {
			setEffective(resolveTheme("system"))
			applyTheme("system")
		}
		mq.addEventListener("change", onChange)
		return () => mq.removeEventListener("change", onChange)
	}, [theme])

	const setTheme = (next: Theme): void => setRaw(next === "system" ? null : next)
	return { theme, effective, setTheme }
}

// ── Session & Display Mode Policy ───────────────────────────────────────────

export function resolveDisplayMode(
	role: "admin" | "viewer" | undefined,
	metricMode: MetricMode,
): { isAdmin: boolean; isViewer: boolean; effectiveMetric: MetricMode; trendMode: TrendMode } {
	const isAdmin = role === "admin"
	const isViewer = !isAdmin
	const effectiveMetric: MetricMode = isViewer ? "tokens" : metricMode
	const trendMode: TrendMode = effectiveMetric === "cost" ? "usd" : "tokens"
	return { isAdmin, isViewer, effectiveMetric, trendMode }
}

export function pickTrendSeries(
	row: { trend_cents?: number[] | null; trend_tokens?: number[] | null },
	isViewer: boolean,
	metricMode: MetricMode,
): number[] {
	if (isViewer || metricMode === "tokens") return row.trend_tokens ?? []
	return row.trend_cents ?? row.trend_tokens ?? []
}

export function useMe() {
	return useQuery({
		queryKey: queryKeys.me,
		queryFn: api.me,
		retry: false,
	})
}

export function useDisplaySession() {
	const { data: me } = useMe()
	const [metricMode, toggleMetric] = useMetricMode()
	const [privacyOn, togglePrivacy] = usePrivacyMode()
	const resolved = resolveDisplayMode(me?.role, metricMode)

	return {
		me,
		...resolved,
		metricMode,
		toggleMetric,
		privacyOn,
		togglePrivacy,
	}
}
