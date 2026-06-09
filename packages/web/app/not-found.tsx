import Link from "next/link";

// A themed 404 so a mistyped or stale URL lands somewhere consistent with the
// rest of the dashboard rather than the default unstyled page.
export default function NotFound() {
  return (
    <div className="panel" style={{ marginTop: 24, textAlign: "center" }}>
      <h2 style={{ marginTop: 0 }}>Not found</h2>
      <p className="meta">That page does not exist. It may have been a run or case that was deleted.</p>
      <p>
        <Link className="btn small" href="/">
          Back to runs
        </Link>
      </p>
    </div>
  );
}
