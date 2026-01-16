'use client';

/**
 * Application Providers
 * QueryClient setup for TanStack Query with Next.js App Router singleton pattern
 */

import {
  QueryClient,
  QueryClientProvider,
  isServer,
} from '@tanstack/react-query';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, set staleTime above 0 to avoid immediate refetch on client
        staleTime: 60 * 1000,      // 1 minute before data is considered stale
        gcTime: 5 * 60 * 1000,     // 5 minutes in garbage collection
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (isServer) {
    // Server: always make a new query client
    return makeQueryClient();
  }
  // Browser: singleton to persist across React suspense/re-renders
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
