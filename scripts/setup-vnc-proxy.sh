#!/usr/bin/env bash
# Phase 2 continued: VNC Proxy Setup for MainStreet Shield VM
# Runs on VPS root@207.244.224.57
# Playbook: all operations via script files, bash -n first, read logs

set -euo pipefail

LOG_FILE="/var/log/mainstreet-shield-vnc-proxy.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "============================================"
echo "MainStreet Shield VNC Proxy Setup"
echo "Date: $(date)"
echo "============================================"

# 1. Create noVNC directory
echo "[1/4] Setting up noVNC web directory"
mkdir -p /var/www/shield-vnc
cp -r /usr/share/novnc/* /var/www/shield-vnc/
# Create index.html that connects to the VNC proxy
cat > /var/www/shield-vnc/index.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
  <title>MainStreet Shield - Linux VM Console</title>
  <script src="app/ui.js"></script>
</head>
<body>
  <h1>MainStreet Shield — Linux VM Console</h1>
  <div id="noVNC_container" style="width:800px; height:600px;"></div>
  <script>
    function startRFB() {
      var host = window.location.hostname;
      var port = 6081; // websockify port
      var path = "/websockify";
      var rfb = new RFB(document.getElementById("noVNC_container"), "ws://" + host + ":" + port + path, {
        shared: true,
        viewOnly: false,
        resize: "session",
        scale: "scale",
        repeatId: "id",
        credentials: { password: "" },
      });
    }
    if (document.readyState === "complete") {
      startRFB();
    } else {
      window.addEventListener("load", startRFB);
    }
  </script>
</body>
</html>
EOF
chown -R www-data:www-data /var/www/shield-vnc

# 2. Start websockify for VNC on port 5901 -> WebSocket on 6081
echo "[2/4] Starting websockify"
systemctl enable --now websockify 2>/dev/null || true
# Create systemd service for websockify if it doesn't exist
cat > /etc/systemd/system/shield-websockify.service << 'EOF'
[Unit]
Description=WebSocket to VNC proxy for MainStreet Shield VM
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/websockify --web=/var/www/shield-vnc 6081 127.0.0.1:5901
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now shield-websockify

# 3. Configure nginx VNC proxy
echo "[3/4] Configuring nginx for VNC proxy"
cat > /etc/nginx/sites-available/shield-vnc << 'EOF'
server {
    listen 80;
    server_name _;
    
    location /shield/vnc/ {
        proxy_pass http://127.0.0.1:6081/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
    
    location /shield/vnc {
        return 301 /shield/vnc/;
    }
    
    location /shield/ {
        proxy_pass http://127.0.0.1:3500/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/shield-vnc /etc/nginx/sites-enabled/shield-vnc
nginx -t && systemctl reload nginx

# 4. Create systemd service for the VM
echo "[4/4] Creating systemd service for shield-lab VM"
cat > /etc/systemd/system/mainstreet-shield-vm.service << 'EOF'
[Unit]
Description=MainStreet Shield Linux VM
After=libvirtd.service
Wants=libvirtd.service

[Service]
Type=simple
ExecStartPre=/usr/bin/virsh destroy shield-lab 2>/dev/null || true
ExecStart=/usr/bin/virsh start shield-lab
ExecStop=/usr/bin/virsh shutdown shield-lab
ExecStopPost=/usr/bin/virsh undefine shield-lab --remove-all-storage 2>/dev/null || true
Restart=on-failure
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable mainstreet-shield-vm.service

echo ""
echo "============================================"
echo "VNC Proxy setup complete"
echo "VNC WebSocket: ws://$(hostname -I | awk '{print $1}'):6081/websockify"
echo "noVNC URL: http://$(hostname -I | awk '{print $1}'):80/shield/vnc/"
echo "VM status: $(virsh list --name | grep shield-lab || echo 'not running')"
echo "Log: $LOG_FILE"
echo "============================================"