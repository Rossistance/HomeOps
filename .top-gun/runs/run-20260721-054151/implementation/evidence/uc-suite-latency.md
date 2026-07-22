# 22-UC benchmark — per-UC pass/latency (WP-006 s7 soak)

Three consecutive green runs on the Windows dev host: run 1 = 23 passed (2.8m, list reporter), run 2 = 23 passed (3.3m), run 3 = 23 passed (2.3m). Per-spec durations below from the JSON reporter of runs 2 and 3 (23 specs = 22 UCs + the unattended tz-anchored scheduler soak).

| Spec | run2 ms | run3 ms | status |
|---|---|---|---|
| scheduler-soak.spec.ts | 87155 | 66986 | green |
| uc01-school-correspondence.spec.ts | 1886 | 2938 | green |
| uc02-work-to-home-forwarder.spec.ts | 1871 | 2445 | green |
| uc03-urgent-slack-escalation.spec.ts | 1899 | 4028 | green |
| uc04-grandparent-digest.spec.ts | 1742 | 3237 | green |
| uc05-cross-calendar-conflict.spec.ts | 1799 | 2674 | green |
| uc06-corporate-hold-generator.spec.ts | 1755 | 2664 | green |
| uc07-document-cloud-sync.spec.ts | 1567 | 2405 | green |
| uc08-secure-archive-builder.spec.ts | 1904 | 1865 | green |
| uc09-database-to-checklist.spec.ts | 2153 | 1987 | green |
| uc10-vacation-onboarding.spec.ts | 2066 | 2041 | green |
| uc11-overdue-chore-auditor.spec.ts | 1937 | 1606 | green |
| uc12-climate-night-mode.spec.ts | 1815 | 1712 | green |
| uc13-dinner-bell.spec.ts | 1937 | 1826 | green |
| uc14-morning-status-text.spec.ts | 2848 | 2785 | green |
| uc15-dashboard-api-bridge.spec.ts | 1774 | 1755 | green |
| uc16-school-menu-harvester.spec.ts | 1669 | 1696 | green |
| uc17-recipe-extractor.spec.ts | 1426 | 1463 | green |
| uc18-memory-scrapbooker.spec.ts | 1850 | 1842 | green |
| uc19-event-coordinator.spec.ts | 2010 | 1940 | green |
| uc20-chore-manager.spec.ts | 1641 | 1846 | green |
| uc21-meal-planner-signoff.spec.ts | 68906 | 24019 | green |
| uc22-internal-system-sync.spec.ts | 1570 | 1551 | green |
