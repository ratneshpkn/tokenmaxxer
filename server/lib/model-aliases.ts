import { normalizeModelName } from "../../shared/model-name"
import { modelAliases } from "../../shared/schema"
import { db } from "../db"

export async function ensureModelAliases(rawModels: string[]) {
	if (!rawModels || rawModels.length === 0) return
	const distinct = Array.from(new Set(rawModels))
	const values = distinct.map((raw) => ({
		rawModel: raw,
		baseModel: normalizeModelName(raw),
	}))
	await db.insert(modelAliases).values(values).onConflictDoNothing()
}
