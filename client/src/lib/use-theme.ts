import { useEffect, useState } from "react"

export type Theme = "system" | "light" | "dark"

const STORAGE_KEY = "tokenmaxxer.theme"
const EVENT = "tokenmaxxer:theme-changed"

function readInitial(): Theme {
	if (typeof window === "undefined") return "system"
	const v = window.localStorage.getItem(STORAGE_KEY)
	return v === "light" || v === "dark" ? v : "system"
}

function resolved(theme: Theme): "light" | "dark" {
	if (theme === "system") {
		return typeof window !== "undefined" &&
			window.matchMedia("(prefers-color-scheme: dark)").matches
			? "dark"
			: "light"
	}
	return theme
}

/** Apply the `.dark` class on <html> based on the resolved theme. Idempotent. */
function applyTheme(theme: Theme): void {
	if (typeof document === "undefined") return
	const root = document.documentElement
	if (resolved(theme) === "dark") root.classList.add("dark")
	else root.classList.remove("dark")
}

/** Theme state hook. Returns `theme` (user pref: system | light | dark), `effective`
 *  (the resolved value applied to the DOM), and `setTheme` to change + persist + apply.
 *  Subscribes to `prefers-color-scheme` changes while in `system` mode. */
export function useTheme(): {
	theme: Theme
	effective: "light" | "dark"
	setTheme: (next: Theme) => void
} {
	const [theme, setThemeState] = useState<Theme>(readInitial)
	const [effective, setEffective] = useState<"light" | "dark">(() => resolved(readInitial()))

	// Cross-tab + cross-instance sync
	useEffect(() => {
		const onChange = (): void => {
			const next = readInitial()
			setThemeState(next)
			setEffective(resolved(next))
			applyTheme(next)
		}
		window.addEventListener(EVENT, onChange)
		window.addEventListener("storage", onChange)
		return () => {
			window.removeEventListener(EVENT, onChange)
			window.removeEventListener("storage", onChange)
		}
	}, [])

	// While in `system` mode, follow OS-level changes
	useEffect(() => {
		if (theme !== "system") return
		const mq = window.matchMedia("(prefers-color-scheme: dark)")
		const onChange = (): void => {
			setEffective(resolved("system"))
			applyTheme("system")
		}
		mq.addEventListener("change", onChange)
		return () => mq.removeEventListener("change", onChange)
	}, [theme])

	function setTheme(next: Theme): void {
		if (next === "system") window.localStorage.removeItem(STORAGE_KEY)
		else window.localStorage.setItem(STORAGE_KEY, next)
		window.dispatchEvent(new Event(EVENT))
	}

	return { theme, effective, setTheme }
}

/** Apply the saved/system theme immediately on app start, before React mounts.
 *  Call from main.tsx so the first paint has the right `.dark` class — prevents
 *  a "flash of wrong theme" on load. */
export function applyInitialTheme(): void {
	applyTheme(readInitial())
}
