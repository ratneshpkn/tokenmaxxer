import type { TeamItem } from "@shared/api-types"
import { Button } from "@/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface TeamFilterDropdownProps {
	teams: TeamItem[]
	selectedTeamId: string
	onSelect: (teamId: string) => void
}

export function TeamFilterDropdown({
	teams,
	selectedTeamId,
	onSelect,
}: TeamFilterDropdownProps): React.JSX.Element | null {
	if (teams.length === 0) return null

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className="h-8 text-xs font-mono bg-bg border-line shrink-0"
				>
					{selectedTeamId === "all"
						? "ALL TEAMS"
						: (teams.find((t) => t.id === selectedTeamId)?.name.toUpperCase() ?? "TEAM")}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-48 font-mono text-xs">
				<DropdownMenuLabel>Filter by Team</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuCheckboxItem
					checked={selectedTeamId === "all"}
					onCheckedChange={() => onSelect("all")}
				>
					ALL TEAMS
				</DropdownMenuCheckboxItem>
				<DropdownMenuSeparator />
				{teams.map((t) => (
					<DropdownMenuCheckboxItem
						key={t.id}
						checked={selectedTeamId === t.id}
						onCheckedChange={() => onSelect(selectedTeamId === t.id ? "all" : t.id)}
					>
						{t.name}
					</DropdownMenuCheckboxItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
