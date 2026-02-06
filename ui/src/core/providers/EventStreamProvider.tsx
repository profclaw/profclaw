import { useEventStream } from '../hooks/useEventStream';

/**
 * EventStreamProvider - Establishes SSE connection for real-time updates
 *
 * This component uses the useEventStream hook which automatically
 * connects to the backend SSE endpoint and invalidates React Query
 * caches when task events occur.
 */
export function EventStreamProvider({ children }: { children: React.ReactNode }) {
  // Connect to SSE stream for real-time task updates
  useEventStream();

  return <>{children}</>;
}
