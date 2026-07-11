import { useQuery } from "@tanstack/react-query"
import { Redirect, Route, Switch } from "wouter"
import { AppShell } from "@/components/AppShell"
import { api } from "@/lib/api"
import { AlertsPage } from "@/pages/alerts"
import { DashboardPage } from "@/pages/dashboard"
import { HomePage } from "@/pages/home"
import { LoginPage } from "@/pages/login"
import { ModelDetailPage } from "@/pages/model-detail"
import { ModelsPage } from "@/pages/models"
import { SettingsPage } from "@/pages/settings"
import { SetupPage } from "@/pages/setup"
import { SignupPage } from "@/pages/signup"
import { UserDetailPage } from "@/pages/user-detail"
import { UsersPage } from "@/pages/users"

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
	return <AppShell>{children}</AppShell>
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
		return <HomePage />
	}
	return <AppShell>{children}</AppShell>
}

export default function App(): React.JSX.Element {
	return (
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
	)
}
