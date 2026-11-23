#!/usr/bin/env bash
# scripts/setup-mss-admin-sudoers.sh — Task B4.
#
# Installs a narrow sudoers drop-in so the MainStreet Shield app user can
# start/stop/restart ONLY the singleton mainstreet-shield-vm.service via
# /usr/bin/systemctl. Does NOT grant broader sudo and does NOT include the
# app's own service.
#
# NOT executed as part of this batch. Run manually on the VPS as root after
# code review, then verify with `visudo -cf /etc/sudoers.d/mainstreet-shield-admin`.
set -euo pipefail

APP_USER="${MSS_APP_USER:-mainstreet-shield}"
SUDOERS_FILE="/etc/sudoers.d/mainstreet-shield-admin"
UNIT="mainstreet-shield-vm.service"
SYSTEMCTL="/usr/bin/systemctl"

# Only these exact commands are permitted.
CMD_ALIAS="Cmnd_Alias MSS_VM_CTL = ${SYSTEMCTL} start ${UNIT}, ${SYSTEMCTL} stop ${UNIT}, ${SYSTEMCTL} restart ${UNIT}"
RULE="${APP_USER} ALL=(ALL) NOPASSWD: MSS_VM_CTL"

echo "[setup-mss-admin-sudoers] app user: ${APP_USER}"
echo "[setup-mss-admin-sudoers] sudoers file: ${SUDOERS_FILE}"

# Idempotent: rewrite the drop-in from scratch each run.
cat > "${SUDOERS_FILE}" <<EOF
# MainStreet Shield — narrow sudo grant for infra control only.
# Allows the app user to start/stop/restart the shield-lab VM service.
# Nothing else. Do not edit by hand; re-run this script instead.
${CMD_ALIAS}
${RULE}
EOF

# Validate syntax before trusting it.
if ! visudo -cf "${SUDOERS_FILE}"; then
  echo "[setup-mss-admin-sudoers] ERROR: visudo validation failed; removing bad drop-in." >&2
  rm -f "${SUDOERS_FILE}"
  exit 1
fi

# Owner/permissions step (required by sudoers): owned by root, mode 0440.
chown root:root "${SUDOERS_FILE}"
chmod 0440 "${SUDOERS_FILE}"

echo "[setup-mss-admin-sudoers] OK: ${SUDOERS_FILE} installed and validated (visudo -cf passed)."
echo "[setup-mss-admin-sudoers] Owner step: ensure the file is owned by root:root with mode 0440 (done above)."
echo "[setup-mss-admin-sudoers] Verify: sudo -U ${APP_USER} -l | grep mainstreet-shield-vm"
