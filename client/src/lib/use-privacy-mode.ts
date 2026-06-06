import { useEffect, useState } from "react"

/** Global "blur cost numbers" toggle. Persisted in localStorage so it survives reloads
 *  and applies the moment the page loads (no flash of un-blurred content). Subscribes
 *  to a custom event so every <Cost /> instance updates synchronously when toggled. */

const STORAGE_KEY = "tokenmaxxer.privacyMode"
const EVENT = "tokenmaxxer:privacy-changed"

function readInitial(): boolean {
	if (typeof window === "undefined") return false
	return window.localStorage.getItem(STORAGE_KEY) === "1"
}

export function usePrivacyMode(): [boolean, () => void] {
	const [on, setOn] = useState<boolean>(readInitial)

	useEffect(() => {
		const handler = (): void => setOn(readInitial())
		window.addEventListener(EVENT, handler)
		window.addEventListener("storage", handler) // cross-tab sync
		return () => {
			window.removeEventListener(EVENT, handler)
			window.removeEventListener("storage", handler)
		}
	}, [])

	function toggle(): void {
		const next = !readInitial()
		window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
		window.dispatchEvent(new Event(EVENT))
	}

	return [on, toggle]
}
