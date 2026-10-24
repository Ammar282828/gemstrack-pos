package erp.core.logic

// Ported from src/lib/social/album.ts (Album.swift; tests: AlbumTests): several photos of one piece with one description
// (the owner, 2026-10-23). WhatsApp gets the photos one after another, the caption under the first only; Instagram a
// carousel of the first ten; one-photo places (the story) the first. The same rules as the TypeScript, so the hub, the
// queue and the apps agree.
object Album {
    /** Instagram's limit on a carousel's children. */
    const val igCarouselMax = 10

    /** Photos of one piece in one send. */
    const val max = 30

    /** What a carousel takes from n photos: [take] of them, [dropped] left out; one is a plain photo. */
    data class CarouselPlan(val take: Int, val dropped: Int, val carousel: Boolean)

    /** The caption each photo carries: the description under the first, nothing under the rest. */
    fun captions(caption: String, count: Int): List<String> = List(maxOf(0, count)) { i -> if (i == 0) caption else "" }

    /** "ruby-ring.jpg", "ruby-ring-2.jpg", ... */
    fun fileName(base: String, i: Int, ext: String = "jpg"): String = "${base.ifEmpty { "piece" }}${if (i > 0) "-${i + 1}" else ""}.$ext"

    fun carouselPlan(n: Int, limit: Int = igCarouselMax): CarouselPlan {
        val count = maxOf(0, n)
        val take = minOf(count, limit)
        return CarouselPlan(take, count - take, take > 1)
    }

    /** A WhatsApp caption as Instagram should show it: *bold*, _italic_ and ~strike~ markers taken off. */
    fun instagramText(caption: String): String {
        var out = caption
        for (mark in listOf("\\*", "_", "~")) {
            val pattern = "(^|[\\s(])" + mark + "([^" + (if (mark == "\\*") "*" else mark) + "\\n]+)" + mark + "(?=[\\s).,!?:;]|$)"
            out = Regex(pattern, RegexOption.MULTILINE).replace(out, "$1$2")
        }
        return out.trim { it.isWhitespace() }
    }

    /** "3 photos" / "1 photo". */
    fun photosLabel(n: Int): String = "$n photo${if (n == 1) "" else "s"}"

    /** Which places photo i still goes to: a place that failed an earlier photo is left out of the rest. */
    fun placesFor(all: List<String>, failed: Set<String>): List<String> = all.filter { it !in failed }
}
