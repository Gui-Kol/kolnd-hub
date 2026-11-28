# Troubleshooting

## General

### Forgotten Credentials
If you forgot your credentials to the web UI, try this.

```bash
KLOUD_GAMES --creds {new-username} {new-password}
```

> [!TIP]
> Remember to replace `{new-username}` and `{new-password}` with your new credentials.
> Do not include the curly braces.

### Unusual Mouse Behavior
If you experience unusual mouse behavior, try attaching a physical mouse to the KLOUD_GAMES host.

For absolute-positioning problems, set **Configuration > Advanced > Log Level** to **Debug** and reproduce the issue.
KLOUD_GAMES forwards libvirtualhid diagnostics with a `[libvirtualhid]` prefix, including the streamed display viewport and
full desktop bounds used for mouse coordinate mapping.

For native touch or pen input on KDE Wayland, KLOUD_GAMES maps its virtual devices to the streamed display.
Use Plasma 6.5.1 or later, which fixes changing a device's assigned output. Display layouts with monitors
left of or above the desktop origin are supported. Other Wayland compositors retain their device mapping
settings; assign KLOUD_GAMES's virtual touchscreen and pen tablet through the compositor's input configuration.

### Web UI Access
Can't access the web UI?

1. Check firewall rules.

### Controller works on Steam but not in games
One trick might be to change Steam settings and check or uncheck the configuration to support Xbox/PlayStation
controllers and leave only support for Generic controllers.

Also, if you have many controllers already directly connected to the host, it might help to disable them so that the
KLOUD_GAMES-provided controller (connected to the guest) is the "first" one. In Linux this can be achieved on USB
devices by finding the device in `/sys/bus/usb/devices/` and writing `0` to the `authorized` file.

### Network performance test

For real-time game streaming the most important characteristic of the network
path between server and client is not pure bandwidth but rather stability and
consistency (low latency with low variance, minimal or no packet loss).

The network can be tested using the multi-platform tool [iPerf3](https://iperf.fr).

On the KLOUD_GAMES host `iperf3` is started in server mode:

```bash
iperf3 -s
```

On the client device iperf3 is asked to perform a 60-second UDP test in a reverse
direction (from server to client) at a given bitrate (e.g. 50 Mbps):

```bash
iperf3 -c {HostIpAddress} -t 60 -u -R -b 50M
```

Watch the output on the client for packet loss and jitter values. Both should be
(very) low. Ideally, packet loss remains less than 5% and jitter below 1 ms.

For Android clients use
[PingMaster](https://play.google.com/store/apps/details?id=com.appplanex.pingmasternetworktools).

For iOS clients use [HE.NET Network Tools](https://apps.apple.com/us/app/he-net-network-tools/id858241710).

If you are testing a remote connection (over the internet), you will need to
forward the port 5201 (TCP and UDP) from your host.

### Packet loss (Buffer overrun)
If the host PC (running KLOUD_GAMES) has a much faster connection to the network
than the slowest segment of the network path to the client device (running
Moonlight), massive packet loss can occur: KLOUD_GAMES emits its stream in bursts
every 16 ms (for 60 fps), but those bursts can't be passed on fast enough to the
client and must be buffered by one of the network devices inbetween. If the
bitrate is high enough, these buffers will overflow and data will be discarded.

This can easily happen if e.g., the host has a 2.5 Gbit/s connection and the
client only 1 Gbit/s or Wi-Fi. Similarly, a 1 Gbps host may be too fast for a
client having only a 100 Mbps interface.

As a workaround the transmission speed of the host NIC can be reduced: 1 Gbps
instead of 2.5 or 100 Mbps instead of 1 Gbps. A technically more advanced
solution would be to configure traffic shaping rules at the OS level, so that
only KLOUD_GAMES's traffic is slowed down.

Such a solution on Linux could look like that:

```bash
# 1) Remove existing qdisc (pfifo_fast)
sudo tc qdisc del dev <NIC> root

# 2) Add HTB root qdisc with default class 1:1
sudo tc qdisc add dev <NIC> root handle 1: htb default 1

# 3) Create class 1:1 for full 10 Gbit/s (all other traffic)
sudo tc class add dev <NIC> parent 1: classid 1:1 htb \
    rate 10000mbit ceil 10000mbit burst 32k

# 4) Create class 1:10 for KLOUD_GAMES game stream at 1 Gbit/s
sudo tc class add dev <NIC> parent 1: classid 1:10 htb \
    rate 1000mbit ceil 1000mbit burst 32k

# 5) Filter UDP source port 47998 into class 1:10
sudo tc filter add dev <NIC> protocol ip parent 1: prio 1 \
    u32 match ip protocol 17 0xff \
    match ip sport 47998 0xffff flowid 1:10
```

In that way only the KLOUD_GAMES traffic is limited by 1 Gbit. This is not persistent on reboots.
If you use a different port for the game stream, you need to adjust the last command.

KLOUD_GAMES versions > 0.23.1 include improved networking code that should
alleviate or even solve this issue (without reducing the NIC speed).

### Packet loss (MTU)
Although unlikely, some guests might work better with a lower
[MTU](https://en.wikipedia.org/wiki/Maximum_transmission_unit) from the host.
For example, an LG TV was found to have 30–60% packet loss when the host had MTU
set to 1500 and 1472, but 0% packet loss with a MTU of 1428 set in the network card
serving the stream (a Linux PC). It's unclear how that helped precisely, so it's a last
resort suggestion.

## Windows

### No gamepad detected
KLOUD_GAMES supports two virtual gamepad backends on Windows. You can install the
[Virtual HID Broker](https://github.com/LizardByte/libvirtualhid/releases/latest) separately as an optional paid upgrade.
Its Windows package includes a broker service and user-mode driver for a Raw Input keyboard and mouse plus full virtual
gamepad support. ViGEmBus is a limited alternative for Xbox 360 and DualShock 4 support that has reached end of life. If you use the
[ViGEmBus fallback](https://github.com/nefarius/ViGEmBus/releases/latest), you must use version 1.17 or newer.

When Virtual HID Broker is used, KLOUD_GAMES requires libvirtualhid version `2026.914.1218.10` or newer.

Virtual HID Broker adds Xbox One, Xbox Series, DualSense, Nintendo Switch Pro, and Generic gamepads, plus advanced
controller features such as motion, touchpads, LEDs, and adaptive triggers when supported. Unlike the discontinued
ViGEmBus project, Virtual HID Broker is actively developed and supported by the LizardByte team.

An active paid Virtual HID Broker machine license is required before KLOUD_GAMES can create driver-backed libvirtualhid
devices, including gamepads and the Raw Input keyboard and mouse. Use the message on the Web UI home page, the startup
tray notification, or **Get/Manage License** in the **Virtual HID Broker** tray submenu to open the license section on
the Troubleshooting page. In **Configuration > Input**, select **All Available Drivers**, only **Virtual HID Broker**, or
only **ViGEmBus**. KLOUD_GAMES keeps prompting until this setting is saved, but automatically selects **All Available
Drivers** when it detects an existing active Virtual HID Broker license. Whenever the Virtual HID Broker license is not
valid, **All Available Drivers** falls back to a compatible ViGEmBus installation for Xbox 360 and DualShock 4 gamepads
and to SendInput for keyboard and mouse. Selecting only **ViGEmBus** suppresses Virtual HID Broker startup notifications
and hides its status and license details from the Troubleshooting page. Selecting **None** disables all virtual
gamepads and suppresses broker and driver choice notices without affecting keyboard or mouse input.

After installation, it is recommended to restart your computer.

### Games do not detect keyboard input
With a compatible Virtual HID Broker and active license, KLOUD_GAMES sends normal key transitions through a real HID
keyboard so games using Raw Input can receive them. Unicode text input and keys outside the supported HID keyboard
page continue to use Windows input injection. When the driver-backed keyboard cannot be created because the driver,
broker, or license is unavailable, libvirtualhid falls back to SendInput.

Check the libvirtualhid driver version and Virtual HID Broker license on the Web UI Troubleshooting page. KLOUD_GAMES recreates the
shared keyboard and mouse after a successful license activation, validation, or deactivation, so you do not need to
restart KLOUD_GAMES merely to switch between the HID and SendInput paths.

### Games do not detect mouse input
With a compatible Virtual HID Broker and active license, KLOUD_GAMES sends relative mouse movement, buttons, and scrolling
through a real HID device so games using Raw Input can receive them. Absolute positioning still uses Windows input
injection. When the driver-backed mouse cannot be created, libvirtualhid falls back to SendInput; the Windows cursor may
still move even though a game that listens only for Raw Input receives nothing.

Check the libvirtualhid driver version and Virtual HID Broker license on the Web UI Troubleshooting page even when controller input
is disabled. The same live refresh used by the keyboard path also switches the mouse between HID and SendInput without
requiring a KLOUD_GAMES restart.

### Permission denied
Since KLOUD_GAMES runs as a service on Windows, it may not have the same level of access that your regular user account
has. You may get permission denied errors when attempting to launch a game or application from a non-system drive.

You will need to modify the security permissions on your disk. Ensure that user/principal SYSTEM has full
permissions on the disk.

### Stuttering
If you experience stuttering using NVIDIA, try disabling `vsync:fast` in the NVIDIA Control Panel.
