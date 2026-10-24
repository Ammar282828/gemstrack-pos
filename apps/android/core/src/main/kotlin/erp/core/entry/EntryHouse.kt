package erp.core.entry

import erp.core.logic.MarginSettings

/**
 * Stand-in for the iPhone's App/Config/House.swift (as Contract's House.swift is): only what the New order and
 * New sale logic reads. core knows no BuildConfig, so the app sets `id` once at start ("taheri" or "mina"; the
 * code's default is Taheri's, as everywhere) and the contract generator switches it to write both houses' cases.
 */
object EntryHouse {
    @Volatile
    var id: String = "taheri"

    /**
     * The open business's own metal and margin, when the app has one that is not a built-in (a business added by its ERP
     * address says both in its descriptor); null: the id decides, as for Taheri and Mina.
     */
    @Volatile
    var metalOverride: String? = null

    @Volatile
    var marginOverride: MarginSettings? = null

    /** The metal a new piece starts on. */
    val metal: String get() = metalOverride ?: if (id == "mina") "silver" else "gold"

    val margin: MarginSettings get() = marginOverride ?: if (id == "mina") MarginSettings.mina else MarginSettings.taheri
}
