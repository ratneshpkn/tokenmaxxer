import { Component, type ErrorInfo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"

interface Props {
	children: ReactNode
}

interface State {
	hasError: boolean
}

export class ChunkErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false }

	static getDerivedStateFromError(): State {
		return { hasError: true }
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error("Chunk load error caught by boundary:", error, errorInfo)
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="p-8 space-y-4 max-w-md mx-auto my-12 text-center border border-line bg-elev">
					<div className="text-sm font-semibold text-fg">
						Update Available or Connection Interrupted
					</div>
					<p className="text-xs text-fg-muted">
						A newer version of the app may be available, or your connection briefly dropped while
						loading this page.
					</p>
					<Button onClick={() => window.location.reload()} className="mt-2">
						Reload Page
					</Button>
				</div>
			)
		}
		return this.props.children
	}
}
