import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: "bg-amber text-black hover:bg-amber/90 font-medium border border-amber",
				destructive:
					"border border-line bg-transparent text-fg-mid hover:text-amber-hot hover:border-amber-hot/60",
				outline:
					"border border-line bg-transparent text-fg-mid hover:text-fg hover:border-line-strong hover:bg-elev2",
				secondary: "bg-elev2 text-fg border border-line hover:bg-elev3",
				ghost: "hover:bg-elev2 hover:text-fg text-fg-mid",
				link: "text-amber underline-offset-4 hover:underline",
				amber: "border border-line bg-transparent text-fg-mid hover:text-amber hover:border-amber",
				mint: "border border-line bg-transparent text-fg-mid hover:text-mint hover:border-mint",
			},
			size: {
				default: "h-9 px-4 py-2 text-xs",
				xs: "h-6 px-2 text-[10px] tracked",
				sm: "h-7 px-2.5 text-[10px] tracked font-medium",
				lg: "h-11 px-8 text-sm",
				icon: "size-8 p-0",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
)

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "button"
		return (
			<Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
		)
	},
)
Button.displayName = "Button"

export { Button, buttonVariants }
