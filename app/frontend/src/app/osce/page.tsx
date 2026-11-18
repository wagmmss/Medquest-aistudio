import { OsceHubClient } from "./OsceHubClient";

export default function OscePage() {
  return (
    <div className="flex-1 flex flex-col min-h-0 w-full p-4 md:p-6 overflow-y-auto">
      <OsceHubClient />
    </div>
  );
}
