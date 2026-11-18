export default function Loading() {
  return (
    <div className="max-w-7xl mx-auto w-full space-y-5 animate-pulse pb-10">
      <div className="bg-surface border border-line-subtle rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-4 w-40 bg-elevated rounded-md" />
          <div className="h-7 w-72 bg-elevated rounded-lg" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-9 w-24 bg-elevated rounded-xl" />
          <div className="h-9 w-36 bg-elevated rounded-xl" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 h-72 bg-surface border border-line-subtle rounded-2xl p-4" />
        <div className="lg:col-span-7 h-72 bg-surface border border-line-subtle rounded-2xl p-4" />
      </div>
    </div>
  );
}
