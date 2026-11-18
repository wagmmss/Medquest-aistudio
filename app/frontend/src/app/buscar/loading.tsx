export default function Loading() {
  return (
    <div className="flex flex-col gap-5 max-w-6xl mx-auto px-4 sm:px-6 py-5 animate-pulse pb-10">
      <div className="mq-page-hero p-5 sm:p-6 space-y-2.5">
        <div className="h-4 w-44 bg-elevated rounded-md" />
        <div className="h-8 w-64 bg-elevated rounded-lg" />
        <div className="h-4 w-96 max-w-full bg-elevated rounded-md" />
      </div>
      <div className="h-12 w-full bg-surface border border-line-subtle rounded-2xl" />
      <div className="flex flex-wrap gap-2">
        <div className="h-7 w-28 bg-surface border border-line-subtle rounded-full" />
        <div className="h-7 w-32 bg-surface border border-line-subtle rounded-full" />
        <div className="h-7 w-24 bg-surface border border-line-subtle rounded-full" />
      </div>
    </div>
  );
}
