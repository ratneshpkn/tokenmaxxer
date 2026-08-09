import { useQuery } from "@tanstack/react-query"
import {
	Bell,
	Cpu,
	DollarSign,
	Eye,
	EyeOff,
	Hash,
	LayoutDashboard,
	LogOut,
	Monitor,
	Moon,
	Settings as SettingsIcon,
	Sun,
	Users,
} from "lucide-react"
import type { ReactNode } from "react"
import { Link, useLocation } from "wouter"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar"
import { Typography, typographyVariants } from "@/components/ui/typography"
import { api } from "@/lib/api"
import { useMetricMode } from "@/lib/use-metric-mode"
import { usePrivacyMode } from "@/lib/use-privacy-mode"
import { type Theme, useTheme } from "@/lib/use-theme"
import { cn } from "@/lib/utils"

interface NavItem {
	to: string
	label: string
	icon: typeof LayoutDashboard
	adminOnly?: boolean
}

const NAV: NavItem[] = [
	{ to: "/", label: "Dashboard", icon: LayoutDashboard },
	{ to: "/users", label: "Users", icon: Users },
	{ to: "/models", label: "Models", icon: Cpu },
	{ to: "/alerts", label: "Alerts", icon: Bell, adminOnly: true },
	{ to: "/settings", label: "Settings", icon: SettingsIcon, adminOnly: true },
]

function initials(email: string | undefined): string {
	if (!email) return "··"
	const local = email.split("@")[0]
	return local.slice(0, 2).toUpperCase()
}

export function AppShell({ children }: { children: ReactNode }): React.JSX.Element {
	const [location] = useLocation()
	const { data: me } = useQuery({ queryKey: ["me"], queryFn: api.me })
	const isAdmin = me?.role === "admin"
	const [privacyOn, togglePrivacy] = usePrivacyMode()
	const [metricMode, toggleMetric] = useMetricMode()
	const { theme, setTheme } = useTheme()

	const { data: alertCountData } = useQuery({
		queryKey: ["alerts.count"],
		queryFn: api.alerts.openCount,
		enabled: isAdmin,
		refetchInterval: 10000,
	})
	const alertCount = alertCountData?.open ?? 0

	return (
		<SidebarProvider>
			<Sidebar collapsible="icon" className="border-r border-line">
				<SidebarHeader className="px-5 pt-6 pb-7 border-b border-line">
					<div className="font-display text-2xl text-fg leading-none tracking-tight group-data-[collapsible=icon]:text-base group-data-[collapsible=icon]:text-center">
						<span className="group-data-[collapsible=icon]:hidden">tokenmaxxer</span>
						<span className="hidden group-data-[collapsible=icon]:inline">t</span>
					</div>
				</SidebarHeader>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupContent>
							<SidebarMenu>
								{NAV.filter((n) => !n.adminOnly || isAdmin).map((n) => {
									const active = n.to === "/" ? location === "/" : location.startsWith(n.to)
									const Icon = n.icon
									return (
										<SidebarMenuItem key={n.to}>
											<SidebarMenuButton
												asChild
												isActive={active}
												tooltip={n.label.toUpperCase()}
												className={cn(
													"border-l-2 rounded-none py-3 pl-5 pr-3",
													typographyVariants({ variant: "label" }),
													active
														? "border-amber bg-amber/[0.06] text-fg"
														: "border-transparent text-fg-muted hover:text-fg hover:border-line-strong",
												)}
											>
												<Link href={n.to}>
													<Icon className="h-4 w-4" strokeWidth={1.5} />
													<span>
														{n.label.toUpperCase()}
														{n.to === "/alerts" && alertCount > 0 ? (
															<span className="text-fg-subtle ml-1.5">· {alertCount}</span>
														) : null}
													</span>
												</Link>
											</SidebarMenuButton>
										</SidebarMenuItem>
									)
								})}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
				<SidebarFooter className="border-t border-line px-5 py-3 group-data-[collapsible=icon]:hidden">
					<Typography variant="th">v0.1</Typography>
				</SidebarFooter>
			</Sidebar>

			<SidebarInset className="bg-bg">
				<div className="h-12 border-b border-line flex items-center justify-between gap-2 px-4">
					<SidebarTrigger className="text-fg-muted hover:text-fg" />
					<div className="flex items-center gap-2">
						{isAdmin ? (
							<Button
								variant={metricMode === "tokens" ? "amber" : "outline"}
								size="icon"
								onClick={toggleMetric}
								title={
									metricMode === "cost"
										? "Switch to tokens-primary view"
										: "Switch to cost-primary view"
								}
								aria-label="Toggle primary metric"
							>
								{metricMode === "cost" ? (
									<DollarSign className="size-4" strokeWidth={1.5} />
								) : (
									<Hash className="size-4" strokeWidth={1.5} />
								)}
							</Button>
						) : null}
						{isAdmin ? (
							<Button
								variant={privacyOn ? "amber" : "outline"}
								size="icon"
								onClick={togglePrivacy}
								title={privacyOn ? "Reveal cost numbers" : "Blur cost numbers (for screen-sharing)"}
								aria-label="Toggle cost privacy"
							>
								{privacyOn ? (
									<EyeOff className="size-4" strokeWidth={1.5} />
								) : (
									<Eye className="size-4" strokeWidth={1.5} />
								)}
							</Button>
						) : null}

						{/* Profile Dropdown */}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" size="sm" className="h-8 px-2 gap-2">
									<Avatar>
										<AvatarFallback>{initials(me?.email)}</AvatarFallback>
									</Avatar>
									<Typography variant="label" className="hidden sm:inline">
										{me?.email?.split("@")[0]}
									</Typography>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								<DropdownMenuLabel>SIGNED IN AS</DropdownMenuLabel>
								<Typography variant="subtle" as="div" className="px-2.5 pb-1.5 text-fg">
									{me?.email}
								</Typography>
								{isAdmin ? (
									<div className="px-2.5 pb-1.5">
										<Typography
											variant="label"
											className="text-amber border border-amber/40 px-1 leading-none"
										>
											ADMIN
										</Typography>
									</div>
								) : null}
								<DropdownMenuSeparator />
								<DropdownMenuLabel>THEME</DropdownMenuLabel>
								{(["system", "light", "dark"] as Theme[]).map((t) => {
									const Icon = t === "system" ? Monitor : t === "light" ? Sun : Moon
									const active = theme === t
									return (
										<DropdownMenuItem
											key={t}
											onClick={() => setTheme(t)}
											className={active ? "text-amber" : undefined}
										>
											<Icon className="h-3 w-3 mr-2" strokeWidth={1.5} />
											{t.toUpperCase()}
											{active ? <span className="ml-auto text-amber">●</span> : null}
										</DropdownMenuItem>
									)
								})}
								<DropdownMenuSeparator />
								<DropdownMenuItem
									onClick={async () => {
										await api.logout()
										window.location.href = "/login"
									}}
								>
									<LogOut className="h-3 w-3 mr-2" strokeWidth={1.5} />
									SIGN OUT
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>

				<div className="px-8 py-8">{children}</div>
			</SidebarInset>
		</SidebarProvider>
	)
}
