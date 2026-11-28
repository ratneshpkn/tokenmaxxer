import { useState } from "react"

export type SortDir = "asc" | "desc"

export interface UseTableStateOptions<T, K extends string> {
	data: readonly T[]
	initialSortKey: K
	initialSortDir?: SortDir
	/** Keys whose first click defaults to ascending order (e.g. text columns like "model" or "email"). */
	ascKeys?: readonly K[]
	/** Return true if `row` matches the lowercased, trimmed search query. */
	filterBy?: (row: T, query: string) => boolean
	/** Extract the sortable string or number for `row` under `key`. */
	sortValue: (row: T, key: K) => string | number
}

export interface TableState<T, K extends string> {
	rows: T[]
	filter: string
	setFilter: (next: string) => void
	sortKey: K
	sortDir: SortDir
	setSortKey: (next: K) => void
	setSortDir: (next: SortDir) => void
	toggleSort: (key: K) => void
}

export function useTableState<T, K extends string>({
	data,
	initialSortKey,
	initialSortDir = "desc",
	ascKeys,
	filterBy,
	sortValue,
}: UseTableStateOptions<T, K>): TableState<T, K> {
	const [filter, setFilter] = useState("")
	const [sortKey, setSortKey] = useState<K>(initialSortKey)
	const [sortDir, setSortDir] = useState<SortDir>(initialSortDir)

	const q = filter.trim().toLowerCase()
	const filtered = q && filterBy ? data.filter((row) => filterBy(row, q)) : data

	const rows = [...filtered].sort((a, b) => {
		const av = sortValue(a, sortKey)
		const bv = sortValue(b, sortKey)
		const cmp =
			typeof av === "string" && typeof bv === "string"
				? av.localeCompare(bv)
				: Number(av) - Number(bv)
		return sortDir === "asc" ? cmp : -cmp
	})

	function toggleSort(key: K): void {
		if (sortKey === key) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"))
		} else {
			setSortKey(key)
			setSortDir(ascKeys?.includes(key) ? "asc" : "desc")
		}
	}

	return { rows, filter, setFilter, sortKey, sortDir, setSortKey, setSortDir, toggleSort }
}
