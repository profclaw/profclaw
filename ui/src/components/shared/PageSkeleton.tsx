/**
 * Page loading skeleton for React.lazy() Suspense fallback.
 */

export function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-6 p-2">
      <div className="h-8 w-48 rounded-lg bg-muted/60" />
      <div className="space-y-3">
        <div className="h-4 w-full rounded bg-muted/40" />
        <div className="h-4 w-3/4 rounded bg-muted/40" />
        <div className="h-4 w-1/2 rounded bg-muted/40" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-32 rounded-xl bg-muted/30" />
        ))}
      </div>
    </div>
  );
}
