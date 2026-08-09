import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"

interface SearchInputProps {
	value: string
	onChange: (value: string) => void
	placeholder?: string
	className?: string
}

export function SearchInput({
	value,
	onChange,
	placeholder = "filter…",
	className = "w-48",
}: SearchInputProps): React.JSX.Element {
	return (
		<div className={`relative flex items-center ${className}`}>
			<Search className="absolute left-2.5 size-3.5 text-fg-muted pointer-events-none" />
			<Input
				type="text"
				placeholder={placeholder}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="pl-8 h-8 text-xs placeholder:text-fg-subtle"
			/>
		</div>
	)
}
