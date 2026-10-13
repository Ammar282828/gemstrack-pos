package erp.app.widget

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The widget's key and its last figures, on this phone only. The key is sealed with an AES key that never leaves the
 * Android Keystore (`ERPWidgetLink`'s keychain, in Android's terms), so a copy of the preferences file opens nothing;
 * and the key itself reads only /api/widget/summary, and the ERP can forget it.
 */
object WidgetStore {
    private const val PREFS = "erp_widget"
    private const val ALIAS = "erp.widget.link"
    private const val LINK = "link"
    private const val CACHE = "last"
    private const val OWNER = "owner"

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun secret(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            generateKey()
        }
    }

    fun save(context: Context, link: WidgetLinkData): Boolean = try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, secret()) }
        val sealed = cipher.iv + cipher.doFinal(link.encode().toByteArray(Charsets.UTF_8))
        prefs(context).edit().putString(LINK, Base64.encodeToString(sealed, Base64.NO_WRAP)).apply()
        true
    } catch (e: Exception) {
        false
    }

    fun load(context: Context): WidgetLinkData? = try {
        val sealed = Base64.decode(prefs(context).getString(LINK, null) ?: return null, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, secret(), GCMParameterSpec(128, sealed.copyOfRange(0, 12))) }
        WidgetLinkData.decode(String(cipher.doFinal(sealed, 12, sealed.size - 12), Charsets.UTF_8))
    } catch (e: Exception) {
        null
    }

    fun clear(context: Context) {
        prefs(context).edit().remove(LINK).remove(CACHE).remove(OWNER).apply()
    }

    /** Which link the cached figures were read with: another account's figures are never shown under a new link. */
    fun ownerHash(link: WidgetLinkData): String =
        MessageDigest.getInstance("SHA-256").digest("${link.url}|${link.key}".toByteArray()).joinToString("") { "%02x".format(it) }

    fun cache(context: Context, link: WidgetLinkData, json: String) {
        prefs(context).edit().putString(OWNER, ownerHash(link)).putString(CACHE, json).apply()
    }

    /** The last figures that came through, shown with their own time when the ERP cannot be reached. */
    fun cached(context: Context, link: WidgetLinkData): WidgetSummary? {
        val p = prefs(context)
        if (p.getString(OWNER, null) != ownerHash(link)) return null
        return p.getString(CACHE, null)?.let { WidgetSummary.decode(it) }
    }
}
