import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
	plugins: [tailwindcss(), react()],
	root: path.resolve(import.meta.dirname, "client"),
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "client", "src"),
			"@shared": path.resolve(import.meta.dirname, "shared"),
		},
	},
	build: {
		outDir: path.resolve(import.meta.dirname, "dist/public"),
		emptyOutDir: true,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
						return "vendor-react"
					}
					if (id.includes("node_modules/@tanstack/react-query/")) {
						return "vendor-query"
					}
				},
			},
		},
	},
	server: {
		host: "0.0.0.0",
		port: 5173,
		watch: {
			usePolling: true,
		},
		hmr: {
			clientPort: 3003,
		},
		fs: {
			strict: true,
			deny: ["**/.*"],
		},
		proxy: {
			"/api": {
				target: process.env.BACKEND_URL || "http://localhost:3003",
				changeOrigin: true,
			},
		},
	},
})
