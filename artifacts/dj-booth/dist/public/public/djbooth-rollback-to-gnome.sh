#!/bin/bash
# NEON AI DJ — emergency rollback from openbox session back to GNOME.
# Run from SSH if openbox session is broken. One command. No UI needed.
#
# Usage:  bash ~/djbooth-rollback-to-gnome.sh
# Then:   sudo reboot
#
# GNOME stays installed on every unit even after the openbox migration — this
# script just flips the default GDM session back to "GNOME on Xorg".

set -e

UNIT_USER=$(whoami)
ACCOUNT_FILE="/var/lib/AccountsService/users/$UNIT_USER"

echo "Flipping default session back to GNOME (gnome-xorg) for user $UNIT_USER..."

sudo mkdir -p /var/lib/AccountsService/users
sudo tee "$ACCOUNT_FILE" > /dev/null << EOF
[User]
Session=gnome-xorg
XSession=gnome-xorg
SystemAccount=false
EOF

echo ""
echo "================================================"
echo "  Default session is now: gnome-xorg"
echo ""
echo "  Reboot to apply:"
echo "    sudo reboot"
echo ""
echo "  To switch BACK to openbox later:"
echo "    bash ~/djbooth-rollback-to-openbox.sh"
echo "================================================"
