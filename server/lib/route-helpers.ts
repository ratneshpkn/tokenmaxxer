import type { Context } from "hono"
import type { AppEnv } from "../auth/session"
import { currentRole, currentUser } from "../routes/index"
import { daysAgo, yesterday } from "../scripts/lib/shared"
import { loadConfig } from "./config"

/** Coerce bigint[] fields (which arrive from node-postgres as string[]) to number[].
 *  Accepts an explicit list of field names. Mutates the row in place.
 *  Safe on missing/null/non-array values. */
export function coerceTrendArrays(row: Record<string, unknown>, fields: string[]): void {
	for (const f of fields) {
		row[f] = Array.isArray(row[f]) ? (row[f] as unknown[]).map(Number) : []
	}
}

/** Strip the named cost fields from each row when the requester is not an admin.
 *  Used by RBAC-gated endpoints to prevent cost data leaking to viewers. */
export async function stripCostForViewer(
	rows: Record<string, unknown>[],
	c: Context<AppEnv>,
	fields: string[],
): Promise<void> {
	if (currentRole(c) === "admin") return
	const cfg = await loadConfig()
	const visibility = cfg.spendVisibility
	if (visibility === "viewer_all") return

	const user = currentUser(c)

	for (const row of rows) {
		if (visibility === "viewer_own") {
			if (row.email && typeof row.email === "string" && row.email === user?.email) {
				continue
			}
		}
		for (const f of fields) delete row[f]
	}
}

/** Resolve the effective date window for a route. If `from`+`to` are both supplied,
 *  use them verbatim. Otherwise default to `[yesterday - defaultDays, yesterday]`
 *  (or use `days` if provided). PT-aware via the existing yesterday()/daysAgo() helpers. */
export function resolveWindow(
	input: { from?: string; to?: string; days?: number },
	defaultDays: number,
): { effFrom: string; effTo: string } {
	if (input.from && input.to) {
		return { effFrom: input.from, effTo: input.to }
	}
	const n = input.days ?? defaultDays
	return { effFrom: daysAgo(n), effTo: yesterday() }
}
