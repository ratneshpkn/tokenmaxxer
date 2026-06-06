/**
 * Plain fetch() against Slack's Web API. We use exactly three endpoints
 * (auth.test, conversations.info, chat.postMessage), all of which are simple
 * JSON POSTs — no streaming, no file uploads, no socket mode. The 100KB
 * @slack/web-api SDK drags in axios + follow-redirects, which throws at
 * module-load time on Bun. Direct fetch sidesteps that entirely.
 *
 * Slack's Web API conventions: every response is `{ ok: boolean, ... }`,
 * and a non-ok response is still HTTP 200 with `ok: false` plus an `error`
 * string. Treat that as a thrown error.
 */
const BASE = "https://slack.com/api"

interface SlackResponse {
	ok: boolean
	error?: string
	[key: string]: unknown
}

async function call(
	method: string,
	token: string,
	body?: Record<string, unknown>,
): Promise<SlackResponse> {
	const res = await fetch(`${BASE}/${method}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json; charset=utf-8",
		},
		body: body ? JSON.stringify(body) : "",
	})
	if (!res.ok) {
		throw new Error(
			`Slack ${method} HTTP ${res.status}: ${await res.text().catch(() => "")}`.slice(0, 300),
		)
	}
	const json = (await res.json()) as SlackResponse
	if (!json.ok) {
		throw new Error(`Slack ${method} error: ${json.error ?? "unknown"}`)
	}
	return json
}

export async function slackAuthTest(token: string): Promise<void> {
	await call("auth.test", token)
}

export async function slackChannelInfo(token: string, channel: string): Promise<void> {
	await call("conversations.info", token, { channel })
}

export async function postDigest(
	token: string | null | undefined,
	channel: string | null | undefined,
	text: string,
	blocks?: unknown[],
): Promise<void> {
	if (!token || !channel) {
		console.log("[slack] skipped (token or channel not configured)")
		return
	}
	await call("chat.postMessage", token, { channel, text, blocks })
}
