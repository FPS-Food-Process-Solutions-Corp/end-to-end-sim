# Repository review snapshot

Reviewed on 2026-09-18 for the proposed pastry-ordering end-to-end simulator. This folder contains review notes, not an implementation. The attached brief describes desired behavior; observed behavior is identified separately and linked to source files.

The source repositories were inspected in place. During this initial review, no application code, dependency installations, database contents, or hardware settings were changed. No application stack or hardware was started. A read-only environment check started the existing WSL distribution. The subsequently authorized base environment installation is recorded separately in the [setup log](../environment-setup-log.md).

- [Review, proposed plan, and questions](../review.md)
- [Master verification report](../master-verification-report.md)
- [User decisions and terminology](../decisions.md)
- [Detailed implementation milestones and acceptance criteria](../implementation-plan.md)
- [Proposed WSL base installation commands](../wsl-setup-proposal.md)
- [Using the WSL base environment](../wsl-environment.md)
- [Platform API and platform-client](platform.md)
- [Nova-5, bun-coordinate-server, and robo-cvstudio](nova-vision.md)
- [AIO GUI and AtomW-VLA](atom.md)

| Brief name | Actual sibling repository | HEAD at review | Working-copy note |
| --- | --- | --- | --- |
| coffee_platform | coffee-platform | `0c36efa` | No tracked modifications reported |
| vision-platform-client | platform-client | `64dd962` | Existing changes in README.md, docs/SPEC.md, hr_client/client.py, pyproject.toml, and tests/test_hr_protocol.py were included in the review |
| nova5_ros2 | nova5_ros2 | `fe1e9d0` | No tracked modifications reported |
| bun-coordinate-server | bun-coordinate-server | `d7ccb3e` | Existing changes in PICK_CELL_PIPELINE_TEST_GUIDE.md, PICK_CELL_RECOVERY_GUIDE.md, and PICK_CELL_TRACE_GUIDE.md were included in the review |
| robo-cvstudio | robo-cvstudio | `a89ea77` | No tracked modifications reported |
| aio_atom-w_gui | aio_atom-w_gui | `574d9ca` | No tracked modifications reported |
| AtomW-VLA | AtomW-VLA | `2b37935` | No tracked modifications reported |

Commit hashes identify the base snapshot, not the entirety of repositories with working-copy changes. Untracked files were not included in the status summary. Source line numbers in the companion notes refer to the current working files and can change.

## Environment observations at review time

These observations precede the authorized base environment installation. See the [setup log](../environment-setup-log.md) for installation results and the [environment guide](../wsl-environment.md) for current usage.

- Windows has an existing `Ubuntu-22.04` WSL 2 distribution. Its OS is Ubuntu 22.04.5 LTS, x86_64.
- WSL has Python 3.10.12, g++, and uv. No `/opt/ros` installation was found, and `ros2`, `colcon`, `cmake`, Linux `node`, Docker, and Podman were not found by the environment checks. An `npm` path inherited from Windows does not establish a usable Linux Node environment.
- WSL exposes `/dev/dxg` and an X11 display socket. These indicate WSL graphics integration is present; rendering and GPU workloads have not been tested.
- WSL reported approximately 940 GB free in its Linux filesystem and 3 TB on D:. These values are transient.
- Windows has Node/npm, pnpm, uv, and Git discoverable on PATH. Neither a Windows Python command nor Docker/Podman was discovered on PATH by this check.
- No packages were installed, services launched, tests executed, or robot connections attempted. Runtime feasibility remains to be verified through a later build and isolated smoke test.

## External feasibility references

- [ROS 2 Humble target platforms](https://docs.ros.org/en/humble/Releases/Release-Humble-Hawksbill.html): Ubuntu 22.04 is a supported target.
- [ros2_control Humble mock components](https://control.ros.org/humble/doc/ros2_control/hardware_interface/doc/mock_components_userdoc.html): ideal command-to-state mirroring supports controller integration testing; it does not establish physical grasp or contact fidelity.
- [Microsoft WSL networking](https://learn.microsoft.com/en-us/windows/wsl/networking): Windows can access Linux servers through localhost; the reverse direction depends on networking mode. Keeping ROS participants inside one WSL environment avoids introducing a Windows/Linux DDS boundary into the initial setup.
- [Microsoft WSL GUI support](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps): Linux GUI applications and accelerated rendering are supported with the required Windows and graphics configuration.
