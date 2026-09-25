# Merge review file inventory - 2026-09-24

Companion to [the merge review](merge-review-2026-09-24.md). Every changed source, test, configuration, tool and non-evidence documentation path is listed below. Captured verification trees are grouped by directory; every individual evidence path is retained in [the complete JSON inventory](merge-review-file-inventory-2026-09-24.json).

Status A means added, M means modified, and untracked means not committed. These are review candidates, not instructions to merge every file. Counts exclude the four new review artifacts themselves, ignored runtime state and test caches. Git could not read .pytest_cache; that cache is explicitly excluded. No merge target was selected and no merge was performed.

## platform-client

Branch codex/durable-failure-recovery; HEAD adf51339db90f75ee078d51bc8fba36148414d89; comparison merge-base 64dd9628d1b5a5d8e6d48951a01af64810281da6 from canonical dev.

Total: 95 paths; 14 listed individually below; 81 captured-evidence paths grouped afterward.

| Status | File |
|---|---|
| A | [docs/combined-recovery-validation-plan.md](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/docs/combined-recovery-validation-plan.md>) |
| A | [docs/combined-recovery-validation-results.md](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/docs/combined-recovery-validation-results.md>) |
| A | [docs/durable-completion-recovery.md](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/docs/durable-completion-recovery.md>) |
| A | [docs/durable-failure-report-recovery.md](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/docs/durable-failure-report-recovery.md>) |
| M | [hr_client/client.py](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/hr_client/client.py>) |
| M | [hr_client/config/hr_settings.json](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/hr_client/config/hr_settings.json>) |
| M | [hr_client/models.py](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/hr_client/models.py>) |
| A | [hr_client/pending_completion.py](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/hr_client/pending_completion.py>) |
| A | [hr_client/pending_failure.py](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/hr_client/pending_failure.py>) |
| M | [hr_client/settings.py](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/hr_client/settings.py>) |
| A | [tests/test_hr_failure_settings.py](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/tests/test_hr_failure_settings.py>) |
| M | [tests/test_hr_protocol.py](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/tests/test_hr_protocol.py>) |
| A | [tests/test_pending_completion.py](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/tests/test_pending_completion.py>) |
| A | [tests/test_pending_failure.py](<C:/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client/tests/test_pending_failure.py>) |

| Captured-evidence directory or file | Changed paths |
|---|---:|
| docs/verification/client-recovery | 9 |
| docs/verification/durable-failure-postfix | 16 |
| docs/verification/durable-failure-prefx | 13 |
| docs/verification/durable-failure-settings | 14 |
| docs/verification/mixed-peer-session | 15 |
| docs/verification/pending-replay-finalization | 4 |
| docs/verification/public-recovery-hold-prefx | 4 |
| docs/verification/startup-completion-recovery | 6 |

## nova5_ros2

Branch codex/nova-recovery-migration; HEAD 39c6aff523e95bc03a1db10bb854aec8746d0df9; comparison merge-base fe1e9d07ad2e16d1c46838cce63b65943b5261c8 from canonical nova5_vision_lebai_andy.

Total: 28 paths; 19 listed individually below; 9 captured-evidence paths grouped afterward.

| Status | File |
|---|---|
| M | [src/platform_bridge/config/platform_bridge.json](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/config/platform_bridge.json>) |
| A | [src/platform_bridge/platform_bridge/completion_recovery.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/platform_bridge/completion_recovery.py>) |
| M | [src/platform_bridge/platform_bridge/executor.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/platform_bridge/executor.py>) |
| M | [src/platform_bridge/platform_bridge/journal.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/platform_bridge/journal.py>) |
| M | [src/platform_bridge/platform_bridge/recover_execution.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/platform_bridge/recover_execution.py>) |
| M | [src/platform_bridge/platform_bridge/recovery.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/platform_bridge/recovery.py>) |
| M | [src/platform_bridge/platform_bridge/ros_node.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/platform_bridge/ros_node.py>) |
| M | [src/platform_bridge/platform_bridge/settings.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/platform_bridge/settings.py>) |
| M | [src/platform_bridge/README.md](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/README.md>) |
| A | [src/platform_bridge/RECOVERY_MIGRATION_BASELINE.md](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/RECOVERY_MIGRATION_BASELINE.md>) |
| A | [src/platform_bridge/RECOVERY_MIGRATION_PROPOSAL.md](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/RECOVERY_MIGRATION_PROPOSAL.md>) |
| A | [src/platform_bridge/RECOVERY.md](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/RECOVERY.md>) |
| A | [src/platform_bridge/test/test_completion_recovery.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/test/test_completion_recovery.py>) |
| M | [src/platform_bridge/test/test_diagnostic_trace.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/test/test_diagnostic_trace.py>) |
| M | [src/platform_bridge/test/test_executor.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/test/test_executor.py>) |
| A | [src/platform_bridge/test/test_journal_migration.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/test/test_journal_migration.py>) |
| M | [src/platform_bridge/test/test_journal.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/test/test_journal.py>) |
| M | [src/platform_bridge/test/test_recovery_cli.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/test/test_recovery_cli.py>) |
| M | [src/platform_bridge/test/test_recovery.py](<D:/Work/FPS/Robotics/end-to-end-sim/.local/nova5-recovery-worktree/src/platform_bridge/test/test_recovery.py>) |

| Captured-evidence directory or file | Changed paths |
|---|---:|
| src/platform_bridge/verification/recovery-migration | 9 |

## humanoid-harness

Branch codex/humanoid-platform-integration; HEAD cef2e87bc22f09eec1ce690c825bbd0cd416afc5; comparison merge-base 62158af5df09aa25f4c438737a3bd68afe2b849d from canonical main.

Total: 48 paths; 48 listed individually below; 0 captured-evidence paths grouped afterward.

| Status | File |
|---|---|
| M | [.gitignore](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/.gitignore>) |
| A | [docs/humanoid-harness/ADAPTERS.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-harness/ADAPTERS.md>) |
| A | [docs/humanoid-harness/FLOW.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-harness/FLOW.md>) |
| A | [docs/humanoid-harness/PLAN.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-harness/PLAN.md>) |
| A | [docs/humanoid-harness/README.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-harness/README.md>) |
| A | [docs/humanoid-harness/SOURCE_CONTRACTS.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-harness/SOURCE_CONTRACTS.md>) |
| A | [docs/humanoid-harness/VALIDATION.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-harness/VALIDATION.md>) |
| A | [docs/humanoid-integration/BASELINE-RUNS.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-integration/BASELINE-RUNS.md>) |
| A | [docs/humanoid-integration/CONTRACTS.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-integration/CONTRACTS.md>) |
| A | [docs/humanoid-integration/FAULT-CASES.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-integration/FAULT-CASES.md>) |
| A | [docs/humanoid-integration/PLAN.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-integration/PLAN.md>) |
| A | [docs/humanoid-integration/README.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-integration/README.md>) |
| A | [docs/humanoid-integration/RECOVERY-ADOPTION.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-integration/RECOVERY-ADOPTION.md>) |
| A | [docs/humanoid-integration/runtime-acceptance.json](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-integration/runtime-acceptance.json>) |
| A | [docs/humanoid-integration/RUNTIME-ACCEPTANCE.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-integration/RUNTIME-ACCEPTANCE.md>) |
| A | [docs/humanoid-integration/source-pin.json](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-integration/source-pin.json>) |
| A | [docs/humanoid-integration/VALIDATION.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/docs/humanoid-integration/VALIDATION.md>) |
| A | [humanoid_harness/__init__.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/__init__.py>) |
| A | [humanoid_harness/__main__.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/__main__.py>) |
| A | [humanoid_harness/adapters/__init__.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/adapters/__init__.py>) |
| A | [humanoid_harness/adapters/amr.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/adapters/amr.py>) |
| A | [humanoid_harness/adapters/humanoid_mover.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/adapters/humanoid_mover.py>) |
| A | [humanoid_harness/adapters/lift.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/adapters/lift.py>) |
| A | [humanoid_harness/adapters/perception.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/adapters/perception.py>) |
| A | [humanoid_harness/adapters/platform.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/adapters/platform.py>) |
| A | [humanoid_harness/adapters/vla.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/adapters/vla.py>) |
| A | [humanoid_harness/config.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/config.py>) |
| A | [humanoid_harness/controller.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/controller.py>) |
| A | [humanoid_harness/integration/__init__.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/integration/__init__.py>) |
| A | [humanoid_harness/integration/__main__.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/integration/__main__.py>) |
| A | [humanoid_harness/integration/executor.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/integration/executor.py>) |
| A | [humanoid_harness/integration/failure_attempts.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/integration/failure_attempts.py>) |
| A | [humanoid_harness/models.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/models.py>) |
| A | [humanoid_harness/README.md](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/README.md>) |
| A | [humanoid_harness/storage.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/storage.py>) |
| A | [humanoid_harness/stubs.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/stubs.py>) |
| A | [humanoid_harness/visual.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/humanoid_harness/visual.py>) |
| A | [tests/humanoid_harness/test_acceptance.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/tests/humanoid_harness/test_acceptance.py>) |
| A | [tests/humanoid_integration/__init__.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/tests/humanoid_integration/__init__.py>) |
| A | [tests/humanoid_integration/crash_driver.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/tests/humanoid_integration/crash_driver.py>) |
| A | [tests/humanoid_integration/failure_crash_driver.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/tests/humanoid_integration/failure_crash_driver.py>) |
| A | [tests/humanoid_integration/fixtures.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/tests/humanoid_integration/fixtures.py>) |
| A | [tests/humanoid_integration/held_placement_crash_driver.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/tests/humanoid_integration/held_placement_crash_driver.py>) |
| A | [tests/humanoid_integration/place_effect_crash_driver.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/tests/humanoid_integration/place_effect_crash_driver.py>) |
| A | [tests/humanoid_integration/postplace_crash_driver.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/tests/humanoid_integration/postplace_crash_driver.py>) |
| A | [tests/humanoid_integration/test_assigned.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/tests/humanoid_integration/test_assigned.py>) |
| A | [tests/humanoid_integration/test_executor.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/tests/humanoid_integration/test_executor.py>) |
| A | [tests/humanoid_integration/test_failure_adoption.py](<C:/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim/tests/humanoid_integration/test_failure_adoption.py>) |

## Root end-to-end-sim working changes

Uncommitted changes against 62158af5df09aa25f4c438737a3bd68afe2b849d. Review and package separately; do not bulk-add runtime state.

Total: 744 paths; 55 listed individually below; 689 captured-evidence paths grouped afterward.

| Status | File |
|---|---|
| M | [.gitignore](<D:/Work/FPS/Robotics/end-to-end-sim/.gitignore>) |
| untracked | [config/platform_bridge.sim.json](<D:/Work/FPS/Robotics/end-to-end-sim/config/platform_bridge.sim.json>) |
| untracked | [docs/3rd-party/atom.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/3rd-party/atom.md>) |
| untracked | [docs/3rd-party/nova-vision.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/3rd-party/nova-vision.md>) |
| untracked | [docs/3rd-party/platform.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/3rd-party/platform.md>) |
| untracked | [docs/3rd-party/README.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/3rd-party/README.md>) |
| untracked | [docs/combined-recovery-validation-plan.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/combined-recovery-validation-plan.md>) |
| untracked | [docs/combined-recovery-validation-results.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/combined-recovery-validation-results.md>) |
| untracked | [docs/decisions.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/decisions.md>) |
| untracked | [docs/environment-setup-log.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/environment-setup-log.md>) |
| untracked | [docs/failure-recovery-summary.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/failure-recovery-summary.md>) |
| untracked | [docs/first-order-runbook.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/first-order-runbook.md>) |
| untracked | [docs/first-order-test.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/first-order-test.md>) |
| untracked | [docs/implementation-plan.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/implementation-plan.md>) |
| untracked | [docs/master-verification-report.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/master-verification-report.md>) |
| untracked | [docs/non-platform-fix-handoff.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/non-platform-fix-handoff.md>) |
| untracked | [docs/non-platform-recovery-follow-up.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/non-platform-recovery-follow-up.md>) |
| untracked | [docs/nova5-failure-recovery-report.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/nova5-failure-recovery-report.md>) |
| untracked | [docs/partial-fulfillment-fix-plan.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/partial-fulfillment-fix-plan.md>) |
| untracked | [docs/partial-order-api-socketio-reproduction.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/partial-order-api-socketio-reproduction.md>) |
| untracked | [docs/review.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/review.md>) |
| untracked | [docs/socket-recovery-test-report.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/socket-recovery-test-report.md>) |
| untracked | [docs/wsl-environment.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/wsl-environment.md>) |
| untracked | [docs/wsl-setup-proposal.md](<D:/Work/FPS/Robotics/end-to-end-sim/docs/wsl-setup-proposal.md>) |
| untracked | [patches/coffee-platform-admin-devices-socket-snapshot.patch](<D:/Work/FPS/Robotics/end-to-end-sim/patches/coffee-platform-admin-devices-socket-snapshot.patch>) |
| untracked | [requirements/live-simulator.in](<D:/Work/FPS/Robotics/end-to-end-sim/requirements/live-simulator.in>) |
| untracked | [requirements/live-simulator.lock](<D:/Work/FPS/Robotics/end-to-end-sim/requirements/live-simulator.lock>) |
| untracked | [requirements/platform-bridge.in](<D:/Work/FPS/Robotics/end-to-end-sim/requirements/platform-bridge.in>) |
| untracked | [requirements/platform-bridge.lock](<D:/Work/FPS/Robotics/end-to-end-sim/requirements/platform-bridge.lock>) |
| untracked | [sim_ros/__init__.py](<D:/Work/FPS/Robotics/end-to-end-sim/sim_ros/__init__.py>) |
| untracked | [sim_ros/bread_pick_sim_core.py](<D:/Work/FPS/Robotics/end-to-end-sim/sim_ros/bread_pick_sim_core.py>) |
| untracked | [sim_ros/fake_bread_pick_service.py](<D:/Work/FPS/Robotics/end-to-end-sim/sim_ros/fake_bread_pick_service.py>) |
| untracked | [tests_ros/test_fake_bread_pick_service_args.py](<D:/Work/FPS/Robotics/end-to-end-sim/tests_ros/test_fake_bread_pick_service_args.py>) |
| untracked | [tests/test_bread_pick_sim_core.py](<D:/Work/FPS/Robotics/end-to-end-sim/tests/test_bread_pick_sim_core.py>) |
| untracked | [tests/test_export_socket_recovery_evidence.py](<D:/Work/FPS/Robotics/end-to-end-sim/tests/test_export_socket_recovery_evidence.py>) |
| untracked | [tests/test_local_sim_console_support.py](<D:/Work/FPS/Robotics/end-to-end-sim/tests/test_local_sim_console_support.py>) |
| untracked | [tests/test_local_sim_console.py](<D:/Work/FPS/Robotics/end-to-end-sim/tests/test_local_sim_console.py>) |
| untracked | [tests/test_local_sim_runtime.py](<D:/Work/FPS/Robotics/end-to-end-sim/tests/test_local_sim_runtime.py>) |
| untracked | [tests/test_nova_post_dispatch_cancellation.py](<D:/Work/FPS/Robotics/end-to-end-sim/tests/test_nova_post_dispatch_cancellation.py>) |
| untracked | [tests/test_nova5_socket_recovery_harness.py](<D:/Work/FPS/Robotics/end-to-end-sim/tests/test_nova5_socket_recovery_harness.py>) |
| untracked | [tests/test_socketio_fault_proxy.py](<D:/Work/FPS/Robotics/end-to-end-sim/tests/test_socketio_fault_proxy.py>) |
| untracked | [tools/bridge_websocket_transport_entrypoint.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/bridge_websocket_transport_entrypoint.py>) |
| untracked | [tools/export_socket_recovery_evidence.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/export_socket_recovery_evidence.py>) |
| untracked | [tools/generic_client_recovery_entrypoint.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/generic_client_recovery_entrypoint.py>) |
| untracked | [tools/generic_client_recovery_harness.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/generic_client_recovery_harness.py>) |
| untracked | [tools/local_sim_console_support.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_console_support.py>) |
| untracked | [tools/local_sim_console.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_console.py>) |
| untracked | [tools/local_sim_runtime.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_runtime.py>) |
| untracked | [tools/nova5_domain68_provider_probe.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/nova5_domain68_provider_probe.py>) |
| untracked | [tools/nova5_executor_domain68_probe.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/nova5_executor_domain68_probe.py>) |
| untracked | [tools/nova5_socket_recovery_harness.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/nova5_socket_recovery_harness.py>) |
| untracked | [tools/partial_order_socketio_proof.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/partial_order_socketio_proof.py>) |
| untracked | [tools/recovery_api_runtime.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/recovery_api_runtime.py>) |
| untracked | [tools/ros_bread_pick_status_observer.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/ros_bread_pick_status_observer.py>) |
| untracked | [tools/socketio_fault_proxy.py](<D:/Work/FPS/Robotics/end-to-end-sim/tools/socketio_fault_proxy.py>) |

| Captured-evidence directory or file | Changed paths |
|---|---:|
| docs/verification/2026-09-18-api-socketio-order.json | 1 |
| docs/verification/2026-09-18-api-socketio-startup-race.json | 1 |
| docs/verification/2026-09-18-middleware-order.json | 1 |
| docs/verification/2026-09-18-nova-failure-baseline.json | 1 |
| docs/verification/2026-09-18-nova-failure-executor-probe.json | 1 |
| docs/verification/2026-09-18-nova-failure-provider-probe.json | 1 |
| docs/verification/2026-09-18-nova-isolated-tests.json | 1 |
| docs/verification/2026-09-18-protocol-order.json | 1 |
| docs/verification/2026-09-18-recovery-baseline.json | 1 |
| docs/verification/2026-09-18-recovery-middleware.json | 1 |
| docs/verification/2026-09-18-recovery-order.json | 1 |
| docs/verification/2026-09-22-client-replay-finalization | 5 |
| docs/verification/2026-09-22-client-startup-recovery | 7 |
| docs/verification/2026-09-22-combined-nova-client-recovery | 591 |
| docs/verification/2026-09-22-non-platform-recovery | 45 |
| docs/verification/2026-09-22-nova-migration-commit.json | 1 |
| docs/verification/2026-09-22-socket-recovery | 26 |
| docs/verification/2026-09-22-socket-recovery-api-baseline.json | 1 |
| docs/verification/2026-09-22-socket-recovery-baseline.json | 1 |
| docs/verification/2026-09-22-socket-recovery-cleanup.json | 1 |

## Additional staged test-fixture review

These two staged modules were used for the qualified Nova compatibility run. They are outside the tracked candidate counts. Promote the helper behavior deliberately; do not copy its temporary overlay import into the normal suite.

- src/platform_bridge/test/test_platform_completion_e2e.py: [test_platform_completion_e2e_overlay.py](<C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/nova-durable-failure-compat-b4b0557/test-overlay/test_platform_completion_e2e_overlay.py>). Promote per-test report-store isolation and accurate fake failure acknowledgment into original helper, then validate normal suite.
- src/platform_bridge/test/test_recovery_replay.py: [test_recovery_replay_overlay.py](<C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/nova-durable-failure-compat-b4b0557/test-overlay/test_recovery_replay_overlay.py>). Keep original helper import in normal branch; no substantive replay-test edit is required solely to copy this overlay.

## Excluded runtime state

- Test caches including .pytest_cache/
- Client .local/ directories and pending-completions journals
- Nova src/platform_bridge/pending-completions.json
- Root .local/ runtimes and staged source trees
- Humanoid .humanoid-runs/ live state; retain accepted evidence separately
