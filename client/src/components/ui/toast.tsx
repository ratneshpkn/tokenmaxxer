import { AlertCircle, CheckCircle2, Info, X } from "lucide-react"
import React, { createContext, useCallback, useContext, useState } from "react"

export interface ToastItem {
	id: string
	title?: string
	description: string
	variant?: "default" | "success" | "destructive"
	duration?: number
}

interface ToastContextType {
	toast: (props: Omit<ToastItem, "id">) => void
	dismiss: (id: string) => void
	toasts: ToastItem[]
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

let toastListener: ((toast: Omit<ToastItem, "id">) => void) | null = null

export function toast(props: Omit<ToastItem, "id">) {
	if (toastListener) {
		toastListener(props)
	}
}

toast.success = (description: string, title?: string) => {
	toast({ description, title, variant: "success" })
}

toast.error = (description: string, title?: string) => {
	toast({ description, title, variant: "destructive" })
}

toast.info = (description: string, title?: string) => {
	toast({ description, title, variant: "default" })
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
	const [toasts, setToasts] = useState<ToastItem[]>([])

	const dismiss = useCallback((id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id))
	}, [])

	const addToast = useCallback(
		(props: Omit<ToastItem, "id">) => {
			const id = Math.random().toString(36).substring(2, 9)
			const duration = props.duration ?? 4000
			const newToast: ToastItem = { ...props, id }

			setToasts((prev) => [...prev.slice(-4), newToast]) // keep max 5 active

			if (duration > 0) {
				setTimeout(() => {
					dismiss(id)
				}, duration)
			}
		},
		[dismiss],
	)

	React.useEffect(() => {
		toastListener = addToast
		return () => {
			toastListener = null
		}
	}, [addToast])

	return (
		<ToastContext.Provider value={{ toast: addToast, dismiss, toasts }}>
			{children}
			<div
				aria-live="assertive"
				className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full px-4 pointer-events-none"
			>
				{toasts.map((t) => (
					<div
						key={t.id}
						className={`pointer-events-auto flex items-start gap-3 p-3 rounded-lg border shadow-lg backdrop-blur-md transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 ${
							t.variant === "destructive"
								? "bg-bg/95 border-rose-500/40 text-fg"
								: t.variant === "success"
									? "bg-bg/95 border-mint/40 text-fg"
									: "bg-bg/95 border-line text-fg"
						}`}
					>
						<div className="mt-0.5 shrink-0">
							{t.variant === "destructive" ? (
								<AlertCircle className="h-4 w-4 text-rose-400" />
							) : t.variant === "success" ? (
								<CheckCircle2 className="h-4 w-4 text-mint" />
							) : (
								<Info className="h-4 w-4 text-amber" />
							)}
						</div>
						<div className="flex-1 min-w-0 text-xs">
							{t.title && <div className="font-semibold mb-0.5 leading-tight">{t.title}</div>}
							<div className="text-fg-mid whitespace-pre-wrap break-words leading-normal">
								{t.description}
							</div>
						</div>
						<button
							type="button"
							onClick={() => dismiss(t.id)}
							className="shrink-0 text-fg-dim hover:text-fg transition-colors p-0.5 rounded outline-none"
						>
							<X className="h-3.5 w-3.5" />
							<span className="sr-only">Close</span>
						</button>
					</div>
				))}
			</div>
		</ToastContext.Provider>
	)
}

export function useToast() {
	const context = useContext(ToastContext)
	if (!context) {
		throw new Error("useToast must be used within a ToastProvider")
	}
	return context
}
