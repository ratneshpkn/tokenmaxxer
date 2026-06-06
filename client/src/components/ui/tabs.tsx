import * as TabsPrimitive from "@radix-ui/react-tabs"
import { forwardRef } from "react"
import { cn } from "@/lib/utils"

export const Tabs = TabsPrimitive.Root

export const TabsList = forwardRef<
	React.ElementRef<typeof TabsPrimitive.List>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.List
		ref={ref}
		className={cn(
			"inline-flex items-center border border-line bg-transparent text-fg-dim",
			className,
		)}
		{...props}
	/>
))
TabsList.displayName = TabsPrimitive.List.displayName

export const TabsTrigger = forwardRef<
	React.ElementRef<typeof TabsPrimitive.Trigger>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Trigger
		ref={ref}
		className={cn(
			"px-2.5 py-1 text-[10px] tracked font-medium border-r border-line last:border-r-0 transition-colors",
			"focus-visible:outline-none focus-visible:bg-amber/10 focus-visible:text-fg",
			"hover:text-fg",
			"data-[state=active]:bg-amber data-[state=active]:text-black",
			"disabled:pointer-events-none disabled:opacity-40",
			className,
		)}
		{...props}
	/>
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

export const TabsContent = forwardRef<
	React.ElementRef<typeof TabsPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
	<TabsPrimitive.Content
		ref={ref}
		className={cn("mt-2 focus-visible:outline-none", className)}
		{...props}
	/>
))
TabsContent.displayName = TabsPrimitive.Content.displayName
