import { useQuery } from "@tanstack/react-query"
import { Link } from "wouter"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"

export function HomePage(): React.JSX.Element {
	const { data: cfg } = useQuery({ queryKey: ["config"], queryFn: api.config })
	const orgName = cfg?.orgName?.trim() || "tokenmaxxer"
	const primaryHref = cfg?.bootstrapNeeded ? "/signup" : "/login"
	const primaryLabel = cfg?.bootstrapNeeded ? "▶ GET STARTED" : "▶ SIGN IN"
	const showSignup = !cfg?.bootstrapNeeded && cfg?.openSignupEnabled === true

	return (
		<div className="min-h-screen flex flex-col bg-bg text-fg font-mono">
			<div className="absolute inset-0 pointer-events-none">
				<div
					className="absolute inset-0 opacity-30"
					style={{
						backgroundImage:
							"linear-gradient(hsla(28,100%,56%,.06) 1px, transparent 1px), linear-gradient(90deg, hsla(28,100%,56%,.06) 1px, transparent 1px)",
						backgroundSize: "60px 60px",
					}}
				/>
				<div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber to-transparent" />
			</div>

			<header className="relative px-8 pt-6 flex items-center justify-between">
				<div className="text-[10px] tracked text-fg-dim">/ TOKENMAXXER · v0.1</div>
				<a
					href="https://github.com/instawork/tokenmaxxer"
					target="_blank"
					rel="noreferrer"
					className="text-[10px] tracked text-fg-dim hover:text-amber"
				>
					★ GITHUB ↗
				</a>
			</header>

			<main className="relative flex-1 px-8 py-12 max-w-5xl mx-auto w-full">
				<div className="mb-16">
					<div className="font-display text-7xl md:text-8xl leading-[0.9] text-fg">token</div>
					<div className="font-display text-7xl md:text-8xl leading-[0.9] text-amber">maxxer.</div>
					<p className="mt-6 text-fg-mid leading-relaxed max-w-xl text-sm">
						Per-engineer spend dashboard for Claude Code and Cursor Teams. Self-hosted. Open source.
						No <code>.env</code> required.
					</p>
					<div className="mt-8 flex items-center gap-3">
						<Link href={primaryHref}>
							<Button>{primaryLabel}</Button>
						</Link>
						{showSignup ? (
							<Link href="/signup">
								<Button variant="outline">SIGN UP</Button>
							</Link>
						) : null}
					</div>
				</div>

				<div className="mb-16">
					<div className="text-[10px] tracked text-fg-dim mb-6">/ HOW IT WORKS</div>
					<div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-line/60 border border-line">
						{[
							{
								n: "01",
								title: "Run docker compose up",
								body: "Zero env vars required. Postgres + app + first-boot setup.",
							},
							{
								n: "02",
								title: "Sign in, paste your keys",
								body: "Anthropic admin + Cursor Teams admin keys. Validated live, encrypted at rest.",
							},
							{
								n: "03",
								title: "Watch the spend",
								body: "Per-user dollars and tokens, daily trends, threshold alerts. 6-month history with backfill.",
							},
						].map((step) => (
							<div key={step.n} className="bg-bg p-6">
								<div className="font-display text-3xl tabular text-fg-very-dim leading-none">
									{step.n}
								</div>
								<div className="mt-3 text-[11px] tracked text-fg">{step.title.toUpperCase()}</div>
								<p className="mt-2 text-xs text-fg-mid leading-relaxed">{step.body}</p>
							</div>
						))}
					</div>
				</div>

				<div className="border border-line bg-elev/40">
					<img
						src="/landing/dashboard.png"
						alt="Tokenmaxxer dashboard preview"
						className="w-full h-auto block"
						onError={(e) => {
							;(e.currentTarget.parentElement as HTMLDivElement).innerHTML =
								'<div class="px-8 py-16 text-center text-fg-dim text-xs tracked">DASHBOARD PREVIEW · screenshot pending</div>'
						}}
					/>
				</div>

				<div className="mt-4 text-center">
					<a
						href="https://github.com/instawork/tokenmaxxer"
						target="_blank"
						rel="noreferrer"
						className="text-[10px] tracked text-fg-dim hover:text-amber"
					>
						VIEW ON GITHUB →
					</a>
				</div>
			</main>

			<footer className="relative px-8 py-6 border-t border-line">
				<div className="text-[9px] tracked text-fg-very-dim">
					{orgName.toUpperCase()} · TOKENMAXXER
				</div>
			</footer>
		</div>
	)
}
