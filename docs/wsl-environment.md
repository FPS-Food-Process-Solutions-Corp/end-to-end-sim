# Using the WSL base environment

This guide describes the approved base environment. The actual installation outcome and versions are recorded separately in [the setup log](environment-setup-log.md). The subsequent staged application setup and local order tests are documented in [the first-order runbook](first-order-runbook.md). Native motion, camera perception, and higher-fidelity simulation remain separate work.

## Open a working shell

From PowerShell:

```powershell
wsl -d Ubuntu-22.04
```

Then run these commands inside Ubuntu, in each new shell that will work on this project:

```bash
export PATH="$HOME/.local/opt/node-v22.23.2-linux-x64/bin:$PATH"
source "$HOME/.venvs/end-to-end-sim-ros/bin/activate"
source /opt/ros/humble/setup.bash
export ROS_LOCALHOST_ONLY=1
export ROS_DOMAIN_ID=67
cd /mnt/d/Work/FPS/Robotics/end-to-end-sim
```

These settings affect this shell. They do not modify Windows Node, another shell's ROS domain, or shell startup files. The virtual environment uses Ubuntu's Python 3.10 and can see APT-managed ROS packages. The simulation domain is local to this host; do not use this profile as a real-robot connection profile.

## Check which tools this shell will use

```bash
command -v node
command -v npm
node --version
npm --version
python --version
ros2 pkg prefix rclcpp
ros2 pkg prefix moveit_ros_move_group
ros2 pkg prefix controller_manager
psql --version
```

Node and npm should resolve inside the Linux user-local Node directory, not a Windows path inherited by WSL. A successful ROS package-prefix check demonstrates package discovery, not that the robot overlay has been built or that a motion workflow has run.

## PostgreSQL

The native PostgreSQL 16 installation may create/start its default local cluster. Confirm the actual status/port from the setup log or these read-only checks:

```bash
pg_lsclusters
pg_isready -h 127.0.0.1 -p 5432
```

The repository's Docker Compose example uses host port 5431; that is a different layout. No application connection setting should be copied without choosing the intended database/port. Project databases, credentials, migrations, and seed data are not part of this base setup.

## Subsequent work and remaining scope

The staged platform dependencies, isolated database and test data, selected ROS interface/bridge overlay, simulated pick services, and terminal observer have since been prepared. The [first-order runbook](first-order-runbook.md) records current launch commands and which order scenarios have been verified.

Work beyond this first software loop remains:

- Initialize/update rosdep before a broader scoped dependency-resolution step; account explicitly for the optional Isaac cuMotion declarations.
- Build and validate the native Nova controller and required robot/model packages.
- Verify graphics, native motion planning, and camera/perception behavior.
- Define the remaining destination and Atom-W mappings, then extend recovery, partial-fulfillment, and multi-order scenarios.

Use the [installation proposal](wsl-setup-proposal.md) for source verification details, deferred rosdep commands, and the optional per-process software-rendering diagnostic. Do not rerun installation blocks blindly in an already prepared environment.
