import type {
	AdminConfigPatch,
	AdminConfigResponse,
	AlertItem,
	AppUserItem,
	AuthResponse,
	CodeOutputItem,
	ConfigResponse,
	CreateInvitationResponse,
	DashboardSummaryResponse,
	GithubHeatmapItem,
	HeatmapItem,
	InvitationItem,
	MeResponse,
	ModelMixItem,
	ModelProfileResponse,
	ModelRawModelItem,
	ModelRecommendationItem,
	ModelTrendItem,
	ModelUserItem,
	SetupSavePayload,
	SyncRunItem,
	ThresholdsResponse,
	TopSpenderItem,
	UpdateTrackedUserRequest,
	UpdateTrackedUserResponse,
	UsageRow,
	UserDetailResponse,
	UserListItem,
	UserPRComplexityResponse,
	UserRawModelsResponse,
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
	adminConfig: () => request<AdminConfigResponse>("/api/admin/config"),
	updateAdminConfig: (payload: AdminConfigPatch) =>
		request<{ ok: true }>("/api/admin/config", {
			method: "PUT",
			body: JSON.stringify(payload),
		}),
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
		validateKey: (
			provider: "anthropic" | "cursor" | "slack" | "github",
			key: string,
			channelId?: string,
			org?: string,
		) =>
			request<{ ok: boolean; error?: string }>("/api/setup/validate-key", {
				method: "POST",
				body: JSON.stringify({ provider, key, channelId, org }),
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

	appUsers: {
		list: () => request<AppUserItem[]>("/api/app-users"),
		updateRole: (id: string, role: "viewer" | "admin") =>
			request<{ ok: true }>(`/api/app-users/${id}/role`, {
				method: "PATCH",
				body: JSON.stringify({ role }),
			}),
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
		githubHeatmap: (email: string, from: string, to: string) =>
			request<GithubHeatmapItem[]>(
				`/api/users/${encodeURIComponent(email)}/github-heatmap?from=${from}&to=${to}`,
			),
		codeOutput: (email: string, from: string, to: string) =>
			request<CodeOutputItem[]>(
				`/api/users/${encodeURIComponent(email)}/code-output?from=${from}&to=${to}`,
			),
		alertsByEmail: (email: string, days = 30, limit = 50) =>
			request<AlertItem[]>(
				`/api/users/${encodeURIComponent(email)}/alerts?days=${days}&limit=${limit}`,
			),
		update: (email: string, fields: UpdateTrackedUserRequest) =>
			request<UpdateTrackedUserResponse>(`/api/users/${encodeURIComponent(email)}`, {
				method: "PATCH",
				body: JSON.stringify(fields),
			}),
		rawModels: (email: string, from: string, to: string) =>
			request<UserRawModelsResponse>(
				`/api/users/${encodeURIComponent(email)}/raw-models?from=${from}&to=${to}`,
			),
		prComplexity: (email: string, from?: string, to?: string) =>
			request<UserPRComplexityResponse>(
				`/api/users/${encodeURIComponent(email)}/pr-complexity${from && to ? `?from=${from}&to=${to}` : ""}`,
			),
		recommendations: (email: string) =>
			request<ModelRecommendationItem[]>(`/api/users/${encodeURIComponent(email)}/recommendations`),
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
		run: (job: "anthropic" | "cursor" | "alerts" | "slack_digest" | "github", full = false) =>
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

	models: {
		profile: (
			model: string,
			from: string,
			to: string,
			platform: "all" | "claude_code" | "cursor" = "all",
		) =>
			request<ModelProfileResponse>(
				`/api/models/${encodeURIComponent(model)}?from=${from}&to=${to}&platform=${platform}`,
			),
		topUsers: (
			model: string,
			from: string,
			to: string,
			platform: "all" | "claude_code" | "cursor" = "all",
			limit = 50,
			metric: "cost" | "tokens" = "cost",
		) =>
			request<ModelUserItem[]>(
				`/api/models/${encodeURIComponent(model)}/top-users?from=${from}&to=${to}&platform=${platform}&limit=${limit}&metric=${metric}`,
			),
		trend: (
			model: string,
			from: string,
			to: string,
			platform: "all" | "claude_code" | "cursor" = "all",
		) =>
			request<ModelTrendItem[]>(
				`/api/models/${encodeURIComponent(model)}/trend?from=${from}&to=${to}&platform=${platform}`,
			),
		rawModels: (
			model: string,
			from: string,
			to: string,
			platform: "all" | "claude_code" | "cursor" = "all",
		) =>
			request<ModelRawModelItem[]>(
				`/api/models/${encodeURIComponent(model)}/raw-models?from=${from}&to=${to}&platform=${platform}`,
			),
	},
}
