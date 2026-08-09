import type { ReactNode } from "react"
import { Typography } from "@/components/ui/typography"

interface SectionHeaderProps {
	title: string
	subtitle?: ReactNode
	action?: ReactNode
	className?: string
}

export function SectionHeader({
	title,
	subtitle,
	action,
	className = "",
}: SectionHeaderProps): React.JSX.Element {
	return (
		<div
			className={`px-5 py-3 border-b border-line flex items-center justify-between gap-4 ${className}`}
		>
			<div className="flex items-center gap-3 min-w-0">
				<Typography variant="section-title" className="truncate">
					{title}
				</Typography>
				{subtitle ? (
					<Typography variant="label" className="shrink-0">
						· {subtitle}
					</Typography>
				) : null}
			</div>
			{action ? <div className="shrink-0">{action}</div> : null}
		</div>
	)
}
