# E2E integration and verification - 2026-09-25

The humanoid harness and the existing root simulation package are integrated on `codex/e2e-humanoid-integration`. The three maintained real-platform simulation controls passed against the canonical merged client and Nova repositories. The tested executable source is `390dc83d39166d14adb84f96a7e0e7d323aa2c47`; subsequent documentation and evidence packaging do not change that code.

Use the [acceptance runbook](e2e-acceptance-runbook.md) for copyable commands. The [curated machine-readable summary](verification/e2e-integration-2026-09-25/summary.json) records exact source hashes, case identities, evidence paths and retained unsuccessful attempts.

## What is ready to review

| Item | Change and reason |
|---|---|
| Harness branch integration | The cumulative humanoid feature at `cef2e87` is included, along with the root tools, configuration, requirements, tests and documentation. Integration started from `main` at `62158af`; `codex/pre-humanoid-integration-20260925` preserves that original tip. The subsequent main merge is recorded below. |
| Client source checks | Four imported client modules must come from the selected source root and match reviewed SHA-256 values after CRLF-to-LF normalization. Raw hashes are also recorded. Equivalent Windows/Linux line endings work; substantive edits or another checkout are rejected. |
| Maintained acceptance runner | `tools/run_e2e_acceptance.py` runs the mixed-order, Nova callback-boundary and held-placement restart controls with explicit source roots, fresh state/database names, local ports and ROS domain. Its active path no longer depends on ignored legacy driver scripts. |
| Audits and recovery cases | `tools/e2e_mixed_audit.py` preserves the exact mixed-device chronology and physical/inventory assertions. `tools/e2e_held_placement_case.py` preserves the crash, recovery and persistent-hold assertions. |
| Nova test support | Current and historical source profiles are explicit. The current profile uses canonical Nova/client code, captures their source and verifies the loaded modules. The bridge wrapper reports all four guarded client modules. Historical captures remain unchanged. |
| Simulated ROS entry point | The fake provider refuses to initialize ROS unless `ROS_LOCALHOST_ONLY=1` and an explicit ASCII-decimal domain from 1 through 232 are supplied. Existing isolated profiles remain supported. |
| Owned process cleanup | Children are registered before startup. The API helper terminates and reaps a newly spawned child if start-time capture or ownership-manifest writing fails. It preserves existing processes and databases. |
| Environment handling | Child launches preserve the configured virtual-environment executable path. Dependency checks run before database creation. WSL Git trust is scoped to explicitly selected repositories for the invocation, with no global Git configuration change. |
| Source and evidence packaging | Ignore rules retain local runtime state and raw archives outside source commits. Curated manifests and selected test reports are included, with explicit Git attributes preserving their bytes across Windows/Linux checkouts. Root and active harness guides now use canonical sources; historical run records keep their original attribution. |

All implementation changes in this integration are in `end-to-end-sim`. The client remains on `dev` at `adf51339db90f75ee078d51bc8fba36148414d89`; Nova remains on `nova5_vision_lebai_andy` at `4055912c72a90e841b79cbc93852fe9cc807927a`. Their earlier merges are documented in [the September 24 record](merge-execution-2026-09-24.md).

The tests reused the prepared compiled API stage. No canonical `coffee-platform` source was modified and no platform patch was applied during this integration. The prepared stage has its own recorded history; these results are not a claim that an arbitrary fresh canonical API build has been tested.

## Three accepted runtime controls

| Control and retained run | What passed |
|---|---|
| Mixed order: `mixed-positive-final-05` | Humanoid completion ACK at 22:31:54.447Z, humanoid NO_TASK at 22:31:54.471Z, Nova terminal at approximately 22:32:04.159Z, exact session readback at 22:32:08.052Z, and humanoid FREE at 22:32:08.053Z. No reconnect occurred before FREE. Both exact tasks and the order completed; there was one Nova start, one humanoid placement, and stock changed from 6 to 5 and 8 to 7. The strict audit remained equal after normal client shutdown. |
| Nova callback restart: `nova-callback-01` | The original completion was confirmed before the bridge callback finished. After interruption/restart, callback replay sent zero additional completion reports. A separate follow-up order succeeded: two reports and two distinct executions total, with stock changing from 6 to 4. |
| Held placement restart: `held-placement-02` | Exit 78 occurred after verified placement and durable hold, before completion queueing. Restart confirmed the saved placement once while preserving the hold. There were zero next-task requests, 178 admin PAUSED observations and zero FREE observations. Physical effects were unchanged and stock settled once, from 8 to 7. |

All three use the tested root source `390dc83`. Each checked 338 captured source files with zero changes, stopped its owned API successfully and left no listeners on its reserved test ports. Run databases and raw evidence remain local. The summary supplies artifact paths and hashes; the source commit does not contain every raw capture.

An earlier mixed success, `mixed-positive-04`, was independently read and confirmed, then repeated on the final shared runner. Its raw status label `case_complete_pending_independent_audit` is preserved as captured; the separate review does not rewrite that file.

## Software checks

| Group | Result |
|---|---|
| Complete humanoid software suite | 68 passed: 21 standalone and 47 integration checks, using the existing WSL Python 3.10 environment. |
| Focused source-pin checks | 5 passed, including equivalent line endings and refusal of wrong/changed source. |
| Three-case runner support suite | 36 passed; an earlier no-ROS support selection had 31 passes. |
| Existing root tool selection | 46 passed. |
| Fake-provider isolation and argument checks | 10 passed. |
| Mixed audit checks | 9 passed. |
| Held-placement case checks | 9 passed. |
| API partial-start cleanup checks | 6 passed. |
| Additional isolated controls | Console observer: 1 passed in its existing live-simulator environment. Bridge cancellation control: 1 passed. |

These groups overlap and must not be added into a claimed unique test total. They ran at their respective component-integration stages; all three final runtime controls ran on `390dc83`. Selected JUnit reports are indexed in the summary. Initial attempts lacking the appropriate console dependency or sourced ROS overlay are retained locally; the applicable checks subsequently passed in their prepared environments. This was not a fresh full-suite run of every sibling repository.

## Attempts retained and fixes they prompted

| Attempt | Observation and response |
|---|---|
| `mixed-positive-01` | WSL root Git ownership refusal, before database or service work. Added narrowly scoped repository trust for the invocation. |
| `mixed-positive-02` | The runner resolved the virtual-environment Python symlink to system Python, so child imports failed after bootstrap. Preserved the configured executable path and added early dependency checks. Owned cleanup passed. |
| `mixed-positive-03` | Both tasks completed, but Nova finished first. The required humanoid-NO_TASK-before-Nova-terminal trigger never occurred, so the strict audit correctly rejected it. Increased the simulated Nova delay from 5 to 15 seconds; assertions were not relaxed. |
| `held-placement-01` | Requested ports were unavailable before database or service work. Retried with fresh state/database names and another free port range. |

The runtime review also found and fixed the missing Nova source-identity fields and both partial-start cleanup gaps before final acceptance. Failed attempts, raw labels and historical source captures were not relabeled as passing.

## Remaining limits and next steps

Following review, the user authorized the local merge. `end-to-end-sim/main` was fast-forwarded from `62158af` to `0c9e81d78a0c06ff7c40c92851599e1c0bb94e90` on September 25; the original tip remains preserved by `codex/pre-humanoid-integration-20260925`. No remote push or deployment was performed. Subsequent operator-recovery work starts on the separate `codex/operator-recovery` branch. The separate platform status patch remains a handoff artifact, not a canonical platform change.

The unchanged platform's partial-order settlement, cancellation-accounting and terminal-replay limitations remain. The held-placement control deliberately preserves a physical hold; there is still no general humanoid operator-resolution workflow. See [the operator recommendation](operator-recovery-recommendation-2026-09-24.md).

The selected software and real-API simulation controls do not validate physical AMR/VLA/mover behavior, calibrated reachability, camera/perception quality, real stopping or hardware exactly-once execution. Browser-rendered frontend behavior was not tested in this integration. The earlier [frontend runbook](first-order-runbook.md) still describes its narrower staged Nova scenario.
