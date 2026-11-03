package erp.app.screens.businesses

import erp.app.config.Business
import java.time.Duration
import java.time.Instant

/**
 * What the cold-start picker's cards decide, apart from drawing them (the logic of BusinessPicker.swift; 2026-11-02 "two cards", which
 * replaced the full-bleed bands). The name is the bands' still: the identity, order, caption and status are unchanged.
 */
object BandLogic {
    /** From this width (dp) the cards sit side by side; narrower, they stack (the iPhone's 600 pt). */
    const val WIDE = 600f

    fun sideBySide(widthDp: Float): Boolean = widthDp >= WIDE

    /** A card's own colours as "RRGGBB" hex, constant in light and dark: an identity screen, not a themed page. */
    data class Identity(val ground: String, val ink: String, val isDark: Boolean)

    fun identity(b: Business): Identity = when (b.art) {
        "taheri" -> Identity("0B1414", "D3B47F", true)
        "mina" -> Identity("F2E9E4", "380000", false)
        else -> {
            // An added business: its accent (the dark side's) as the ground, its name in the colour that sits on that accent.
            val side = b.palette.dark
            Identity(side.accent.trim('#'), side.onAccent.trim('#'), (luminance(side.accent) ?: 0.0) < 0.5)
        }
    }

    /** Relative brightness (0..1) of a "RRGGBB" colour, or null if it is not one. */
    fun luminance(hex: String): Double? {
        val s = hex.trim().trimStart('#')
        if (s.length < 6) return null
        val v = s.take(6).toLongOrNull(16) ?: return null
        val r = ((v shr 16) and 0xFF) / 255.0
        val g = ((v shr 8) and 0xFF) / 255.0
        val b = (v and 0xFF) / 255.0
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    /** The business used last first; the rest in the phone's own order. */
    fun ordered(list: List<Business>, lastId: String): List<Business> = list.filter { it.id == lastId } + list.filter { it.id != lastId }

    sealed interface SignIn {
        data class Email(val email: String) : SignIn
        data object Needed : SignIn

        /** A business whose Firebase app is not made yet is unknown, not "needed". */
        data object Unknown : SignIn
    }

    /** From whether the business's Firebase app exists and who is signed in to it. */
    fun signIn(appMade: Boolean, email: String?): SignIn = when {
        !appMade -> SignIn.Unknown
        email != null -> SignIn.Email(email)
        else -> SignIn.Needed
    }

    /** The line under the wordmark: who is signed in, else that a sign-in is needed, else the address. */
    fun caption(b: Business, state: SignIn): String = when (state) {
        is SignIn.Email -> state.email
        SignIn.Needed -> "Sign in"
        SignIn.Unknown -> b.host
    }

    /** "Opened 5 min ago" from the stamp of the last open (epoch millis); null with no stamp. */
    fun lastOpened(stampMillis: Long?, now: Instant): String? {
        val t = stampMillis?.takeIf { it > 0 } ?: return null
        val m = Duration.between(Instant.ofEpochMilli(t), now).toMinutes()
        if (m < 1) return "Opened just now"
        val days = m / (60 * 24)
        val phrase = when {
            m < 60 -> "$m min ago"
            days < 1 -> "${m / 60} hr ago"
            days < 30 -> if (days == 1L) "1 day ago" else "$days days ago"
            else -> "${days / 30} mo ago"
        }
        return "Opened $phrase"
    }

    /** What a screen reader says of a card beyond "Open <name>". */
    fun status(b: Business, last: Boolean, state: SignIn, stampMillis: Long?, now: Instant): String {
        val parts = mutableListOf<String>()
        if (last) parts += "Last opened"
        parts += caption(b, state)
        if (state is SignIn.Email) lastOpened(stampMillis, now)?.let { parts += it }
        return parts.joinToString(", ")
    }
}
