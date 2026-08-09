import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"
import { cn } from "@/lib/utils"

export const typographyVariants = cva("", {
	variants: {
		variant: {
			hero: "font-display text-6xl md:text-7xl text-fg leading-none tracking-tight",
			"display-lg": "font-display text-5xl text-fg leading-none tracking-tight",
			display: "font-display text-4xl text-fg leading-none tracking-tight",
			heading: "font-display text-xl text-fg font-normal tracking-tight",
			"section-title": "text-xs tracked text-fg font-semibold uppercase",
			label: "text-xs tracked text-fg-subtle font-medium uppercase",
			th: "text-xs tracked text-fg-subtle font-normal uppercase select-none",
			body: "text-base text-fg leading-relaxed",
			muted: "text-sm text-fg-muted leading-relaxed",
			subtle: "text-xs text-fg-subtle leading-relaxed",
			caption: "text-[11px] text-fg-subtle leading-tight",
			mono: "font-mono tabular text-sm text-fg",
			"mono-sm": "font-mono tabular text-xs text-fg-subtle",
			"metric-lg": "font-display text-5xl md:text-6xl text-fg leading-none tracking-tight tabular",
			"metric-md": "font-mono text-3xl tabular text-fg leading-none font-medium",
			"metric-sm": "font-mono text-xl tabular text-fg leading-none",
		},
	},
	defaultVariants: {
		variant: "body",
	},
})

export interface TypographyProps
	extends React.HTMLAttributes<HTMLElement>,
		VariantProps<typeof typographyVariants> {
	asChild?: boolean
	as?: React.ElementType
}

export const Typography = React.forwardRef<HTMLElement, TypographyProps>(
	({ className, variant, asChild = false, as: Component = "span", ...props }, ref) => {
		const Comp = (asChild ? Slot : Component) as React.ElementType
		return <Comp className={cn(typographyVariants({ variant }), className)} ref={ref} {...props} />
	},
)
Typography.displayName = "Typography"

export { Typography as Text }
