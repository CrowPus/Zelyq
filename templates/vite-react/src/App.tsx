export default function App() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-16">
        <p className="text-sm font-medium uppercase tracking-widest text-sky-400">{{projectName}}</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Your app starts here.
        </h1>
        <p className="text-lg leading-relaxed text-slate-400">
          Describe what you want in the chat panel and the agent will build it. Everything in this
          project is an ordinary file you can read and edit yourself.
        </p>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 font-mono text-sm text-slate-400">
          src/App.tsx
        </div>
      </div>
    </main>
  );
}
