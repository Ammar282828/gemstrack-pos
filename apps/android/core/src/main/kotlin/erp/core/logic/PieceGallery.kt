package erp.core.logic

import erp.core.entry.NewOrderPieceDraft
import erp.core.models.OrderItem

/**
 * One reference picture before it is read (PieceGallery.swift `PhotoSource`, lib/order-photos.ts `itemPhotoRefs`): inline ([uri]: a data
 * address or a stock piece's address), in its own document ([storedId], `order_photos/<id>`), or new on this phone ([data], a JPEG).
 * [id] names it on screen.
 */
data class PhotoSource(
    val id: String,
    val uri: String? = null,
    val storedId: String? = null,
    val data: ByteArray? = null,
) {
    override fun equals(other: Any?): Boolean = other is PhotoSource && id == other.id && uri == other.uri && storedId == other.storedId && data.contentEquals(other.data)
    override fun hashCode(): Int = id.hashCode()
}

object PieceGallery {
    private fun tail(s: String): String = "${s.toByteArray(Charsets.UTF_8).size}-${s.takeLast(24)}"

    /** The piece's reference pictures in order: the first (as every older order has it), then photos 2...n, at most [NewOrderPieceDraft.MAX_PHOTOS]. */
    fun sources(item: OrderItem): List<PhotoSource> {
        val out = ArrayList<PhotoSource>()
        val first = (item.sampleImageDataUri ?: "").trim()
        val firstId = item.samplePhotoId
        if (first.isNotEmpty()) out += PhotoSource("m-" + tail(first), uri = first)
        else if (!firstId.isNullOrEmpty()) out += PhotoSource(firstId, storedId = firstId)
        for (e in item.extraPhotos) {
            val uri = e.dataUri
            val id = e.id
            if (!uri.isNullOrEmpty()) out += PhotoSource("x-" + tail(uri), uri = uri)
            else if (!id.isNullOrEmpty()) out += PhotoSource(id, storedId = id)
        }
        return out.take(NewOrderPieceDraft.MAX_PHOTOS)
    }

    /** The piece's pictures as the karigar portal hands them over, inline (the first, then photos 2...n). */
    fun sources(jobId: String, images: List<String>): List<PhotoSource> =
        images.withIndex().filter { it.value.isNotEmpty() }
            .map { (i, uri) -> PhotoSource("$jobId-$i-${uri.length}", uri = uri) }
            .take(NewOrderPieceDraft.MAX_PHOTOS)

    /** What the editor lists for a piece being typed: the first (new, else the one on file unless taken off), then the extras. */
    fun sources(piece: NewOrderPieceDraft): List<PhotoSource> {
        val out = ArrayList<PhotoSource>()
        val photo = piece.photo
        val uri = piece.sampleImageDataUri
        val stored = piece.samplePhotoId
        if (photo != null) out += PhotoSource("new-${piece.id}", data = photo)
        else if (!piece.removePhoto && !uri.isNullOrEmpty()) out += PhotoSource("main-${piece.id}-${uri.length}", uri = uri)
        else if (!piece.removePhoto && !stored.isNullOrEmpty()) out += PhotoSource(stored, storedId = stored)
        for (e in piece.extras) {
            val id = e.storedId
            val data = e.data
            if (!id.isNullOrEmpty()) out += PhotoSource(id, storedId = id)
            else if (data != null) out += PhotoSource("new-${e.id}", data = data)
        }
        return out
    }

    // MARK: Editing a piece's pictures (NewOrderSampleField)

    fun hasFirst(piece: NewOrderPieceDraft): Boolean =
        piece.photo != null || (!piece.removePhoto && (!piece.samplePhotoId.isNullOrEmpty() || !piece.sampleImageDataUri.isNullOrEmpty()))

    fun count(piece: NewOrderPieceDraft): Int = (if (hasFirst(piece)) 1 else 0) + piece.extras.size

    /** How many more pictures the piece takes. */
    fun room(piece: NewOrderPieceDraft): Int = (NewOrderPieceDraft.MAX_PHOTOS - count(piece)).coerceAtLeast(0)

    /** Moves an extra (by its place among the extras) one step earlier or later; the main picture does not move. */
    fun move(piece: NewOrderPieceDraft, extraAt: Int, by: Int) {
        val to = extraAt + by
        if (extraAt !in piece.extras.indices || to !in piece.extras.indices) return
        val x = piece.extras[extraAt]
        piece.extras[extraAt] = piece.extras[to]
        piece.extras[to] = x
    }

    /**
     * Takes picture [i] (as listed by [sources]) off the piece. The main one is taken off altogether; the ERP makes the next picture the
     * main one when the order is saved.
     */
    fun remove(piece: NewOrderPieceDraft, i: Int) {
        if (hasFirst(piece) && i == 0) {
            piece.photo = null
            piece.removePhoto = true
        } else {
            val at = i - (if (hasFirst(piece)) 1 else 0)
            if (at in piece.extras.indices) piece.extras.removeAt(at)
        }
    }

    /** New pictures (JPEGs): the first fills an empty main slot, the rest follow; no more than the piece takes. Returns whether some were left out. */
    fun add(piece: NewOrderPieceDraft, jpegs: List<ByteArray>): Boolean {
        val room = room(piece)
        val rest = jpegs.take(room).toMutableList()
        if (!hasFirst(piece) && rest.isNotEmpty()) {
            piece.photo = rest.removeAt(0)
            piece.removePhoto = false
        }
        for (data in rest) if (count(piece) < NewOrderPieceDraft.MAX_PHOTOS) piece.extras.add(erp.core.entry.NewOrderExtraPhoto(data = data))
        return jpegs.size > room
    }
}
