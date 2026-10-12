package erp.app.device

/**
 * What an owner's phone tells the ERP once signed in, and takes back on signing out: where to send
 * notifications (lib/push on the server, `push_devices` entries with `platform: 'android'`), and the
 * home-screen widget's own key (/api/widget/key). The structure is the iPhone's; the two bodies come with
 * their phases (docs/features/android-app.md, phase 5), so the shell calls them already.
 */
object DeviceLinks {
    // TODO(fcm): ask for POST_NOTIFICATIONS here (only a feature that needs it asks, never the launch), take the FCM
    // token, POST it to /api/push/devices {token, bundleId, label, platform: 'android'}; then link the widget key.
    suspend fun afterSignIn() {}

    // TODO(fcm): DELETE /api/push/devices {token} with a 3 s timeout, then clear the widget key. The caller caps the
    // wait: offline, the sign-out must still happen (the unregister is a courtesy, tried first while the token is good).
    @Suppress("UNUSED_PARAMETER")
    suspend fun beforeSignOut(unregister: Boolean = true) {}
}
