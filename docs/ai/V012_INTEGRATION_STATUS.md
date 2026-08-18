# v0.12 integration status

The Rust audio core source is substantial and includes WASAPI capture, bounded handoff, raw spool, SQLite ledger, lifecycle/recovery and a Windows hardware-test binary.

Important integration rule: the `auralis-audio-test.exe` hardware-gate binary does not yet emit the live JSON event / VAD / `segment.frozen` contract consumed by the current Bun product shell. Therefore v0.11.1 deliberately does **not** auto-promote that binary into the product hot path. It can only be selected with `AURALIS_EXPERIMENTAL_V012_CAPTURE=1` until the v0.13 speech/event bridge is implemented.

This prevents a compiled v0.12 hardware runner from silently breaking live transcript and auto-answer behavior that currently relies on the validated legacy event-producing probe.
