# Proposed WSL base-environment commands

Status: approved base installation completed and verified, 2026-09-18. This is the reviewed command reference; actual results are recorded in the [setup log](environment-setup-log.md). Use the [environment guide](wsl-environment.md) for new WSL sessions. This installation covers the base tooling, not project dependency installation, builds, database migrations, or robot execution. Deferred diagnostic and rosdep commands below were not run.

Luna checked repository requirements, Terra reviewed the proposed commands and native-build boundaries, and the coordinator checked Bash syntax before installation. Following user approval, Terra installed the base environment and verified package integrity, runtime versions, ROS package discovery, Python imports, and the local PostgreSQL cluster. Project builds, graphics, and end-to-end runtime compatibility remain untested.

A follow-up byte/codepoint inspection found no non-ASCII characters in this file. Both SHA-256 records use two ordinary ASCII spaces (U+0020 U+0020) between the hash and filename; neither contains a non-breaking space.

The proposed route is native ROS 2 Humble with CPU/OMPL planning inside the existing Ubuntu 22.04 WSL distribution. Existing repository guides also describe an Isaac ROS Docker route for hardware/GPU deployment. This proposal does not run that bootstrap or install a second container-based ROS stack. Native overlay compatibility will be checked separately; having these packages installed does not establish that the complete project builds.

## Sources and boundaries

| Software | Proposed source | Verification |
| --- | --- | --- |
| Build tools and Python 3.10 | Ubuntu Jammy repositories | APT signed repository metadata |
| ROS Humble, MoveIt, ros2_control | Official ROS APT repository | Official ros2-apt-source package pinned below; SHA-256 plus APT signatures |
| Node.js 22.23.2 with bundled npm | nodejs.org official Linux x64 archive | Pinned version and SHA-256 from the official release checksums |
| PostgreSQL 16 | PostgreSQL Global Development Group APT repository | Official key, scoped Signed-By repository configuration, APT signatures |

No downloaded shell script is piped into a shell. No miscellaneous PPAs, global pip installs, CUDA/Isaac/TensorRT installations, robot drivers, Windows firewall changes, or sibling-repository edits are included. Standard APT packages can run their normal publisher-provided installation hooks. PostgreSQL installation may create/start a default local cluster; this does not create the application's database or run its migrations.

Before applying the proposal, inspect existing APT sources and each simulated APT transaction. Abort on unexpected origins, removals, or replacement of an existing conflicting setup. --no-remove prevents APT from proceeding with package removals. Checksums verify a downloaded artifact against the publisher's advertised bytes; they are not an independent security audit of that publisher.

## Enter Ubuntu

Run this one command in PowerShell. All following commands are Bash commands inside Ubuntu, one complete command per line.

```powershell
wsl -d Ubuntu-22.04
```

Run the installation blocks in order in the same Bash session and working directory. The temporary download path and shell settings are not shared automatically with another pane. The commands print the download directory below so it can be recorded. If a shell closes, resume only after restoring that actual directory and the required PATH/ROS settings; do not blindly rerun the blocks because the existing-file guards intentionally stop rather than overwrite prior setup. Installed packages, the extracted Node runtime, and the virtual-environment directory persist across shells.

Read-only inspection on 2026-09-18 confirmed that this distribution already has systemd as PID 1 and [boot] systemd=true in /etc/wsl.conf. No systemd enablement or WSL restart is needed. PostgreSQL itself does not require systemd; the init system affects how service startup is managed. On another environment, check the running init process rather than relying only on the configuration file.

## Ubuntu prerequisites

The systemd/udev update is limited to those packages inside WSL. ROS's Humble installation instructions specifically call out outdated Ubuntu 22.04 systemd/udev packages as an installation hazard. Preview their changes first; do not substitute a distribution upgrade.

```bash
set -eo pipefail
source /etc/os-release
test "$ID" = ubuntu
test "$VERSION_ID" = 22.04
test "$(dpkg --print-architecture)" = amd64
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
sudo apt-get update
apt-cache policy
sudo apt-get -s --no-remove install --only-upgrade systemd libsystemd0 udev libudev1
sudo apt-get --no-remove install --only-upgrade systemd libsystemd0 udev libudev1
sudo apt-get -s --no-remove install ca-certificates curl gnupg software-properties-common
sudo apt-get --no-remove install ca-certificates curl gnupg software-properties-common
sudo add-apt-repository -y universe
sudo apt-get update
sudo apt-get -s --no-remove install build-essential cmake ninja-build pkg-config git git-lfs python3-dev python3-venv python3-pip python3-yaml xz-utils
sudo apt-get --no-remove install build-essential cmake ninja-build pkg-config git git-lfs python3-dev python3-venv python3-pip python3-yaml xz-utils
E2E_SETUP_DIR=$(mktemp -d "$HOME/e2e-setup.XXXXXX")
printf 'Download directory: %s\n' "$E2E_SETUP_DIR"
cd "$E2E_SETUP_DIR"
```

## ROS 2 Humble and simulation tooling

The ROS repository configuration package is pinned to release 1.3.0. Its SHA-256 was read from the official release asset metadata. This package configures ROS repository signing keys and sources; subsequent package updates are handled by APT.

```bash
curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output ros2-apt-source_1.3.0.jammy_all.deb https://github.com/ros-infrastructure/ros-apt-source/releases/download/1.3.0/ros2-apt-source_1.3.0.jammy_all.deb
printf '%s\n' '110b9a462d55252decb8b7c816f61c2ba0d9890ce5fb93ac504e97cae5860d76  ros2-apt-source_1.3.0.jammy_all.deb' | sha256sum --check --strict
dpkg-deb --info ros2-apt-source_1.3.0.jammy_all.deb
sudo apt-get -s --no-remove install ./ros2-apt-source_1.3.0.jammy_all.deb
sudo apt-get --no-remove install ./ros2-apt-source_1.3.0.jammy_all.deb
sudo apt-get update
sudo apt-get -s --no-remove install ros-humble-ros-base ros-humble-rviz2 ros-humble-moveit ros-humble-moveit-servo ros-humble-ros2-control ros-humble-ros2-controllers ros-humble-xacro ros-humble-joint-state-publisher ros-humble-robot-state-publisher python3-colcon-common-extensions python3-rosdep python3-vcstool
sudo apt-get --no-remove install ros-humble-ros-base ros-humble-rviz2 ros-humble-moveit ros-humble-moveit-servo ros-humble-ros2-control ros-humble-ros2-controllers ros-humble-xacro ros-humble-joint-state-publisher ros-humble-robot-state-publisher python3-colcon-common-extensions python3-rosdep python3-vcstool
```

This preserves APT-managed ROS/Python packages and avoids mixing another pip-provided ROS distribution into the same interpreter. Hardware-only gripper packages and optional accelerated planners are outside this base install.

## Node.js

The repository requires Node >=20.11 and npm >=10. The proposed Linux runtime is Node 22.23.2, installed in the WSL user's local directory. It does not replace Windows Node or use the Windows npm executable from WSL. The SHA-256 below was read from Node's official release checksum file.

```bash
curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output node-v22.23.2-linux-x64.tar.xz https://nodejs.org/download/release/v22.23.2/node-v22.23.2-linux-x64.tar.xz
printf '%s\n' 'd60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307  node-v22.23.2-linux-x64.tar.xz' | sha256sum --check --strict
mkdir -p "$HOME/.local/opt"
test ! -e "$HOME/.local/opt/node-v22.23.2-linux-x64"
tar -xJf node-v22.23.2-linux-x64.tar.xz -C "$HOME/.local/opt"
export PATH="$HOME/.local/opt/node-v22.23.2-linux-x64/bin:$PATH"
node --version
npm --version
```

The existence check deliberately stops instead of overwriting a pre-existing runtime. PATH changes above affect only this shell. A reviewed project activation file can make the environment convenient later without changing Windows configuration or silently appending to shell startup files.

## PostgreSQL 16

The project documents PostgreSQL 16. Ubuntu 22.04's default PostgreSQL package is version 14, so this proposal uses the PostgreSQL project's own repository and requests version 16 explicitly. It uses manual repository configuration, not the project's automated setup script. If PostgreSQL or its repository is already configured, inspect and reuse it rather than applying a duplicate source or overwriting it.

```bash
test ! -e /etc/apt/sources.list.d/pgdg.sources
test ! -e /etc/apt/sources.list.d/pgdg.list
test ! -e /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output postgresql.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
gpg --show-keys --with-fingerprint postgresql.asc
E2E_PGDG_FINGERPRINT=$(gpg --show-keys --with-colons postgresql.asc | awk -F: '$1 == "fpr" { print $10; exit }')
test "$E2E_PGDG_FINGERPRINT" = B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
sudo install -d -m 0755 /usr/share/postgresql-common/pgdg
sudo install -m 0644 postgresql.asc /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
printf '%s\n' 'Types: deb' 'URIs: https://apt.postgresql.org/pub/repos/apt' 'Suites: jammy-pgdg' 'Architectures: amd64' 'Components: main' 'Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc' | sudo tee /etc/apt/sources.list.d/pgdg.sources
sudo apt-get update
sudo apt-get -s --no-remove install postgresql-16 postgresql-client-16
sudo apt-get --no-remove install postgresql-16 postgresql-client-16
psql --version
```

The application's documented Compose setup maps PostgreSQL to host port 5431; a native cluster commonly uses 5432. Choosing the isolated project database, credentials, and application connection settings is a later explicit configuration step. No existing databases are to be dropped, reset, migrated, or seeded by this proposal.

## Basic checks and ROS Python environment

These commands check installed tooling and create an isolated Python environment with visibility of the APT-managed ROS packages. They do not install project Python packages or start a robot node.

```bash
source /opt/ros/humble/setup.bash
export ROS_LOCALHOST_ONLY=1
export ROS_DOMAIN_ID=67
ros2 pkg prefix rclcpp
ros2 pkg prefix moveit_ros_move_group
ros2 pkg prefix moveit_servo
ros2 pkg prefix moveit_planners_ompl
ros2 pkg prefix moveit_planners_chomp
ros2 pkg prefix pilz_industrial_motion_planner
ros2 pkg prefix controller_manager
cmake --version
python3 --version
test ! -e "$HOME/.venvs/end-to-end-sim-ros"
python3 -m venv --system-site-packages "$HOME/.venvs/end-to-end-sim-ros"
```

The ROS environment variables limit subsequent ROS discovery to this host/domain for the simulation profile. They are current-shell settings, not a modification of an existing robot's configuration. Do not launch the real-hardware profile as an installation check.

## Later WSL graphics diagnostic

Do not disable hardware acceleration by default. If RViz later shows an OpenGL initialization error or rendering failure, compare a single software-rendered launch after activating the ROS environment:

```bash
LIBGL_ALWAYS_SOFTWARE=true rviz2
```

Mesa documents this variable as forcing software rendering. This is a diagnostic fallback, can be slower, and is not a guarantee that it fixes every WSLg problem. RViz is installed but has not been launched, so graphics behavior remains untested. Keep the variable scoped to that process instead of adding it to a shell startup file.

## Later rosdep initialization

Installing python3-rosdep does not initialize its rule database. Before a later reviewed rosdep-based dependency-resolution step, initialize it once if it is not already configured, then update as the normal user:

```bash
sudo rosdep init
rosdep update --rosdistro humble
```

These are deferred preparation commands, not part of the base installation blocks above. init writes rosdep source configuration under /etc/ros; update downloads dependency-rule metadata to the user's cache. Skip init if the installation is already initialized, and inspect any custom sources. These commands do not install the workspace dependencies and do not justify a blanket rosdep install; the Isaac cuMotion dependency caveat below still applies.

## Separate follow-up before project dependency installation

The base setup is not the complete application environment. Project pip/npm installs will be proposed after checking lockfiles, package sources, build hooks, and interpreter compatibility. In particular:

- platform-client requires Python >=3.10 and needs to be importable from the same environment as platform MW.
- bun-coordinate-server lists NumPy, OpenCV, ONNX Runtime, RealSense, PySide6, and qtawesome. Camera mocking does not automatically remove those import-time dependencies. No pip installation from this list is included above.
- Robo-CVStudio needs a separate Python 3.12 environment; no new Python distribution, PPA, or managed interpreter download is included in this first batch.
- The existing Isaac bootstrap imports additional NVIDIA repositories. That is outside this native base setup.
- Native Nova bring-up still requires source-overlay packages including cr_robot_ros2, dobot_moveit, lebai_driver, bread_interfaces, and dobot_msgs_v4. They are not supplied by the base APT commands. YAML is covered above, while the environment publisher's trimesh dependency belongs in the separately reviewed Python dependency setup; its availability as an Ubuntu Jammy package has not been verified.
- The Nova package metadata declares Isaac cuMotion dependencies even when runtime selection uses CPU OMPL. Do not run a blanket workspace-wide rosdep install and assume it produces a native-only setup. Define a scoped dependency/skip strategy before the overlay build.
- Package installation alone does not validate WSL graphics, native builds, simulated camera behavior, or an end-to-end order. Those checks follow the approved scope separately.

## Official sources checked

- [ROS installation source documentation](https://github.com/ros2/ros2_documentation/blob/humble/source/Installation/Ubuntu-Install-Debs.rst)
- [ROS repository setup documentation](https://github.com/ros2/ros2_documentation/blob/humble/source/Installation/_Apt-Repositories.rst)
- [ROS apt-source 1.3.0 release](https://github.com/ros-infrastructure/ros-apt-source/releases/tag/1.3.0)
- [Node.js 22.23.2 official files](https://nodejs.org/download/release/v22.23.2/)
- [Node.js official SHA-256 checksums](https://nodejs.org/download/release/v22.23.2/SHASUMS256.txt)
- [PostgreSQL official Ubuntu repository instructions](https://www.postgresql.org/download/linux/ubuntu/)
- [PostgreSQL published repository key fingerprint](https://www.postgresql.org/about/news/pgdg-apt-repository-for-debianubuntu-1432/)
- [Ubuntu Jammy PostgreSQL 14 package](https://packages.ubuntu.com/jammy/postgresql-14)
- [Microsoft: WSL systemd support](https://learn.microsoft.com/en-us/windows/wsl/systemd)
- [Microsoft: PostgreSQL service management in WSL](https://learn.microsoft.com/en-us/windows/wsl/tutorials/wsl-database)
- [Mesa: LIBGL_ALWAYS_SOFTWARE](https://docs.mesa3d.org/envvars.html)
- [rosdep initialization and updates](https://github.com/ros-infrastructure/rosdep/blob/master/doc/overview.rst)
