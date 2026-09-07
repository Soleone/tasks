import { useState, type ReactElement } from "react";
import { runRuntimeProbe, type ProbeResult } from "./platform/backendClient";

function ResultValue({ label, value }: { label: string; value: string | number | boolean }): ReactElement {
  return (
    <div className="result-row">
      <dt>{label}</dt>
      <dd>{String(value)}</dd>
    </div>
  );
}

export default function App(): ReactElement {
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function handleProbe(): Promise<void> {
    setRunning(true);
    setError(null);

    try {
      setProbe(await runRuntimeProbe());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div className="eyebrow">Local work, clearly held</div>
        <h1>Tasks</h1>
        <p className="lede">A calm workspace for turning loose thoughts into the next clear action.</p>
      </header>

      <section className="launch-card" aria-labelledby="kickoff-title">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Kickoff / M0</p>
            <h2 id="kickoff-title">Prove the local runtime</h2>
          </div>
          <span className="status-pill">Scaffolded</span>
        </div>
        <p className="card-copy">
          The first slice checks that the desktop shell and headless agent interface can use the same packaged TypeScript runtime and SQLite database.
        </p>
        <button type="button" onClick={handleProbe} disabled={running}>
          {running ? "Checking runtime…" : "Run runtime probe"}
        </button>
        {error ? <p className="message error" role="alert">{error}</p> : null}
        {probe ? (
          <dl className="probe-results" aria-label="Runtime probe results">
            <ResultValue label="Node" value={probe.nodeVersion} />
            <ResultValue label="SQLite" value={probe.sqliteVersion} />
            <ResultValue label="Journal" value={probe.journalMode} />
            <ResultValue label="FTS5" value={probe.fts5Enabled} />
            <ResultValue label="Matches" value={probe.searchMatches} />
            <ResultValue label="Database" value={probe.databasePath} />
          </dl>
        ) : null}
      </section>

      <footer className="footer-note">Built local-first. Designed to stay understandable.</footer>
    </main>
  );
}
