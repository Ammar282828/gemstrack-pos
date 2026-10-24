package erp.app.config

import erp.app.auth.Session
import erp.app.data.FirestoreSource
import erp.app.device.DeviceLinks
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Signs a business out of this phone without touching the open one (Sessions.signOutForRemoval): the ERP forgets this phone's
 * alerts and the widget's key, Firebase forgets the person, and the books on disk are erased. Never waits long: offline, the
 * removal must still happen.
 */
object BusinessRemoval {
    suspend fun signOut(b: Business) {
        if (House.isDemo) return
        val auth = Businesses.auth(b)
        if (auth?.currentUser != null) {
            withTimeoutOrNull(7_000) { DeviceLinks.beforeSignOut(unregister = true, business = b) }
            auth.signOut()
            FirestoreSource.forget(b)
        } else {
            // Nobody signed in: only what a key left behind goes.
            DeviceLinks.beforeSignOut(unregister = false, business = b)
        }
        Session.forgetLastMe(b.id)
    }
}
