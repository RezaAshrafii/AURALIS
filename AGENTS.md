# AURALIS Agent Rules

## Scope
This repository is the local development baseline for AURALIS v0.10.12.

## Read freely
- README-WINDOWS.txt
- VERSION
- server.mjs
- core/**
- app/**
- docs/**
- tests/**
- native/core/**

## Do not scan
- runtime/**
- data/**
- releases/**
- node_modules/**
- *.exe
- *.dll
- binary fixtures

## Engineering rules
- Read the task specification before editing.
- Acceptance criteria are authoritative.
- Do not redesign unrelated UI.
- Do not change API contracts unless the task explicitly requires it.
- Do not generate or commit binaries or release artifacts.
- Prefer targeted tests over broad filesystem scans.
- Report changed files, tests, and unresolved risks.
- Never expose credentials or secrets.
