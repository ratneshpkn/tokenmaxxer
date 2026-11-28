import { AccessSection } from "@/components/settings/AccessSection"
import { SyncSection } from "@/components/settings/SyncSection"
import { TeamsSection } from "@/components/settings/TeamsSection"
import { ThresholdsSection } from "@/components/settings/ThresholdsSection"
import { WorkspaceConfigSection } from "@/components/settings/WorkspaceConfigSection"

export function SettingsPage(): React.JSX.Element {
	return (
		<div className="space-y-8 fade-rise">
			<WorkspaceConfigSection />
			<AccessSection />
			<TeamsSection />
			<ThresholdsSection />
			<SyncSection />
		</div>
	)
}
