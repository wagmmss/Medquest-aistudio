export default function Loading() {
  return (
    <div className="max-w-7xl mx-auto w-full space-y-6 animate-pulse pb-10">
      <div className="mq-page-hero p-6 md:p-8 space-y-3">
        <div className="h-6 w-56 bg-elevated rounded-full" />
        <div className="h-8 w-72 bg-elevated rounded-lg" />
        <div className="h-4 w-full max-w-xl bg-elevated rounded-md" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="h-44 bg-surface border border-line-subtle rounded-2xl" />
        <div className="h-44 bg-surface border border-line-subtle rounded-2xl" />
        <div className="h-44 bg-surface border border-line-subtle rounded-2xl" />
      </div>
    </div>
  );
}
