package erp.app.screens.marketing

import erp.core.ERPDate
import java.time.Instant

/**
 * The Website pages in the demo, which has no server (CONVENTIONS.md rule 13): made-up pieces, collections, weights and
 * gold posts, dated from the clock so a baseline does not age. Names and times are invented.
 */
object WebsiteDemo {
    fun settings(house: String): WebsiteSettings = WebsiteSettings(
        site = "https://www.example.test", siteName = "example.test", featured = house == "taheri",
        weights = house == "taheri", edit = true, investments = house == "taheri",
    )

    fun featured(house: String): WebsiteFeatured? =
        if (house == "taheri") WebsiteFeatured("Rings/R-102.webp", "Our newest eternity band.", "Rings", "R-102", "") else null

    val collections: List<WebsiteCollection> = listOf(
        WebsiteCollection("Rings", "Rings", 48, "Rings/Rings", null),
        WebsiteCollection("Solitaire", "Rings", 21, "Rings/Solitaire", "/rings/solitaire"),
        WebsiteCollection("Jhumki", "Earrings", 33, "Earrings/Jhumki", null),
        WebsiteCollection("Studs", "Earrings", 0, "Earrings/Studs", null),
        WebsiteCollection("Kara", "Bangles", 17, "Bangles/Kara", null),
        WebsiteCollection("Drops", "Pendants", 12, "Pendants/Drops", null),
    )

    private fun piece(
        id: String, name: String, collection: String, grams: Double?, hidden: Boolean = false, tags: Boolean = true,
        photo: Boolean = false, words: Boolean = false, at: String? = null,
    ): WebsiteEditPiece {
        val own = WebsiteWords(name = name, about = "A made-up piece for the demo.", facts = if (tags) emptyList() else listOf("Stone: Emerald", "Setting: Prong"), stone = if (tags) "Diamond" else "", metal = if (tags) "Gold" else "", karat = if (tags) "18k" else "", cut = if (tags) "Round" else "", style = if (tags) "Classic" else "")
        val keys = buildSet {
            if (photo) add("photo")
            if (words) add("name")
            if (grams != null && tags) add("weightGrams")
        }
        return WebsiteEditPiece(
            id = id, name = name, url = "https://www.example.test/${id.lowercase()}", image = "", thumb = "", collection = collection,
            weightGrams = grams, weightOnPhoto = false, facts = own.facts, imagePath = null, source = if (tags) "attributes" else "pieces",
            own = own, words = own, change = if (keys.isEmpty()) null else WebsiteEditChange(keys, photo, at, if (tags) grams else null, false),
            hidden = hidden, photoSource = null, sourceMarked = false,
        )
    }

    fun edits(house: String, now: Instant): WebsiteEditsAnswer {
        val tags = house == "taheri"
        val at = ERPDate.iso(now.minusSeconds(3 * 3600))
        val pieces = listOf(
            piece("Rings/R-101.webp", "Solitaire ring", "Rings", 4.2, tags = tags, photo = true, at = at),
            piece("Rings/R-102.webp", "Eternity band", "Rings", 3.1, tags = tags),
            piece("Earrings/E-201.webp", "Jhumka pair", "Earrings", 11.8, tags = tags, words = true, at = at),
            piece("Bangles/B-301.webp", "Kara bangle", "Bangles", 24.5, hidden = true, tags = tags, at = at),
            piece("Pendants/P-401.webp", "Drop pendant", "Pendants", 5.6, tags = tags),
            piece("Rings/R-103.webp", "Signet ring", "Rings", null, tags = tags),
        )
        val recent = listOf(
            WebsiteEditRecent("Rings/R-101.webp", "Solitaire ring", listOf("new photo"), "owner@example.test", at),
            WebsiteEditRecent("Bangles/B-301.webp", "Kara bangle", listOf("hidden"), "counter", ERPDate.iso(now.minusSeconds(26 * 3600))),
        )
        return WebsiteEditsAnswer("https://www.example.test", pieces, recent)
    }

    fun weights(): List<WebsiteWeightPiece> = listOf(
        WebsiteWeightPiece("Rings/Solitaire/R-101.webp", "Rings", "R-101.webp", "", null, null, null, null, null),
        WebsiteWeightPiece("Rings/Solitaire/R-102.webp", "Rings", "R-102.webp", "", null, null, null, null, null),
        WebsiteWeightPiece("Rings/Solitaire/R-103.webp", "Rings", "R-103.webp", "", 7.0, "pos", null, "counter", null),
        WebsiteWeightPiece("Earrings/Jhumki/E-201.webp", "Earrings", "E-201.webp", "", null, "label", 11.8, null, null).copy(weightGrams = 11.8),
        WebsiteWeightPiece("Bangles/Kara/B-301.webp", "Bangles", "B-301.webp", "", null, null, null, null, null),
        WebsiteWeightPiece("Pendants/Drops/P-401.webp", "Pendants", "P-401.webp", "", null, null, null, null, null),
    )

    /** A tray the demo opens with (nothing can be picked without a phone's Photos): one waiting, one that failed, one sent. */
    fun tray(): List<WebsitePhotoItem> {
        val jpg = MarketingPhotos.Kind("jpg", "image/jpeg")
        return listOf(
            WebsitePhotoItem("demo-1", ByteArray(4_404_019), jpg, null, "IMG-20261012-130000-1a1a"),
            WebsitePhotoItem("demo-2", ByteArray(839_680), jpg, null, "IMG-20261012-130010-2b2b", status = WebsitePhotoItem.Status.Failed, error = "The ERP answered 500."),
            WebsitePhotoItem("demo-3", ByteArray(1_572_864), jpg, null, "IMG-20261012-130020-3c3c", status = WebsitePhotoItem.Status.Done, rel = "Rings/Solitaire/IMG-20261012-130020-3c3c.webp"),
        )
    }

    fun targets(): List<WebsiteGoldStatus.Target> = listOf(
        WebsiteGoldStatus.Target("group", "Post + square card", "the Investments group"),
        WebsiteGoldStatus.Target("channel", "Post + square card", "the Investments channel"),
        WebsiteGoldStatus.Target("teaser", "Teaser", "the community's announcements"),
        WebsiteGoldStatus.Target("instagram", "Story card", "Instagram"),
    )

    fun gold(now: Instant): Triple<WebsiteGoldAnswer, WebsiteGoldSchedule, WebsiteGoldStatus> {
        val today = ERPDate.karachiDay(now)
        fun day(back: Long) = ERPDate.karachiDay(now.minusSeconds(back * 86_400))
        fun post(back: Long, headline: String, sent: Map<String, WebsiteGoldPost.Went>, hold: Boolean = false) = WebsiteGoldPost(
            id = day(back), date = day(back), post = "*$headline*\nA made-up rate line for the demo.\n_Not advice._", teaser = "A made-up teaser for the demo.",
            cards = listOf("square", "story"), receivedAt = ERPDate.iso(now.minusSeconds(back * 86_400 + 2 * 3600)), source = "routine", editedAt = null,
            sent = sent, hold = hold, approvedAt = null,
        )
        val went = { hours: Long, by: String -> WebsiteGoldPost.Went(ERPDate.iso(now.minusSeconds(hours * 3600)), by) }
        val posts = listOf(
            post(0, "Gold holds steady", mapOf("group" to went(1, "schedule"))),
            post(1, "Gold eases a little", targets().associate { it.id to went(25, "schedule") }),
            post(2, "Gold rises on the week", mapOf("group" to went(49, "owner@example.test"), "teaser" to went(48, "schedule")), hold = false),
        )
        val schedule = WebsiteGoldSchedule(
            enabled = true, days = listOf(1, 2, 3, 4, 5, 6), mode = "auto", targets = WebsiteGoldSchedule.defaults,
            lateUntil = "20:00", updatedBy = "owner@example.test", lastTick = ERPDate.iso(now.minusSeconds(120)),
        )
        val status = WebsiteGoldStatus(
            today = today, enabled = true, mode = "auto", lastTick = schedule.lastTick, targets = targets(), dayId = today,
            parts = mapOf(
                "group" to WebsiteGoldStatus.Part("sent", "Sent 1 h ago", "ok"),
                "teaser" to WebsiteGoldStatus.Part("waiting", "Goes at 12:00 pm", "muted"),
            ),
        )
        return Triple(WebsiteGoldAnswer(posts, today), schedule, status)
    }
}
