import { useQuery } from "@tanstack/react-query"
import { lazy, Suspense } from "react"
import { Redirect, Route, Switch } from "wouter"
import { ChunkErrorBoundary } from "@/components/ChunkErrorBoundary"
import { api } from "@/lib/api"

const AppShell = lazy(() => import("@/components/AppShell").then((m) => ({ default: m.AppShell })))

const AlertsPage = lazy(() => import("@/pages/alerts").then((m) => ({ default: m.AlertsPage })))
const DashboardPage = lazy(() =>
	import("@/pages/dashboard").then((m) => ({ default: m.DashboardPage })),
)
const HomePage = lazy(() => import("@/pages/home").then((m) => ({ default: m.HomePage })))
const LoginPage = lazy(() => import("@/pages/login").then((m) => ({ default: m.LoginPage })))
const ModelDetailPage = lazy(() =>
	import("@/pages/model-detail").then((m) => ({ default: m.ModelDetailPage })),
)
const ModelsPage = lazy(() => import("@/pages/models").then((m) => ({ default: m.ModelsPage })))
const SettingsPage = lazy(() =>
	import("@/pages/settings").then((m) => ({ default: m.SettingsPage })),
)
const SetupPage = lazy(() => import("@/pages/setup").then((m) => ({ default: m.SetupPage })))
const SignupPage = lazy(() => import("@/pages/signup").then((m) => ({ default: m.SignupPage })))
const UserDetailPage = lazy(() =>
	import("@/pages/user-detail").then((m) => ({ default: m.UserDetailPage })),
)
const UsersPage = lazy(() => import("@/pages/users").then((m) => ({ default: m.UsersPage })))

function AuthGate({
	adminOnly = false,
	children,
}: {
	adminOnly?: boolean
	children: React.ReactNode
}): React.JSX.Element {
	const { data, isLoading, isError } = useQuery({
		queryKey: ["me"],
		queryFn: api.me,
		retry: false,
	})
	if (isLoading) {
		return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
	}
	if (isError || !data) {
		return <Redirect to="/login" />
	}
	if (adminOnly && data.role !== "admin") {
		return <Redirect to="/" />
	}
	return (
		<AppShell>
			<ChunkErrorBoundary>
				<Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
					{children}
				</Suspense>
			</ChunkErrorBoundary>
		</AppShell>
	)
}

function RootRoute({ children }: { children: React.ReactNode }): React.JSX.Element {
	const { data, isLoading, isError } = useQuery({
		queryKey: ["me"],
		queryFn: api.me,
		retry: false,
	})
	if (isLoading) {
		return <div className="p-8 text-sm text-muted-foreground">Loading…</div>
	}
	if (isError || !data) {
		return (
			<ChunkErrorBoundary>
				<Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
					<HomePage />
				</Suspense>
			</ChunkErrorBoundary>
		)
	}
	return (
		<AppShell>
			<ChunkErrorBoundary>
				<Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
					{children}
				</Suspense>
			</ChunkErrorBoundary>
		</AppShell>
	)
}

export default function App(): React.JSX.Element {
	return (
		<ChunkErrorBoundary>
			<Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Loading…</div>}>
				<Switch>
					<Route path="/login" component={LoginPage} />
					<Route path="/signup" component={SignupPage} />
					<Route path="/setup">
						{() => (
							<AuthGate>
								<SetupPage />
							</AuthGate>
						)}
					</Route>
					<Route path="/">
						{() => (
							<RootRoute>
								<DashboardPage />
							</RootRoute>
						)}
					</Route>
					<Route path="/users">
						{() => (
							<AuthGate>
								<UsersPage />
							</AuthGate>
						)}
					</Route>
					<Route path="/users/:email">
						{(params) => (
							<AuthGate>
								<UserDetailPage email={decodeURIComponent(params.email)} />
							</AuthGate>
						)}
					</Route>
					<Route path="/models">
						{() => (
							<AuthGate>
								<ModelsPage />
							</AuthGate>
						)}
					</Route>
					<Route path="/models/:model">
						{(params) => (
							<AuthGate>
								<ModelDetailPage model={decodeURIComponent(params.model)} />
							</AuthGate>
						)}
					</Route>
					<Route path="/alerts">
						{() => (
							<AuthGate adminOnly>
								<AlertsPage />
							</AuthGate>
						)}
					</Route>
					<Route path="/settings">
						{() => (
							<AuthGate adminOnly>
								<SettingsPage />
							</AuthGate>
						)}
					</Route>
					<Route>
						<div className="p-8">404</div>
					</Route>
				</Switch>
			</Suspense>
		</ChunkErrorBoundary>
	)
}
