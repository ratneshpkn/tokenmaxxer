export function normalizeModelName(raw: string): string {
	if (!raw) return "Unknown"

	let clean = raw.toLowerCase()

	// Strip cursor prefix
	clean = clean.replace(/^cursor-/, "")

	// Strip noisy keywords
	const stripWords = [
		"high",
		"fast",
		"medium",
		"low",
		"xhigh",
		"extra",
		"max",
		"premium",
		"thinking",
	]

	// Handle special cases: 'k2p5' -> 'k2.5'
	clean = clean.replace(/(\d)p(\d)/g, "$1.$2")

	// Replace separators with spaces, but keep dots
	clean = clean.replace(/[-_:()[\]]/g, " ")

	const words = clean.split(/\s+/).filter((w) => w && !stripWords.includes(w))

	const result: string[] = []
	for (let i = 0; i < words.length; i++) {
		const w = words[i]
		// Recombine standalone numbers into versions (e.g. '4', '7' -> '4.7')
		if (result.length > 0 && /^\d+$/.test(w) && /^\d+$/.test(result[result.length - 1])) {
			result[result.length - 1] += `.${w}`
		} else {
			result.push(w)
		}
	}

	const titleCased = result.map((w) => {
		if (w === "gpt") return "GPT"
		if (w === "tpu") return "TPU"
		return w.charAt(0).toUpperCase() + w.slice(1)
	})

	return titleCased.join(" ")
}
