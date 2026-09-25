# First software-only order runbook

Follow the acceptance criteria in [first-order-test.md](first-order-test.md). This runbook controls only the already prepared Linux-home staging copy and the dedicated `coffee_platform_sim` database. It does not alter the original sibling checkout.

The completed direct-protocol evidence is in [2026-09-18-protocol-order.json](verification/2026-09-18-protocol-order.json), and the completed middleware evidence is in [2026-09-18-middleware-order.json](verification/2026-09-18-middleware-order.json).

For the combined component coverage, applied local fixes, and remaining software and hardware limits, see the [master verification report](master-verification-report.md).

Start the final bridge-mode services with one command from Windows PowerShell:

```powershell
wsl.exe -d Ubuntu-22.04 -u user -- /usr/bin/python3 /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_runtime.py start --mode bridge
```

Check process identity and log locations:

```powershell
wsl.exe -d Ubuntu-22.04 -u user -- /usr/bin/python3 /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_runtime.py status --mode bridge
```

The launcher runs the staged API's compiled `dist/main.js`, avoiding development watch restarts during a test. Its stage-only REST readiness patch is recorded in [coffee-platform-admin-devices-socket-snapshot.patch](../patches/coffee-platform-admin-devices-socket-snapshot.patch). The API retains the latest gateway connection snapshot, so its REST device view changes from Nova5 Ready to offline when the bridge disconnects and back to Ready after it reconnects.

Read one labeled service log:

```powershell
wsl.exe -d Ubuntu-22.04 -u user -- /usr/bin/python3 /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_runtime.py logs bridge
```

Open the real kiosk at `http://127.0.0.1:3000/kiosk/menu` and the real admin UI at `http://127.0.0.1:3000/admin`. In bridge mode, the labeled API, bridge, and fake ROS provider logs are the execution evidence.

For this snack-only scenario, use the admin **Devices** view as the readiness signal: **Pick ready** and **NOVA5 Free / Online / Ready** with one HR connection indicate the supported path is available. The broader Orders page can still show Robot offline and Brew not ready because Atom and the brew workcell are deliberately outside this simulation.

Submit one Butter Croissant through the kiosk, using mock payment. The bridge maps the actual `croissant` item ID and counter areas 1 through 3 to the local fake ROS provider, which reports a simulated controller outcome after two seconds. This is a middleware protocol test; it does not command hardware, motion planning, vision, or a physical delivery.

Open the read-only terminal observer in a visible Linux terminal:

```powershell
wsl.exe -d Ubuntu-22.04 -u user -- /home/user/.venvs/coffee-platform-live-sim/bin/python /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_console.py --runtime-dir /home/user/e2e-stage/runtime --journal /home/user/e2e-stage/runtime/ros/platform_bridge_journal.json
```

The observer only reads the manifest, logs, and journal; it cannot start, stop, restart, or signal a process. Direct protocol mode and the ROS bridge mode are mutually exclusive: stop the direct simulator before starting the bridge so that only one client uses `nova5_arm`. The optional direct mode uses `start --mode direct` and its event console on port 8770; it is not middleware evidence.

After the bridge reports the pick complete and the order is Ready, use the admin order Complete control to record the customer collection and release its counter. Select Backup mode if the admin UI asks for it. Do not use an admin action to bypass a pending pick task.

Stop all staged services with one command:

```powershell
wsl.exe -d Ubuntu-22.04 -u user -- /usr/bin/python3 /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_runtime.py stop
```

The runtime manifest is `/home/user/e2e-stage/runtime/processes.json`. It records each PID and Linux process start-time tick to prevent accidental control of a reused PID. Logs stay under `/home/user/e2e-stage/runtime`.

The staging copy uses the pinned Node runtime, hash-locked Python dependencies, and a non-editable minimal copy of the Platform client under `/home/user/e2e-stage/platform-client`; it never runs from the original sibling checkout. The supported fake provider maps counters 1, 2, and 3 only. Counter 4 is intentionally rejected, and coffee tasks, Atom workflows, native Nova motion, vision, and physical delivery remain outside this simulation.

An optional deterministic partial-result diagnostic can run the provider with `success,failed,failed`: the first distinct pick succeeds, while the second task and its one platform retry report `NO_DETECTION`. The managed launcher refuses to change that selection under a live provider, and normal startup keeps the safe `success` default. The observed A004 behavior, required evidence capture, cleanup result, and the distinction from isolated bridge mocks are recorded in [failure-recovery-summary.md](failure-recovery-summary.md).

The kiosk currently displays a tax-inclusive cart value of $4.63 for the $4.25 croissant, while the saved mock-payment order total is $4.25. This existing checkout discrepancy is recorded for follow-up and was not changed for the simulation test.

After a managed restart, a full reload of `/kiosk/status` can briefly show No active order before client rendering restores the Ready order. The development log records a React hydration mismatch in `KioskOrderStatusView`, `StatePanel`, and `LoadingOverlay`; the API order and inventory state remain unchanged. Treat the restored client view and API order record as the evidence until this existing frontend reload issue is fixed.
