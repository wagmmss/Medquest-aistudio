export default function Loading() {
  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="bg-surface border border-line-subtle rounded-lg p-6 space-y-3">
        <div className="h-3 w-32 bg-surface-subtle rounded-xs" />
        <div className="h-8 w-72 bg-surface-subtle rounded-md" />
        <div className="h-4 w-96 max-w-full bg-surface-subtle rounded-md" />
      </div>

      <div className="h-12 w-80 bg-surface-subtle border border-line-subtle rounded-lg" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-surface border border-line-subtle rounded-lg h-64" />
        <div className="bg-surface border border-line-subtle rounded-lg h-64" />
      </div>
    </div>
  );
}
