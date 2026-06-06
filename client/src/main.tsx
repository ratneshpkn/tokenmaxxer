import { QueryClientProvider } from "@tanstack/react-query"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { TooltipProvider } from "@/components/ui/tooltip"
import { applyInitialTheme } from "@/lib/use-theme"
import App from "./App"
import { queryClient } from "./lib/queryClient"
import "./index.css"

// Apply the saved/system theme before React mounts so the first paint matches.
applyInitialTheme()

const root = document.getElementById("root")
if (!root) throw new Error("root element not found")

createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<TooltipProvider delayDuration={200}>
				<App />
			</TooltipProvider>
		</QueryClientProvider>
	</StrictMode>,
)
