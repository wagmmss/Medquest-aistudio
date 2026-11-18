export default function Loading() {
  return (
    <div className="flex flex-col gap-5 w-full max-w-5xl mx-auto animate-pulse pb-10">
      <div className="mq-page-hero p-5 sm:p-6 space-y-2.5">
        <div className="h-4 w-36 bg-elevated rounded-md" />
        <div className="h-8 w-64 bg-elevated rounded-lg" />
        <div className="h-4 w-80 max-w-full bg-elevated rounded-md" />
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="h-10 flex-1 bg-surface border border-line-subtle rounded-xl" />
        <div className="h-10 w-48 bg-surface border border-line-subtle rounded-xl" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="h-36 bg-surface border border-line-subtle rounded-2xl" />
        <div className="h-36 bg-surface border border-line-subtle rounded-2xl" />
      </div>
    </div>
  );
}
