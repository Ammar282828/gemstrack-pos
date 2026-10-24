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
import erp.app.data.Outbox
import erp.app.device.AppLock
import erp.app.device.Foreground
import erp.app.device.LaunchClock
import erp.app.nav.AppRoot
import erp.app.nav.AppRouter
import erp.app.nav.ThemeChoice
import erp.app.widget.WidgetSync
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
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
            AppRouter.handle(this, intent)
            // A cold start of a signed-in app asks for the fingerprint too; a fresh sign-in does not.
            if (session.state.value == Session.State.SignedIn) AppLock.launched(this, signedIn = true)
        }
        // The launch report's steps (LaunchClock): the first frame, the sign-in, and the books of the first page.
        window.decorView.viewTreeObserver.addOnPreDrawListener(object : android.view.ViewTreeObserver.OnPreDrawListener {
            override fun onPreDraw(): Boolean {
                window.decorView.viewTreeObserver.removeOnPreDrawListener(this)
                LaunchClock.mark("frame:first")
                return true
            }
        })
        lifecycleScope.launch {
            // Home is ready when its orders and invoices are in; a karigar's own page ends the launch itself.
            val book = erp.app.data.Book.shared
            combine(book.orders.loaded, book.invoices.loaded) { a, b -> a && b }.first { it }
            LaunchClock.finish("home")
        }
        lifecycleScope.launch {
            var before = session.state.value
            if (before == Session.State.SignedIn) LaunchClock.mark("session:signedIn", session.me.value?.role.orEmpty())
            session.state.collect { s ->
                if (s == Session.State.SignedIn) LaunchClock.mark("session:signedIn", session.me.value?.role.orEmpty())
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
        AppRouter.handle(this, intent)
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
        // Back in front: the server is warmed for the first tap, and saves a kill or a dead line left are sent again.
        if (signedIn && !House.isDemo) { Outbox.warm(); Outbox.resume() }
        // The widget's figures are as fresh as the app coming to the front.
        if (signedIn && session.isOwner && !House.isDemo) WidgetSync.refreshSoon(this)
        lifecycleScope.launch { AppLock.unlockIfNeeded(this@MainActivity) }
    }

    override fun onDestroy() {
        Foreground.detach(this)
        super.onDestroy()
    }
}
