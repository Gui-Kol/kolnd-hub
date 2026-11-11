#!/bin/sh

# User Service
systemctl --user stop app-dev.lizardbyte.app.KLOUD_GAMES
rm "$HOME/.config/systemd/user/app-dev.lizardbyte.app.KLOUD_GAMES.service"
systemctl --user daemon-reload
echo "KLOUD_GAMES User Service has been removed."

# Remove rules
flatpak-spawn --host pkexec sh -c "rm /etc/modules-load.d/60-KLOUD_GAMES.conf"
flatpak-spawn --host pkexec sh -c "rm /etc/udev/rules.d/60-KLOUD_GAMES.rules"
flatpak-spawn --host pkexec udevadm control --reload-rules
echo "Input rules removed."
