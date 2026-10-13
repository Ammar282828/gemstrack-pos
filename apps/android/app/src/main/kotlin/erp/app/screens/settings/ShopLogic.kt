package erp.app.screens.settings

/** The three texts of Settings → Shop being typed. */
data class ShopDraft(val name: String, val address: String, val contact: String) {
    companion object {
        fun of(s: erp.core.models.Settings) = ShopDraft(s.shopName, s.shopAddress, s.shopContact)
    }
}

/** What leaving a text box does (ShopSettings.swift `commit`): only what was typed is sent, trimmed. */
data class ShopCommit(
    /** The `updateSettings` patch; empty when nothing changed. */
    val patch: Map<String, Any?>,
    /** The shop's name cannot be empty: the box goes back to what it was. */
    val error: String?,
    /** What the form shows and the base becomes if the ERP takes it. */
    val next: ShopDraft,
)

object ShopLogic {
    /** "INV-000124": the number after the last used one, six digits. */
    fun next(prefix: String, last: Int): String = "$prefix-" + String.format(java.util.Locale.US, "%06d", last + 1)

    fun commit(draft: ShopDraft, base: ShopDraft): ShopCommit {
        var next = base
        var error: String? = null
        val patch = LinkedHashMap<String, Any?>()
        val name = draft.name.trim()
        if (name != base.name) {
            if (name.isEmpty()) error = "The shop needs a name." else { patch["shopName"] = name; next = next.copy(name = name) }
        }
        val address = draft.address.trim()
        if (address != base.address) { patch["shopAddress"] = address; next = next.copy(address = address) }
        val contact = draft.contact.trim()
        if (contact != base.contact) { patch["shopContact"] = contact; next = next.copy(contact = contact) }
        return ShopCommit(patch, error, next)
    }

    /** What the book now holds replaces a text only where nothing has been typed over it. */
    fun sync(draft: ShopDraft, base: ShopDraft, fresh: ShopDraft) = ShopDraft(
        name = if (draft.name == base.name) fresh.name else draft.name,
        address = if (draft.address == base.address) fresh.address else draft.address,
        contact = if (draft.contact == base.contact) fresh.contact else draft.contact,
    )

    /** The shop mode as the picker holds it: anything but "default" is dark ("taheri"). */
    fun mode(theme: String): String = if (theme == "default") "default" else "taheri"

    fun style(uiStyle: String?): String = if (uiStyle == "glass") "glass" else "standard"
}
