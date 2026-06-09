# Records the regression-catch loop as a GIF.
# Install vhs (https://github.com/charmbracelet/vhs): brew install vhs
# Then, from the repo root: vhs docs/demo.tape

Output docs/screenshots/regression-catch.gif

Set Shell "bash"
Set FontSize 17
Set Width 1180
Set Height 640
Set Theme "Catppuccin Mocha"
Set Padding 22
Set TypingSpeed 30ms

Hide
Type "cd examples/reference-agent && clear" Enter
Sleep 1s
Show

Type "pnpm check        # the gate is green" Sleep 500ms Enter
Sleep 6s

Type "# inject a regression: the agent stops calling its booking tool" Enter
Sleep 1s
Type "AGENTPROBE_DEMO_REGRESSION=1 pnpm record" Sleep 500ms Enter
Sleep 6s

Type "pnpm check        # fails, exit 1, names the broken assertions" Sleep 500ms Enter
Sleep 7s

Type "pnpm record       # revert" Sleep 500ms Enter
Sleep 6s
Type "pnpm check        # green again" Sleep 500ms Enter
Sleep 7s
