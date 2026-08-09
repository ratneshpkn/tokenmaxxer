import { cva, type VariantProps } from "class-variance-authority"
import type { HTMLAttributes } from "react"
import { typographyVariants } from "@/components/ui/typography"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
	cn(
		"inline-flex items-center gap-1 px-1.5 py-0.5 border",
		typographyVariants({ variant: "label" }),
	),
	{
		variants: {
			variant: {
				default: "bg-elev2 text-fg border-line",
				secondary: "bg-transparent text-fg-muted border-line",
				destructive: "bg-transparent text-amber-hot border-amber-hot/50",
				outline: "bg-transparent text-fg-muted border-line",
				success: "bg-transparent text-mint border-mint/40",
				warning: "bg-transparent text-amber border-amber/40",
			},
		},
		defaultVariants: { variant: "default" },
	},
)

export interface BadgeProps
	extends HTMLAttributes<HTMLDivElement>,
		VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
	return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
