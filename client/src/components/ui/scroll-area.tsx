import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"
import { forwardRef } from "react"
import { cn } from "@/lib/utils"

export const ScrollArea = forwardRef<
	React.ElementRef<typeof ScrollAreaPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
	<ScrollAreaPrimitive.Root
		ref={ref}
		className={cn("relative overflow-hidden", className)}
		{...props}
	>
		<ScrollAreaPrimitive.Viewport className="h-full w-full">
			{children}
		</ScrollAreaPrimitive.Viewport>
		<ScrollBar />
		<ScrollAreaPrimitive.Corner />
	</ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

export const ScrollBar = forwardRef<
	React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
	React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
	<ScrollAreaPrimitive.ScrollAreaScrollbar
		ref={ref}
		orientation={orientation}
		className={cn(
			"flex touch-none select-none transition-colors",
			orientation === "vertical" && "h-full w-1.5 border-l border-line/50 p-[1px]",
			orientation === "horizontal" && "h-1.5 flex-col border-t border-line/50 p-[1px]",
			className,
		)}
		{...props}
	>
		<ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 bg-line-strong" />
	</ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName
