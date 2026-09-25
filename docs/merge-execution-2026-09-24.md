# Local merge execution - 2026-09-24

**Follow-up (2026-09-25):** The remaining humanoid/root integration described below is now prepared on `codex/e2e-humanoid-integration`, with all three maintained simulation controls passing. See the [integration report](e2e-integration-2026-09-25.md). This September 24 record retains its original status and test attribution; the client and Nova tips listed here are unchanged.

The requested client and Nova changes have been merged into their specified local branches. This record supersedes the merge-status and checkout-status statements in the earlier [merge review](merge-review-2026-09-24.md); that review and its inventories remain historical snapshots of the proposed changes.

## What was merged

| Repository | Destination | Before | After | Result |
|---|---|---|---|---|
| platform-client | dev | 64dd9628d1b5a5d8e6d48951a01af64810281da6 | adf51339db90f75ee078d51bc8fba36148414d89 | Fast-forward of the cumulative durable completion/failure recovery and mixed-device completion fixes. |
| nova5_ros2 | nova5_vision_lebai_andy | fe1e9d07ad2e16d1c46838cce63b65943b5261c8 | 4055912c72a90e841b79cbc93852fe9cc807927a | Fast-forward of recovery candidate 39c6aff5 and a narrow test-fixture preparation commit. |

Both canonical checkouts were clean immediately before the merges and at the final check. The client edits reported in the earlier review were no longer present; no old changes were reconstructed or discarded. The original branch tips remain available as `codex/pre-merge-client-dev-20260924` and `codex/pre-merge-nova-20260924` in their respective repositories.

These are local merges. No remote push, deployment, hardware operation or service launch was performed.

## Nova test correction included

The preparation commit changes only `src/platform_bridge/test/test_platform_completion_e2e.py`:

- Each test client uses its own temporary pending-completion and pending-failure files.
- The fake failure acknowledgment includes the identity, retry policy and message fields expected from the actual backend.

The helper's content matches the reviewed staged fixture after line-ending normalization. `test_recovery_replay.py` keeps its normal import and is unchanged. The final tests ran the original package test modules with this corrected helper; they did not substitute overlay modules. This preparation adds no Nova production behavior beyond the reviewed recovery candidate.

## Verification on the merged versions

| Check | Result | Qualification |
|---|---|---|
| Client focused protocol, settings and pending-store tests | 164 passed | Actual canonical client on local dev; WSL Python 3.10. This is a focused selection, not the entire repository suite. |
| Normal Nova package suite before target merge | 236 passed | Preparation checkout with the corrected helper and actual canonical merged client. |
| Normal Nova package suite on the merged canonical target, first run | 235 passed, 1 failed | A lost-start-acknowledgment test exceeded its fixed 0.5-second deadline during trace handling. |
| Repeat of that individual test | Passed | Reported alongside the initial failure; a pass does not erase the timing sensitivity. |
| Full Nova package suite on the merged canonical target, repeated | 236 passed | Same merged source and client pairing. |

The initial Nova failure is included in this record. The successful repeat does not make the first run a clean pass. Timing sensitivity is the current explanation suggested by the repeats, not a proven root cause. The affected test is `test_lost_start_ack_recovers_known_success_without_a_second_start`. No production fix was added in response to that failure. This merge verification does not claim a new real-platform runtime run, rendered frontend check, or physical robot validation.

The [verification manifest](verification/merge-2026-09-24/manifest.json) contains the machine-readable merge record and provenance. The counts above are reported results from the merge executor's tool runs. The temporary raw JUnit files and test logs were no longer available when archival was attempted; they have not been reconstructed. The missing raw reports limit retrospective inspection of the test failure and output. A separate read-only audit confirmed final branch tips, ancestry, clean checkouts and the line-ending-only source differences.

## Preserved and excluded local state

The client candidate's uncommitted `.gitignore` addition for `/.local` was left untouched and is not part of the merged commits. The Nova preparation checkout's pre-existing untracked `src/platform_bridge/pending-completions.json` remains local runtime state and was excluded. Historical source captures, databases and earlier acceptance records retain their original version attribution.

## What remains to integrate

1. **Humanoid harness:** `codex/humanoid-platform-integration` at `cef2e87bc22f09eec1ce690c825bbd0cd416afc5` remains unmerged into `end-to-end-sim`. Its standalone predecessor is already included in that branch. The launcher checks exact client file hashes. Git materialized different line endings in the canonical client checkout: the independently checked files have matching contents after CRLF-to-LF normalization, but different raw hashes. Preserve the expected checkout bytes or deliberately update the active source pins, then validate that pairing before using it. Keep historical run manifests unchanged.
2. **Root E2E tooling, tests and documentation:** the existing uncommitted package in the original `end-to-end-sim` checkout remains separate from the humanoid branch. Package it deliberately, preserve verification evidence and reconcile both sets of `.gitignore` additions.
3. **coffee-platform:** unchanged. Its staged status-snapshot patch is a separate handoff; the known server-side accounting, cancellation and replay defects are not fixed by these two merges.

Recommended next step: finish the humanoid source-pin compatibility check, integrate its reviewed branch with the root E2E package on an explicit branch, and run the applicable software and simulated integration checks. The operator recovery workflow remains a separate design/implementation item described in [the recommendation](operator-recovery-recommendation-2026-09-24.md).
