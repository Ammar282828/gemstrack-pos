#!/bin/sh
# Xcode Cloud (docs/features/iphone-app.md "Xcode Cloud"): runs after the clone, before any build.
# ERP.xcodeproj is never committed (project.yml), so it is made here, dressed as the house whose
# product this workflow builds: Xcode Cloud says which by the bundle ID (houses.json), and the team
# it signs for. Automatic signing: Xcode Cloud holds the certificates, nothing is kept here.
set -eu
cd "$CI_PRIMARY_REPOSITORY_PATH/apps/iphone"

export HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1
command -v xcodegen >/dev/null || brew install xcodegen
command -v node >/dev/null || brew install node

HOUSE=$(CI_BUNDLE_ID="${CI_BUNDLE_ID:-}" node -e '
  const h = require("./houses.json");
  const id = process.env.CI_BUNDLE_ID;
  const name = Object.keys(h).find((k) => h[k].bundleId === id);
  if (!name) { console.error("No house has the bundle ID " + id + " (houses.json)"); process.exit(1); }
  console.log(name);
')
echo "Dressing the app as $HOUSE (build ${CI_BUILD_NUMBER:-1}, team ${CI_TEAM_ID:-?})"
node scripts/house.mjs "$HOUSE" --auto "${CI_TEAM_ID:-}" "${CI_BUILD_NUMBER:-1}" >/dev/null
xcodegen generate --spec project.yml

# Xcode Cloud builds with package resolution switched off, from the project's Package.resolved: a project
# made here has none, so the packages are resolved now (Firebase, ERPCore). As GitHub's build passed
# -skipPackagePluginValidation and -skipMacroValidation, the packages' plugins and macros are trusted.
defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation -bool YES
defaults write com.apple.dt.Xcode IDESkipMacroFingerprintValidation -bool YES
xcodebuild -resolvePackageDependencies -project ERP.xcodeproj -scheme ERP -skipPackagePluginValidation -skipMacroValidation >/dev/null
echo "ERP.xcodeproj is made and its packages resolved"
