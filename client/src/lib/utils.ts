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
