import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-zinc-950">
      <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-100">
        Grape
      </h1>
      <p className="mt-2 text-zinc-500 dark:text-zinc-400">
        Meeting support assistant
      </p>
      <div className="mt-6 flex flex-col gap-3">
        <Link
          href="/transcription"
          className="rounded-full bg-zinc-900 px-6 py-3 text-center font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Open Transcription
        </Link>
        <Link
          href="/playground"
          className="rounded-full bg-purple-600 px-6 py-3 text-center font-medium text-white transition-colors hover:bg-purple-700"
        >
          Voice Playground
        </Link>
      </div>
    </div>
  );
}
