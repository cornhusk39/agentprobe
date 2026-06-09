# Screenshots

Drop the following assets here (the README references them by these exact
filenames):

| File | What it should show | How to capture |
| --- | --- | --- |
| `regression-catch.gif` | The CLI catching a regression and recovering | `vhs ../demo.tape` from this folder, or screen-record the loop |
| `dashboard.png` | The home dashboard: trends, flaky cases, runs table | `/` at ~1280px wide |
| `run-detail.png` | A regressed run's cases, trace, and judge | `/runs/4`, cropped to the Cases section |
| `compare.png` | Two runs diffed with deltas | `/compare?base=1&candidate=4` |
| `suite-editor.png` | Authoring a case in the browser | `/suite/lists-availability` |

To run the dashboard locally:

```sh
pnpm --filter @agentprobe/web seed:db
pnpm --filter @agentprobe/web dev   # http://localhost:3000
```
