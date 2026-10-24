package erp.app.auth

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.R
import erp.app.config.Business
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.screens.businesses.BusinessLogo

fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}

/**
 * Sign in with Google, on the business's own ground: it says which business this is signing in to, with a way to switch (a business
 * whose Android app is not registered yet says so here and offers the others, rather than failing).
 */
@Composable
fun SignInScreen(session: Session) {
    val state by session.state.collectAsStateWithLifecycle()
    val error by session.error.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findActivity()
    SignInBody(
        session.business, state, error, canAsk = activity != null,
        onGoogle = { activity?.let(session::signIn) }, onBrowser = { activity?.let(session::signInThroughBrowser) },
    )
}

/** The page itself, from what it shows (a screenshot draws it for a business that is not set up, which no Session in the demo can be). */
@Composable
internal fun SignInBody(business: Business, state: Session.State, error: String?, canAsk: Boolean, onGoogle: () -> Unit, onBrowser: () -> Unit) {
    val signingIn = state == Session.State.SigningIn

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        // Scrolls rather than clips at the largest text sizes and in landscape; centred when it fits.
        Box(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) {
            Column(
                Modifier.widthIn(max = 520.dp).padding(horizontal = 32.dp, vertical = 24.dp),
                verticalArrangement = Arrangement.spacedBy(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                BusinessLogo(business, Modifier.widthIn(max = 280.dp), height = 64.dp)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(business.displayName, style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
                    Text(
                        "Sign in with the Gmail the shop has for you.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
                if (state == Session.State.NeedsSetup) {
                    Text(House.needsSetupMessage(business), style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
                } else {
                    // The button says what is happening; the page itself never goes to a loading state.
                    Button(onClick = onGoogle, enabled = !signingIn && canAsk) {
                        Text(if (signingIn) "Signing in…" else "Sign in with Google")
                    }
                    TextButton(onClick = onBrowser, enabled = !signingIn && canAsk) {
                        Text("Sign in through the browser")
                    }
                }
                error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
                // Another business of this phone's, or a new one by its address.
                TextButton(onClick = Businesses::openSheet) { Text("Switch business") }
            }
        }
    }
}
