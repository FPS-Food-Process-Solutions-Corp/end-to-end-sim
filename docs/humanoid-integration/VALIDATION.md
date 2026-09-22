# Humanoid integration validation

Date: 2026-09-22. Branch: `codex/humanoid-platform-integration`, based on standalone commit `02fabbec015d9444ece79ec38c089e69ec1faeaa`.

## Local acceptance

**16 integration tests and all 21 existing standalone tests pass.** These are isolated tests; they do not establish an actual platform order result. Integration tests import the pinned real client's public context, outcome, identity and completion queue classes, while using fresh local simulator fixtures. No service, network, device or package installation was involved.

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
| Failure policy | Known safe failure reports FAILED with next-task readiness false; unknown effect preserves unresolved ownership. |
| Recovery | Child process exits after a durable place effect before proof; a fresh process recovers through the public queue with exactly one pick and place. |
| Cancellation | Cleanup timeout cannot orphan an unguarded worker; late physical effects remain held and the device lock stays protected. |
| Startup and corruption | Unresolved owner gates client startup; corrupt/stale/mismatched proof cannot become completion. |
| Launcher | Inert client composition starts/stops without hardware or service calls in the local lifecycle test. |

Five new test files and all four changed production Python files pass ASCII, syntax and module-level-import checks. Independent Sol review reran all 16 integration tests and cleared the code for the controlled happy runtime stage. The integration uses the real client source at documentation HEAD `e6766e8319c9a6a832e8f058135a9d52b869a7c2`; `client.py` SHA256 is `65bc9effd3c11241517aad58290d109a67f6c792c165c286013267772a91d777`.

## Actual platform acceptance

Pending the sole runtime owner's controlled runs at this local-validation checkpoint. The required first gate is a fresh real Rack B order reaching READY with verified assigned-counter placement and exactly-once stock/action effects. Later gates cover faults, acknowledgment loss, placement-before-return restart, cancellation/unknown holds, partial settlement constraints and mixed Nova/Rack A plus humanoid/Rack B routing.

The client task's Sol `/root/sol_combined_harness` alone owns services, fresh databases, process provenance and cleanup. Case artifacts belong beneath `.humanoid-runs/integration/`. Historical seed state and the sealed prior combined-recovery evidence remain untouched. Actual failures and external platform limitations must be retained here when observed, rather than replaced with an assumed passing outcome.

## Assurance limits

Local passing tests demonstrate software contracts and simulated physical recovery only. They do not demonstrate a live platform READY transition until the actual runs are recorded. No hardware, camera, VLA policy endpoint or calibrated motion is exercised. Persistent physical holds have no manual resolver. Known safe failure also pauses later assignment requests after reporting failure; automatic continuation of the remaining order after that failure is deferred. The known real platform partial-order settlement and cancellation-accounting defects remain outside this task's source-edit scope.
