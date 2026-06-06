import { Hono } from "hono"
import { serveStatic } from "hono/bun"
import { logger } from "hono/logger"
import { secureHeaders } from "hono/secure-headers"
import { setupGoogleAuth } from "./auth/google-provider"
import { type AppEnv, sessionMiddleware } from "./auth/session"
import { startCron } from "./cron"
import { registerRoutes } from "./routes"
import { reapOrphanedSyncRuns } from "./scripts/lib/shared"

const app = new Hono<AppEnv>()

// Secure headers (equivalent to Helmet)
app.use(
	"*",
	secureHeaders({
		contentSecurityPolicy:
			process.env.NODE_ENV === "production"
				? {
						defaultSrc: ["'self'"],
						scriptSrc: ["'self'"],
						styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
						fontSrc: ["'self'", "https://fonts.gstatic.com"],
						imgSrc: ["'self'", "data:"],
						connectSrc: ["'self'"],
						frameAncestors: ["'none'"],
					}
				: undefined,
	}),
)

// Request logger
app.use("*", logger())

// Session middleware
app.use("*", sessionMiddleware)

// Health check route
app.get("/api/health", (c) => c.json({ ok: true }))

;(async () => {
	// Any sync_runs row in 'running' state at startup is an orphan — its runner died with the
	// previous process. Mark them failed so the UI stops showing them as in-flight.
	try {
		const reaped = await reapOrphanedSyncRuns()
		if (reaped > 0) console.log(`reaped ${reaped} orphaned sync_runs row(s)`)
	} catch (err) {
		console.error("[boot] sync_runs reaper failed (non-fatal):", err)
	}

	// Auth & Routes Setup
	await setupGoogleAuth(app)
	await registerRoutes(app)

	// Global Error Handler
	app.onError((err, c) => {
		const error = err as Error & { status?: number; statusCode?: number }
		const status = error.status || error.statusCode || 500
		const message = error.message || "Internal Server Error"
		console.error(`[${c.req.method} ${c.req.path}] ${status}:`, err)
		const isClient = status >= 400 && status < 500
		return c.json(
			{ message: isClient ? message : "Internal Server Error" },
			status as Parameters<typeof c.json>[1],
		)
	})

	// SPA static serving and fallback (Production only)
	if (process.env.NODE_ENV === "production") {
		// Serve static assets from dist/public
		app.use("/*", serveStatic({ root: "./dist/public" }))

		// Serve index.html as fallback for client-side routing, excluding API routes
		app.get("*", async (c, next) => {
			if (c.req.path.startsWith("/api")) {
				return await next()
			}
			return serveStatic({ path: "./dist/public/index.html" })(c, next)
		})
	}

	// Start Cron
	startCron()

	// Start Bun server
	const port = parseInt(process.env.PORT || "3003", 10)
	console.log(`serving on http://localhost:${port}`)

	Bun.serve({
		fetch: app.fetch,
		port,
	})
})().catch((err) => {
	console.error("Server startup failed:", err)
	process.exit(1)
})
