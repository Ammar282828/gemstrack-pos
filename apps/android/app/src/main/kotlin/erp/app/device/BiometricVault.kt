package erp.app.device

import android.app.Application
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.spec.MGF1ParameterSpec
import javax.crypto.Cipher
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Small secrets this phone keeps behind a fingerprint or face (the iPhone's FaceIDVault): the delete code, so a
 * delete asks for a finger instead of four digits typed in front of a customer. Kept for this phone only,
 * readable only after the biometric prompt, and forgotten by the phone itself if the enrolled biometrics change.
 * The server still checks the code every time (/api/auth/delete-code): this only types it.
 *
 * An RSA key pair in the Keystore, not an AES key: saving needs the public half alone, so it never prompts (the
 * iPhone's save does not ask for a face either); reading needs the private half, which is usable only after the
 * prompt, with the cipher handed to it.
 */
object BiometricVault {
    class Failure(val code: String, override val message: String) : Exception(message)

    private const val PROVIDER = "AndroidKeyStore"
    private const val PREFS = "erp_vault"
    private const val TRANSFORM = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding"
    private const val MAX_BYTES = 150

    private lateinit var app: Application

    fun init(application: Application) { app = application }

    private fun prefs() = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun alias(key: String) = "erp.secret.$key"

    /**
     * A secret belongs to one business (each shop has its own delete code): the build's own business keeps the key it always had (an
     * install keeps its fingerprint-sealed code), every other business's is named for it.
     */
    private fun scoped(key: String): String = erp.app.config.House.id.let { if (it == erp.app.config.Businesses.buildId) key else "$key.$it" }

    /** Whether a fingerprint or face can be used, and which (the page only asks whether). */
    fun biometry(): Pair<Boolean, String> {
        val ok = BiometricManager.from(app).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS
        return ok to (if (ok) "biometric" else "none")
    }

    fun save(value: String, name: String) {
        val key = scoped(name)
        val bytes = value.toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_BYTES) throw Failure("failed", "That is too long to keep.")
        try {
            purge(key)
            val pair = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, PROVIDER).run {
                initialize(
                    KeyGenParameterSpec.Builder(alias(key), KeyProperties.PURPOSE_DECRYPT or KeyProperties.PURPOSE_ENCRYPT)
                        .setKeySize(2048)
                        .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
                        .setUserAuthenticationRequired(true)
                        .setInvalidatedByBiometricEnrollment(true)
                        .build(),
                )
                generateKeyPair()
            }
            // The Keystore's own OAEP uses SHA-1 for MGF1; the public key used outside it must say so.
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.ENCRYPT_MODE, pair.public, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT))
            prefs().edit().putString(key, Base64.encodeToString(cipher.doFinal(bytes), Base64.NO_WRAP)).apply()
        } catch (e: Failure) {
            throw e
        } catch (e: Exception) {
            purge(key)
            throw Failure("unavailable", "This phone can't keep it behind a fingerprint.")
        }
    }

    /** Whether a secret is kept, without asking for a finger. */
    fun has(name: String): Boolean = scoped(name).let { key -> prefs().contains(key) && keyStore().containsAlias(alias(key)) }

    fun delete(name: String) = purge(scoped(name))

    /** Forgets an already-scoped key. */
    private fun purge(key: String) {
        prefs().edit().remove(key).apply()
        runCatching { keyStore().deleteEntry(alias(key)) }
    }

    /** The secret after the biometric prompt, or null when none is kept (or the phone's biometrics changed and it is gone). */
    suspend fun read(name: String, reason: String): String? {
        val key = scoped(name)
        val stored = prefs().getString(key, null) ?: return null
        val activity = Foreground.activity ?: throw Failure("failed", "The app isn't in front.")
        val cipher = try {
            val private = keyStore().getKey(alias(key), null) ?: run { purge(key); return null }
            Cipher.getInstance(TRANSFORM).apply {
                init(Cipher.DECRYPT_MODE, private as java.security.PrivateKey, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT))
            }
        } catch (e: KeyPermanentlyInvalidatedException) {
            purge(key) // the enrolled biometrics changed: the phone forgets it, the page asks for the code typed
            return null
        } catch (e: Exception) {
            throw Failure("failed", "The fingerprint didn't unlock it.")
        }
        val opened = authenticate(activity, reason, cipher)
        return try {
            String(opened.doFinal(Base64.decode(stored, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (e: Exception) {
            throw Failure("failed", "The fingerprint didn't unlock it.")
        }
    }

    private suspend fun authenticate(activity: FragmentActivity, reason: String, cipher: Cipher): Cipher = suspendCancellableCoroutine { cont ->
        val executor = ContextCompat.getMainExecutor(activity)
        val prompt = BiometricPrompt(activity, executor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val c = result.cryptoObject?.cipher
                if (cont.isActive) { if (c != null) cont.resume(c) else cont.resumeWithException(Failure("failed", "The fingerprint didn't unlock it.")) }
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                val cancelled = errorCode == BiometricPrompt.ERROR_USER_CANCELED || errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                    errorCode == BiometricPrompt.ERROR_CANCELED
                if (cont.isActive) cont.resumeWithException(if (cancelled) Failure("cancelled", "Cancelled") else Failure("failed", errString.toString()))
            }
        })
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(reason)
            .setNegativeButtonText("Cancel")
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            .build()
        cont.invokeOnCancellation { prompt.cancelAuthentication() }
        prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(PROVIDER).apply { load(null) }
}
