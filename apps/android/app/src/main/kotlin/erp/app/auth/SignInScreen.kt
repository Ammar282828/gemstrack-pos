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
import erp.app.config.House

fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}

/** Sign in with Google, on the house's own ground. */
@Composable
fun SignInScreen(session: Session) {
    val state by session.state.collectAsStateWithLifecycle()
    val error by session.error.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findActivity()
    val signingIn = state == Session.State.SigningIn

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        // Scrolls rather than clips at the largest text sizes and in landscape; centred when it fits.
        Box(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()), contentAlignment = Alignment.Center) {
            Column(
                Modifier.widthIn(max = 520.dp).padding(horizontal = 32.dp, vertical = 24.dp),
                verticalArrangement = Arrangement.spacedBy(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Image(painterResource(R.drawable.brand_logo), stringResource(R.string.app_name), Modifier.widthIn(max = 280.dp))
                Column(verticalArrangement = Arrangement.spacedBy(6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(House.storeName, style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
                    Text(
                        "Sign in with the Gmail the shop has for you.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                    )
                }
                if (state == Session.State.NeedsSetup) {
                    Text(House.needsSetupMessage, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
                } else {
                    // The button says what is happening; the page itself never goes to a loading state.
                    Button(onClick = { activity?.let(session::signIn) }, enabled = !signingIn && activity != null) {
                        Text(if (signingIn) "Signing in…" else "Sign in with Google")
                    }
                }
                error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center) }
            }
        }
    }
}
