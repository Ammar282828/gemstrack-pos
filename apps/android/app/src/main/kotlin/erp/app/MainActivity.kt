package erp.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import erp.app.auth.Session
import erp.app.config.House
import erp.app.device.AppLock
import erp.app.device.Foreground
import erp.app.nav.AppRoot
import erp.app.nav.AppRouter
import erp.app.nav.ThemeChoice
import kotlinx.coroutines.launch

// FragmentActivity (a ComponentActivity) because BiometricPrompt, the delete code's and the lock's, wants one.
class MainActivity : FragmentActivity() {
    private val session: Session get() = ErpApp.session

    override fun onCreate(savedInstanceState: Bundle?) {
        val splash = installSplashScreen() // before super: swaps the splash theme for Theme.Erp
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Before the Session exists: the demo is decided by the launch intent.
        House.applyIntent(intent)
        ErpApp.ensureFirebase()
        ThemeChoice.load()
        Foreground.attach(this)
        // Held only while the ERP is asked who a new account is, and no longer than a second.
        val started = System.currentTimeMillis()
        splash.setKeepOnScreenCondition { session.state.value == Session.State.Starting && System.currentTimeMillis() - started < 1000 }
        if (savedInstanceState == null) {
            AppRouter.handle(intent)
            // A cold start of a signed-in app asks for the fingerprint too; a fresh sign-in does not.
            if (session.state.value == Session.State.SignedIn) AppLock.launched(this, signedIn = true)
        }
        lifecycleScope.launch {
            var before = session.state.value
            session.state.collect { s ->
                if (before == Session.State.Starting && s == Session.State.SignedIn && savedInstanceState == null) {
                    // The cached sign-in was someone else's or missing and the ERP has now said who this is.
                    AppLock.launched(this@MainActivity, signedIn = true)
                    AppLock.unlockIfNeeded(this@MainActivity)
                }
                before = s
                if (s != Session.State.SignedIn) AppLock.signedOut()
                AppLock.applyRecentsPolicy(this@MainActivity, hide = s == Session.State.SignedIn && AppLock.enabled && !House.isDemo)
            }
        }
        setContent { AppRoot(session) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // A link or a tapped notification opens its page over whatever is showing.
        AppRouter.handle(intent)
    }

    private val signedIn: Boolean get() = session.state.value == Session.State.SignedIn

    override fun onPause() {
        AppLock.paused(signedIn)
        super.onPause()
    }

    override fun onStop() {
        AppLock.stopped(signedIn)
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        AppLock.resumed(this, signedIn)
        lifecycleScope.launch { AppLock.unlockIfNeeded(this@MainActivity) }
    }

    override fun onDestroy() {
        Foreground.detach(this)
        super.onDestroy()
    }
}
