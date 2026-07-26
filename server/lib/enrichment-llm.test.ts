import { describe, expect, it } from "bun:test"
import { classifyPRBatch, type LLMConfig, type PREnrichmentInput } from "./enrichment-llm"

describe("enrichment-llm", () => {
	it("returns empty array for empty PR list", async () => {
		const config: LLMConfig = {
			provider: "anthropic",
			apiKey: "test-key",
			modelName: "claude-3-5-haiku-20241022",
		}
		const result = await classifyPRBatch([], config)
		expect(result).toEqual([])
	})

	it("throws error if API key or model name is missing", async () => {
		const config: LLMConfig = {
			provider: "anthropic",
			apiKey: "",
			modelName: "claude-3-5-haiku-20241022",
		}
		const prs: PREnrichmentInput[] = [{ repo: "owner/repo", number: 1, title: "fix bug" }]
		expect(classifyPRBatch(prs, config)).rejects.toThrow(/required/)
	})
})
