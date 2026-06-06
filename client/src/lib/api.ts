import type {
	AlertItem,
	AuthResponse,
	ConfigResponse,
	CreateInvitationResponse,
	DashboardSummaryResponse,
	HeatmapItem,
	InvitationItem,
	MeResponse,
	ModelMixItem,
	SetupSavePayload,
	SyncRunItem,
	ThresholdsResponse,
	TopSpenderItem,
	UsageRow,
	UserDetailResponse,
	UserListItem,
} from "@shared/api-types"

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		credentials: "include",
		headers: { "content-type": "application/json", accept: "application/json" },
		...init,
	})
	if (res.status === 401) {
		window.location.href = "/login"
		throw new Error("Unauthorized")
	}
	if (!res.ok) {
		const text = await res.text()
		throw new Error(`${res.status} ${path}: ${text.slice(0, 300)}`)
	}
	if (res.status === 204) return undefined as T
	return (await res.json()) as T
}

export const api = {
	config: () => request<ConfigResponse>("/api/config"),
	me: () => request<MeResponse>("/api/auth/me"),
	logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

	auth: {
		signup: (email: string, password: string, token?: string) =>
			request<AuthResponse>("/api/auth/signup", {
				method: "POST",
				body: JSON.stringify({ email, password, token }),
			}),
		login: (email: string, password: string) =>
			request<AuthResponse>("/api/auth/login", {
				method: "POST",
				body: JSON.stringify({ email, password }),
			}),
	},

	setup: {
		status: () => request<{ setupCompleted: boolean }>("/api/setup/status"),
		validateKey: (provider: "anthropic" | "cursor" | "slack", key: string, channelId?: string) =>
			request<{ ok: boolean; error?: string }>("/api/setup/validate-key", {
				method: "POST",
				body: JSON.stringify({ provider, key, channelId }),
			}),
		save: (payload: SetupSavePayload) =>
			request<{ ok: true }>("/api/setup", {
				method: "POST",
				body: JSON.stringify(payload),
			}),
	},

	invitations: {
		list: () => request<InvitationItem[]>("/api/invitations"),
		create: (email: string, role: "viewer" | "admin") =>
			request<CreateInvitationResponse>("/api/invitations", {
				method: "POST",
				body: JSON.stringify({ email, role }),
			}),
		delete: (id: string) => request(`/api/invitations/${id}`, { method: "DELETE" }),
	},

	dashboard: {
		summary: (range: { from: string; to: string }) =>
			request<DashboardSummaryResponse>(`/api/dashboard/summary?from=${range.from}&to=${range.to}`),
		topSpenders: (
			range: { from: string; to: string },
			platform: "claude_code" | "cursor" | "all" = "all",
			limit = 10,
			metric: "cost" | "tokens" = "cost",
		) =>
			request<TopSpenderItem[]>(
				`/api/dashboard/top-spenders?from=${range.from}&to=${range.to}&platform=${platform}&limit=${limit}&metric=${metric}`,
			),
		modelMix: (
			range: { from: string; to: string },
			limit?: number,
			metric: "cost" | "tokens" = "cost",
		) =>
			request<ModelMixItem[]>(
				`/api/dashboard/model-mix?from=${range.from}&to=${range.to}${
					limit != null ? `&limit=${limit}` : ""
				}&metric=${metric}`,
			),
	},

	users: {
		list: (range: { from: string; to: string }) =>
			request<UserListItem[]>(`/api/users?from=${range.from}&to=${range.to}`),
		detail: (email: string) =>
			request<UserDetailResponse>(`/api/users/${encodeURIComponent(email)}`),
		usage: (
			email: string,
			from: string,
			to: string,
			platform: "all" | "claude_code" | "cursor" = "all",
		) =>
			request<{
				claude_code?: UsageRow[]
				cursor?: UsageRow[]
			}>(
				`/api/users/${encodeURIComponent(email)}/usage?from=${from}&to=${to}&platform=${platform}`,
			),
		heatmap: (email: string, from: string, to: string) =>
			request<HeatmapItem[]>(
				`/api/users/${encodeURIComponent(email)}/heatmap?from=${from}&to=${to}`,
			),
		alertsByEmail: (email: string, days = 30, limit = 50) =>
			request<AlertItem[]>(
				`/api/users/${encodeURIComponent(email)}/alerts?days=${days}&limit=${limit}`,
			),
	},

	alerts: {
		list: (status: "open" | "acknowledged" | "resolved" | "all" = "open", limit = 50) =>
			request<AlertItem[]>(`/api/alerts?status=${status}&limit=${limit}`),
		openCount: () => request<{ open: number }>("/api/alerts/count"),
		acknowledge: (id: string) => request(`/api/alerts/${id}/acknowledge`, { method: "POST" }),
		resolve: (id: string) => request(`/api/alerts/${id}/resolve`, { method: "POST" }),
	},

	thresholds: {
		list: () => request<ThresholdsResponse>("/api/thresholds"),
		setGlobal: (platform: "claude_code" | "cursor", dailyCents: number, enabled = true) =>
			request("/api/thresholds/global", {
				method: "PUT",
				body: JSON.stringify({ platform, dailyCents, enabled }),
			}),
		setUser: (
			email: string,
			platform: "claude_code" | "cursor",
			dailyCents: number,
			enabled = true,
		) =>
			request(`/api/thresholds/user/${encodeURIComponent(email)}`, {
				method: "PUT",
				body: JSON.stringify({ platform, dailyCents, enabled }),
			}),
	},

	sync: {
		runs: (limit = 50) => request<SyncRunItem[]>(`/api/sync/runs?limit=${limit}`),
		run: (job: "anthropic" | "cursor" | "alerts" | "slack_digest", full = false) =>
			request<{ ok: true; runId: string }>(
				`/api/admin/sync/${job}/run${full ? "?full=true" : ""}`,
				{ method: "POST" },
			),
		backfill: (days: number) =>
			request<{ ok: true; runIds: string[] }>(`/api/admin/sync/backfill?days=${days}`, {
				method: "POST",
			}),
		runsByIds: (ids: string[]) => request<SyncRunItem[]>(`/api/sync/runs?ids=${ids.join(",")}`),
	},
}
