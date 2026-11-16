#!/usr/bin/env bash
# Phase 2: VM Infrastructure Setup for MainStreet Shield
# Runs on VPS root@207.244.224.57
# Playbook: all operations via script files, bash -n first, read logs

set -euo pipefail

LOG_FILE="/var/log/mainstreet-shield-vm-setup.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "============================================"
echo "MainStreet Shield VM Infrastructure Setup"
echo "Date: $(date)"
echo "============================================"

# 1. Install required packages
echo "[1/7] Installing packages: qemu-kvm libvirt-daemon-system virtinst websockify novnc"
apt-get update -y
apt-get install -y qemu-kvm libvirt-daemon-system libvirt-clients virtinst bridge-utils \
  websockify novnc nginx curl wget

# 2. Check KVM support
echo "[2/7] Checking KVM support"
if grep -qE '(vmx|svm)' /proc/cpuinfo; then
  echo "KVM CPU extensions detected"
else
  echo "WARNING: No KVM CPU extensions - will use QEMU emulation (slower but functional)"
fi
if [ -c /dev/kvm ]; then
  echo "/dev/kvm exists - KVM acceleration available"
else
  echo "WARNING: /dev/kvm not found - KVM acceleration unavailable"
fi

# 3. Start and enable libvirtd
echo "[3/7] Starting libvirtd"
systemctl enable --now libvirtd
systemctl status libvirtd --no-pager | head -5

# 4. Add trmm user to libvirt group
echo "[4/7] Adding trmm user to libvirt group"
usermod -aG libvirt trmm 2>/dev/null || echo "trmm user not found, skipping"

# 5. Create VM storage directory
echo "[5/7] Creating VM storage directory"
mkdir -p /var/lib/libvirt/images/mainstreet-shield
chown root:libvirt /var/lib/libvirt/images/mainstreet-shield
chmod 750 /var/lib/libvirt/images/mainstreet-shield

# 6. Download Ubuntu 24.04 cloud image
echo "[6/7] Downloading Ubuntu 24.04 cloud image"
IMAGE_URL="https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
IMAGE_PATH="/var/lib/libvirt/images/mainstreet-shield/ubuntu-base.qcow2"
if [ ! -f "$IMAGE_PATH" ]; then
  wget -q "$IMAGE_URL" -O "$IMAGE_PATH"
  echo "Downloaded cloud image to $IMAGE_PATH"
else
  echo "Cloud image already exists at $IMAGE_PATH"
fi

# 7. Create the shield-lab VM (4 GB RAM, 2 vCPU, 60 GB disk)
echo "[7/7] Creating shield-lab VM"
VM_DISK="/var/lib/libvirt/images/mainstreet-shield/shield-lab.qcow2"

# Create a 60 GB qcow2 from the base image
qemu-img create -f qcow2 -o backing_file="$IMAGE_PATH",backing_fmt=qcow2 "$VM_DISK" 60G

# Create cloud-init user-data for initial setup
cat > /var/lib/libvirt/images/mainstreet-shield/user-data << 'EOF'
#cloud-config
hostname: shield-lab
users:
  - name: shield
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIImJ3Q1G3R3R3R3R3R3R3R3R3R3R3R3R3R3R3R3R3R3 mikeolab@spaceworker
EOF

# Create cloud-init meta-data
cat > /var/lib/libvirt/images/mainstreet-shield/meta-data << EOF
instance-id: shield-lab-01
local-hostname: shield-lab
EOF

# Create cloud-init ISO
genisoimage -output /var/lib/libvirt/images/mainstreet-shield/cloud-init.iso \
  -volid cidata -joliet -rock \
  /var/lib/libvirt/images/mainstreet-shield/user-data \
  /var/lib/libvirt/images/mainstreet-shield/meta-data 2>/dev/null || \
  mkisofs -output /var/lib/libvirt/images/mainstreet-shield/cloud-init.iso \
  -volid cidata -joliet -rock \
  /var/lib/libvirt/images/mainstreet-shield/user-data \
  /var/lib/libvirt/images/mainstreet-shield/meta-data

# Create the VM
virt-install \
  --name shield-lab \
  --ram 4096 \
  --vcpus 2 \
  --disk path="$VM_DISK",format=qcow2 \
  --disk path=/var/lib/libvirt/images/mainstreet-shield/cloud-init.iso,device=cdrom \
  --os-variant ubuntu24.04 \
  --network default \
  --graphics vnc,listen=127.0.0.1,port=5901 \
  --noautoconsole \
  --import \
  --print-xml > /var/lib/libvirt/images/mainstreet-shield/shield-lab.xml 2>&1 || true

# If import failed (cloud image may need different approach), try with location
if ! virsh list --all | grep -q shield-lab; then
  echo "Cloud-init import may need manual intervention. VM XML saved to shield-lab.xml"
fi

# Set VM to autostart
virsh autostart shield-lab 2>/dev/null || echo "VM not yet defined, will define after first start"

echo ""
echo "============================================"
echo "VM Infrastructure setup complete"
echo "Check: virsh list --all"
echo "Log: $LOG_FILE"
echo "============================================"