#!/bin/bash
# NEON AI DJ — switch default session back to openbox after a GNOME rollback.
# Companion to djbooth-rollback-to-gnome.sh.

set -e

UNIT_USER=$(whoami)
ACCOUNT_FILE="/var/lib/AccountsService/users/$UNIT_USER"

echo "Flipping default session to openbox for user $UNIT_USER..."

sudo mkdir -p /var/lib/AccountsService/users
sudo tee "$ACCOUNT_FILE" > /dev/null << EOF
[User]
Session=openbox
XSession=openbox
SystemAccount=false
EOF

echo ""
echo "================================================"
echo "  Default session is now: openbox"
echo ""
echo "  Reboot to apply:"
echo "    sudo reboot"
echo "================================================"
