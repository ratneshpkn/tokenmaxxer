import { forwardRef, type HTMLAttributes } from "react"
import { cn } from "@/lib/utils"

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => <div ref={ref} className={cn("panel", className)} {...props} />,
)
Card.displayName = "Card"

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div
			ref={ref}
			className={cn("flex flex-col gap-1 px-4 py-3 border-b border-line", className)}
			{...props}
		/>
	),
)
CardHeader.displayName = "CardHeader"

export const CardTitle = forwardRef<HTMLDivElement, HTMLAttributes<HTMLHeadingElement>>(
	({ className, ...props }, ref) => (
		<h3
			ref={ref}
			className={cn("text-[11px] tracked text-fg-mid font-medium", className)}
			{...props}
		/>
	),
)
CardTitle.displayName = "CardTitle"

export const CardDescription = forwardRef<
	HTMLParagraphElement,
	HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
	<p ref={ref} className={cn("text-xs text-fg-dim", className)} {...props} />
))
CardDescription.displayName = "CardDescription"

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div ref={ref} className={cn("px-4 py-4", className)} {...props} />
	),
)
CardContent.displayName = "CardContent"

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => (
		<div
			ref={ref}
			className={cn("flex items-center px-4 py-3 border-t border-line", className)}
			{...props}
		/>
	),
)
CardFooter.displayName = "CardFooter"
