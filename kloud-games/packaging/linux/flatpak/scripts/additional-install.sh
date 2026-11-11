#!/bin/sh

set -e

# User Service
mkdir -p ~/.config/systemd/user
cp "/app/share/KLOUD_GAMES/systemd/user/app-dev.lizardbyte.app.KLOUD_GAMES.service" "$HOME/.config/systemd/user/app-dev.lizardbyte.app.KLOUD_GAMES.service"
echo "KLOUD_GAMES User Service has been installed."
echo "Use [systemctl --user enable app-dev.lizardbyte.app.KLOUD_GAMES] once to autostart KLOUD_GAMES on login."

# Load uhid for descriptor-driven gamepad emulation
UHID=$(cat /app/share/KLOUD_GAMES/modules-load.d/60-KLOUD_GAMES.conf)
echo "Enabling gamepad emulation."
# The host shell expands $1; the configuration is passed as a literal argument.
# shellcheck disable=SC2016
flatpak-spawn --host pkexec sh -c 'printf "%s\n" "$1" > /etc/modules-load.d/60-KLOUD_GAMES.conf' sh "$UHID"
flatpak-spawn --host pkexec modprobe uhid

# Udev rule
UDEV=$(cat /app/share/KLOUD_GAMES/udev/rules.d/60-KLOUD_GAMES.rules)
echo "Configuring virtual input permissions."
# The host shell expands $1; the rules are passed as a literal argument.
# shellcheck disable=SC2016
flatpak-spawn --host pkexec sh -c 'printf "%s\n" "$1" > /etc/udev/rules.d/60-KLOUD_GAMES.rules' sh "$UDEV"
flatpak-spawn --host pkexec udevadm control --reload-rules
flatpak-spawn --host pkexec udevadm trigger --property-match=DEVNAME=/dev/uinput
flatpak-spawn --host pkexec udevadm trigger --property-match=DEVNAME=/dev/uhid
flatpak-spawn --host pkexec udevadm trigger --subsystem-match=hidraw
flatpak-spawn --host pkexec udevadm trigger --subsystem-match=input
echo "Virtual input permissions have been updated."
