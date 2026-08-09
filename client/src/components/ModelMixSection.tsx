import { MetricPair } from "@/components/MetricPair"
import { Sparkline } from "@/components/Sparkline"
import { colorForModelInMix } from "@/lib/model-color"

import { useMetricMode } from "@/lib/use-metric-mode"

type ModelMixItem = {
	model: string
	cents: number | null
	tokens: number
	trend_cents: number[] | null
	trend_tokens: number[]
}

interface ModelMixSectionProps {
	modelMix: ModelMixItem[]
	isViewer: boolean
}

export function ModelMixSection({
	modelMix,
	isViewer,
}: ModelMixSectionProps): React.JSX.Element | null {
	const [metricMode] = useMetricMode()

	if (!modelMix || modelMix.length === 0) {
		return <div className="px-5 py-6 text-xs text-fg-muted">── no model data in window ──</div>
	}

	const totalCents = modelMix.reduce((acc, m) => acc + Number(m.cents ?? 0), 0)
	const totalTokens = modelMix.reduce((acc, m) => acc + Number(m.tokens ?? 0), 0)
	// Viewers can never see cost so force tokens-primary if isViewer.
	const effectiveMode = isViewer ? "tokens" : metricMode
	const denom = effectiveMode === "cost" ? totalCents : totalTokens

	let colorIdx = 0
	const segments = modelMix.map((m) => {
		const value = effectiveMode === "cost" ? Number(m.cents ?? 0) : Number(m.tokens)
		const pct = denom > 0 ? (value / denom) * 100 : 0
		const color = colorForModelInMix(colorIdx++)
		return { ...m, pct, color, value }
	})

	const topN = segments.slice(0, 6)
	const tail = segments.slice(6)
	const tailCents = tail.reduce((acc, s) => acc + Number(s.cents ?? 0), 0)
	const tailTokens = tail.reduce((acc, s) => acc + Number(s.tokens), 0)
	const tailPct = tail.reduce((acc, s) => acc + s.pct, 0)

	return (
		<>
			{/* Stacked bar */}
			<div className="mx-5 mt-4 mb-3 h-[22px] border border-line flex overflow-hidden">
				{segments.map((s) => (
					<div
						key={s.model}
						style={{ background: s.color, width: `${s.pct}%` }}
						title={`${s.model} · ${s.pct.toFixed(1)}%`}
					/>
				))}
			</div>

			{/* Ranked list */}
			<ol className="divide-y divide-line/60">
				{topN.map((s, i) => (
					<li
						key={s.model}
						className="grid grid-cols-12 items-center gap-3 px-5 py-2.5 hover:bg-elev2/40 transition-colors"
					>
						<span className="col-span-1 font-mono text-xs tabular text-fg-subtle">
							{String(i + 1).padStart(3, "0")}
						</span>
						<span className="col-span-4 text-sm truncate min-w-0">
							<span
								className="inline-block w-2 h-2 mr-2 align-middle"
								style={{ background: s.color }}
							/>
							<span className="text-fg">{s.model}</span>
						</span>
						<span className="col-span-2 text-right text-sm tabular text-fg">
							<MetricPair cents={isViewer ? null : s.cents} tokens={s.tokens} digits={2} />
						</span>
						<span className="col-span-1 text-right text-xs tabular text-fg-muted">
							{s.pct.toFixed(1)}%
						</span>
						<div className="col-span-4">
							<Sparkline
								data={
									isViewer
										? s.trend_tokens
										: metricMode === "cost"
											? (s.trend_cents ?? s.trend_tokens)
											: s.trend_tokens
								}
								color={s.color}
								height={22}
							/>
						</div>
					</li>
				))}
				{tail.length > 0 ? (
					<li className="grid grid-cols-12 items-center gap-3 px-5 py-2.5">
						<span className="col-span-1 font-mono text-xs tabular text-fg-subtle">
							{String(topN.length + 1).padStart(3, "0")}
						</span>
						<span className="col-span-4 text-sm text-fg-muted">other ({tail.length} models)</span>
						<span className="col-span-2 text-right text-sm tabular text-fg-muted">
							<MetricPair cents={isViewer ? null : tailCents} tokens={tailTokens} digits={2} />
						</span>
						<span className="col-span-1 text-right text-xs tabular text-fg-muted">
							{tailPct.toFixed(1)}%
						</span>
						<div className="col-span-4" />
					</li>
				) : null}
			</ol>
		</>
	)
}
