import { PR_COMPLEXITY_WEIGHTS } from "@shared/constants"
import { normalizeModelName } from "@shared/model-name"
import { modelAliases } from "@shared/schema"
import { eq, type SQL, sql } from "drizzle-orm"
import type { Context } from "hono"
import { z } from "zod"
import type { AppEnv } from "../auth/session"
import { currentRole, currentUser } from "../auth/session"
import { db } from "../db"
import { loadConfig } from "../lib/config"
import { daysAgo, yesterday } from "../scripts/lib/shared"

// ── Spend Visibility Policy ─────────────────────────────────────────────────

export type SpendVisibilitySetting = "admin_only" | "viewer_own" | "viewer_all"

export interface SpendViewer {
	role: "admin" | "viewer" | null
	email?: string | null
}

export function canViewOrgSpend(viewer: SpendViewer, visibility: SpendVisibilitySetting): boolean {
	if (viewer.role === "admin") return true
	return viewer.role === "viewer" && visibility === "viewer_all"
}

export function canViewSpendForEmail(
	viewer: SpendViewer,
	visibility: SpendVisibilitySetting,
	targetEmail?: string | null,
): boolean {
	if (canViewOrgSpend(viewer, visibility)) return true
	return Boolean(
		viewer.role === "viewer" &&
			visibility === "viewer_own" &&
			targetEmail &&
			viewer.email &&
			targetEmail.toLowerCase() === viewer.email.toLowerCase(),
	)
}

/** Set named cost fields to `null` on rows the viewer cannot see. Mutates in place. */
export function redactSpendRows(
	rows: Record<string, unknown>[],
	viewer: SpendViewer,
	visibility: SpendVisibilitySetting,
	fields: readonly string[],
	opts?: { targetEmail?: string | null },
): void {
	if (canViewOrgSpend(viewer, visibility)) return
	for (const row of rows) {
		const rowEmail =
			opts?.targetEmail !== undefined
				? opts.targetEmail
				: typeof row.email === "string"
					? row.email
					: null
		if (canViewSpendForEmail(viewer, visibility, rowEmail)) continue
		for (const f of fields) row[f] = null
	}
}

export function redactRecommendationMessage(message: string): string {
	return message
		.replace(/to save ~\$[\d.,]+\./g, ".")
		.replace(/\(\$[\d.,]+\/M\)/g, "")
		.replace(/\s+\./g, ".")
		.replace(/\s+/g, " ")
		.trim()
}

export async function resolveSpendPolicy(c: Context<AppEnv>) {
	const viewer: SpendViewer = { role: currentRole(c), email: currentUser(c)?.email ?? null }
	const visibility: SpendVisibilitySetting =
		viewer.role === "admin" ? "viewer_all" : (await loadConfig()).spendVisibility

	return {
		canViewOrgSpend: canViewOrgSpend(viewer, visibility),
		canViewEmail: (targetEmail: string) => canViewSpendForEmail(viewer, visibility, targetEmail),
		redactRows: (
			rows: Record<string, unknown>[],
			fields: readonly string[],
			opts?: { targetEmail?: string | null },
		) => redactSpendRows(rows, viewer, visibility, fields, opts),
		redactObject: (
			obj: Record<string, unknown>,
			fields: readonly string[],
			opts?: { targetEmail?: string | null },
		) => redactSpendRows([obj], viewer, visibility, fields, opts),
		redactRecommendationMessage,
	}
}

// ── Date Window & Query Validation ──────────────────────────────────────────

export const YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/

const optionalDateShape = {
	from: z.string().regex(YMD_REGEX).optional(),
	to: z.string().regex(YMD_REGEX).optional(),
	days: z.coerce.number().int().min(1).max(365).optional(),
}

const requiredDateShape = {
	from: z.string().regex(YMD_REGEX),
	to: z.string().regex(YMD_REGEX),
}

const hasPairedBounds = (q: { from?: string; to?: string }) =>
	Boolean((q.from && q.to) || (!q.from && !q.to))
const hasOrderedBounds = (q: { from?: string; to?: string }) => !q.from || !q.to || q.from <= q.to

export function withDateRangeValidation<T extends z.ZodRawShape>(extra: T) {
	return z
		.object({ ...optionalDateShape, ...extra })
		.refine((q) => hasPairedBounds(q as { from?: string; to?: string }), {
			message: "from and to must be provided together",
		})
		.refine((q) => hasOrderedBounds(q as { from?: string; to?: string }), {
			message: "from must be <= to",
		})
}

export const optionalDateRangeSchema = z
	.object(optionalDateShape)
	.refine(hasPairedBounds, { message: "from and to must be provided together" })
	.refine(hasOrderedBounds, { message: "from must be <= to" })

export function withRequiredDateRange<T extends z.ZodRawShape>(extra: T) {
	return z
		.object({ ...requiredDateShape, ...extra })
		.refine((q) => hasOrderedBounds(q as { from?: string; to?: string }), {
			message: "from must be <= to",
		})
}

export const requiredDateRangeSchema = z
	.object(requiredDateShape)
	.refine(hasOrderedBounds, { message: "from must be <= to" })

export function resolveWindow(
	input: { from?: string; to?: string; days?: number },
	defaultDays: number,
): { effFrom: string; effTo: string } {
	if (input.from && input.to) return { effFrom: input.from, effTo: input.to }
	return { effFrom: daysAgo(input.days ?? defaultDays), effTo: yesterday() }
}

export function windowDayCount(effFrom: string, effTo: string): number {
	return (
		Math.round(
			(new Date(`${effTo}T00:00:00Z`).getTime() - new Date(`${effFrom}T00:00:00Z`).getTime()) /
				86_400_000,
		) + 1
	)
}

export function coerceTrendArrays(row: Record<string, unknown>, fields: readonly string[]): void {
	for (const f of fields) {
		row[f] = Array.isArray(row[f]) ? (row[f] as unknown[]).map(Number) : []
	}
}

// ── Composable Drizzle SQL Fragments & Model Catalog ────────────────────────

const col = (alias: string | undefined, column: string): SQL =>
	sql.raw(alias ? `${alias}.${column}` : column)

export const ccTokensExpr = (alias?: string): SQL =>
	sql`(${col(alias, "uncached_input_tokens")} + ${col(alias, "cache_read_input_tokens")} + ${col(alias, "cache_creation_5m_tokens")} + ${col(alias, "cache_creation_1h_tokens")} + ${col(alias, "output_tokens")})`

export const cuTokensExpr = (alias?: string): SQL =>
	sql`(${col(alias, "input_tokens")} + ${col(alias, "output_tokens")} + ${col(alias, "cache_read_tokens")} + ${col(alias, "cache_write_tokens")})`

export const baseModelExpr = (tableAlias = "d", maAlias = "ma"): SQL =>
	sql`coalesce(${col(maAlias, "base_model")}, ${col(tableAlias, "model")})`

export const modelAliasJoin = (tableAlias = "d", maAlias = "ma"): SQL =>
	sql`left join model_aliases ${sql.raw(maAlias)} on ${col(maAlias, "raw_model")} = ${col(tableAlias, "model")}`

export const modelMatchesExpr = (
	baseModelName: string,
	rawModel: string,
	tableAlias = "d",
	maAlias = "ma",
): SQL => {
	const resolved = baseModelExpr(tableAlias, maAlias)
	return sql`(${resolved} = ${baseModelName} or ${resolved} = ${rawModel})`
}

export function complexityWeightCaseSql(alias = "gpe"): SQL {
	const scoreCol = col(alias, "complexity_score")
	return sql`case ${scoreCol}
		when 1 then ${sql.raw(String(PR_COMPLEXITY_WEIGHTS[1]))}
		when 2 then ${sql.raw(String(PR_COMPLEXITY_WEIGHTS[2]))}
		when 3 then ${sql.raw(String(PR_COMPLEXITY_WEIGHTS[3]))}
		when 4 then ${sql.raw(String(PR_COMPLEXITY_WEIGHTS[4]))}
		when 5 then ${sql.raw(String(PR_COMPLEXITY_WEIGHTS[5]))}
		else 0.0
	end`
}

export function teamMembershipJoin(emailColRef: string, teamId?: string, alias = "tm"): SQL {
	if (!teamId) return sql``
	return sql`join team_memberships ${sql.raw(alias)} on ${sql.raw(alias)}.user_email = ${sql.raw(emailColRef)} and ${sql.raw(alias)}.team_id = ${teamId}`
}

export async function ensureModelAliases(rawModels: string[]): Promise<void> {
	if (!rawModels.length) return
	const values = Array.from(new Set(rawModels)).map((rawModel) => ({
		rawModel,
		baseModel: normalizeModelName(rawModel),
	}))
	await db.insert(modelAliases).values(values).onConflictDoNothing()
}

export async function resolveBaseModel(model: string): Promise<string> {
	const [row] = await db
		.select({ baseModel: modelAliases.baseModel })
		.from(modelAliases)
		.where(eq(modelAliases.rawModel, model))
		.limit(1)
	return row?.baseModel || model
}

export async function getRawModelsForBase(baseModel: string): Promise<string[]> {
	const rows = await db
		.select({ rawModel: modelAliases.rawModel })
		.from(modelAliases)
		.where(eq(modelAliases.baseModel, baseModel))
	return rows.length > 0 ? rows.map((r) => r.rawModel) : [baseModel]
}
