import { AppNav } from "@/components/app-nav";
import { PasteLog } from "@/components/paste-log";

export default function LogPage() {
  return (
    <>
      <AppNav />
      <main className="min-h-screen w-full px-4 py-10">
        <div className="mx-auto w-full max-w-2xl">
          <PasteLog />
        </div>
      </main>
    </>
  );
}
