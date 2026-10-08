# Native builds asked for by hand

A line added here sends each house whose Firebase iOS app is registered (`houses.json`, `firebase.iosAppId`) to
TestFlight as version 2.0 (`.github/workflows/iphone-native.yml`), as "Run workflow" with *testflight* ticked does: a
cloud session cannot press that button, but it can push. One line per build, newest last.
