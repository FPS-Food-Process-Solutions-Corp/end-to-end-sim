# Humanoid integration validation

Date: 2026-09-22. Branch: `codex/humanoid-platform-integration`, based on standalone commit `02fabbec015d9444ece79ec38c089e69ec1faeaa`.

## Local acceptance

**32 integration tests and all 21 existing standalone tests pass** with the held-placement crash hook. The initial `da0f09fd8564e0e5472f2c7144b076759bd1a96f` checkpoint had 16 integration tests; the accepted device-readiness baseline `597ec2c` had 29. These isolated tests do not establish an actual platform order result. Integration tests import the pinned real client's public context, outcome, identity and completion queue classes, while using fresh local simulator fixtures. No service, network, device or package installation was involved.

Integration command inside the existing Ubuntu-22.04 environment:

```bash
PYTHONPATH=/mnt/c/Users/andyl/.codex/worktrees/dfcb/platform-client:/mnt/c/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim /home/user/.venvs/end-to-end-sim-ros/bin/python -m unittest discover -s tests/humanoid_integration -p 'test_*.py' -q
```

Standalone command from this worktree on Windows:

```powershell
& 'C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -m unittest discover -s tests/humanoid_harness -p 'test_*.py' -q
```

| Boundary | Local evidence |
| --- | --- |
| Assigned execution | Stops at physical proof without local platform reports, task selection or front-idle motion. |
| Public client seam | Actual `TaskContext`, `PickExecutionOutcome`, `CompletionIdentity`, awaited progress and public pending completion queue. |
| Identity | Rejects changed order/session/task/counter or item/source slot; retry metadata does not repick a completed unit. |
| Counter 4 | Real `LocationTable` loads the simulation overlay; original relative trajectory references remain valid after relocation. |
| Safe failure | Exact no-effect source evidence, empty-hand/stocked-rack observation and bounded travel recovery precede FAILED with readiness true. Unknown/collision/cancel evidence holds. |
| Current device readiness | New units inherit the latest verified robot state. B failure, C success, then B retry preserves C's current release and adds no B motion. Corrupted release pointer, posture or source fails closed. |
| Placement and readiness | Verified placement survives an unsafe post-place recovery as COMPLETED with readiness false and a hold. Same-identity delivery cannot clear an explicit hold. |
| Recovery | Child process exits after a durable place effect before proof; a fresh process recovers through the public queue with exactly one pick and place. |
| Held-placement crash | Real child exits 78 only after exact placement proof, durable HOLD and unknown readiness, before returning its executor outcome; no pending-completion file exists. A fresh executor seeds that proof into a test receiver for the public recovery method, and the startup helper rejects the retained hold; the device still has one place effect. A separate fresh child with an existing one-shot marker returns COMPLETED with readiness false and leaves the marker unchanged. Default mode and unknown pick without placement cannot trigger the hook. These isolated children do not construct a real client or connect to the platform. |
| Cancellation | Cleanup timeout cannot orphan an unguarded worker; late physical effects remain held and the device lock stays protected. |
| Startup and corruption | Unresolved owner gates client startup; corrupt/stale/mismatched proof cannot become completion. |
| Launcher | Inert client composition starts/stops without hardware or service calls in the local lifecycle test. |

For the baseline, all eight integration test source files and the five changed production files passed ASCII, syntax and module-level-import checks; independent Sol review reran both suites with 29/29 and 21/21 passing. The hook revision adds a ninth integration test source file. Its test owner ran the complete suites with 32/32 and 21/21 passing and checked all nine test files for ASCII, syntax and module-level imports. The production owner checked compilation and standalone tests; independent source review cleared the two changed production files and confirmed ASCII and a clean diff. The integration still uses the real client source at documentation HEAD `e6766e8319c9a6a832e8f058135a9d52b869a7c2`; `client.py` SHA256 is `65bc9effd3c11241517aad58290d109a67f6c792c165c286013267772a91d777`.

Hard-stop regressions cover failure-retract effects, placement before physical proof, post-place retract effects, placement before client queueing, and verified placement after entering a physical hold. Eligible ACTIVE recovery reconciles exact saved actions, completes the bounded safe-release sequence and verifies one physical place. A persisted explicit hold cannot use that recovery to clear itself. The exit-78 hook and its local tests do not establish reporting while held with the baseline client; [RECOVERY-ADOPTION.md](RECOVERY-ADOPTION.md) records the agreed new-client design and remaining acceptance.

## Actual platform acceptance

**The real Rack B happy case is accepted**, along with two baseline failure-report characterizations on production commit `597ec2c21da1540e11ebd999d3552f84f9859a3c` and the unchanged client above. Order A008 reached READY on counter 2 with exactly one pick, place and post-place retract; database stock changed 8 to 7 and the client confirmed completion in one attempt. See [BASELINE-RUNS.md](BASELINE-RUNS.md) for exact identities, source pins, audits, unsuccessful attempts and cleanup.

The baseline failure cases demonstrate missing durable failure-report recovery while preserving physical effects. They are not acceptance of the future client fix. Fixed-client reruns, held-placement reporting after restart, the remaining fault cases and mixed Nova/Rack A plus humanoid/Rack B routing remain pending.

Two fixture attempts stopped before any API, proxy or humanoid launcher started and before any order was created. They are not platform acceptance runs. Their fresh cloned databases and evidence remain retained:

| Attempt | Database | Result and evidence |
| --- | --- | --- |
| `happy-01` | `taska_20260922_humanoid_happy_01` | Linux Git could not resolve the Windows worktree pointer. The fixture was corrected to pass converted Git/worktree paths explicitly. Evidence: `.humanoid-runs/integration/happy-01/driver-error.json`, `driver-events.jsonl`, `cleanup.json`. |
| `happy-02` | `taska_20260922_humanoid_happy_02` | The fixture logger received a duplicate `path` argument while recording settings. Evidence: the corresponding files under `.humanoid-runs/integration/happy-02/`, plus a full pre-run source capture. |

Before the readiness correction, the sole owner confirmed that `happy-03` had not yet created a database, evidence directory, service or order. Its temporary offline preflight was console-only, with no retained report. The actual `happy-03` run occurred afterward on the reviewed `597ec2c` pin. The mistimed `failure-drop-01` attempt is also retained and excluded from the post-exhaustion checkpoint claim, as detailed in the baseline report.

The client task's Sol `/root/sol_combined_harness` alone owns services, fresh databases, process provenance and cleanup. Case artifacts belong beneath `.humanoid-runs/integration/`. Historical seed state and the sealed prior combined-recovery evidence remain untouched. Actual failures and external platform limitations must be retained here when observed, rather than replaced with an assumed passing outcome.

The following matrix separates accepted baseline evidence from work still pending:

| Case | Required evidence |
| --- | --- |
| Happy Rack B | Accepted in `happy-03`: READY, counter 2, one pick/place/retract, verified release, stock decrease of one. |
| Safe retries and confirmed loss | Separate bounded navigation, VLA and full-cycle budgets; stable IDs for reconciliation, new IDs only for authorized physical attempts; exact successful placement and inventory effects. |
| Completion acknowledgment loss | Real client pending queue/readback/reconnect settles the exact completion; no additional physical pick or place. |
| Placement before client queue, then restart | A real process stop after a durable place; restart preserves placement and verifies safe release; public client recovery queue settles once. |
| Held-placement reporting restart | Pending new public client seam: recover an exact placed pastry's report while retaining PAUSED and the durable physical hold; no FREE status, next-task request or additional motion. |
| Physical uncertainty and cancellation | Persistent hold, no unjustified terminal failure/success, no dependent motion; same-identity redelivery cannot clear a safety hold. |
| Partial A/B/C | A completes; B exhausts known no-effect attempts and recovers safely; C completes before B's platform retry; B is not picked again. Preserve the platform's terminal failed task, unconsumed failed reservation and PREPARING order if observed. |
| Lost outbound failure report | Baseline `failure-drop-02` characterization accepted. Fixed-client rerun remains pending with a separate pin and fresh fixture. |
| Committed failure with lost responses | Baseline `failure-commit-01` characterization accepted. Fixed-client acceptance/readback and reporting holds remain to be tested. |
| Mixed Rack A and Rack B | One real mixed order routes through the pinned Nova bridge and humanoid executor; verify device-specific execution counts, assigned counter, stock deltas and settlement. |

Each actual case must retain source and compiled API/configuration provenance, fixture baseline, exact order/session/task identities and retry generations, physical action evidence, client pending records, platform readback, failures, owned process identities and cleanup results. A process exit code alone cannot satisfy any row.

## Assurance limits

Local tests demonstrate software contracts and simulated physical recovery; the accepted happy run additionally demonstrates an actual platform READY transition. No hardware, camera, VLA policy endpoint or calibrated motion is exercised. Persistent physical holds have no manual resolver. The known real platform partial-order settlement and cancellation-accounting defects remain outside this task's source-edit scope. Failure-report durability belongs to the client recovery work and must be assessed separately from those platform limitations.

The initial checkpoint persisted a separate world per unit and ended successful placement at symbolic `SIM_POSE_PLACE_DONE`, without a current device-level travel-readiness proof. Review identified this as insufficient for continuing physical work. The revision adds a versioned latest device release, current-readback validation, carry-forward of robot state and verified post-place travel recovery. Historical failure proof remains separate from current readiness. Shared physical sensors, calibrated safe postures and actual motion clearance remain requirements for a hardware adapter, not claims established by these simulations.
