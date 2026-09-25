# Verification records and local archives

This directory separates curated review records from raw local test output. Source commits include an explicit selection of manifests, summaries and test reports. Raw service logs, per-case source captures, event streams, runtime journals and databases remain local and are excluded by the repository's ignore rules. Exclusion does not delete or rewrite those files. Explicit Git attributes preserve the selected manifests, summary and test reports without line-ending conversion, so their recorded raw SHA-256 values remain meaningful across checkouts.

## Current records

- [2026-09-24 merge manifest](merge-2026-09-24/manifest.json): the client and Nova local branch merges, source hashes and reported software test results. Its temporary raw JUnit/log files were unavailable when archival was attempted; the manifest states that limit.
- [2026-09-25 integration summary](e2e-integration-2026-09-25/summary.json): three accepted runtime controls using the canonical merged client and Nova checkouts, selected software results, hashes and retained unsuccessful attempts. Output was saved directly to durable local run directories. The [integration report](../e2e-integration-2026-09-25.md) explains the changes, selected records committed for review and local raw-output paths.

The [master verification report](../master-verification-report.md) describes coverage and remaining issues. The [merge review](../merge-review-2026-09-24.md) and its inventories retain the earlier review snapshot; subsequent execution records identify which changes were actually integrated.

## Historical evidence

The existing September 18-23 archives include direct platform and ROS checks, Socket.IO fault cases, client restart/replay tests and combined recovery runs. Many cases contain copied source and runtime state. They remain attributed to the versions that actually ran; a later merge or passing test does not revalidate them automatically.

Some historical reports link to these local-only files or to the original worktree captures. Those links require the preserved workstation archive and may not resolve in a fresh clone. A source hash or index identifies an artifact but does not replace missing raw evidence. Do not recreate a captured file and present it as an original result.

## Adding evidence

Save raw output to the run directory before starting a test. Record the selected source roots and hashes, interpreter, arguments, assertions, failures, retries and cleanup outcome. Preserve failed attempts alongside successful repeats. Select only the necessary summary, provenance and test-report files for Git, check them for credentials and unrelated data, and record where the remaining raw files are kept.

Use a fresh database and state directory for an independent test. For a restart test, deliberately reuse that case's state and verify that no physical effect was repeated. Do not edit a journal or inventory record to force acceptance. Hardware validation remains a separate activity.
