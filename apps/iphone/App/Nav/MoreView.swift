import SwiftUI

/// Sign in with Google, on the house's own ground.
struct SignInView: View {
    @Environment(Session.self) private var session

    var body: some View {
        // Scrolls rather than clips at the largest text sizes and in landscape; centred when it fits.
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 28) {
                    HouseLogo().padding(.horizontal, 32)
                    VStack(spacing: 6) {
                        Text(House.storeName).font(.title.weight(.semibold)).multilineTextAlignment(.center)
                        // Which business this is for: the person may have come back to one of several.
                        Label {
                            Text("Signing in to \(House.business.host)")
                        } icon: {
                            BusinessBadge(business: House.business, size: 20)
                        }
                        .font(.footnote).foregroundStyle(.secondary)
                        .accessibilityElement(children: .combine)
                        Text("Sign in with the Gmail the shop has for you.").font(.subheadline).foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    if session.state == .needsSetup {
                        Text("This build can't reach the shop's book yet: its Firebase iOS app is not registered.")
                            .font(.footnote).multilineTextAlignment(.center)
                    } else {
                        let signingIn = session.state == .signingIn
                        Button {
                            Task { await session.signIn() }
                        } label: {
                            // The button says what is happening; the page itself never goes to a loading state.
                            Label(signingIn ? "Signing in…" : "Sign in with Google",
                                  systemImage: signingIn ? "hourglass" : "person.crop.circle.badge.checkmark")
                                .frame(maxWidth: 280)
                                .padding(.vertical, 6)
                        }
                        .buttonStyle(.houseProminent)
                        .largeOnPhone()
                        .disabled(signingIn)
                    }
                    if let e = session.error {
                        Label(e, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote).foregroundStyle(Tone.problem.color).multilineTextAlignment(.center)
                    }
                    if !House.isDemo {
                        Button {
                            Businesses.shared.switcherOpen = true
                        } label: {
                            Label(Businesses.shared.list.count > 1 ? "Switch business" : "Add a business", systemImage: "arrow.left.arrow.right")
                        }
                        .buttonStyle(.houseGlass)
                        .disabled(session.state == .signingIn)
                        .accessibilityIdentifier("signin.switch")
                    }
                }
                .padding(.horizontal, 32)
                .padding(.vertical, 24)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity, minHeight: geo.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(Theme.ground.ignoresSafeArea())
    }
}
