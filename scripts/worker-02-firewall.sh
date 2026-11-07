#!/usr/bin/env bash
# Updates worker-02's firewall (the iot_wifi_guard table from iot-wifi-worker-02.sh) for the
# Wyze bridge, which runs on worker-02's own network so the cameras can send video back to it.
#
# - IOT Wi-Fi (wlp1s0): replies are allowed as before, plus UDP from the two Wyze cameras only,
#   which is how their video arrives. Every other new connection from IOT is still dropped.
# - Main network (eno1): the bridge's ports are blocked, because its web page and go2rtc page
#   have no login. Frigate reaches the streams from inside worker-02, which this doesn't affect.
#
# Run on worker-02:  sudo bash worker-02-firewall.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run this with sudo."; exit 1; fi
if [ "$(hostname)" != "worker-02" ]; then echo "This is meant for worker-02 only."; exit 1; fi

WYZE_CAMERAS="192.168.0.15, 192.168.0.240"
BRIDGE_TCP_PORTS="1984, 5080, 8554, 8888, 8889"
BRIDGE_UDP_PORTS="8189"

# Written to a temporary file and checked first, so a mistake never replaces a working file.
NEW=$(mktemp)
cat > "$NEW" <<EOF
table inet iot_wifi_guard
delete table inet iot_wifi_guard
table inet iot_wifi_guard {
  chain input {
    type filter hook input priority -10; policy accept;
    iifname "wlp1s0" ct state established,related accept
    iifname "wlp1s0" ip saddr { $WYZE_CAMERAS } meta l4proto udp accept
    iifname "wlp1s0" drop
    iifname "eno1" tcp dport { $BRIDGE_TCP_PORTS } drop
    iifname "eno1" udp dport { $BRIDGE_UDP_PORTS } drop
  }
  chain forward {
    type filter hook forward priority -10; policy accept;
    iifname "wlp1s0" ct state established,related accept
    iifname "wlp1s0" drop
  }
}
EOF
nft -c -f "$NEW"
cp /etc/iot-wifi-guard.nft "/etc/iot-wifi-guard.nft.$(date +%Y%m%d-%H%M%S).bak"
install -m 0644 "$NEW" /etc/iot-wifi-guard.nft
rm -f "$NEW"
systemctl restart iot-wifi-guard.service
systemctl is-active iot-wifi-guard.service
nft list table inet iot_wifi_guard
echo "Firewall updated."
