package erp.app

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import erp.app.auth.Session
import erp.app.config.House
import erp.app.data.Outbox
import erp.app.device.AppLock
import erp.app.device.Foreground
import erp.app.nav.AppShell
import erp.app.nav.LocalNavigator
import erp.app.nav.Navigator
import erp.app.nav.PlaceScreen
import erp.app.nav.ThemeChoice
import kotlinx.coroutines.launch

/**
 * One ERP page (a pushed screen, a create action, a link) as an Activity of its own, over MainActivity's tabs or over
 * another page. That is the point: Android draws the open and close animation and the predictive Back gesture between
 * Activities itself, so the app adds no transition of its own (owner, 2026-10-15). It wears what MainActivity wears
 * ([AppShell]) and shows `PlaceScreen(path)` with its back arrow.
 */
class PageActivity : FragmentActivity() {
    private val session: Session get() = ErpApp.session
    private val signedIn: Boolean get() = session.state.value == Session.State.SignedIn

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // A page restored after the process died starts here, not in MainActivity: make the same preparations (all idempotent).
        House.applyIntent(intent)
        ErpApp.ensureFirebase()
        ThemeChoice.load()
        Foreground.attach(this)
        val path = intent.getStringExtra(EXTRA_PATH)
        if (path == null) { finish(); return }
        // Signed out (or into someone else's account) while a page is up: the tabs' sign-in is the only place to be.
        lifecycleScope.launch {
            session.state.collect { s ->
                if (s != Session.State.SignedIn && s != Session.State.Starting) finish()
                AppLock.applyRecentsPolicy(this@PageActivity, hide = s == Session.State.SignedIn && AppLock.enabled && !House.isDemo)
            }
        }
        setContent {
            AppShell(session) {
                val navigator = remember { PageNavigator(this@PageActivity) }
                CompositionLocalProvider(LocalNavigator provides navigator) {
                    PlaceScreen(path, isRoot = false)
                }
            }
        }
    }

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
        if (signedIn && !House.isDemo) { Outbox.warm(); Outbox.resume() }
        lifecycleScope.launch { AppLock.unlockIfNeeded(this@PageActivity) }
    }

    override fun onDestroy() {
        Foreground.detach(this)
        super.onDestroy()
    }

    companion object {
        const val EXTRA_PATH = "erp.path"

        fun intent(context: Context, path: String): Intent =
            Intent(context, PageActivity::class.java).putExtra(EXTRA_PATH, path)

        /** Opens the page over the caller; the platform's own transition. */
        fun start(context: Context, path: String) {
            val intent = intent(context, path)
            // Not from an Activity (never today): a task of its own is the only way to start one.
            if (context !is android.app.Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
        }
    }
}

/** A page's Navigator: forward is another Activity, back is finishing this one. */
private class PageNavigator(private val activity: PageActivity) : Navigator {
    override fun open(path: String) = PageActivity.start(activity, path)

    override fun replace(path: String) {
        PageActivity.start(activity, path)
        activity.finish()
    }

    override fun back() = activity.finish()

    override val canGoBack: Boolean get() = true
}
