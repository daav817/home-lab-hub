#!/usr/bin/env bash
# Joins worker-02's built-in Wi-Fi to the IOT network, so Home Assistant and the camera bridges
# on worker-02 can reach devices that the router keeps isolated from the main network.
#
# Safeguards:
# - A firewall drops every new connection that arrives over this Wi-Fi, to worker-02 itself and
#   to anything routed through it. Replies to worker-02's own connections still get through.
#   It runs in its own nftables table, so the cluster's network rules can't override it, and it
#   is switched on before the Wi-Fi connects.
# - The Wi-Fi takes no default route and no DNS, so worker-02 only uses it for 192.168.0.x.
# - The Wi-Fi password is typed at a hidden prompt and stored only in a root-only netplan file.
#
# Run on worker-02:  sudo bash iot-wifi-worker-02.sh "IOT"
# The argument is the IOT Wi-Fi name, exactly as it appears in the Wi-Fi list.
set -euo pipefail

IFACE=wlp1s0
SSID="${1:-}"

if [ "$(id -u)" -ne 0 ]; then echo "Run this with sudo."; exit 1; fi
if [ -z "$SSID" ]; then echo "Give the IOT Wi-Fi name, for example: sudo bash $0 \"IOT\""; exit 1; fi
if [ "$(hostname)" != "worker-02" ]; then echo "This is meant for worker-02 only."; exit 1; fi
if ! ip link show "$IFACE" > /dev/null 2>&1; then echo "No $IFACE on this machine."; exit 1; fi

echo "Checking packages..."
missing=""
command -v nft > /dev/null 2>&1 || missing="$missing nftables"
dpkg -s wpasupplicant > /dev/null 2>&1 || missing="$missing wpasupplicant"
if [ -n "$missing" ]; then
  apt-get update -qq
  # shellcheck disable=SC2086
  apt-get install -y -qq $missing
fi

echo "Switching on the IOT firewall..."
cat > /etc/iot-wifi-guard.nft <<EOF
table inet iot_wifi_guard
delete table inet iot_wifi_guard
table inet iot_wifi_guard {
  chain input {
    type filter hook input priority -10; policy accept;
    iifname "$IFACE" ct state established,related accept
    iifname "$IFACE" drop
  }
  chain forward {
    type filter hook forward priority -10; policy accept;
    iifname "$IFACE" ct state established,related accept
    iifname "$IFACE" drop
  }
}
EOF
cat > /etc/systemd/system/iot-wifi-guard.service <<'EOF'
[Unit]
Description=Drop new connections arriving over the IOT Wi-Fi
Before=network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/iot-wifi-guard.nft
ExecStop=/usr/sbin/nft delete table inet iot_wifi_guard

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now iot-wifi-guard.service
nft list table inet iot_wifi_guard > /dev/null && echo "Firewall is on."

read -rsp "IOT Wi-Fi password (hidden): " PASSWORD; echo
if [ -z "$PASSWORD" ]; then echo "No password entered. The firewall is on, but the Wi-Fi was not set up."; exit 1; fi
# YAML single quotes: a ' inside the value is written as ''.
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

umask 077
cat > /etc/netplan/60-iot-wifi.yaml <<EOF
network:
  version: 2
  wifis:
    $IFACE:
      dhcp4: true
      dhcp6: false
      dhcp4-overrides:
        use-routes: false
        use-dns: false
      access-points:
        $(quote "$SSID"):
          password: $(quote "$PASSWORD")
EOF
unset PASSWORD
chmod 600 /etc/netplan/60-iot-wifi.yaml

echo "Applying the Wi-Fi settings. If anything goes wrong, they roll back after 120 seconds."
echo "When asked, press Enter to keep them."
netplan try --timeout 120

echo
echo "Waiting for an IOT address..."
for _ in $(seq 1 30); do
  addr=$(ip -4 -o addr show "$IFACE" | awk '{print $4}')
  [ -n "$addr" ] && break
  sleep 2
done
echo "IOT address: ${addr:-none yet}"
echo "Default route (should still be eno1):"
ip route show default
