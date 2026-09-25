# Merge review - recovery fixes and humanoid E2E integration

**Merge update (2026-09-24):** The requested local client and Nova merges are complete. See the [merge execution record](merge-execution-2026-09-24.md) for final branches, new verification results and remaining work. The earlier status and evidence below retain their historical context.

Prepared 2026-09-24. This report supports your merge decisions. No merge, source-code change, deployment, or new test run was performed while preparing it.

**Recommended outcome:** integrate the reviewed client and humanoid changes together, integrate the Nova recovery changes with the reviewed test-fixture adjustment described below, and package the root simulation tools/documentation as a separate change. Existing local edits and the intended target branches need to be resolved first.

The source inventory comes from current local Git state. It is not a remote freshness check. All test results below are retained results from the completed work, attributed to their actual versions.

## 1. Decisions to review

| Item | Candidate to review | What it provides | Recommendation |
|---|---|---|---|
| Client recovery | `platform-client`: `codex/durable-failure-recovery`, tip `adf51339`; latest production change `9be6207a` | Durable completion/failure reporting, safe restart/reconciliation, physical hold APIs, and mixed-device session completion | Review as one cumulative feature. Reconcile overlapping local client edits before merging. |
| Humanoid harness | `end-to-end-sim`: `codex/humanoid-platform-integration`, tip `cef2e87b`; latest production change `1fb043c4` | Standalone simulated pick loop plus real-platform integration, physical evidence/readiness, failure reporting and fault tests | Integrate with the reviewed client version. Its launcher checks exact client source hashes. |
| Nova recovery | `nova5_ros2`: `codex/nova-recovery-migration`, tip `39c6aff5` | Journal migration, manual exact late-success recovery, durable completion replay, audited local operator resolution | Review as a separate Nova change, paired with the compatible client. Promote the reviewed fixture adjustment and verify the normal suite before calling the branch merge-ready. |
| Root simulation tooling and reports | Current uncommitted files in the original `end-to-end-sim` checkout | API/Socket.IO/ROS simulation tools, console helpers, probes, requirements, issue reports and verification evidence | Package a deliberate source/test/docs change on a branch; choose how to retain verification records. These files are not already included in the humanoid branch. |
| Platform status patch | `patches/coffee-platform-admin-devices-socket-snapshot.patch` | Staging-only status-snapshot correction | Keep as a separately reviewed handoff. Applying it to canonical `coffee-platform` is outside the current read-only scope. |

Use the final feature branch tips for review. A latest production commit is a version marker, not necessarily a self-contained patch: cherry-picking only `9be6207a`, for example, would omit earlier durable-store and hold changes on which it depends.

## 2. Concrete merge preparation

1. **Protect and reconcile the existing client edits.** The canonical `platform-client` checkout is on local `dev` at `64dd9628`, with unstaged changes in `README.md`, `docs/SPEC.md`, `hr_client/client.py`, `pyproject.toml`, and `tests/test_hr_protocol.py`. The client and protocol-test edits overlap the recovery branch. These are existing checkout changes, not a reason to discard or overwrite them.
2. **Choose the actual destination branches.** The client candidate was based on local `dev`, Nova on `nova5_vision_lebai_andy`, and the harness on local `end-to-end-sim/main`. No destination was selected for this report. Local client `origin/dev` is older than the candidate's base, and `origin/HEAD` points to `main`; neither should be silently substituted for the reviewed base.
3. **Reconcile the root `.gitignore`.** Both the root checkout and humanoid branch change this tracked file. The other candidate harness paths do not overlap the inventoried root untracked paths. Preserve the useful ignore rules from both sides.
4. **Carry the Nova test-fixture adjustment.** The compatibility run used two staged test modules outside the frozen Nova branch. Their relationship to the normal tests is detailed below.
5. **Keep client/harness source pins consistent.** A client source edit or checkout line-ending conversion can change a raw file hash. If the resulting client bytes change, review the change, update the active launcher pin/manifest deliberately, and verify the resulting pairing. Preserve historical run manifests unchanged.
6. **Keep runtime state out of source commits.** Pending-report journals, case databases, `.local/` and `.humanoid-runs/` are not default source merge payloads. Retain their evidence; do not bulk-add them or delete them as part of a merge.

The earlier `codex/durable-completion-recovery` branch at `e6766e8` is already an ancestor of the final client branch. Likewise, standalone humanoid commit `02fabbec` is included in the final harness branch. They do not require separate feature merges.

## 3. Client changes: what was fixed

Scope from the current canonical base: **95 tracked paths** = 5 Python source files, 1 configuration file, 4 test files, 4 primary documents, and 81 verification/provenance files.

| Changed item | Fix and resulting behavior |
|---|---|
| `hr_client/pending_completion.py` | Adds durable completion records so a lost acknowledgment or process restart does not lose the outcome or require repeating physical work. |
| `hr_client/pending_failure.py` | Adds durable failure records bound to exact order/session/task/retry/execution identity, with confirmation, callback and hold state. |
| `hr_client/client.py`: outcome handling | Queues/replays saved results, validates acknowledgments and authoritative readback, and preserves ambiguous results instead of treating them as new physical work. |
| `hr_client/client.py`: scheduling/restart | Coordinates replay, confirmation and callbacks before requesting more work; preserves recovery gates across reconnect/startup. |
| `hr_client/client.py`: physical hold APIs | Allows a known placement to be reported while the device stays physically held. Releasing a client hold does not manufacture readiness evidence. |
| `hr_client/client.py`: mixed-device completion | Fixes the case where the humanoid finishes first, receives `NO_TASK_FOR_DEVICE`, and misses a later completion event sent only to Nova. It reconciles the exact session and finalizes when the evidence and local gates permit it. |
| `hr_client/models.py` | Carries outcome/recovery metadata needed by the client and executors. |
| `hr_client/settings.py` and `config/hr_settings.json` | Configure durable reporting. The optional failure-store setting accepts omitted/empty values and derives from the active completion store; the real checked-in settings were smoke-tested. |
| Four test files | Protocol/recovery regressions, completion/failure stores, and optional-setting compatibility. |
| Four documents and 81 evidence files | Design, reproduction, validation and provenance. They are tracked review material; they are not robot runtime state. |

The client guards do not make the server atomically enforce failure retry generations. That source-reviewed cross-actor race and canonical replay/accounting defects remain platform work.

## 4. Nova changes: what was fixed

Scope from canonical `fe1e9d07`: **28 tracked paths** = 7 production Python files, 1 configuration file, 7 test files, 4 main bridge documents, and 9 verification/provenance artifacts.

All source paths below are under `src/platform_bridge/`.

| Changed item | Fix and resulting behavior |
|---|---|
| `platform_bridge/journal.py` | Adds the recovery journal/migration and durable state needed to preserve identity and outcome through interrupted work. |
| `platform_bridge/recovery.py` and `recover_execution.py` | Support manual recovery using the exact execution ID, current controller terminal outcome and fresh readiness evidence. Known success is preserved without redispatching the pick. |
| `platform_bridge/completion_recovery.py` | Couples saved Nova results to the client's durable completion path and acknowledgment callback. |
| `platform_bridge/executor.py` | Integrates recovery identity, journal state and physical outcome handling with execution. |
| `platform_bridge/ros_node.py` | Integrates startup/replay and client callback behavior into the ROS bridge. |
| `platform_bridge/settings.py` and `config/platform_bridge.json` | Supply the corresponding recovery/reporting configuration. |
| `recover_execution.py`: operator resolution | Provides an explicit audited local completion-reporting resolution for supported cancelled/deleted-session discrepancies. It sends no platform message and does not repair inventory. |
| Seven tests plus documentation/evidence | Cover journal migration, executor and recovery behavior, CLI checks, traces and completion replay. |

**Clarification about older issue descriptions:** the canonical Nova checkout is still at the original baseline. Candidate `39c6aff5` adds a supported manual late-success recovery path. This is distinct from automatic/background recovery, a general physical-hold resolver, or canonical platform accounting reconciliation.

### Bring the reviewed Nova fixture behavior into the normal tests

The recorded 236-pass compatibility run with the newer client used reviewed copies of two test fixtures. The frozen candidate branch still has the originals.

| Target file in Nova | Reviewed correction to promote |
|---|---|
| `src/platform_bridge/test/test_platform_completion_e2e.py` | Give each test client its own pending-report paths under `tmp_path`; make the fake failure acknowledgment match the real backend's identity, retry, policy and message fields. |
| `src/platform_bridge/test/test_recovery_replay.py` | Keep its normal import of the original helper module. The staged copy redirects that import only to run alongside the untouched originals; do not copy the `_overlay` import into the branch. |

The substantive test-only changes are in the shared helper: isolated stores and accurate fake acknowledgments. The replay test can remain unchanged once its original helper is corrected; the temporary overlay import is not a feature to merge. These changes do not weaken assertions or require a Nova production change.

Reviewed copies and provenance are in [the compatibility overlay directory](<C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/nova-durable-failure-compat-b4b0557/test-overlay>) and [its provenance record](<C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/nova-durable-failure-compat-b4b0557/compatibility-provenance.json>). The exact staged names are `test_platform_completion_e2e_overlay.py` and `test_recovery_replay_overlay.py`.

After incorporating those corrections, run the normal selected Nova suite against the intended final client. The earlier overlay-qualified pass is not an unqualified pass of the unchanged candidate tests.

## 5. Humanoid harness changes: what was added

Scope from root `main` at `62158af5`: **48 tracked paths** = 19 production Python files, 11 test/driver files, 17 documentation/manifest files, and `.gitignore`. This includes the original standalone harness as well as platform integration.

| Changed area | Behavior to review |
|---|---|
| Controller, models and configuration | Implements the simulated pick loop: navigation, pre-pick positioning, VLA/pick, possession checks, placement and safe release, with separate failure/retry paths. |
| Adapter modules | Explicit simulation boundaries for AMR, humanoid movement, lift, perception, VLA and platform behavior. They are extension points, not claims of working real hardware. |
| Storage and stubs | Preserve execution effects and identity so restart/retry can inspect previous work rather than repeat it. |
| Global ownership/readiness | Uses current device readiness and proof after the latest physical action; an older unit's proof cannot establish readiness after a later unit runs. |
| `integration/executor.py` | Adapts a real platform-client assignment to the full humanoid loop, binds placement to the assigned destination, and keeps reporting separate from physical readiness. |
| `integration/failure_attempts.py` | Binds failure report generations and callbacks to saved physical proof, including report-only retries after another unit has completed. |
| `integration/__main__.py` | Loads the real client/settings, checks the reviewed client hashes, restores eligible reporting/holds before connecting, and provides opt-in simulation fault hooks. |
| Standalone entry point and visual replay | Provide local scenarios, durable output and replay artifacts. Browser-rendered QA remains unverified. |
| Tests, guides and manifests | Cover assignment contracts, retries, loss, crash windows, held startup and real-client composition; distinguish historical runs from the final accepted versions. |

The integration launcher pins four client modules. Its current client `client.py` hash is `481163dc187fff8e62fdd9d2af6c919f3ed9f1ccae43d4f463acd900111a3f9d`, associated with production commit `9be6207a`. The complete expected hashes are in the reviewed launcher and source manifest.

## 6. Root simulation tools and evidence

These files are separate from the committed humanoid branch. At the review snapshot, excluding the four new review artifacts, the original root checkout had **1 modified tracked file plus 743 untracked files**. The untracked files comprise **689 verification files and 54 other files**; including the tracked `.gitignore` change gives **55 non-evidence paths**.

| Group | Items and purpose | Merge treatment |
|---|---|---|
| Fake ROS service | Three `sim_ros/` modules | Reusable simulated bread-pick service/core; review as development tooling. |
| Transport/recovery tooling | API runtime, generic-client and Nova recovery harnesses, WebSocket entry point, Socket.IO fault proxy and evidence exporter | Package the reusable versions with their tests. |
| Console and runtime tools | `local_sim_console.py`, support module and runtime helper | Useful operator/development tooling; sustained/reconnect console acceptance is still limited. |
| Probes and reproduction tools | Two domain-68 Nova probes, ROS status observer and partial-order Socket.IO reproduction | Preserve their stated assumptions; do not assume a historical hardcoded domain is free on a new run. |
| Configuration/dependencies | Simulation bridge configuration and two `.in`/`.lock` requirement pairs | Review endpoints, domains and environment assumptions for the destination setup. |
| Tests | Eight `tests/` files plus one `tests_ros/` file | Keep with the tools they validate; the report does not claim a new consolidated pass of every root test. |
| Main reports/source notes | 22 non-evidence documentation paths | Preserve decisions, issue ledger, reproducibility and source attribution. |
| Verification tree | 689 captured files | Retain as reviewed evidence or a versioned archive, with working links and hashes. It is not a runtime dependency. |
| Platform patch | Staging-only admin/device snapshot patch | Separate platform-owner review; no implicit permission to apply it. |
| `.gitignore` | Modified in both root and harness candidate | Reconcile the two changes deliberately. |

Some latest scenario drivers and the Nova test overlay live in ignored staging directories or captured source archives. The completed runs are reproducible evidence, but the root tools are not yet a single maintained command that reproduces every latest accepted case. Curating those final drivers is a follow-up packaging task.

## 7. Test results supporting the review

Counts overlap and are not additive. Production versions and later documentation-only tips are deliberately separate.

| Scope | Recorded result | Qualification |
|---|---|---|
| Final client `9be6207a` | Owner: 154 focused checks and 385 available broad checks; independent review: 153 explicitly selected checks and 385 broad checks | These are overlapping scopes, not different totals to combine. Actual imported source hashes were retained. |
| Client environment exclusions | Four GUI/vision modules could not collect; nine logging tests fail on the unchanged Python 3.10 baseline | Missing optional GUI/CV dependencies and a Python 3.11 logging API. The available broad run is not a claim that the complete repository suite is green. |
| Nova `39c6aff5` | 236 bridge tests passed; compatibility with client `b4b0557` passed using the reviewed two-file test overlay | Promote the test corrections and verify the normal final-client suite as described above. |
| Humanoid `1fb043c4` with client `9be6207a` | 43 integration checks passed, including checked-in-settings launcher smoke | The launcher smoke stubs network loops. The earlier 21 standalone passes are inherited, not claimed as freshly rerun here. |
| Earlier client `b4b0557` / humanoid `6d0111a` | Eight isolated humanoid cases accepted | Lost failure reports, committed-response loss, held placement restart, safe retry/loss, two unknown/cancel holds, crash plus completion loss, and partial A/B/C. |
| Nova with client `b4b0557` | Three affected runtime controls accepted | Retry exhaustion/reconnect, callback-boundary restart, and readiness-false hold preservation. |
| Final client `9be6207a` / humanoid `1fb043c4` / Nova `39c6aff5` | Mixed order, Nova callback-boundary and humanoid held-placement controls accepted | These are the targeted final-version reruns; the older eight plus three cases were not silently re-attributed to the new client. |

The final mixed case proved the original failure trigger: humanoid completion, then `NO_TASK_FOR_DEVICE` while Nova was still pending, then Nova completion and exact shared-session readback, followed by humanoid availability without reconnect or repeated motion.

The final held-placement case confirmed the placement while the physical hold stayed active, with no next-task request or extra movement. The final Nova callback case persisted the original callback before availability and subsequent work.

Earlier failed or excluded fixture attempts remain excluded. A finished order alone was not enough for acceptance: identity, physical effects, reporting, readiness, inventory, source provenance and owned-process cleanup were checked. No real hardware validation or production deployment is claimed.

## 8. What merging will not fix

- The platform can leave partial/failed orders PREPARING with reservations or destinations held.
- Canonical terminal-report idempotency, concurrent session creation and failure-generation enforcement still need platform work.
- Local operator resolution does not repair cancelled-order platform confirmation or inventory.
- The humanoid harness has no operator-facing physical-hold resolver yet.
- Hardware motion, grasp/possession, navigation, VLA, calibration and physical safety behavior remain unvalidated.
- Browser-rendered replay QA, sustained console behavior, and the observed pricing/reload issues remain outside the accepted runtime claims.

See [the operator recovery recommendation](operator-recovery-recommendation-2026-09-24.md) for the proposed next feature.

## 9. Suggested review and eventual merge sequence

1. Review the four merge groups above and choose their destination branches.
2. Reconcile the existing client edits and root `.gitignore` without discarding them.
3. Integrate the cumulative client recovery branch; do not separately re-merge its predecessor.
4. Integrate Nova recovery with the reviewed test-fixture corrections and verify the normal suite against the chosen client.
5. Integrate the complete humanoid branch with the compatible client/source pins.
6. Package root tooling, requirements, documentation and selected evidence separately; keep runtime journals and databases out of source changes.
7. After the actual integration, verify the resulting checkout/pins and rerun the relevant smoke and recovery checks against that result. Retain the old acceptance records unchanged.

No merge command is supplied because the destination branches and reconciliation of existing edits are decisions still to be made.

## 10. Where to review the files

- [Readable file-by-file inventory](merge-review-file-inventory-2026-09-24.md): all non-evidence changed paths, with captured evidence grouped.
- [Complete machine-readable inventory](merge-review-file-inventory-2026-09-24.json): every tracked candidate path and inventoried root path, including individual verification files, current branch/base/status metadata and additional staged test corrections.
- [Master verification report](master-verification-report.md): complete issue/coverage ledger.
- [Client design and validation](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/docs/durable-failure-report-recovery.md>).
- [Nova recovery guide](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/RECOVERY.md>).
- [Humanoid runtime acceptance](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-integration/RUNTIME-ACCEPTANCE.md>).

Full candidate tips and bases are in the JSON inventory. Client docs tip `adf51339` and humanoid docs tip `cef2e87b` include the reviewed production versions; their later documentation commits did not change the accepted production bytes.

Git reported an unreadable `.pytest_cache` during inventory. That test cache is excluded from the review payload. All four new review artifacts are also excluded from the pre-existing change counts.
