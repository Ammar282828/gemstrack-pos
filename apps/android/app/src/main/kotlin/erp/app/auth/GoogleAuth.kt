package erp.app.auth

import android.app.Activity
import android.content.Context
import android.util.Base64
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import erp.app.config.House
import erp.core.Json
import java.security.SecureRandom
import kotlinx.coroutines.CancellationException

/**
 * Google sign-in the way Android allows it: Credential Manager's Google sheet with the house's **web** OAuth
 * client as the server client id. Google's ID token signs Firebase in (Session), and the same token, silently
 * fetched again, is what the ERP pages inside the app get (web/WebBridge `googleSignIn`) without the sheet.
 * The iPhone keeps a refresh token for that; Credential Manager does it with an authorized-accounts request.
 */
object GoogleAuth {
    /** `code` is the app's: cancelled, not-configured, failed (what the ERP page's AppSignInError reads). */
    class Failure(val code: String, message: String) : Exception(message) {
        companion object {
            fun cancelled() = Failure("cancelled", "Sign-in cancelled.")
            fun notConfigured() = Failure("not-configured", "Google sign-in isn't set up in this build.")
            fun failed(why: String) = Failure("failed", why)
        }
    }

    data class Tokens(val idToken: String, val accessToken: String = "")

    private var cached: Pair<Tokens, Long>? = null

    /** The web client is what Credential Manager needs; empty until the owner has registered the house's Android app. */
    private val clientId: String get() = House.googleWebClientId
    val isConfigured: Boolean get() = clientId.endsWith(".apps.googleusercontent.com")

    /** A Google ID token: the one in hand if it has ten minutes left, else a silent request, else (if `interactive`) the sheet. */
    suspend fun idToken(activity: Activity, interactive: Boolean = true): Tokens {
        cachedToken(System.currentTimeMillis())?.let { return it }
        if (!isConfigured) throw Failure.notConfigured()
        try {
            return remember(request(activity, silent = true))
        } catch (e: Failure) {
            if (e.code == "cancelled") throw e
            if (!interactive) throw Failure.failed("Sign in again.")
        }
        return signIn(activity)
    }

    /** The account sheet. */
    suspend fun signIn(activity: Activity): Tokens {
        if (!isConfigured) throw Failure.notConfigured()
        return remember(request(activity, silent = false))
    }

    /** The token in hand while it has ten minutes left. */
    internal fun cachedToken(nowMs: Long): Tokens? = cached?.takeIf { it.second - Jwt.REFRESH_MARGIN_MS > nowMs }?.first

    private fun remember(t: Tokens): Tokens {
        // A token whose expiry cannot be read is used once, never kept.
        Jwt.expiryMillis(t.idToken)?.let { cached = t to it }
        return t
    }

    suspend fun signOut(context: Context) {
        cached = null
        runCatching { CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest()) }
    }

    private suspend fun request(activity: Activity, silent: Boolean): Tokens {
        val nonce = randomUrlSafe(16)
        val option = if (silent) {
            GetGoogleIdOption.Builder()
                .setFilterByAuthorizedAccounts(true)
                .setServerClientId(clientId)
                .setAutoSelectEnabled(true)
                .setNonce(nonce)
                .build()
        } else {
            GetSignInWithGoogleOption.Builder(clientId).setNonce(nonce).build()
        }
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
        try {
            val result = CredentialManager.create(activity).getCredential(activity, request)
            val credential = result.credential
            if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                return Tokens(GoogleIdTokenCredential.createFrom(credential.data).idToken)
            }
            throw Failure.failed("No answer from Google.")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Failure) {
            throw e
        } catch (e: GetCredentialCancellationException) {
            throw Failure.cancelled()
        } catch (e: NoCredentialException) {
            throw Failure.failed(if (silent) "Sign in again." else "No Google account on this phone to sign in with. Add one in Settings, then try again.")
        } catch (e: GetCredentialProviderConfigurationException) {
            throw Failure.failed("Google sign-in isn't available on this phone. Update Google Play services and try again.")
        } catch (e: GoogleIdTokenParsingException) {
            throw Failure.failed("Google's answer couldn't be read.")
        } catch (e: GetCredentialException) {
            throw Failure.failed(e.message?.takeIf { it.isNotBlank() } ?: "Couldn't open Google sign-in.")
        }
    }

    private fun randomUrlSafe(n: Int): String {
        val bytes = ByteArray(n)
        SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }
}

/** A JWT's expiry, read without checking it (Google and Firebase check it): only to know when to ask again. */
object Jwt {
    /** A token with less than this left is not handed out again. */
    const val REFRESH_MARGIN_MS = 10 * 60 * 1000L

    /** The `exp` claim in milliseconds since 1970, or null if the token is not a readable JWT. */
    fun expiryMillis(token: String): Long? {
        val parts = token.split('.')
        if (parts.size < 2) return null
        val payload = try {
            java.util.Base64.getUrlDecoder().decode(parts[1].trimEnd('='))
        } catch (e: IllegalArgumentException) {
            return null
        }
        val exp = (Json.parse(String(payload, Charsets.UTF_8)) as? Map<*, *>)?.get("exp") as? Number ?: return null
        return exp.toLong() * 1000
    }
}
