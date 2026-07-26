import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs))
}

export function formatCents(cents: number | null | undefined): string {
	if (cents == null) return "—"
	const dollars = Number(cents) / 100
	return dollars.toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: 2,
	})
}

/** Pretty dollars without the cents — for big headline figures. */
export function formatDollars(cents: number | null | undefined, max = 0): string {
	if (cents == null) return "—"
	const dollars = Number(cents) / 100
	return dollars.toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
		maximumFractionDigits: max,
	})
}

export function formatNumber(n: number | null | undefined): string {
	if (n == null) return "—"
	return Number(n).toLocaleString("en-US")
}

export function formatCompact(n: number | null | undefined): string {
	if (n == null) return "—"
	const num = Number(n)
	if (!Number.isFinite(num)) return "—"
	return new Intl.NumberFormat("en-US", {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(num)
}

export function formatDate(d: string | Date): string {
	const date = typeof d === "string" ? new Date(d) : d
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

/** YYYY-MM-DD HH:MM:SS in local tz, for terminal-style timestamps. */
export function formatTimestamp(d: string | Date): string {
	const date = typeof d === "string" ? new Date(d) : d
	const pad = (n: number) => String(n).padStart(2, "0")
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Time-since helper: "2h 14m ago", "32s ago" */
export function timeAgo(d: string | Date | null | undefined): string {
	if (d == null) return "—"
	const date = typeof d === "string" ? new Date(d) : d
	const sec = Math.floor((Date.now() - date.getTime()) / 1000)
	if (sec < 60) return `${sec}s ago`
	if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
	if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m ago`
	return `${Math.floor(sec / 86400)}d ago`
}

/** Formats run duration: e.g. "350ms", "2.4s", "15s", "2m 5s", "1h 12m" or "—" if incomplete/invalid. */
export function formatDuration(
	startedAt: string | Date | null | undefined,
	completedAt: string | Date | null | undefined,
): string {
	if (!startedAt || !completedAt) return "—"
	const start = typeof startedAt === "string" ? new Date(startedAt).getTime() : startedAt.getTime()
	const end =
		typeof completedAt === "string" ? new Date(completedAt).getTime() : completedAt.getTime()
	if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—"

	const ms = end - start
	const sec = Math.floor(ms / 1000)
	if (sec < 1) return `${ms}ms`
	if (sec < 10) return `${(ms / 1000).toFixed(1)}s`
	if (sec < 60) return `${sec}s`
	const min = Math.floor(sec / 60)
	const remSec = sec % 60
	if (min < 60) return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`
	const hrs = Math.floor(min / 60)
	const remMin = min % 60
	return remMin > 0 ? `${hrs}h ${remMin}m` : `${hrs}h`
}
