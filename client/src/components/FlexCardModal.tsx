import { Download, Loader2 } from "lucide-react"
import { useRef, useState } from "react"
import { Cost } from "@/components/Cost"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "@/components/ui/toast"
import { Typography } from "@/components/ui/typography"
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
}: FlexCardModalProps): React.JSX.Element {
	const cardRef = useRef<HTMLDivElement>(null)
	const [downloading, setDownloading] = useState(false)
	const [privacyOn] = usePrivacyMode()
	const [metricMode] = useMetricMode()
	const showCost = !privacyOn && totalCents !== null

	const handleDownload = async () => {
		if (!cardRef.current) return
		try {
			setDownloading(true)
			const htmlToImage = await import("html-to-image")
			const dataUrl = await htmlToImage.toPng(cardRef.current, { cacheBust: true, pixelRatio: 2 })
			const link = document.createElement("a")
			link.download = `${userName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-tokenmaxxer-stats.png`
			link.href = dataUrl
			link.click()
		} catch (err) {
			console.error("Failed to generate image", err)
			toast.error("Failed to generate stats card image. Please try again.")
		} finally {
			setDownloading(false)
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[540px] p-0 bg-bg border-line overflow-hidden">
				<DialogHeader className="sr-only">
					<DialogTitle>Shareable Stats Card</DialogTitle>
				</DialogHeader>

				<div className="p-6 overflow-x-auto flex justify-center bg-bg/50">
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
									<Typography variant="label" as="div" className="mt-1">
										Tokenmaxxer Profile · {daysInWindow}D Window
									</Typography>
								</div>
								<Typography variant="th" as="div" className="flex items-center gap-1.5 mt-5">
									<span className="w-1.5 h-1.5 bg-amber inline-block" />
									<span className="w-1.5 h-1.5 bg-sky inline-block" />
								</Typography>
							</div>

							<div className="grid grid-cols-2 gap-px bg-line/60 border border-line">
								{!showCost ? (
									<div className="bg-bg p-4 flex flex-col justify-center col-span-2">
										<Typography variant="label" as="div" className="mb-2">
											Total Tokens
										</Typography>
										<div className="font-display text-4xl text-fg leading-none tracking-tight tabular">
											{formatCompact(totalTokens)}
										</div>
									</div>
								) : metricMode === "cost" ? (
									<>
										<div className="bg-bg p-4 flex flex-col justify-center">
											<Typography variant="label" as="div" className="mb-2">
												Total Cost
											</Typography>
											<Cost
												cents={totalCents}
												digits={2}
												className="font-display text-4xl text-fg leading-none tracking-tight block"
											/>
										</div>
										<div className="bg-bg p-4 flex flex-col justify-center">
											<Typography variant="label" as="div" className="mb-2">
												Total Tokens
											</Typography>
											<div className="font-mono text-3xl text-fg leading-none tabular">
												{formatCompact(totalTokens)}
											</div>
										</div>
									</>
								) : (
									<>
										<div className="bg-bg p-4 flex flex-col justify-center">
											<Typography variant="label" as="div" className="mb-2">
												Total Tokens
											</Typography>
											<div className="font-display text-4xl text-fg leading-none tracking-tight tabular">
												{formatCompact(totalTokens)}
											</div>
										</div>
										<div className="bg-bg p-4 flex flex-col justify-center">
											<Typography variant="label" as="div" className="mb-2">
												Total Cost
											</Typography>
											<Cost
												cents={totalCents}
												digits={2}
												className="font-mono text-3xl text-fg leading-none tabular block"
											/>
										</div>
									</>
								)}

								<div className="bg-bg p-4 flex flex-col justify-center col-span-2">
									<Typography variant="label" as="div" className="mb-2">
										Platform Split
									</Typography>
									<div className="flex items-center gap-6">
										<div className="flex items-center gap-2">
											<span className="w-1.5 h-1.5 bg-amber inline-block shrink-0 translate-y-[1px]" />
											<span className="font-mono text-sm text-fg">{formatCompact(ccTokens)}</span>
											<Typography variant="label">CLAUDE CODE</Typography>
										</div>
										<div className="flex items-center gap-2">
											<span className="w-1.5 h-1.5 bg-sky inline-block shrink-0 translate-y-[1px]" />
											<span className="font-mono text-sm text-fg">{formatCompact(cuTokens)}</span>
											<Typography variant="label">CURSOR</Typography>
										</div>
									</div>
								</div>
							</div>

							<div className="flex items-center justify-between mt-2">
								<Typography variant="label" as="div">
									<span className="text-fg">{activeDays}</span> ACTIVE DAYS
								</Typography>
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
							<Loader2 className="size-4 animate-spin" data-icon="inline-start" />
						) : (
							<Download className="size-4" data-icon="inline-start" />
						)}
						Download as Image
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
