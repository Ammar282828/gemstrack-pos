package erp.app.screens.marketing

import erp.core.logic.ShopNumber

/**
 * What decides whether a piece can go and where, as plain functions of the draft (PostComposerModel's computed
 * properties): no screen, no network, so they are tested on the JVM. The caption's wording and every route are the web's;
 * only the checks that stop a post before it is made live here.
 */
object PostComposerRules {
    /** The fields the designs print: headline, kicker, weight ("12.5g", "12.5g each") and details ("Metal | Stones"). */
    fun fields(words: MarketingValue): Map<String, String> = mapOf(
        "headline" to words.s("headline"), "kicker" to words.s("kicker"), "weight" to validWeight(words),
        "details" to listOf(words.s("metal"), words.s("stones")).filter { it.isNotEmpty() }.joinToString(" | "),
    )

    /** The weight as typed, "g" taken off and put back, only when it is a number above zero. */
    fun validWeight(words: MarketingValue): String {
        val text = words.s("weight").trim().replace("g", "", ignoreCase = true)
        val value = ShopNumber.parse(text)?.takeIf { it > 0 } ?: return ""
        return WebsiteNumber.grams(value) + "g" + if (words["weightEach"].bool) " each" else ""
    }

    fun makeSquare(words: MarketingValue) = words.s("formats") != "story"
    fun makeStory(words: MarketingValue) = words.s("formats") != "square"

    fun hero(draft: PostDraft): PostPhoto? = draft.photos.firstOrNull { it.id == draft.story["bg"].s("photoId") } ?: draft.photos.firstOrNull()

    /** The lead photo goes first. */
    fun sitePhotos(draft: PostDraft): List<PostPhoto> = draft.photos.filter { it.toSite }.sortedByDescending { it.id == hero(draft)?.id }

    fun waPhotos(draft: PostDraft): List<PostPhoto> = draft.photos.filter { it.toWhatsApp }.sortedByDescending { it.id == hero(draft)?.id }

    fun siteOn(draft: PostDraft) = makeSquare(draft.words) && draft.words["toWebsite"].bool && sitePhotos(draft).isNotEmpty()

    fun waKeys(draft: PostDraft): List<String> =
        if (draft.words["toWhatsApp"].bool && makeSquare(draft.words)) draft.words["waTargets"].array.map { it.string } else emptyList()

    fun igOn(draft: PostDraft, instagramConnected: Boolean) = makeStory(draft.words) && draft.words["toInstagram"].bool && instagramConnected

    /** A story that goes to no Instagram is shared by hand, from the phone. */
    fun manualStory(draft: PostDraft, instagramConnected: Boolean) = makeStory(draft.words) && !igOn(draft, instagramConnected)

    val frozen: (PostDraft) -> Boolean = { it.queuedID != null }

    /** What stops the post, in the Swift's words, in the order the form shows them. */
    fun problems(draft: PostDraft, instagramConnected: Boolean): List<String> {
        val w = draft.words
        val hero = hero(draft)
        val out = ArrayList<String>()
        if (hero == null) out.add("Add a photo.")
        if (w.s("headline").trim().isEmpty()) out.add("Give the piece a headline.")
        if (makeSquare(w) && w["toWebsite"].bool && sitePhotos(draft).isEmpty()) out.add("Choose a photo for the website.")
        val siteOn = siteOn(draft)
        if (siteOn && w.s("folder").isEmpty()) out.add("Choose a website collection.")
        if (siteOn && w.s("folder").endsWith("The Maisons") && w.s("maisonHouse").trim().isEmpty()) out.add("Choose the piece’s house for The Maisons.")
        if (makeSquare(w) && w["toWhatsApp"].bool) {
            if (waPhotos(draft).isEmpty()) out.add("Choose a photo for WhatsApp.")
            if (waKeys(draft).isEmpty()) out.add("Choose a WhatsApp destination.")
            if (w.s("caption").trim().isEmpty()) out.add("Write the WhatsApp caption.")
        }
        if (draft.paintedStory != null && draft.paintedStoryFor != hero?.id) out.add("The painted story belongs to another photo. Repaint it or use the original design.")
        return out
    }

    /** The queue file's base name: lower case, anything but letters, digits, `_` and `-` a hyphen, at most 120 characters. */
    fun fileBase(title: String): String {
        val base = title.lowercase().replace(Regex("[^a-z0-9_-]+"), "-").trim('-')
        return if (base.isEmpty()) "piece" else base.take(120)
    }

    /** The body of POST /api/website/post/queue, key for key (`names` and `thumb` come from the engine's draw). */
    fun queueBody(
        draft: PostDraft, instagramConnected: Boolean, folders: List<MarketingValue>, featuredOn: Boolean, names: List<String>, thumb: String,
    ): Map<String, Any?> {
        val siteOn = siteOn(draft)
        val igOn = igOn(draft, instagramConnected)
        val waKeys = waKeys(draft)
        val folder = draft.words.s("folder")
        val body = LinkedHashMap<String, Any?>()
        body["headline"] = draft.title
        body["caption"] = draft.words.s("caption")
        body["fileBase"] = fileBase(draft.title)
        body["counts"] = mapOf("site" to if (siteOn) sitePhotos(draft).size else 0, "wa" to if (waKeys.isEmpty()) 0 else waPhotos(draft).size, "story" to igOn)
        body["website"] = if (siteOn) mapOf(
            "folder" to folder,
            "collection" to (folders.firstOrNull { it.s("folder") == folder }?.s("collection") ?: folder),
            "names" to names,
            "featured" to (featuredOn && draft.words["feature"].bool),
        ) else null
        body["instagram"] = igOn
        body["whatsapp"] = waKeys
        body["thumb"] = thumb
        hero(draft)?.source?.let { from -> if (from.s("id").isNotEmpty()) body["sitePiece"] = from.s("id") }
        return body
    }

    /** The words of the confirmation before it goes (publishWords): every place, what needs attention, and what the button does. */
    fun publishWords(draft: PostDraft, siteName: String, instagramUser: String, instagramConnected: Boolean, checks: List<MarketingValue>, sendsNow: Boolean): String {
        val places = (if (siteOn(draft)) listOf(siteName + " · " + draft.words.s("folder")) else emptyList()) +
            (if (igOn(draft, instagramConnected)) listOf("Instagram story · @$instagramUser") else emptyList()) +
            waKeys(draft).map { "WhatsApp · $it" }
        val blockers = checks.filter { it.s("status") == "fail" }.map { it.s("label") + ": " + it.s("fix") }
        return places.joinToString("\n") + (if (blockers.isEmpty()) "" else "\n\nNeeds attention:\n" + blockers.joinToString("\n")) +
            (if (sendsNow) "\n\nThis sends now. A published post cannot be taken back." else "\n\nIt stays held until you send or schedule it.")
    }

    /** What to say when the AI's version could not be verified as the same piece. */
    fun needsComparing(check: MarketingValue): Boolean = check.isNull || !check["samePiece"].bool || check.n("confidence") < 0.8
}
