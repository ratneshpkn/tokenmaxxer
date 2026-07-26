import type { ReactNode } from "react"

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
				<span className="text-[11px] tracked text-fg font-medium truncate">{title}</span>
				{subtitle ? (
					<span className="text-[10px] tracked text-fg-dim shrink-0">· {subtitle}</span>
				) : null}
			</div>
			{action ? <div className="shrink-0">{action}</div> : null}
		</div>
	)
}
