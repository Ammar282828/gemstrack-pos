#!/bin/sh
# Once, on the Mac, for each house (docs/features/iphone-app.md "Xcode Cloud"): make the project as that
# house and open it in Xcode, to create the house's Xcode Cloud workflows there.
#
#   sh apps/iphone/scripts/xcode-cloud-setup.sh taheri     (then again with mina)
set -eu
HOUSE=${1:-taheri}
cd "$(dirname "$0")/.."
command -v xcodegen >/dev/null || brew install xcodegen
node scripts/house.mjs "$HOUSE" --auto >/dev/null
xcodegen generate --spec project.yml
echo "Opening the $HOUSE app in Xcode: Integrate → Create Workflow… (docs/features/iphone-app.md \"Xcode Cloud\")"
open ERP.xcodeproj
