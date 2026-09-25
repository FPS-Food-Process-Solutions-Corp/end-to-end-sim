# Base WSL environment setup log

Completed on 2026-09-18 in Ubuntu 22.04 WSL2 (amd64), using WSL user `user`.

## Verified sources

- ROS 2 source configuration: `ros2-apt-source` version `1.3.0~jammy`.  The downloaded `ros2-apt-source_1.3.0.jammy_all.deb` SHA-256 matched `110b9a462d55252decb8b7c816f61c2ba0d9890ce5fb93ac504e97cae5860d76` before installation.  The resulting ROS source is `http://packages.ros.org/ros2/ubuntu jammy`.
- Node.js: the official `node-v22.23.2-linux-x64.tar.xz` SHA-256 matched `d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307` before extraction.
- PostgreSQL PGDG: the downloaded signing key's primary fingerprint matched `B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8` before installation.  Its scoped deb822 source is `http://apt.postgresql.org/pub/repos/apt`, suite `jammy-pgdg`.

## Installed and checked

- ROS 2 Humble base, RViz, MoveIt, MoveIt Servo, ros2_control/controllers, Xacro, robot-state and joint-state publishers, colcon, rosdep, and vcstool.
- Key versions: `ros-humble-ros-base` `0.10.0-1jammy.20260908.101203`; MoveIt and Servo `2.5.10`; ros2_control `2.54.2`; ros2_controllers `2.54.0`.
- `ros2 pkg prefix` resolves `rclcpp`, `moveit_core`, `controller_manager`, `moveit_servo`, `moveit_planners_ompl`, `moveit_planners_chomp`, and `pilz_industrial_motion_planner` to `/opt/ros/humble`.
- Node.js `v22.23.2` and npm `10.9.8` at `/home/user/.local/opt/node-v22.23.2-linux-x64`; the directory is owned by `user:user`.
- Python `3.10.12` virtual environment at `/home/user/.venvs/end-to-end-sim-ros`, created with `--system-site-packages` and owned by `user:user`.  With ROS sourced it imports `rclpy` from `/opt/ros/humble` and PyYAML `5.4.1`.
- PostgreSQL server and client `16.15-1.pgdg22.04+2`.  Package installation created the standard `16/main` cluster; `postgresql.service` is active and it listens only on `127.0.0.1:5432` at the time of verification.  The installed `sysstat` service and its collection and summary timers are inactive.
- `apt-get check` and `dpkg --audit` completed without broken or incomplete package states.

## Deliberately deferred

- No project `pip` or `npm` dependencies, project build, database migration, or application service was run.
- `rosdep init` and `rosdep update` were not run.
- No Isaac, CUDA, Docker, drivers, global Python packages, hardware, robot launch, or graphics test was started.
