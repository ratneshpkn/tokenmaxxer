import { Link } from "wouter"
import { Typography } from "@/components/ui/typography"

interface UserLinkProps {
	email: string
	name?: string | null
	className?: string
}

export function UserLink({ email, name, className = "" }: UserLinkProps): React.JSX.Element {
	const label = name?.trim() || email
	return (
		<Link
			href={`/users/${encodeURIComponent(email)}`}
			className={`group inline-flex flex-col min-w-0 ${className}`}
		>
			<span className="text-fg group-hover:text-amber font-medium truncate text-sm transition-colors">
				{label}
			</span>
			{name?.trim() ? (
				<Typography variant="subtle" className="font-mono truncate">
					{email}
				</Typography>
			) : null}
		</Link>
	)
}
