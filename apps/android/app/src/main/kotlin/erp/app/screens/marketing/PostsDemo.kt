package erp.app.screens.marketing

import erp.core.ERPDate
import java.time.Instant

/**
 * The Posts hub in the demo, which has no server (CONVENTIONS.md rule 13): made-up pieces, sends and queue, dated
 * from the clock so a baseline does not age. Names, groups and times are invented.
 */
object PostsDemo {
    private fun ago(now: Instant, hours: Double): String = ERPDate.iso(now.minusSeconds((hours * 3600).toLong()))
    private fun ahead(now: Instant, hours: Double): String = ERPDate.iso(now.plusSeconds((hours * 3600).toLong()))

    private fun piece(id: String, name: String, collection: String, grams: Double?, fresh: Boolean, now: Instant, daysOnSite: Long) = PostPiece(
        id = id, name = name, url = "https://example.test/${id.lowercase()}", image = "", thumb = "", collection = collection, weightGrams = grams,
        facts = listOf("Handmade", collection), about = "A made-up piece for the demo.",
        added = (now.minusSeconds(daysOnSite * 86_400)).toEpochMilli().toDouble(), newArrival = fresh, hidden = false,
    )

    fun state(now: Instant): PostsState {
        val pieces = listOf(
            piece("Rings/R-101.webp", "Solitaire ring", "Rings", 4.2, true, now, 2),
            piece("Rings/R-102.webp", "Eternity band", "Rings", 3.1, true, now, 3),
            piece("Earrings/E-201.webp", "Jhumka pair", "Earrings", 11.8, true, now, 4),
            piece("Bangles/B-301.webp", "Kara bangle", "Bangles", 24.5, true, now, 5),
            piece("Pendants/P-401.webp", "Drop pendant", "Pendants", 5.6, false, now, 40),
            piece("Rings/R-103.webp", "Signet ring", "Rings", 7.0, false, now, 60),
            piece("Earrings/E-202.webp", "Stud pair", "Earrings", 2.4, false, now, 75),
            piece("Bangles/B-302.webp", "Slim bangle", "Bangles", 15.0, false, now, 90),
        )
        val sent = listOf(
            PostSent("a1", ago(now, 1.5), "Solitaire ring", "Rings/R-101.webp", listOf("whatsapp-community", "instagram-story")),
            PostSent("a2", ago(now, 3.0), "Jhumka pair", "Earrings/E-201.webp", listOf("whatsapp-group:diamonds", "whatsapp-channel")),
            PostSent("a3", ago(now, 30.0), "Kara bangle", null, listOf("whatsapp-community")),
        )
        val queue = listOf(
            PostQueueEntry(
                id = "q1", status = "scheduled", dueAt = ahead(now, 3.0), createdAt = ago(now, 2.0), sentAt = null, headline = "Eternity band", thumb = null,
                toWebsite = true, toInstagram = true, whatsapp = listOf("diamonds", "channel"), units = 5, done = 0, lastError = null,
                caption = "A made-up caption for the demo.", websiteCollection = "Rings", websiteNames = listOf("eternity-band-1", "eternity-band-2"),
                websiteFeatured = false, sitePhotos = 2, waPhotos = 1,
                unitKeys = listOf("site-0", "site-1", "instagram", "wa:diamonds:0", "wa:channel:0"), doneKeys = emptySet(), unitErrors = emptyMap(),
            ),
            PostQueueEntry(
                id = "q2", status = "failed", dueAt = null, createdAt = ago(now, 5.0), sentAt = null, headline = "Drop pendant", thumb = null,
                toWebsite = false, toInstagram = false, whatsapp = listOf("diamonds"), units = 2, done = 1, lastError = "WhatsApp did not answer.",
                caption = "Another made-up caption.", websiteCollection = "", websiteNames = emptyList(), websiteFeatured = false, sitePhotos = 0, waPhotos = 2,
                unitKeys = listOf("wa:diamonds:0", "wa:diamonds:1"), doneKeys = setOf("wa:diamonds:0"), unitErrors = mapOf("wa:diamonds:1" to "WhatsApp did not answer."),
            ),
            PostQueueEntry(
                id = "q3", status = "held", dueAt = null, createdAt = ago(now, 8.0), sentAt = null, headline = "Signet ring", thumb = null,
                toWebsite = true, toInstagram = false, whatsapp = emptyList(), units = 1, done = 0, lastError = null,
                caption = "", websiteCollection = "Rings", websiteNames = listOf("signet-ring-1"), websiteFeatured = false, sitePhotos = 1, waPhotos = 0,
                unitKeys = listOf("site-0"), doneKeys = emptySet(), unitErrors = emptyMap(),
            ),
        )
        return PostsState(
            piecesPhase = PostsPhase.Loaded,
            pieces = pieces,
            site = "https://www.example.test",
            posted = mapOf("Rings/R-101.webp" to ago(now, 1.5), "Earrings/E-201.webp" to ago(now, 3.0), "Bangles/B-301.webp" to ago(now, 30.0), "Pendants/P-401.webp" to ago(now, 24 * 12.0)),
            sent = sent,
            queue = queue,
            checks = listOf(
                PostCheck("c1", "WhatsApp", "Community", "ok", "Connected.", null),
                PostCheck("c2", "Instagram", "Story", "fail", "The connection expired.", "Connect Instagram again from Post a piece."),
            ),
            gold = PostGold(ERPDate.karachiDay(now), mapOf("group" to ago(now, 2.0))),
            goldParts = PostsStore.goldOrder.filter { it != "channel" },
            audience = PostAudience("Announcements", listOf(PostAudience.Place("diamonds", "Diamonds", "Demo Diamonds"), PostAudience.Place("gold", "Gold", "Demo Gold"), PostAudience.Place("announcements", "Announcements", "Announcements"))),
        )
    }
}
