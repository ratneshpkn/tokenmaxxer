import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// 5-minute staleTime for cached dashboard, user, team, and model metrics.
			// Background syncs run hourly/daily; mutations explicitly invalidate relevant query keys.
			staleTime: 5 * 60 * 1000,
			refetchOnWindowFocus: false,
			retry: 1,
		},
	},
})
