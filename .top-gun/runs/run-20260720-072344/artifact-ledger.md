# Artifact Ledger

Rows added only by mem's record_artifact.py. Snapshot mode stores a frozen copy
under snapshots/; reference mode tracks a live file by path + hash.

| ID | Timestamp (UTC) | Mode | Path | SHA-256 (12) | Producer | Kind | Purpose | Supersedes |
|---|---|---|---|---|---|---|---|---|
| ART-001 | 2026-07-20T07:30:15Z | snapshot | .top-gun/runs/run-20260720-072344/facts-and-notes.md | e75030e99d5d | top-gun | handoff | Run-3 facts handoff: 4 discovery-driven goals, environment + authority + discriminating checks | - |
| ART-002 | 2026-07-20T07:30:15Z | snapshot | D:\FamiliOS\.app-angel\familios\01-discovery.md | 67cb8a9070f4 | top-gun | report | App-angel discovery report for FamiliOS (2026-07-20): product state, competitors, 30-day goals driving this mission | - |
