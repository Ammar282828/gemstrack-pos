package erp.app.config

import android.content.Context
import android.content.SharedPreferences

/**
 * The phone's small settings (the iPhone's UserDefaults): the last answer of /api/app/me, the theme, the
 * lock switch, a draft's remote id. Synchronous on purpose: Session reads its cached answer before the
 * first frame, and a DataStore read would make a cold start wait. Nothing secret lives here: those are
 * kept in the Keystore (device/BiometricVault).
 *
 * One app holds many businesses, so a key belongs to the open business unless it is one of the phone's own
 * ([isPhoneWide]): its stored name is the key with the business id after it ("erp.orderDraft" -> "erp.orderDraft.taheri",
 * the iPhone's `BizKey`), so a draft started in one business is never opened in another, and no call site has to
 * remember to say so.
 */
object Prefs {
    private var store: SharedPreferences? = null

    /** Before init (unit tests) everything is kept in memory. */
    private val memory = HashMap<String, Any?>()

    /** The business whose keys these are: the open one (Businesses sets it); Taheri's before anything has. */
    @Volatile var scope: () -> String = { "taheri" }

    /** Settings that are the phone's, not a business's: the theme, the lock, notifications, the business list itself. */
    private val phoneWide = setOf(
        "deviceTheme", "erp.lock.enabled", "erp.notifications.asked", "design.tidy", "stock.layout", "artwork.snap",
        "orders.grouping",
        BUSINESS_CURRENT, ASK_AT_LAUNCH, MIGRATED, WIDGET_BOTH,
    )

    fun isPhoneWide(key: String): Boolean = key in phoneWide || key.startsWith("erp.phone.")

    /** The stored name of `key` for a business. */
    fun keyFor(key: String, business: String): String = if (isPhoneWide(key)) key else "$key.$business"

    private fun real(key: String) = keyFor(key, scope())

    fun init(context: Context) {
        if (store == null) store = context.applicationContext.getSharedPreferences("erp", Context.MODE_PRIVATE)
    }

    fun string(key: String, business: String? = null): String? {
        val k = if (business == null) real(key) else keyFor(key, business)
        return store?.getString(k, null) ?: (if (store == null) memory[k] as? String else null)
    }

    fun putString(key: String, value: String?, business: String? = null) {
        val k = if (business == null) real(key) else keyFor(key, business)
        val s = store
        if (s == null) { memory[k] = value; return }
        s.edit().apply { if (value == null) remove(k) else putString(k, value) }.apply()
    }

    fun bool(key: String): Boolean? {
        val k = real(key)
        val s = store ?: return memory[k] as? Boolean
        return if (s.contains(k)) s.getBoolean(k, false) else null
    }

    fun putBool(key: String, value: Boolean?) {
        val k = real(key)
        val s = store
        if (s == null) { memory[k] = value; return }
        s.edit().apply { if (value == null) remove(k) else putBoolean(k, value) }.apply()
    }

    fun remove(key: String, business: String? = null) {
        putString(key, null, business)
    }

    /** Everything one business kept here (a removal): every key that ends with its id and is not the phone's. */
    fun forget(business: String) {
        val s = store
        val suffix = ".$business"
        if (s == null) { memory.keys.filter { it.endsWith(suffix) }.forEach { memory.remove(it) }; return }
        val edit = s.edit()
        s.all.keys.filter { it.endsWith(suffix) && !isPhoneWide(it) }.forEach { edit.remove(it) }
        edit.apply()
    }

    /**
     * Once: what the one-business builds kept under unsuffixed names now belongs to the business that build was (Taheri
     * for the one app; the Mina flavor was Mina's own app), the way the iPhone moves its legacy keys (BizDefaults.moveLegacy).
     */
    fun moveLegacy(to: String) {
        val s = store ?: return
        if (s.getBoolean(MIGRATED, false)) return
        val edit = s.edit()
        for ((key, value) in s.all) {
            if (isPhoneWide(key)) continue
            val moved = "$key.$to"
            if (!s.contains(moved)) when (value) {
                is String -> edit.putString(moved, value)
                is Boolean -> edit.putBoolean(moved, value)
                is Int -> edit.putInt(moved, value)
                is Long -> edit.putLong(moved, value)
                is Float -> edit.putFloat(moved, value)
            }
            edit.remove(key)
        }
        edit.putBoolean(MIGRATED, true)
        edit.apply()
    }

    const val BUSINESS_CURRENT = "erp.business.current"

    /** Settings > Businesses > "Ask which business at launch" (on unless turned off). */
    const val ASK_AT_LAUNCH = "erp.askBusinessAtLaunch"
    const val MIGRATED = "erp.business.migrated"

    /** Settings > Widgets > "Show both businesses" (on unless turned off). */
    const val WIDGET_BOTH = "erp.widget.showBoth"
}
