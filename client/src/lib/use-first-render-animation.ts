import { useEffect, useState } from "react"

/** Returns `true` on first mount, flips to `false` after `delayMs`. Pass the value
 *  to a Recharts series' `isAnimationActive` so it animates entrance once and then
 *  stays static on every subsequent re-render (including ResizeObserver-driven
 *  re-renders from `ResponsiveContainer` during full-page screenshots). */
export function useFirstRenderAnimation(delayMs = 1500): boolean {
	const [animating, setAnimating] = useState(true)
	useEffect(() => {
		const t = setTimeout(() => setAnimating(false), delayMs)
		return () => clearTimeout(t)
	}, [delayMs])
	return animating
}
