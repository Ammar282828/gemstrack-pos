package erp.app.screens.ads

import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.FormatListNumbered
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Power
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.config.House
import erp.app.nav.ScreenActions
import erp.app.nav.ScreenTitle
import erp.app.screens.stock.StockImage
import erp.app.ui.FailureAlert
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.app.web.openOutside
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** What Setup says about the state of things (AdsSetup.swift), as plain functions. */
object AdsSetupLogic {
    /** What is still wrong, first (readiness.tsx): the app not Live, a login the ERP can't keep, permissions the login lacks, the website pixel. */
    fun readiness(s: AdsStatusAnswer, pixel: AdsPixelAnswer?): List<String> {
        val app = s.app
        if (!s.ready || app == null) return emptyList()
        val out = ArrayList<String>()
        app.live?.let { live ->
            if (!live.ready) out.add("The Meta app is still in Development: new ads from new photos are refused (boosting a post works). Fill the privacy policy, category and icon (step 1), then switch it Live.")
        }
        if (!app.tokenStoreWrite) {
            out.add("This ERP can't save the Meta login (${app.tokenSecret}): grant the App Hosting account Secret Version Adder on it. Until then, connect again before each login runs out.")
        }
        val missing = s.connection?.missingScopes ?: emptyList()
        if (missing.isNotEmpty()) {
            out.add("The Facebook login lacks ${missing.joinToString(", ")}: add ${if (missing.size == 1) "it" else "them"} to the login configuration and connect again.")
        }
        val px = pixel?.state
        if (px != null && !px.live && px.sites.isNotEmpty()) {
            val carried = px.carried
            if (px.id != null) out.add("The website pixel hasn't fired this week: the site isn't loading it yet.")
            else if (carried.isNotEmpty()) out.add("The shop's site already carries a Meta pixel (${carried.joinToString(", ")}) but ads don't use it yet: choose it in step 8.")
            else out.add("No website pixel: website ads buy clicks only, and visitors can't be retargeted.")
        }
        return out
    }

    fun tokenLine(app: AdsStatusAnswer.App): String {
        if (app.tokenStoreWrite) return "Connection store ${app.tokenSecret} is ready."
        if (!app.tokenStoreExists) return "The connection store ${app.tokenSecret} doesn't exist in ${app.project} yet: it needs creating, with Secret Accessor and Secret Version Adder for the App Hosting account."
        return "This server can't save to ${app.tokenSecret}: grant the App Hosting account Secret Version Adder on it."
    }

    fun connectedLine(c: AdsStatusAnswer.Connection): String {
        var line = "Connected"
        c.userName?.let { line += " as $it" }
        line += if (c.kind == "system") " (a system user: never expires)." else "."
        return line
    }

    /** The shop's Instagram is somebody else's (this house's `houseInstagram` against the chosen one). */
    fun wrongHouse(house: String?, chosen: String?): Boolean = house != null && chosen != null && chosen.lowercase() != house

    /** The ERP's own Setup page, where Facebook's login can come back to the browser that started it. */
    fun setupAddress(): String = House.serverUrl.trimEnd('/') + "/ads/setup"
}

/**
 * Ads → Setup (src/app/ads/setup/page.tsx): what still stands between the shop and running every kind of ad, then each
 * step checked live: the Meta app (what its Live switch asks for, the login configuration), the app secret, the
 * Facebook connection, and which ad account, Instagram account and Page this house advertises from, the chat greeting
 * and the website pixel, each chosen with the web's own route (/api/ads/setup, /api/ads/pixel).
 *
 * Connecting is the one step done in the browser (a Custom Tab): Facebook's login comes back to the ERP in the browser
 * that started it (a cookie keeps a connection nobody started from being finished), so the phone opens Setup there. The
 * long one-time steps in Meta's app dashboard are read on the ERP's own page. Nothing here spends money.
 */
@Composable
fun AdsSetupScreen() {
    val session = LocalSession.current
    val backend = LocalAdsBackend.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val mayUse = adsMayUse(session.role)

    var status by remember { mutableStateOf<AdsStatusAnswer?>(null) }
    var assets by remember { mutableStateOf<AdsSetupAssets?>(null) }
    var assetsProblem by remember { mutableStateOf<String?>(null) }
    var pixel by remember { mutableStateOf<AdsPixelAnswer?>(null) }
    var pixelProblem by remember { mutableStateOf<String?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf<String?>(null) }
    var greeting by remember { mutableStateOf("") }
    var configId by remember { mutableStateOf("") }
    var pixelName by remember { mutableStateOf("Website") }
    var confirmOff by remember { mutableStateOf(false) }
    var confirmPixel by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    ScreenTitle("Setup")
    val connected = status?.connection?.connected == true
    val settings = assets?.settings ?: status?.settings
    val house = status?.houseInstagram
    val wrongHouse = AdsSetupLogic.wrongHouse(house, settings?.instagramUsername)

    suspend fun loadAssets() {
        try {
            val a = backend.setupAssets()
            assets = a
            greeting = a.settings?.whatsappGreeting ?: ""
            assetsProblem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            assetsProblem = adsWords(e)
        }
    }

    suspend fun loadPixel() {
        try {
            pixel = backend.pixel()
            pixelProblem = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            pixelProblem = adsWords(e)
        }
    }

    suspend fun load(fresh: Boolean = false) {
        loading = true
        try {
            val s = backend.status(fresh)
            status = s
            problem = null
            val id = s.app?.loginConfigId
            if (id != null && configId.isEmpty()) configId = id
            if (s.connection?.connected == true) {
                loadAssets()
                if (s.settings?.adAccountId != null) loadPixel()
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = adsWords(e)
        } finally {
            loading = false
        }
    }

    suspend fun save(patch: Map<String, Any?>, what: String) {
        busy = what
        try {
            backend.saveSetup(patch)
            AdsChanges.bump()
            load(fresh = true)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = adsWords(e)
        } finally {
            busy = null
        }
    }

    suspend fun pixelAct(body: Map<String, Any?>, what: String) {
        busy = what
        try {
            backend.pixelAct(body)
            loadPixel()
            try { status = backend.status(fresh = true) } catch (e: CancellationException) { throw e } catch (_: Exception) {}
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure = "Couldn't change the pixel. ${adsWords(e)}"
        } finally {
            busy = null
        }
    }

    LaunchedEffect(mayUse) { if (mayUse && status == null) load() }

    if (mayUse && status != null) {
        ScreenActions {
            TextButton(onClick = { scope.launch { load(fresh = true) } }, enabled = !loading) {
                Icon(Icons.Filled.Refresh, contentDescription = null, Modifier.size(18.dp))
                Text("Check again", Modifier.padding(start = 6.dp), maxLines = 1)
            }
        }
    }

    val s0 = status
    when {
        !mayUse -> AdsOwnersOnly()
        s0 != null -> PullToRefreshBox(
            isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; load(fresh = true); refreshing = false } }, modifier = Modifier.fillMaxSize(),
        ) {
            AdsPage {
                AdsAlertsSection(s0)
                AdsTwoPane(
                    left = {
                        Readiness(s0, pixel)
                        AdsSection(null) {
                            AdsLink("Audiences", Icons.Filled.Group, "/ads/audiences", "The ERP's customers, Instagram engagers, lookalikes")
                            AdsLink("Rules", Icons.Filled.Checklist, "/ads/rules", "Meta's automated rules, and every change logged")
                        }
                        AppSections(s0, configId, { configId = it }, busy) { id -> scope.launch { save(mapOf("loginConfigId" to id), "config") } }
                        ConnectSection(s0, session.shop.name, busy, onOpen = { openOutside(context, Uri.parse(AdsSetupLogic.setupAddress())) }, onDisconnect = { confirmOff = true })
                    },
                    right = {
                        ChoiceSections(s0, assets, assetsProblem, connected, settings, house, wrongHouse, session.shop.name, busy,
                            onRetry = { scope.launch { loadAssets() } }, onSave = { patch, what -> scope.launch { save(patch, what) } })
                        GreetingSection(assets, settings, greeting, { greeting = it }, busy) { scope.launch { save(mapOf("whatsappGreeting" to greeting), "greeting") } }
                        PixelSection(
                            connected && settings?.adAccountId != null, pixel, pixelProblem, pixelName, { pixelName = it }, busy,
                            onRetry = { scope.launch { loadPixel() } },
                            onAct = { body, what -> scope.launch { pixelAct(body, what) } },
                            onNew = { carried -> if (carried) confirmPixel = true else scope.launch { pixelAct(mapOf("action" to "create", "name" to pixelName), "pixel") } },
                        )
                    },
                )
            }
        }
        problem != null -> AdsNotReady(null, problem) { scope.launch { load(fresh = true) } }
        else -> SkeletonLoading(Modifier.fillMaxSize(), label = "Checking…")
    }

    if (confirmOff) {
        AdsConfirm(
            title = "Disconnect Meta ads?",
            message = "The ERP forgets the login. Ads already running keep running; the Ads pages show nothing until it's connected again.",
            confirm = "Disconnect", destructive = true, cancel = "Keep it", onDismiss = { confirmOff = false },
            onConfirm = {
                scope.launch {
                    busy = "off"
                    try {
                        backend.disconnect()
                        assets = null
                        pixel = null
                        AdsChanges.bump()
                        load(fresh = true)
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
    if (confirmPixel) {
        AdsConfirm(
            title = "Make another pixel?",
            message = "The site already carries pixel ${(pixel?.state?.carried ?: emptyList()).joinToString(", ")}. A second pixel splits visits and orders between two.",
            confirm = "Make one anyway", cancel = "Not now", onDismiss = { confirmPixel = false },
            onConfirm = { scope.launch { pixelAct(mapOf("action" to "create", "name" to pixelName), "pixel") } },
        )
    }
    FailureAlert(failure, { failure = null }, "That didn't work")
}

@Composable
private fun StepHeader(n: Int, title: String, done: Boolean?) {
    val tint = when (done) { null -> MaterialTheme.colorScheme.onSurfaceVariant; true -> Tone.settled.color(); false -> Tone.problem.color() }
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(
            when (done) { null -> Icons.Filled.Circle; true -> Icons.Filled.CheckCircle; false -> Icons.Filled.Cancel }, contentDescription = null,
            Modifier.size(if (done == null) 14.dp else 18.dp), tint = tint,
        )
        Text("$n. $title", style = erp.app.ui.theme.ErpType.heading)
    }
}

@Composable
private fun Readiness(s: AdsStatusAnswer, pixel: AdsPixelAnswer?) {
    val lines = AdsSetupLogic.readiness(s, pixel)
    if (lines.isEmpty()) return
    AdsSection("Before every kind of ad can run") { for (l in lines) AdsWarningRow(l, Tone.owed) }
}

// MARK: Steps 1 and 2: the Meta app and its secret

@Composable
private fun AppSections(s: AdsStatusAnswer, configId: String, onConfigId: (String) -> Unit, busy: String?, onSaveConfig: (String) -> Unit) {
    val app = s.app ?: return
    AdsSection(
        null,
        header = { StepHeader(1, "The Meta app", app.id != null) },
        footer = { Text("A new ad's photos and words become a post the app makes, and Meta runs such a post only from a Live app. Fill these in App settings → Basic, then App Mode → Live.") },
    ) {
        if (app.id != null) ValueRow("App") { Text(app.id, style = MaterialTheme.typography.bodyLarge) }
        else AdsRow { Text("No Meta app is set for this shop (META_APP_ID in apphosting.yaml).", color = Tone.problem.color()) }
        LiveRow("Privacy policy URL", ok = app.live?.privacyPolicyUrl != null, known = app.live != null, now = app.live?.privacyPolicyUrl, give = app.privacyPage)
        LiveRow("Data deletion instructions URL", ok = false, known = false, now = null, give = app.deletionPage)
        LiveRow("Category", ok = app.live?.category != null, known = app.live != null, now = app.live?.category, give = "Business and pages")
        LiveRow("App icon (1024 × 1024)", ok = app.live?.icon == true, known = app.live != null, now = null, give = "${House.serverUrl.trimEnd('/')}/brand/meta-app-icon-1024.png")
        ConfigRow(app, configId, onConfigId, busy, onSaveConfig)
        AdsLink("The one-time steps in Meta's dashboard", Icons.Filled.FormatListNumbered, "/ads/setup?web=1", "Products, domains, redirect addresses, the login configuration")
    }
    AdsSection(
        null,
        header = { StepHeader(2, "The app secret, kept by this ERP", app.secret && app.tokenStoreWrite) },
    ) {
        AdsRow(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                if (app.secret) "Found in Secret Manager (${app.secretName})." else "Copy the App secret from the Meta app's App settings → Basic and add it as a new version of ${app.secretName} in this project's Secret Manager.",
                color = if (app.secret) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            )
            Text(AdsSetupLogic.tokenLine(app), style = MaterialTheme.typography.bodySmall, color = if (app.tokenStoreWrite) MaterialTheme.colorScheme.onSurfaceVariant else Tone.problem.color())
        }
    }
}

/** One thing Meta's Live switch asks for: ticked when the app has it (read from Meta), else the value to give it. */
@Composable
private fun LiveRow(label: String, ok: Boolean, known: Boolean, now: String?, give: String) {
    AdsRow(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(
                if (known && ok) Icons.Filled.CheckCircle else if (known) Icons.Filled.Cancel else Icons.Filled.Circle, contentDescription = null,
                Modifier.size(if (known) 18.dp else 14.dp),
                tint = if (known && ok) Tone.settled.color() else if (known) Tone.problem.color() else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(label)
        }
        if (known && ok) {
            if (now != null) Text(now, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        } else if (give.isNotEmpty()) {
            androidx.compose.foundation.text.selection.SelectionContainer { Text(give, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace)) }
        }
    }
}

@Composable
private fun ConfigRow(app: AdsStatusAnswer.App, configId: String, onConfigId: (String) -> Unit, busy: String?, onSave: (String) -> Unit) {
    if (app.loginConfigFromEnv) {
        ValueRow("Login configuration") { Text(app.loginConfigId ?: "") }
        return
    }
    AdsRow(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Facebook Login for Business configuration ID")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                configId, onConfigId, Modifier.weight(1f), placeholder = { Text("Configuration ID") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            AdsTonalButton(if (busy == "config") "Saving…" else "Save", { onSave(configId.filter { it.isDigit() }) }, enabled = configId.isNotEmpty() && configId != (app.loginConfigId ?: ""))
        }
        Text(
            app.loginConfigId?.let { "Saved: Connect uses configuration $it." } ?: "Without one, Facebook answers \"Invalid Scopes\".",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// MARK: Step 3: the connection

@Composable
private fun ConnectSection(s: AdsStatusAnswer, shopName: String, busy: String?, onOpen: () -> Unit, onDisconnect: () -> Unit) {
    AdsSection(
        null,
        header = { StepHeader(3, "Connect Facebook", s.connection?.connected) },
        footer = { Text("Facebook's login comes back to the ERP in the browser that started it, so it opens Setup in the browser: sign in there, press Connect, then Check again here.") },
    ) {
        val conn = s.connection
        if (conn != null) {
            if (conn.connected) {
                AdsRow(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(AdsSetupLogic.connectedLine(conn))
                    val days = conn.daysLeft
                    if (conn.kind == "user" && days != null) {
                        Text(
                            "Good for $days more day${if (days == 1) "" else "s"}: connect again before then (running ads are never affected).",
                            style = MaterialTheme.typography.bodySmall, color = if (days <= 10) Tone.owed.color() else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            } else {
                AdsRow { Text(conn.error ?: "The connection is no longer valid.", color = Tone.problem.color()) }
            }
            if (conn.missingScopes.isNotEmpty()) {
                AdsWarningRow("Not granted: ${conn.missingScopes.joinToString(", ")}. Add them to the login configuration (step 1), then connect again.", Tone.owed)
            }
        } else {
            AdsRow { Text("Log in to Facebook as the person who runs $shopName's ads and approve. The login is kept in this project's Secret Manager, never in the database.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        AdsActionRow(
            if (s.connection?.connected == true) "Connect again in the browser" else "Connect in the browser", onOpen,
            icon = Icons.Filled.OpenInBrowser, enabled = (s.app?.secret ?: false) && s.app?.id != null && busy == null,
        )
        if (s.connection != null) {
            AdsActionRow(if (busy == "off") "Disconnecting…" else "Disconnect", onDisconnect, icon = Icons.Filled.Power, tone = Tone.problem, enabled = busy == null)
        }
        s.connectionError?.let { e -> AdsRow { Text(e, style = MaterialTheme.typography.bodySmall, color = Tone.problem.color()) } }
    }
}

// MARK: Steps 4 to 6: the ad account, Instagram, the Page

@Composable
private fun ChoiceRow(title: String, line: String, picture: String?, on: Boolean, enabled: Boolean = true, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, role = androidx.compose.ui.semantics.Role.RadioButton, onClick = onClick).ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        if (picture != null) StockImage(picture, title, title, Modifier.size(36.dp).clip(CircleShape))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title)
            if (line.isNotEmpty()) Text(line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (on) Icon(Icons.Filled.CheckCircle, "Chosen", tint = ErpColors.accent)
    }
}

@Composable
private fun ChoiceSections(
    s: AdsStatusAnswer,
    assets: AdsSetupAssets?,
    assetsProblem: String?,
    connected: Boolean,
    settings: AdsSettingsRow?,
    house: String?,
    wrongHouse: Boolean,
    shopName: String,
    busy: String?,
    onRetry: () -> Unit,
    onSave: (Map<String, Any?>, String) -> Unit,
) {
    AdsSection(null, header = { StepHeader(4, "The ad account", if (connected) settings?.adAccountId != null else null) }) {
        when {
            !connected -> AdsRow { Text("After connecting.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            assetsProblem != null -> {
                AdsWarningRow(assetsProblem, Tone.problem)
                AdsActionRow("Try again", onRetry)
            }
            assets != null -> {
                if (assets.accounts.isEmpty()) {
                    AdsRow { Text("This login can't see any ad account. In Meta Business Settings → Accounts → Ad accounts, give this person access to $shopName's ad account, then Check again.", color = Tone.problem.color()) }
                }
                for (a in assets.accounts) {
                    val st = AdsStatusWords.ofAccount(a.status)
                    val line = listOf(a.business ?: "", "act ${a.id}", a.currency, if (st.label == "Active") "" else st.label).filter { it.isNotEmpty() }.joinToString(" · ")
                    ChoiceRow(a.name, line, null, settings?.adAccountId == a.id, enabled = !s.pinnedAccount && busy == null) { onSave(mapOf("adAccountId" to a.id, "adAccountName" to a.name), "account") }
                }
                if (s.pinnedAccount) AdsRow { Text("Fixed for this shop by META_AD_ACCOUNT_ID.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            else -> AdsReading("Reading what the login can see…")
        }
    }
    if (assets != null && connected) {
        InstagramSection(assets, settings, house, wrongHouse, busy, onSave)
        PageSection(assets, settings, shopName, busy, onSave)
    }
}

@Composable
private fun InstagramSection(assets: AdsSetupAssets, settings: AdsSettingsRow?, house: String?, wrongHouse: Boolean, busy: String?, onSave: (Map<String, Any?>, String) -> Unit) {
    AdsSection(
        null,
        header = { StepHeader(5, house?.let { "Instagram · @$it" } ?: "Instagram", settings?.instagramUserId != null && !wrongHouse) },
    ) {
        if (assets.instagram.isEmpty()) {
            AdsRow {
                Text(
                    "No Instagram account is linked to a Page or the ad account yet. Existing ads still show here; to make new ones, link ${house?.let { "@$it" } ?: "the shop's Instagram"} to a Facebook Page (step 6).",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        for (i in assets.instagram) {
            val page = i.pageId?.let { id -> assets.pages.firstOrNull { it.id == id } }
            val via = page?.let { "Linked to the Page “${it.name}”" } ?: (if (i.via == "ad account") "Added to the ad account" else "Business account")
            val notOurs = house != null && i.username.lowercase() != house
            ChoiceRow("@${i.username.ifEmpty { i.id }}", via + (if (notOurs) " · not this shop's" else ""), i.picture, settings?.instagramUserId == i.id, enabled = busy == null) {
                val patch = linkedMapOf<String, Any?>("instagramUserId" to i.id, "instagramUsername" to i.username)
                if (page != null) {
                    patch["pageId"] = page.id
                    patch["pageName"] = page.name
                }
                onSave(patch, "ig")
            }
        }
        if (wrongHouse && house != null) {
            AdsRow { Text("This shop is @$house; ads made here would appear as @${settings?.instagramUsername ?: ""}.", style = MaterialTheme.typography.bodySmall, color = Tone.problem.color()) }
        }
    }
}

@Composable
private fun PageSection(assets: AdsSetupAssets, settings: AdsSettingsRow?, shopName: String, busy: String?, onSave: (Map<String, Any?>, String) -> Unit) {
    val chosenIg = assets.instagram.firstOrNull { it.id == settings?.instagramUserId }
    AdsSection(
        null,
        header = { StepHeader(6, "The Facebook Page behind new ads", settings?.pageId != null) },
        footer = { Text("Meta runs every new ad through a Facebook Page, even an Instagram-only one (the Page doesn't show on Instagram). Viewing and running existing ads needs none.") },
    ) {
        if (assets.pages.isEmpty()) {
            AdsRow { Text("No Facebook Page yet. Create one for $shopName at facebook.com/pages/create, then in the Page's Settings → Linked accounts link the shop's Instagram (and WhatsApp, for chat ads). Then Check again.", color = Tone.owed.color()) }
        }
        for (p in assets.pages) {
            val line = listOf(
                p.instagramUsername?.let { "@$it" } ?: "no Instagram linked", p.whatsapp?.let { "WhatsApp $it" } ?: "no WhatsApp linked",
                if (p.canAdvertise) "" else "can't advertise",
            ).filter { it.isNotEmpty() }.joinToString(" · ")
            ChoiceRow(p.name, line, p.picture, settings?.pageId == p.id, enabled = busy == null) { onSave(mapOf("pageId" to p.id, "pageName" to p.name), "page") }
        }
        val linked = chosenIg?.pageId
        val page = settings?.pageId
        if (chosenIg != null && linked != null && page != null && linked != page) {
            AdsRow { Text("@${chosenIg.username} is linked to another Page: Meta requires that same Page.", style = MaterialTheme.typography.bodySmall, color = Tone.owed.color()) }
        }
    }
}

// MARK: Steps 7 and 8: the chat greeting, the website pixel

@Composable
private fun GreetingSection(assets: AdsSetupAssets?, settings: AdsSettingsRow?, greeting: String, onGreeting: (String) -> Unit, busy: String?, onSave: () -> Unit) {
    val page = assets?.pages?.firstOrNull { it.id == settings?.pageId }
    AdsSection(
        null,
        header = { StepHeader(7, "Chat ads (optional)", null) },
        footer = {
            Text(
                page?.whatsapp?.let { "Chat ads open WhatsApp to $it (linked to the Page). The message they start with is above." }
                    ?: "Chat ads to WhatsApp need a WhatsApp number linked to the Page (Page settings → Linked accounts → WhatsApp). Instagram-message ads need nothing more.",
            )
        },
    ) {
        AdsRow {
            OutlinedTextField(
                greeting, onGreeting, Modifier.fillMaxWidth(), minLines = 2, maxLines = 4,
                placeholder = { Text("Hi! I saw your ad. Can you tell me more about this piece?") },
            )
        }
        AdsActionRow(if (busy == "greeting") "Saving…" else "Save the message", onSave, enabled = greeting != (settings?.whatsappGreeting ?: "") && busy == null)
    }
}

@Composable
private fun PixelSection(
    ready: Boolean,
    pixel: AdsPixelAnswer?,
    pixelProblem: String?,
    pixelName: String,
    onPixelName: (String) -> Unit,
    busy: String?,
    onRetry: () -> Unit,
    onAct: (Map<String, Any?>, String) -> Unit,
    onNew: (Boolean) -> Unit,
) {
    AdsSection(
        null,
        header = { StepHeader(8, "The website pixel", null) },
        footer = { Text("With a pixel on the website, Meta can retarget people who looked at a piece, build audiences of them, buy page views instead of clicks, and, once it records orders, look for people who buy (\"Online orders\" on New ad).") },
    ) {
        val st = pixel?.state
        when {
            !ready -> AdsRow { Text("Connect and choose the ad account first.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            pixelProblem != null -> {
                AdsRow { Text(pixelProblem, color = Tone.problem.color()) }
                AdsActionRow("Try again", onRetry, icon = Icons.Filled.Refresh)
            }
            pixel != null && st != null -> PixelRows(pixel, st, pixelName, onPixelName, busy, onAct, onNew)
            else -> AdsReading("Reading the ad account's pixels…")
        }
    }
}

@Composable
private fun PixelRows(
    p: AdsPixelAnswer,
    st: AdsPixelState,
    pixelName: String,
    onPixelName: (String) -> Unit,
    busy: String?,
    onAct: (Map<String, Any?>, String) -> Unit,
    onNew: (Boolean) -> Unit,
) {
    val listed = p.pixels.map { it.id }.toSet()
    for (id in st.carried.filter { it != st.id }) {
        AdsRow(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Language, null, Modifier.size(18.dp))
                Text("${st.sitesCarrying(id)} already carries pixel $id", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
            }
            Text(
                if (id in listed) "Use it rather than making another: one pixel keeps every visit and order in one place, and its history is already there."
                else "It isn't shared with this ad account yet, so Meta won't let ads use it. In Meta Business settings → Data sources → Datasets, open $id → Assign assets → this ad account (full control); then it appears below.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            AdsTonalButton(if (id in listed) "Use this pixel" else "Use it anyway (after sharing it)", { onAct(mapOf("action" to "choose", "id" to id), "pixel") }, enabled = busy == null)
        }
    }
    if (st.id != null) {
        AdsRow(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (st.live) Icons.Filled.CheckCircle else Icons.Filled.Warning, null, Modifier.size(18.dp), tint = if (st.live) Tone.settled.color() else Tone.owed.color())
                Text(
                    "Pixel ${st.id} ${if (st.live) "is receiving from the website" else "has not received anything this week"}",
                    color = if (st.live) Tone.settled.color() else Tone.owed.color(),
                )
            }
            st.lastFired?.let { Text("Last received ${ShopDate.say(it, withTime = true)}.", style = MaterialTheme.typography.bodySmall) }
            if (st.onSite == false) {
                Text(
                    "${st.sites.joinToString(" and ") { it.host }} doesn't load it yet: ${if (st.carried.isEmpty()) "the website needs its loader (it reads the id from this ERP's /api/public/pixel)" else "the site carries a different pixel (above)"}.",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            if (st.events != null) Text("This week: ${st.eventLine}.", style = MaterialTheme.typography.bodySmall)
        }
    } else {
        AdsRow { Text("No pixel chosen: website ads buy clicks, and nobody who visits can be retargeted.", style = MaterialTheme.typography.bodySmall, color = Tone.owed.color()) }
    }
    for (x in p.pixels) {
        Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(x.name)
                Text("${x.id} · ${x.lastFired?.let { "last ${ShopDate.say(it)}" } ?: "never fired"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (st.id == x.id) Text("In use", style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold), color = Tone.settled.color())
            else TextButton(onClick = { onAct(mapOf("action" to "choose", "id" to x.id), "pixel") }, enabled = busy == null) { Text("Use this") }
        }
    }
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(pixelName, onPixelName, Modifier.weight(1f), placeholder = { Text("New pixel's name") }, singleLine = true)
        TextButton(onClick = { onNew(st.carried.isNotEmpty()) }, enabled = busy == null && pixelName.trim().isNotEmpty()) {
            Text(if (busy == "pixel") "Working…" else "Make a new pixel")
        }
    }
    if (st.id != null) AdsActionRow("Stop using it", { onAct(mapOf("action" to "choose", "id" to null), "pixel") }, tone = Tone.problem, enabled = busy == null)
}
