import * as htmlToImage from "html-to-image"
import { Download, Loader2 } from "lucide-react"
import { useRef, useState } from "react"
import { Cost } from "@/components/Cost"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useMetricMode } from "@/lib/use-metric-mode"
import { usePrivacyMode } from "@/lib/use-privacy-mode"
import { formatCompact } from "@/lib/utils"

interface FlexCardModalProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	userName: string
	totalTokens: number
	totalCents: number | null
	ccTokens: number
	cuTokens: number
	activeDays: number
	daysInWindow: number
}

export function FlexCardModal({
	open,
	onOpenChange,
	userName,
	totalTokens,
	totalCents,
	ccTokens,
	cuTokens,
	activeDays,
	daysInWindow,
}: FlexCardModalProps) {
	const cardRef = useRef<HTMLDivElement>(null)
	const [downloading, setDownloading] = useState(false)
	const [metricMode] = useMetricMode()
	const [privacyOn] = usePrivacyMode()
	const showCost = !privacyOn && totalCents !== null

	const handleDownload = async () => {
		if (!cardRef.current) return
		setDownloading(true)
		try {
			await new Promise((r) => setTimeout(r, 100))
			const dataUrl = await htmlToImage.toPng(cardRef.current, {
				quality: 1,
				pixelRatio: 3,
				backgroundColor: "#0d0d0d",
				style: {
					transform: "none",
				},
			})
			const a = document.createElement("a")
			a.href = dataUrl
			a.download = `tokenmaxxer-${userName.replace(/\s+/g, "-").toLowerCase()}-flex.png`
			a.click()
		} catch (err) {
			console.error("Failed to generate image", err)
		} finally {
			setDownloading(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-xl p-0 overflow-hidden bg-bg border-line">
				<DialogHeader className="p-4 border-b border-line bg-elev2/40">
					<DialogTitle className="text-sm font-mono tracking-tight">Share Your Stats</DialogTitle>
				</DialogHeader>

				<div className="p-8 bg-elev flex items-center justify-center">
					{/* The actual flex card that gets screenshotted */}
					<div
						ref={cardRef}
						className="w-full max-w-[480px] bg-bg border border-line flex flex-col relative overflow-hidden"
					>
						{/* Top accent bar */}
						<div className="h-1 w-full bg-gradient-to-r from-amber to-sky" />

						<div className="p-8 flex flex-col gap-8">
							<div className="flex justify-between items-start">
								<div>
									<h2 className="font-display text-4xl tracking-tight text-fg">{userName}</h2>
									<div className="text-[10px] tracked text-fg-dim mt-1 uppercase">
										Tokenmaxxer Profile · {daysInWindow}D Window
									</div>
								</div>
								<div className="text-[10px] tracked text-fg-very-dim uppercase flex items-center gap-1.5 mt-5">
									<span className="w-1.5 h-1.5 bg-amber inline-block" />
									<span className="w-1.5 h-1.5 bg-sky inline-block" />
								</div>
							</div>

							<div className="grid grid-cols-2 gap-px bg-line/60 border border-line">
								{!showCost ? (
									<div className="bg-bg p-4 flex flex-col justify-center col-span-2">
										<div className="text-[10px] tracked text-fg-dim mb-2 uppercase">
											Total Tokens
										</div>
										<div className="font-display text-4xl text-fg leading-none tracking-tight tabular">
											{formatCompact(totalTokens)}
										</div>
									</div>
								) : metricMode === "cost" ? (
									<>
										<div className="bg-bg p-4 flex flex-col justify-center">
											<div className="text-[10px] tracked text-fg-dim mb-2 uppercase">
												Total Cost
											</div>
											<Cost
												cents={totalCents}
												digits={2}
												className="font-display text-4xl text-fg leading-none tracking-tight block"
											/>
										</div>
										<div className="bg-bg p-4 flex flex-col justify-center">
											<div className="text-[10px] tracked text-fg-dim mb-2 uppercase">
												Total Tokens
											</div>
											<div className="font-mono text-3xl text-fg leading-none tabular">
												{formatCompact(totalTokens)}
											</div>
										</div>
									</>
								) : (
									<>
										<div className="bg-bg p-4 flex flex-col justify-center">
											<div className="text-[10px] tracked text-fg-dim mb-2 uppercase">
												Total Tokens
											</div>
											<div className="font-display text-4xl text-fg leading-none tracking-tight tabular">
												{formatCompact(totalTokens)}
											</div>
										</div>
										<div className="bg-bg p-4 flex flex-col justify-center">
											<div className="text-[10px] tracked text-fg-dim mb-2 uppercase">
												Total Cost
											</div>
											<Cost
												cents={totalCents}
												digits={2}
												className="font-mono text-3xl text-fg leading-none tabular block"
											/>
										</div>
									</>
								)}

								<div className="bg-bg p-4 flex flex-col justify-center col-span-2">
									<div className="text-[10px] tracked text-fg-dim mb-2 uppercase">
										Platform Split
									</div>
									<div className="flex items-center gap-6">
										<div className="flex items-center gap-2">
											<span className="w-1.5 h-1.5 bg-amber inline-block shrink-0 translate-y-[1px]" />
											<span className="font-mono text-sm text-fg">{formatCompact(ccTokens)}</span>
											<span className="text-[10px] text-fg-dim">CLAUDE CODE</span>
										</div>
										<div className="flex items-center gap-2">
											<span className="w-1.5 h-1.5 bg-sky inline-block shrink-0 translate-y-[1px]" />
											<span className="font-mono text-sm text-fg">{formatCompact(cuTokens)}</span>
											<span className="text-[10px] text-fg-dim">CURSOR</span>
										</div>
									</div>
								</div>
							</div>

							<div className="flex items-center justify-between mt-2">
								<div className="text-[10px] tracked text-fg-dim">
									<span className="text-fg">{activeDays}</span> ACTIVE DAYS
								</div>
								<div className="font-display text-lg tracking-tight text-fg text-right opacity-90 italic">
									"Are you even tokenmaxxing?"
								</div>
							</div>
						</div>
					</div>
				</div>

				<div className="p-4 border-t border-line flex justify-end bg-elev2/40">
					<Button
						onClick={handleDownload}
						disabled={downloading}
						className="bg-fg text-bg hover:bg-fg/90"
					>
						{downloading ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Download className="mr-2 h-4 w-4" />
						)}
						Download as Image
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
