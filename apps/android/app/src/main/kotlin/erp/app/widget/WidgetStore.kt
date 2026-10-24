package erp.app.widget

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import erp.app.data.JsonText
import erp.core.Json
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The widget's keys and its last figures, on this phone only: one key per business (ERPWidgetLink's keychain list, in Android's
 * terms). The keys are sealed, as one list, with an AES key that never leaves the Android Keystore, so a copy of the preferences
 * file opens nothing; and a key itself reads only /api/widget/summary, and the ERP can forget it. The figures last read are kept per
 * business beside them, under the key's own hash: another account's figures are never shown under a new key.
 */
object WidgetStore {
    private const val PREFS = "erp_widget"
    private const val ALIAS = "erp.widget.link"
    private const val LIST = "links"

    /** What the one-house build kept: a single link under this name, moved into the list when first read. */
    private const val LEGACY = "link"
    private const val CACHE = "last."
    private const val OWNER = "owner."

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

    private fun seal(text: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, secret()) }
        return Base64.encodeToString(cipher.iv + cipher.doFinal(text.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    private fun open(sealedText: String): String? = try {
        val sealed = Base64.decode(sealedText, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, secret(), GCMParameterSpec(128, sealed.copyOfRange(0, 12))) }
        String(cipher.doFinal(sealed, 12, sealed.size - 12), Charsets.UTF_8)
    } catch (e: Exception) {
        null
    }

    /** Every linked business, in the order they were linked. A link from the one-house build is moved into the list the first time it is read. */
    @Synchronized
    fun all(context: Context): List<WidgetLinkData> {
        val p = prefs(context)
        p.getString(LIST, null)?.let { text ->
            val list = open(text)?.let { runCatching { Json.parse(it) }.getOrNull() } as? List<*>
            if (list != null) return list.mapNotNull { WidgetLinkData.from(it) }
        }
        val old = p.getString(LEGACY, null)?.let { open(it) }?.let { WidgetLinkData.decode(it) } ?: return emptyList()
        store(context, listOf(old))
        p.edit().remove(LEGACY).apply()
        return listOf(old)
    }

    fun link(context: Context, id: String): WidgetLinkData? = all(context).firstOrNull { it.id == id }

    @Synchronized
    private fun store(context: Context, list: List<WidgetLinkData>): Boolean = try {
        val edit = prefs(context).edit()
        if (list.isEmpty()) edit.remove(LIST) else edit.putString(LIST, seal(JsonText.of(list.map { it.toMap() }) ?: "[]"))
        edit.apply()
        true
    } catch (e: Exception) {
        false
    }

    /** Adds the business's link, or replaces the one it has (its place in the list is kept). */
    @Synchronized
    fun save(context: Context, link: WidgetLinkData): Boolean {
        val list = all(context).toMutableList()
        val i = list.indexOfFirst { it.id == link.id }
        if (i >= 0) list[i] = link else list.add(link)
        return store(context, list)
    }

    /** A business signed out or removed: its link and its figures go, the others stay. */
    @Synchronized
    fun remove(context: Context, id: String) {
        store(context, all(context).filter { it.id != id })
        prefs(context).edit().remove(CACHE + id).remove(OWNER + id).apply()
    }

    /** Every link and every kept figure (the app's data cleared). */
    @Synchronized
    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }

    /** Which link the cached figures were read with: another account's figures are never shown under a new link. */
    fun ownerHash(link: WidgetLinkData): String =
        MessageDigest.getInstance("SHA-256").digest("${link.url}|${link.key}".toByteArray()).joinToString("") { "%02x".format(it) }

    fun cache(context: Context, link: WidgetLinkData, json: String) {
        prefs(context).edit().putString(OWNER + link.id, ownerHash(link)).putString(CACHE + link.id, json).apply()
    }

    /** The last figures that came through for this business, shown with their own time when the ERP cannot be reached. */
    fun cached(context: Context, link: WidgetLinkData): WidgetSummary? {
        val p = prefs(context)
        if (p.getString(OWNER + link.id, null) != ownerHash(link)) return null
        return p.getString(CACHE + link.id, null)?.let { WidgetSummary.decode(it) }
    }
}
