import * as AvatarPrimitive from "@radix-ui/react-avatar"
import { forwardRef } from "react"
import { cn } from "@/lib/utils"

export const Avatar = forwardRef<
	React.ElementRef<typeof AvatarPrimitive.Root>,
	React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
	<AvatarPrimitive.Root
		ref={ref}
		className={cn("relative flex h-7 w-7 shrink-0 overflow-hidden border border-line", className)}
		{...props}
	/>
))
Avatar.displayName = AvatarPrimitive.Root.displayName

export const AvatarImage = forwardRef<
	React.ElementRef<typeof AvatarPrimitive.Image>,
	React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image>
>(({ className, ...props }, ref) => (
	<AvatarPrimitive.Image
		ref={ref}
		className={cn("aspect-square h-full w-full", className)}
		{...props}
	/>
))
AvatarImage.displayName = AvatarPrimitive.Image.displayName

export const AvatarFallback = forwardRef<
	React.ElementRef<typeof AvatarPrimitive.Fallback>,
	React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
	<AvatarPrimitive.Fallback
		ref={ref}
		className={cn(
			"flex h-full w-full items-center justify-center bg-elev2 text-[9px] tracked font-medium text-fg",
			className,
		)}
		{...props}
	/>
))
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName
