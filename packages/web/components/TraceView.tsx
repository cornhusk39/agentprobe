// Renders an agent run's trace: the conversational messages and, crucially, the
// tool calls with their arguments and results. The tool-call view is the point;
// it is where agent regressions actually show up (the wrong tool, the wrong
// args), which a single-prompt eval never sees.

import type { SeedCase } from "../lib/types";

type Trace = SeedCase["trace"];

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function TraceView({ trace }: { trace: Trace }) {
  return (
    <div className="trace">
      {trace.map((step, i) => {
        if (step.type === "message") {
          return (
            <div className="step" key={i}>
              <span className="role">{step.role}</span> {step.content}
            </div>
          );
        }
        const call = step.call;
        return (
          <div className="tool" key={i}>
            <div>
              <span className="name">{call.name}</span>
            </div>
            <pre className="code">{pretty(call.args)}</pre>
            {call.result !== undefined ? (
              <>
                <div className="meta" style={{ marginTop: 6 }}>
                  returned
                </div>
                <pre className="code">{pretty(call.result)}</pre>
              </>
            ) : null}
            {call.error ? <div className="meta">error: {call.error}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
