# Records the regression-catch loop as a GIF.
# Install vhs (https://github.com/charmbracelet/vhs): brew install vhs
# Then, from the repo root: vhs docs/demo.tape

Output docs/screenshots/regression-catch.gif

Set FontSize 18
Set Width 1100
Set Height 620
Set Theme "Catppuccin Mocha"
Set Padding 20

Type "cd examples/reference-agent" Enter
Sleep 500ms

Type "pnpm check   # the gate is green" Enter
Sleep 3s

Type "# now inject a regression: the agent stops calling its booking tool" Enter
Sleep 800ms
Type "AGENTPROBE_DEMO_REGRESSION=1 pnpm record" Enter
Sleep 4s

Type "pnpm check   # fails, exit 1, names the broken assertions" Enter
Sleep 4s

Type "pnpm record  # revert" Enter
Sleep 3s
Type "pnpm check   # green again" Enter
Sleep 4s
