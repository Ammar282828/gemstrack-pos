# The ERP's iPhone app

A Capacitor shell around the live ERP, one app per house. Why it is built this way, what it does for the page and
how it reaches the phones: [docs/features/iphone-app.md](../../docs/features/iphone-app.md).

- `houses.json`: what differs between Taheri ERP and House of Mina ERP (bundle ID, names, address, Google client).
- `scripts/house.mjs <taheri|mina>`: dress the project as one house, then `npx cap sync ios` (Node 22).
- `ios/App/App/ERP.swift`: the app's own pieces (Google sign-in, live words, the status bar).
- `scripts/asc.mjs`: App Store Connect for the workflow (`.github/workflows/ios.yml`).
- `ci/probe.html`: what the simulator check runs inside the app.
- Icons and launch screens: `node scripts/make-icons.mjs` from the repository root.

On a Mac: `npm ci`, `node scripts/house.mjs taheri`, `npx cap sync ios`, then open `ios/App/App.xcodeproj`.
