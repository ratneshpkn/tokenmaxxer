import type { Context } from "hono"
import type { AppEnv } from "../auth/session"
import { currentRole } from "../routes/index"
import { daysAgo, yesterday } from "../scripts/lib/shared"

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
export function stripCostForViewer(
	rows: Record<string, unknown>[],
	c: Context<AppEnv>,
	fields: string[],
): void {
	if (currentRole(c) === "admin") return
	for (const row of rows) {
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
