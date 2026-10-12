#!/usr/bin/env bash
# Installs the Android SDK the build needs into $ANDROID_HOME (default /opt/android-sdk). Safe to run again.
# A fresh Linux container with JDK 17+, curl and unzip is enough.
set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
TOOLS_REV="${TOOLS_REV:-16111833}"   # commandlinetools-linux revision (Google's repository2-3.xml lists the latest)
PLATFORM="${PLATFORM:-android-37.0}"
BUILD_TOOLS="${BUILD_TOOLS:-37.0.0}"

mkdir -p "$ANDROID_HOME"
SM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"

if [ ! -x "$SM" ]; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/tools.zip" "https://dl.google.com/android/repository/commandlinetools-linux-${TOOLS_REV}_latest.zip"
  unzip -q "$tmp/tools.zip" -d "$tmp/x"
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  rm -rf "$ANDROID_HOME/cmdline-tools/latest"
  mv "$tmp/x/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
  rm -rf "$tmp"
fi

# Licences are accepted by piping "y"; the newer sdkmanager also writes them on first install.
# (a finite answer list, not `yes`: under pipefail yes dies of SIGPIPE and fails the script)
answers() { for _ in $(seq 40); do echo y; done; }
answers | "$SM" --sdk_root="$ANDROID_HOME" --licenses >/dev/null 2>&1 || true
answers | "$SM" --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;$PLATFORM" "build-tools;$BUILD_TOOLS" >/dev/null

# What a shell sources to build: `source $ANDROID_HOME/env.sh`
cat > "$ANDROID_HOME/env.sh" <<X
export ANDROID_HOME=$ANDROID_HOME
export ANDROID_SDK_ROOT=\$ANDROID_HOME
export PATH=\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/build-tools/$BUILD_TOOLS:\$PATH
X

echo "Android SDK ready in $ANDROID_HOME (platform $PLATFORM, build-tools $BUILD_TOOLS). Run: source $ANDROID_HOME/env.sh"
