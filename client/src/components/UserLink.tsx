import { Link } from "wouter"

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
			<span className="text-fg group-hover:text-amber font-medium truncate text-xs transition-colors">
				{label}
			</span>
			{name?.trim() ? (
				<span className="text-[10px] text-fg-very-dim font-mono truncate">{email}</span>
			) : null}
		</Link>
	)
}
