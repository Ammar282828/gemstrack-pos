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

# Mina's workflows build ERPMina.xcodeproj (project-mina.yml), Taheri's ERP.xcodeproj: Xcode Cloud keeps one
# product per project file. CI_XCODE_PROJECT names the file the workflow builds; the bundle ID is the fallback.
case "${CI_XCODE_PROJECT:-}" in
  *ERPMina.xcodeproj) HOUSE=mina ;;
  *ERP.xcodeproj) HOUSE=taheri ;;
  *) HOUSE=$(CI_BUNDLE_ID="${CI_BUNDLE_ID:-}" node -e '
  const h = require("./houses.json");
  const id = process.env.CI_BUNDLE_ID;
  const name = Object.keys(h).find((k) => h[k].bundleId === id);
  if (!name) { console.error("No house has the bundle ID " + id + " (houses.json)"); process.exit(1); }
  console.log(name);
') ;;
esac
if [ "$HOUSE" = mina ]; then SPEC=project-mina.yml; PROJ=ERPMina.xcodeproj; else SPEC=project.yml; PROJ=ERP.xcodeproj; fi
echo "Dressing the app as $HOUSE (build ${CI_BUILD_NUMBER:-1}, team ${CI_TEAM_ID:-?})"
node scripts/house.mjs "$HOUSE" --auto "${CI_TEAM_ID:-}" "${CI_BUILD_NUMBER:-1}" >/dev/null
xcodegen generate --spec "$SPEC"

# Xcode Cloud builds with package resolution switched off, only from the project's Package.resolved, and a
# project made here has none: the committed one (apps/iphone/Package.resolved, Firebase's exact version and
# everything it pulls in) is put where Xcode looks. Change Firebase's version in project.yml and this file is
# remade: `swift package resolve` on a package with the same dependency, or Xcode's own after a local build.
mkdir -p "$PROJ/project.xcworkspace/xcshareddata/swiftpm"
cp Package.resolved "$PROJ/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"
# As GitHub's build passed -skipPackagePluginValidation and -skipMacroValidation, the packages' plugins and
# macros are trusted.
defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation -bool YES
defaults write com.apple.dt.Xcode IDESkipMacroFingerprintValidation -bool YES
echo "$PROJ is made, with its Package.resolved"
