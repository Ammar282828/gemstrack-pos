package erp.app.screens.ads

import erp.app.ui.ShopDate
import erp.core.Container
import erp.core.Decodable

// The answers of the Ads routes behind Setup, Audiences and Rules (/api/ads/status, /setup, /pixel, /audiences,
// /rules), read leniently: a missing or odd field gives a default, never an emptied page (AdsWorkModels.swift).

private fun Container.trimmed(key: String): String? = string(key)?.trim()?.takeIf { it.isNotEmpty() }

/** Which ad account, Page and Instagram account this house advertises from (src/lib/ads/settings.ts AdsSettings). */
data class AdsSettingsRow(
    val adAccountId: String?,
    val adAccountName: String?,
    val pageId: String?,
    val pageName: String?,
    val instagramUserId: String?,
    val instagramUsername: String?,
    val whatsappGreeting: String?,
    val loginConfigId: String?,
    val pixelId: String?,
) {
    companion object : Decodable<AdsSettingsRow> {
        override fun fromMap(m: Map<String, Any?>): AdsSettingsRow {
            val c = Container(m)
            return AdsSettingsRow(
                c.trimmed("adAccountId"), c.trimmed("adAccountName"), c.trimmed("pageId"), c.trimmed("pageName"),
                c.trimmed("instagramUserId"), c.trimmed("instagramUsername"), c.trimmed("whatsappGreeting"), c.trimmed("loginConfigId"), c.trimmed("pixelId"),
            )
        }
    }
}

/** GET /api/ads/status: what every Ads page needs to know before it can do anything (ads-kit.tsx AdsStatus). */
data class AdsStatusAnswer(
    val app: App?,
    val connection: Connection?,
    val connectionError: String?,
    val settings: AdsSettingsRow?,
    val houseInstagram: String?,
    val pinnedAccount: Boolean,
    val account: AdAccount?,
    val accountError: String?,
) {
    data class App(
        val id: String?,
        val secret: Boolean,
        val secretName: String,
        val tokenSecret: String,
        val tokenStoreExists: Boolean,
        val tokenStoreWrite: Boolean,
        val project: String,
        val loginConfigId: String?,
        val loginConfigFromEnv: Boolean,
        /** What Meta's Live switch asks for, read from the app; null when Meta didn't answer. */
        val live: Live?,
        val privacyPage: String,
        val deletionPage: String,
    ) {
        data class Live(val privacyPolicyUrl: String?, val category: String?, val icon: Boolean) {
            val ready: Boolean get() = privacyPolicyUrl != null && category != null && icon

            companion object : Decodable<Live> {
                override fun fromMap(m: Map<String, Any?>): Live {
                    val c = Container(m)
                    return Live(c.text("privacyPolicyUrl"), c.text("category"), c.bool("icon", false))
                }
            }
        }

        companion object : Decodable<App> {
            override fun fromMap(m: Map<String, Any?>): App {
                val c = Container(m)
                val t = Container(m.obj("tokenStore") ?: emptyMap())
                val p = Container(m.obj("pages") ?: emptyMap())
                return App(
                    id = c.text("id"), secret = c.bool("secret", false), secretName = c.string("secretName", "meta-app-secret"),
                    tokenSecret = c.string("tokenSecret", "meta-ads-token"), tokenStoreExists = t.bool("exists", false),
                    tokenStoreWrite = t.bool("write", false), project = c.string("project", ""), loginConfigId = c.text("loginConfigId"),
                    loginConfigFromEnv = c.bool("loginConfigFromEnv", false), live = c.obj("live", Live),
                    privacyPage = p.string("privacy", ""), deletionPage = p.string("deletion", ""),
                )
            }
        }
    }

    data class Connection(
        val connected: Boolean,
        /** "user" (a Facebook login, which runs out) or "system" (a system user's token, which doesn't). */
        val kind: String,
        val userName: String?,
        val daysLeft: Int?,
        val missingScopes: List<String>,
        val error: String?,
    ) {
        companion object : Decodable<Connection> {
            override fun fromMap(m: Map<String, Any?>): Connection {
                val c = Container(m)
                return Connection(
                    c.bool("connected", false), c.string("kind", "user"), c.text("userName"), c.int("daysLeft"),
                    c.strings("missingScopes"), c.text("error"),
                )
            }
        }
    }

    /** Connected, with an ad account chosen: the pages can work (ads-kit.tsx useAdsStatus `ready`). */
    val ready: Boolean get() = connection?.connected == true && settings?.adAccountId != null
    val currency: String get() = account?.currency ?: "PKR"

    companion object : Decodable<AdsStatusAnswer> {
        override fun fromMap(m: Map<String, Any?>): AdsStatusAnswer {
            val c = Container(m)
            return AdsStatusAnswer(
                app = c.obj("app", App), connection = c.obj("connection", Connection), connectionError = c.text("connectionError"),
                settings = c.obj("settings", AdsSettingsRow), houseInstagram = c.text("houseInstagram"),
                pinnedAccount = c.bool("pinnedAccount", false), account = c.obj("account", AdAccount), accountError = c.text("accountError"),
            )
        }
    }
}

// MARK: Setup's choices (GET /api/ads/setup)

data class AdsAccountChoice(val id: String, val name: String, val currency: String, val status: Int, val business: String?) {
    companion object : Decodable<AdsAccountChoice> {
        override fun fromMap(m: Map<String, Any?>): AdsAccountChoice {
            val c = Container(m)
            return AdsAccountChoice(c.string("id", ""), c.string("name", ""), c.string("currency", ""), c.int("status") ?: 0, c.string("business"))
        }
    }
}

data class AdsPageChoice(
    val id: String,
    val name: String,
    val picture: String?,
    val canAdvertise: Boolean,
    val instagramUsername: String?,
    val whatsapp: String?,
) {
    companion object : Decodable<AdsPageChoice> {
        override fun fromMap(m: Map<String, Any?>): AdsPageChoice {
            val c = Container(m)
            val ig = m.obj("instagram")
            return AdsPageChoice(
                c.string("id", ""), c.string("name", ""), c.string("picture"), c.bool("canAdvertise", true),
                if (ig != null) Container(ig).string("username") else null, c.text("whatsapp"),
            )
        }
    }
}

data class AdsInstagramChoice(
    val id: String,
    val username: String,
    val picture: String?,
    /** "page", "ad account" or "business". */
    val via: String,
    val pageId: String?,
) {
    companion object : Decodable<AdsInstagramChoice> {
        override fun fromMap(m: Map<String, Any?>): AdsInstagramChoice {
            val c = Container(m)
            return AdsInstagramChoice(c.string("id", ""), c.string("username", ""), c.string("picture"), c.string("via", "business"), c.text("pageId"))
        }
    }
}

data class AdsSetupAssets(
    val accounts: List<AdsAccountChoice>,
    val pages: List<AdsPageChoice>,
    val instagram: List<AdsInstagramChoice>,
    val settings: AdsSettingsRow?,
) {
    companion object : Decodable<AdsSetupAssets> {
        override fun fromMap(m: Map<String, Any?>): AdsSetupAssets {
            val c = Container(m)
            return AdsSetupAssets(
                c.list("accounts", AdsAccountChoice).filter { it.id.isNotEmpty() },
                c.list("pages", AdsPageChoice).filter { it.id.isNotEmpty() },
                c.list("instagram", AdsInstagramChoice).filter { it.id.isNotEmpty() },
                c.obj("settings", AdsSettingsRow),
            )
        }
    }
}

/** POST /api/ads/setup: the settings as saved. */
data class AdsSettingsSaved(val settings: AdsSettingsRow?) {
    companion object : Decodable<AdsSettingsSaved> {
        override fun fromMap(m: Map<String, Any?>): AdsSettingsSaved = AdsSettingsSaved(Container(m).obj("settings", AdsSettingsRow))
    }
}

// MARK: The website pixel (/api/ads/pixel)

data class AdsPixelRow(val id: String, val name: String, val lastFired: String?) {
    companion object : Decodable<AdsPixelRow> {
        override fun fromMap(m: Map<String, Any?>): AdsPixelRow {
            val c = Container(m)
            return AdsPixelRow(c.string("id", ""), c.string("name", c.string("id", "")), c.string("lastFired"))
        }
    }
}

/** A site the house sells from and the pixels its front page carries (null: the page couldn't be read). */
data class AdsPixelSite(val url: String, val ids: List<String>?, val loader: Boolean) {
    /** "taheri.shop". */
    val host: String
        get() {
            val h = runCatching { java.net.URI(url).host }.getOrNull() ?: url
            return if (h.startsWith("www.")) h.drop(4) else h
        }

    companion object : Decodable<AdsPixelSite> {
        override fun fromMap(m: Map<String, Any?>): AdsPixelSite {
            val c = Container(m)
            // null (the page couldn't be read) stays null; a list, even an empty one, is what the page carries.
            val ids = (m["ids"] as? List<*>)?.mapNotNull { Container(mapOf("v" to it)).string("v") }
            return AdsPixelSite(c.string("url", ""), ids, c.bool("loader", false))
        }
    }
}

data class AdsPixelState(
    val id: String?,
    val lastFired: String?,
    val live: Boolean,
    val onSite: Boolean?,
    /** The site that carries it (or the first the house sells from). */
    val site: String?,
    val sites: List<AdsPixelSite>,
    /** What the chosen pixel received in the last 7 days, by event name; null when Meta wouldn't say. */
    val events: Map<String, Double>?,
) {
    /** The pixels the house's own sites already carry (House of Mina's Shopify store, through Shopify's app). */
    val carried: List<String>
        get() {
            val seen = ArrayList<String>()
            for (s in sites) for (id in s.ids.orEmpty()) if (id !in seen) seen.add(id)
            return seen
        }

    fun sitesCarrying(id: String): String = sites.filter { id in s(it) }.joinToString(" and ") { it.host }

    private fun s(site: AdsPixelSite): List<String> = site.ids.orEmpty()

    /** "1,204 page views · 31 added to cart · 4 orders" (pixel-step.tsx eventLine). */
    val eventLine: String
        get() {
            val ev = events ?: return ""
            val order = listOf("PageView", "ViewContent", "Search", "AddToCart", "InitiateCheckout", "AddPaymentInfo", "Purchase")
            val word = mapOf(
                "PageView" to "page views", "ViewContent" to "pieces viewed", "Search" to "searches", "AddToCart" to "added to cart",
                "InitiateCheckout" to "checkouts started", "AddPaymentInfo" to "payment details", "Purchase" to "orders",
            )
            val keys = ev.keys.filter { (ev[it] ?: 0.0) > 0 }.sortedWith { a, b ->
                val ia = order.indexOf(a).let { if (it < 0) 99 else it }
                val ib = order.indexOf(b).let { if (it < 0) 99 else it }
                if (ia == ib) a.compareTo(b) else ia.compareTo(ib)
            }
            if (keys.isEmpty()) return "nothing"
            return keys.joinToString(" · ") { "${AdsFormat.count(ev[it] ?: 0.0)} ${word[it] ?: it}" }
        }

    val purchases: Double? get() = events?.let { it["Purchase"] ?: 0.0 }

    companion object : Decodable<AdsPixelState> {
        override fun fromMap(m: Map<String, Any?>): AdsPixelState {
            val c = Container(m)
            return AdsPixelState(
                id = c.text("id"), lastFired = c.string("lastFired"), live = c.bool("live", false), onSite = c.bool("onSite"),
                site = c.text("site"), sites = c.list("sites", AdsPixelSite), events = numberMap(m["events"]),
            )
        }
    }
}

data class AdsPixelAnswer(val pixels: List<AdsPixelRow>, val state: AdsPixelState?) {
    companion object : Decodable<AdsPixelAnswer> {
        override fun fromMap(m: Map<String, Any?>): AdsPixelAnswer {
            val c = Container(m)
            return AdsPixelAnswer(c.list("pixels", AdsPixelRow).filter { it.id.isNotEmpty() }, c.obj("state", AdsPixelState))
        }
    }
}

// MARK: Audiences (/api/ads/audiences)

data class AdsAudienceRow(
    val id: String,
    val name: String,
    /** "Customer list", "Lookalike", "Engagement", "Website"… */
    val kind: String,
    val lower: Double?,
    val upper: Double?,
    val ready: Boolean,
    val status: String?,
    val created: String?,
) {
    /** "12k–15k", or null before Meta knows. */
    val sizeWords: String?
        get() = if (lower == null || upper == null) null else "${AdsFormat.compact(lower)}–${AdsFormat.compact(upper)}"

    companion object : Decodable<AdsAudienceRow> {
        override fun fromMap(m: Map<String, Any?>): AdsAudienceRow {
            val c = Container(m)
            val size = (m["size"] as? List<*>).orEmpty().mapNotNull { Container(mapOf("v" to it)).double("v") }
            return AdsAudienceRow(
                c.string("id", ""), c.string("name", ""), c.string("kind", ""), if (size.size == 2) size[0] else null,
                if (size.size == 2) size[1] else null, c.bool("ready", true), c.text("status"), c.string("created"),
            )
        }
    }
}

/** A choice with a line under it (a customer segment, a kind of rule). */
data class AdsHinted(
    val key: String,
    val label: String,
    val hint: String,
    /** Rules: "spend" (an amount today) or "cost" (a cost per result). */
    val needs: String,
) {
    companion object : Decodable<AdsHinted> {
        override fun fromMap(m: Map<String, Any?>): AdsHinted {
            val c = Container(m)
            return AdsHinted(c.string("key", ""), c.string("label", ""), c.string("hint", ""), c.string("needs", "spend"))
        }
    }
}

data class AdsAudiencesAnswer(
    val audiences: List<AdsAudienceRow>,
    val segments: List<AdsHinted>,
    val events: List<AdsChoice>,
    val instagram: String?,
    /** Website visitors the pixel can make an audience of (audience-rows.ts WEBSITE_EVENTS). */
    val websiteEvents: List<AdsHinted> = emptyList(),
    /** Whether a pixel is chosen on Setup. */
    val pixel: Boolean = false,
) {
    companion object : Decodable<AdsAudiencesAnswer> {
        override fun fromMap(m: Map<String, Any?>): AdsAudiencesAnswer {
            val c = Container(m)
            return AdsAudiencesAnswer(
                c.list("audiences", AdsAudienceRow).filter { it.id.isNotEmpty() },
                c.list("segments", AdsHinted).filter { it.key.isNotEmpty() },
                c.list("events", AdsChoice).filter { it.key.isNotEmpty() },
                c.text("instagram"),
                c.list("websiteEvents", AdsHinted).filter { it.key.isNotEmpty() },
                c.bool("pixel", false),
            )
        }
    }
}

/** What making a customer audience sent (hashed): how many customers. */
data class AdsAudienceMade(val id: String?, val sent: Double?) {
    companion object : Decodable<AdsAudienceMade> {
        override fun fromMap(m: Map<String, Any?>): AdsAudienceMade {
            val c = Container(m)
            return AdsAudienceMade(c.string("id"), c.double("sent"))
        }
    }
}

// MARK: Rules and the log (/api/ads/rules)

data class AdsRuleRow(
    val id: String,
    val name: String,
    val enabled: Boolean,
    /** "ad sets · today · spent > Rs 500 · results < 1 → pause it, every 30 min" (rules.ts describeRule). */
    val summary: String,
) {
    companion object : Decodable<AdsRuleRow> {
        override fun fromMap(m: Map<String, Any?>): AdsRuleRow {
            val c = Container(m)
            return AdsRuleRow(c.string("id", ""), c.string("name", ""), c.bool("enabled", false), c.string("summary", ""))
        }
    }
}

/** One change made to the ads from the ERP (`ads_log`). */
data class AdsLogRow(
    val id: String,
    val at: String,
    val by: String,
    val action: String,
    val target: String?,
    val name: String?,
    val daily: Double?,
    val lifetime: Double?,
    val currency: String?,
    val newName: String?,
    val end: String?,
    val hasEnd: Boolean,
) {
    /** The change in words (rules/page.tsx logLine). */
    fun words(fallbackCurrency: String): String {
        val cur = currency ?: fallbackCurrency
        return when (action) {
            "budget" -> if (daily != null && daily > 0) "budget → ${AdsFormat.money(daily, cur)} a day" else "budget → ${AdsFormat.money(lifetime ?: 0.0, cur)} in total"
            "rename" -> "renamed “${newName ?: ""}”"
            "schedule" -> if (!end.isNullOrEmpty()) "end date ${ShopDate.say(end)}" else "no end date"
            else -> action
        }
    }

    companion object : Decodable<AdsLogRow> {
        override fun fromMap(m: Map<String, Any?>): AdsLogRow {
            val c = Container(m)
            val dm = m.obj("detail")
            val d = Container(dm ?: emptyMap())
            return AdsLogRow(
                id = c.string("id", java.util.UUID.randomUUID().toString()), at = c.string("at", ""), by = c.string("by", ""),
                action = c.string("action", ""), target = c.text("target"), name = c.text("name"),
                daily = d.double("daily"), lifetime = d.double("lifetime"), currency = d.string("currency"),
                newName = d.string("name"), end = d.string("end"), hasEnd = dm?.containsKey("end") == true,
            )
        }
    }
}

data class AdsRulesAnswer(val rules: List<AdsRuleRow>, val kinds: List<AdsHinted>, val currency: String, val log: List<AdsLogRow>) {
    companion object : Decodable<AdsRulesAnswer> {
        override fun fromMap(m: Map<String, Any?>): AdsRulesAnswer {
            val c = Container(m)
            return AdsRulesAnswer(
                c.list("rules", AdsRuleRow).filter { it.id.isNotEmpty() }, c.list("kinds", AdsHinted).filter { it.key.isNotEmpty() },
                c.string("currency", "PKR"), c.list("log", AdsLogRow),
            )
        }
    }
}
