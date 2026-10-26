package erp.app.screens.ads

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.nav.ScreenTitle
import erp.app.ui.FailureAlert
import erp.app.ui.FilterChip
import erp.app.ui.PickerRow
import erp.app.ui.ShopDate
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** The countries a lookalike can be made for (AdsAudiences.swift). */
val AdsCountries = listOf(
    AdsChoice("PK", "Pakistan"), AdsChoice("AE", "UAE"), AdsChoice("SA", "Saudi Arabia"),
    AdsChoice("GB", "UK"), AdsChoice("US", "USA"), AdsChoice("CA", "Canada"),
)

/**
 * Ads → Audiences (src/app/ads/audiences/page.tsx): the ad account's audiences, and the three kinds worth making from
 * here: the shop's own customers (from the ERP's customer book, scrambled on the server before Meta sees them; owners
 * only, as the route insists), people who engaged with the house's Instagram, and lookalikes of either. Any of them can
 * then be reached or left out on New ad → Who sees it. Making an audience spends nothing; sending the customer book and
 * deleting ask first.
 */
@Composable
fun AdsAudiencesScreen() {
    val session = LocalSession.current
    val backend = LocalAdsBackend.current
    val scope = rememberCoroutineScope()
    val mayUse = adsMayUse(session.role)
    // Only an owner can send the customer book to Meta (the route insists).
    val isOwner = session.role == "owner"

    var status by remember { mutableStateOf<AdsStatusAnswer?>(null) }
    var data by remember { mutableStateOf<AdsAudiencesAnswer?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var loadProblem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var segment by remember { mutableStateOf("buyers") }
    var days by remember { mutableStateOf(365) }
    var event by remember { mutableStateOf("ig_business_profile_all") }
    var webEvent by remember { mutableStateOf("Purchase") }
    var webDays by remember { mutableStateOf(180) }
    var origin by remember { mutableStateOf("") }
    var percent by remember { mutableStateOf(1) }
    var country by remember { mutableStateOf("PK") }
    var sendingCustomers by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<AdsAudienceRow?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    ScreenTitle("Audiences")

    val segmentLabel = data?.segments?.firstOrNull { it.key == segment }?.label ?: "customers"

    suspend fun loadAudiences() {
        try {
            data = backend.audiences()
            loadProblem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            loadProblem = adsWords(e)
        }
    }

    suspend fun load(fresh: Boolean = false) {
        try {
            val s = backend.status(fresh)
            status = s
            problem = null
            if (s.ready) loadAudiences()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = adsWords(e)
        }
    }

    suspend fun make(body: Map<String, Any?>, what: String) {
        busy = what
        try {
            val m = backend.makeAudience(body)
            val sent = m.sent
            notice = if (sent != null && sent > 0) "${AdsFormat.count(sent)} customers sent (scrambled); Meta matches them over the next hour or so."
            else "Audience made. Meta fills it over the next hour or so."
            loadAudiences()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = adsWords(e)
        } finally {
            busy = null
        }
    }

    LaunchedEffect(mayUse) { if (mayUse && status == null) load() }

    val s0 = status
    when {
        !mayUse -> AdsOwnersOnly()
        s0 != null && s0.ready -> PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; loadAudiences(); refreshing = false } },
            modifier = Modifier.fillMaxSize(),
        ) {
            AdsPage {
                AdsAlertsSection(s0)
                loadProblem?.let { p ->
                    AdsSection(null) {
                        AdsWarningRow(p, Tone.problem)
                        AdsActionRow("Try again", { scope.launch { loadAudiences() } })
                    }
                }
                AdsTwoPane(
                    left = {
                        // The shop's customers
                        AdsSection(
                            "${session.shop.name}'s customers",
                            footer = { Text("Show ads to people who already buy from the shop, or leave them out of ads meant for new people. From the ERP's customer book: phones and emails are scrambled (SHA-256) on the server before anything goes to Meta, which only matches them to accounts.") },
                        ) {
                            if (isOwner) {
                                for (seg in data?.segments ?: emptyList()) AdsChoiceRow(seg.label, seg.key == segment, { segment = seg.key }, subtitle = seg.hint, enabled = busy == null)
                                AdsActionRow("Make “$segmentLabel”", { sendingCustomers = true }, icon = Icons.Filled.VerifiedUser, enabled = data != null && busy == null, busy = busy == "customers")
                            } else {
                                AdsRow { Text("Only an owner can send the customer book to Meta.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                        }
                        // Instagram engagers
                        AdsSection(
                            data?.instagram?.let { "Instagram engagers · @$it" } ?: "Instagram engagers",
                            footer = { Text("People who already know the shop on Instagram: usually the cheapest to turn into chats.") },
                        ) {
                            PickerRow("Who", event, (data?.events ?: emptyList()).map { it.key to it.label }) { event = it }
                            PickerRow("In the last", days.toString(), listOf("30" to "30 days", "90" to "90 days", "180" to "180 days", "365" to "Year", "730" to "2 years")) { days = it.toInt() }
                            AdsActionRow(
                                "Make the engagers audience", { scope.launch { make(mapOf("kind" to "engagers", "days" to days, "event" to event), "engagers") } },
                                icon = Icons.Filled.CameraAlt, enabled = data != null && busy == null, busy = busy == "engagers",
                            )
                        }
                        // Website visitors (the shop's pixel, audiences/page.tsx "Website visitors")
                        AdsSection(
                            "Website visitors",
                            footer = { Text("People the shop's pixel saw on the website. Show ads again to those who looked or added to cart and didn't buy, or make a lookalike of the buyers.") },
                        ) {
                            val d = data
                            if (d != null && !d.pixel) {
                                AdsRow { Text("Choose the shop's pixel on Setup first.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            } else {
                                for (e in d?.websiteEvents ?: emptyList()) AdsChoiceRow(e.label, e.key == webEvent, { webEvent = e.key }, subtitle = e.hint, enabled = busy == null)
                                PickerRow("In the last", webDays.toString(), listOf(7, 14, 30, 60, 90, 180).map { it.toString() to "$it days" }) { webDays = it.toInt() }
                                AdsActionRow(
                                    "Make the website audience", { scope.launch { make(AdsAudiencesLogic.websiteBody(webEvent, webDays), "website") } },
                                    icon = Icons.Filled.Public, enabled = data != null && busy == null, busy = busy == "website",
                                )
                            }
                        }
                        // Lookalike
                        val seeds = (data?.audiences ?: emptyList()).filter { it.kind != "Lookalike" }
                        AdsSection(
                            "Lookalike",
                            footer = { Text("New people who resemble an audience above. 1% is the closest match; bigger reaches more people, less alike. Meta needs at least 100 matched people in the country to start from.") },
                        ) {
                            PickerRow("Like which audience", origin, listOf("" to "Choose one") + seeds.map { it.id to (it.sizeWords?.let { w -> "${it.name} ($w)" } ?: it.name) }) { origin = it }
                            AdsRow {
                                AdsChips { for (p in listOf(1, 2, 3, 5, 10)) FilterChip("$p%", percent == p, { percent = p }) }
                            }
                            PickerRow("Country", country, AdsCountries.map { it.key to it.label }) { country = it }
                            AdsActionRow(
                                "Make the lookalike", { scope.launch { make(mapOf("kind" to "lookalike", "origin" to origin, "percent" to percent, "country" to country), "lookalike") } },
                                icon = Icons.Filled.AutoAwesome, enabled = origin.isNotEmpty() && busy == null, busy = busy == "lookalike",
                            )
                        }
                    },
                    right = {
                        AdsSection("In the ad account") {
                            val d = data
                            if (d != null) {
                                if (d.audiences.isEmpty()) AdsRow { Text("No audiences yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                for (a in d.audiences) AudienceRow(a, isOwner, busy, onRefresh = {
                                    scope.launch {
                                        busy = a.id
                                        try {
                                            val m = backend.makeAudience(mapOf("kind" to "refresh", "id" to a.id, "segment" to segment))
                                            notice = "${AdsFormat.count(m.sent ?: 0.0)} customers sent; ones Meta already had are ignored."
                                            loadAudiences()
                                        } catch (e: CancellationException) {
                                            throw e
                                        } catch (e: Exception) {
                                            failure = adsWords(e)
                                        } finally {
                                            busy = null
                                        }
                                    }
                                }, onDelete = { deleting = a })
                            } else if (loadProblem == null) {
                                AdsReading("Reading the audiences…")
                            }
                        }
                    },
                )
            }
        }
        else -> AdsNotReady(status, problem) { scope.launch { load(fresh = true) } }
    }

    if (sendingCustomers) {
        AdsConfirm(
            title = "Send “$segmentLabel” to Meta?",
            message = "The customers' phone numbers, emails and names are scrambled on the ERP's server first; Meta receives only the scrambled codes, matches them to accounts, and doesn't keep the unmatched ones. It costs nothing. The first time, Meta may ask for its Custom Audience terms to be accepted.",
            confirm = "Send", cancel = "Not now", onDismiss = { sendingCustomers = false },
            onConfirm = { scope.launch { make(mapOf("kind" to "customers", "segment" to segment), "customers") } },
        )
    }
    deleting?.let { a ->
        AdsConfirm(
            title = "Delete “${a.name}”?", message = "Ads that reach or leave out this audience lose it and keep the rest of their targeting. This can't be undone.",
            confirm = "Delete", destructive = true, onDismiss = { deleting = null },
            onConfirm = {
                scope.launch {
                    busy = a.id
                    try {
                        backend.deleteAudience(a.id)
                        loadAudiences()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        failure = adsWords(e)
                    } finally {
                        busy = null
                    }
                }
            },
        )
    }
    notice?.let { n ->
        AlertDialog(onDismissRequest = { notice = null }, title = { Text("Done") }, text = { Text(n) }, confirmButton = { TextButton(onClick = { notice = null }) { Text("OK") } })
    }
    FailureAlert(failure, { failure = null }, "Meta didn't take that")
}

@Composable
private fun AudienceRow(a: AdsAudienceRow, isOwner: Boolean, busy: String?, onRefresh: () -> Unit, onDelete: () -> Unit) {
    val size = a.sizeWords?.let { "$it people" } ?: "size not known yet"
    val made = a.created?.let { ShopDate.say(it) } ?: ""
    val line = listOf(a.kind, size, made).filter { it.isNotEmpty() }.joinToString(" · ")
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(a.name)
            Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            a.status?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Tone.owed.color()) }
        }
        if (busy == a.id) {
            erp.app.ui.SkeletonLoading(compact = true, label = "Working")
        } else {
            if (a.kind == "Customer list" && isOwner) {
                IconButton(onClick = onRefresh, enabled = busy == null) { Icon(Icons.Filled.Refresh, "Add today's customers") }
            }
            IconButton(onClick = onDelete, enabled = busy == null) { Icon(Icons.Filled.Delete, "Delete ${a.name}", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

/** The bodies the audiences route takes (AdsAudiences.swift), kept where a test can read them key for key. */
object AdsAudiencesLogic {
    /** `{ kind: 'website', days, event }`: the pixel's own event (Purchase, AddToCart…) over the last [days] days. */
    fun websiteBody(event: String, days: Int): Map<String, Any?> = linkedMapOf("kind" to "website", "days" to days, "event" to event)
}
