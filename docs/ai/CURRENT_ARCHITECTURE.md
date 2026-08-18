> v0.11.2 hardens runtime credential validation and health reporting without changing the capture-first architecture.

# Auralis current architecture — v0.11.2

The product behavior remains the v0.10.12 focused workspace: persistent local session state, direct Windows audio validation path, immutable transcript/turn ownership, source-grounded text Brain, auto-answer policies, conversation hub and selectable stored answers.

The engineering foundation adds typed shared contracts and deterministic verification without changing the user-facing workflow. The `native/core` tree contains the next milestone (v0.12) production Rust audio implementation source, but it must not be called hardware-verified until its Rust tests compile and the Windows hardware gates pass.
