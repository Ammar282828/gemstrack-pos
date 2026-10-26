package erp.app.screens.ads

import erp.app.ui.SearchBarField
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Power
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import erp.app.ui.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import erp.app.ui.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProvideTextStyle
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import erp.app.ui.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import erp.app.nav.LocalNavigator
import erp.app.screens.stock.StockImage
import erp.app.ui.DividedColumn
import erp.app.ui.LedgerHeading
import erp.app.ui.MinTouchTarget
import erp.app.ui.Pill
import erp.app.ui.Radius
import erp.app.ui.ShopDate
import erp.app.ui.SkeletonLoading
import erp.app.ui.Tone
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpType
import erp.core.ERPDate
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset

// The Ads pages' own little kit (AdsKit.swift, AdsWorkKit.swift, and the MarketingKit rows they use). Everything
// here sits on the shared kit: Tone for colour, Radius for corners, the house card for surfaces.
// TODO(shared): MarketingKit.MarketingLink / MarketingReading / MarketingChip, when screens/marketing/MarketingKit.kt lands.

/** The page: a column of cards on the house ground that scrolls (ads pages fill the window; ScreenRegistry.readableWidth). */
@Composable
fun AdsPage(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
        content = content,
    )
}

/** Two columns of cards on a wide window (a tablet, an unfolded fold), one on a phone: the iPad's wide list, as cards. */
@Composable
fun AdsTwoPane(modifier: Modifier = Modifier, left: @Composable ColumnScope.() -> Unit, right: @Composable ColumnScope.() -> Unit) {
    BoxWithConstraints(modifier.fillMaxWidth()) {
        if (maxWidth >= 840.dp) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp), content = left)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(14.dp), content = right)
            }
        } else {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp)) { left(); right() }
        }
    }
}

/** A titled card of rows with hairlines between (a Form's Section), its footer as small print under it. */
@Composable
fun AdsSection(
    title: String?,
    modifier: Modifier = Modifier,
    count: Int? = null,
    footer: (@Composable () -> Unit)? = null,
    divided: Boolean = true,
    header: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (header != null) Box(Modifier.padding(horizontal = 4.dp)) { header() }
        else if (title != null) LedgerHeading(title, Modifier.padding(horizontal = 4.dp), count = count)
        Column(Modifier.fillMaxWidth().clip(Radius.cardShape).background(ErpColors.card)) {
            if (divided) DividedColumn(content = content) else content()
        }
        if (footer != null) {
            CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant) {
                ProvideTextStyle(MaterialTheme.typography.bodySmall) { Column(Modifier.padding(horizontal = 4.dp)) { footer() } }
            }
        }
    }
}

/** One row of a section: its own inset and a comfortable height; tappable when [onClick] is set. */
@Composable
fun AdsRow(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, verticalArrangement: Arrangement.Vertical = Arrangement.spacedBy(4.dp), content: @Composable ColumnScope.() -> Unit) {
    val tap = if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier
    Column(modifier.fillMaxWidth().then(tap).ledgerRow(), verticalArrangement = verticalArrangement, content = content)
}

/** A line of words in a row, in a tone. */
@Composable
fun AdsLine(text: String, tone: Tone = Tone.quiet, modifier: Modifier = Modifier, small: Boolean = false) {
    Text(text, modifier, style = if (small) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyMedium, color = tone.color())
}

/** A row with an icon, a title and a line under it, going somewhere: the iPhone's MarketingLink. */
@Composable
fun AdsLink(title: String, icon: ImageVector, path: String, subtitle: String? = null) {
    val navigator = LocalNavigator.current
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button) { navigator.open(path) }.ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, Modifier.size(22.dp), tint = ErpColors.accent)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (!subtitle.isNullOrEmpty()) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** A line while something is being read. */
@Composable
fun AdsReading(text: String, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        SkeletonLoading(compact = true, label = text)
        Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** A tick-or-circle row: a goal, a segment, an account, a kind of rule. */
@Composable
fun AdsChoiceRow(title: String, chosen: Boolean, onClick: () -> Unit, subtitle: String? = null, leading: ImageVector? = null, enabled: Boolean = true) {
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, role = Role.RadioButton, onClick = onClick).ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) Icon(leading, contentDescription = null, Modifier.size(24.dp), tint = if (chosen) ErpColors.accent else MaterialTheme.colorScheme.onSurfaceVariant)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (!subtitle.isNullOrEmpty()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (chosen) Icon(Icons.Filled.Check, contentDescription = "Chosen", tint = ErpColors.accent)
    }
}

/** The filled button in the house's accent, its words in OnAccent (never the system's white on a light dark-mode accent). */
@Composable
fun AdsProminentButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, busy: Boolean = false) {
    Button(
        onClick = onClick, enabled = enabled, modifier = modifier.defaultMinSize(minHeight = MinTouchTarget),
        colors = ButtonDefaults.buttonColors(containerColor = ErpColors.accent, contentColor = ErpColors.onAccent),
    ) {
        if (busy) SkeletonLoading(compact = true, label = text)
        Text(text, Modifier.padding(start = if (busy) 8.dp else 0.dp), textAlign = TextAlign.Center)
    }
}

/** A quieter button (the iPhone's `.glass`). */
@Composable
fun AdsTonalButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: ImageVector? = null) {
    FilledTonalButton(onClick = onClick, enabled = enabled, modifier = modifier.defaultMinSize(minHeight = MinTouchTarget)) {
        if (icon != null) Icon(icon, contentDescription = null, Modifier.size(18.dp))
        Text(text, Modifier.padding(start = if (icon != null) 6.dp else 0.dp))
    }
}

/** A row that is only a button: a link-styled action in the accent (or a tone). */
@Composable
fun AdsActionRow(text: String, onClick: () -> Unit, icon: ImageVector? = null, enabled: Boolean = true, tone: Tone = Tone.house, busy: Boolean = false) {
    val ink = if (enabled) tone.color() else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
    Row(
        Modifier.fillMaxWidth().clickable(enabled = enabled, role = Role.Button, onClick = onClick).ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (busy) SkeletonLoading(compact = true, label = text)
        else if (icon != null) Icon(icon, contentDescription = null, Modifier.size(22.dp), tint = ink)
        Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge, color = ink)
    }
}

/** An ad object's status as a coloured word. */
@Composable
fun AdsStatusBadge(status: String, modifier: Modifier = Modifier) {
    val words = AdsStatusWords.of(status)
    Pill(words.label, modifier, AdsStatusWords.tone(words.tone))
}

/** An alert asking before something that spends, changes money or cannot be undone (a confirmationDialog). */
@Composable
fun AdsConfirm(
    title: String,
    message: String,
    confirm: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
    cancel: String = "Cancel",
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { if (message.isNotEmpty()) Text(message) },
        confirmButton = {
            TextButton(onClick = { onDismiss(); onConfirm() }) {
                Text(confirm, color = if (destructive) Tone.problem.color() else ErpColors.accent)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(cancel) } },
    )
}

/** A page that can't be shown, with what to do about it (a ContentUnavailableView). */
@Composable
fun AdsUnavailable(
    title: String,
    message: String,
    modifier: Modifier = Modifier,
    icon: ImageVector = Icons.Filled.Campaign,
    actions: @Composable ColumnScope.() -> Unit = {},
) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, contentDescription = null, Modifier.size(40.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.size(12.dp))
        Text(title, style = ErpType.heading, textAlign = TextAlign.Center)
        if (message.isNotEmpty()) {
            Spacer(Modifier.size(6.dp))
            Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
        Spacer(Modifier.size(14.dp))
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp), content = actions)
    }
}

/** Who the Ads pages are for (src/lib/ads/gate.ts): owners and marketing accounts. */
@Composable
fun AdsOwnersOnly() {
    erp.app.ui.NotAvailableState("Ads are for owners", why = "Sign in with an owner or marketing account to see the ad spend.", icon = Icons.Filled.Lock)
}

/** The Ads pages answer owners and marketing accounts alone (gate.ts). */
fun adsMayUse(role: String): Boolean = role == "owner" || role == "marketing"

/** Instead of a page that can't work yet (ads-kit.tsx NotReady): what's missing, and the way to Setup. */
@Composable
fun AdsNotReady(status: AdsStatusAnswer?, problem: String?, retry: () -> Unit) {
    val navigator = LocalNavigator.current
    when {
        problem != null -> AdsUnavailable("Ads aren't ready", problem) {
            // The demo has no ERP to ask again: no button that can only fail.
            if (!erp.app.config.House.isDemo) AdsTonalButton("Try again", retry)
        }
        status != null -> AdsUnavailable(notReadyTitle(status), notReadyDetail(status), icon = Icons.Filled.Power) {
            AdsTonalButton("Open Setup", { navigator.open("/ads/setup") })
        }
        else -> Box(Modifier.fillMaxSize()) { SkeletonLoading(Modifier.fillMaxSize(), label = "Checking the Meta connection…") }
    }
}

fun notReadyTitle(s: AdsStatusAnswer): String {
    val app = s.app
    if (app == null || app.id == null || !app.secret) return "Meta ads aren't set up for this shop yet"
    val conn = s.connection ?: return "Connect the shop's Meta ad account"
    if (!conn.connected) return "The Meta connection needs renewing"
    return "Choose the ad account for this shop"
}

fun notReadyDetail(s: AdsStatusAnswer): String {
    val app = s.app
    if (app == null || app.id == null || !app.secret) return "A couple of one-time steps on Setup, then one tap to connect."
    val conn = s.connection ?: return "On Setup: log in to Facebook as the person who runs the ads and approve."
    if (!conn.connected) return conn.error ?: "Connect again on Setup."
    return "Pick the ad account, Page and Instagram account on Setup."
}

/** One alert at the top of a page. */
class AdsAlert(val bad: Boolean, val text: String)

/**
 * The account's own trouble (payment due, disabled), its spending limit, and a login running out (ads-kit.tsx
 * AccountAlerts). Nothing when all is well.
 */
fun adsAlerts(status: AdsStatusAnswer): List<AdsAlert> {
    val out = ArrayList<AdsAlert>()
    status.account?.let { a ->
        val s = AdsStatusWords.ofAccount(a.status)
        if (s.tone != AdsStatusWords.Level.good) {
            out.add(AdsAlert(s.tone == AdsStatusWords.Level.bad, "${a.name}: ${s.label}. ${AdsStatusWords.accountFix(a.status) ?: ""}"))
        }
        val cap = a.spendCap
        if (cap != null && cap > 0 && a.amountSpent >= cap * 0.9) {
            out.add(AdsAlert(false, "The account has spent ${erp.core.swiftRounded(a.amountSpent / cap * 100).toInt()}% of its spending limit. Ads stop when it reaches it: raise it in Ads Manager → Payment settings."))
        }
    }
    val days = status.connection?.daysLeft
    if (days != null && status.connection?.kind == "user" && days <= 10) {
        val `when` = if (days <= 0) "less than a day" else "$days day${if (days == 1) "" else "s"}"
        out.add(AdsAlert(days <= 3, "The Meta connection runs out in $`when`. Connect again on Setup to keep the Ads pages working (running ads are not affected)."))
    }
    status.accountError?.let { out.add(AdsAlert(true, "Meta didn't answer for the ad account: $it")) }
    return out
}

@Composable
fun AdsAlertsSection(status: AdsStatusAnswer) {
    val list = adsAlerts(status)
    if (list.isEmpty()) return
    AdsSection(null) {
        for (i in list) AdsWarningRow(i.text, if (i.bad) Tone.problem else Tone.owed)
    }
}

/** A triangle and a line of words in a tone. */
@Composable
fun AdsWarningRow(text: String, tone: Tone, icon: ImageVector = Icons.Filled.Warning) {
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        Icon(icon, contentDescription = null, Modifier.size(18.dp).padding(top = 2.dp), tint = tone.color())
        Text(text, style = MaterialTheme.typography.bodyMedium, color = tone.color())
    }
}

/** What stops a plan, as the server said it. */
@Composable
fun AdsProblemsSection(problems: List<String>, setup: Boolean = true) {
    if (problems.isEmpty()) return
    AdsSection("Before it can be made") {
        for (p in problems) AdsWarningRow(p, Tone.owed)
        if (setup && problems.any { it.contains("Setup") }) AdsLink("Open Setup", Icons.Filled.Power, "/ads/setup")
    }
}

/** The range as a menu in the bar (the web's chip row), remembered on the phone. */
@Composable
fun RowScope.AdsRangeMenu() {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }, modifier = Modifier.defaultMinSize(minHeight = MinTouchTarget).semantics { contentDescription = "Range: ${AdsRange.label(AdsRangeStore.key)}" }) {
            Icon(Icons.Filled.CalendarMonth, contentDescription = null, Modifier.size(18.dp))
            Text(AdsRange.label(AdsRangeStore.key), Modifier.padding(start = 6.dp), maxLines = 1)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (r in AdsRange.all) {
                DropdownMenuItem(
                    text = { Text(r.label, fontWeight = if (r.key == AdsRangeStore.key) FontWeight.SemiBold else FontWeight.Normal) },
                    trailingIcon = { if (r.key == AdsRangeStore.key) Icon(Icons.Filled.Check, null, tint = ErpColors.accent) },
                    onClick = { open = false; AdsRangeStore.set(r.key) },
                )
            }
        }
    }
}

/** A picture, filling the frame it is given. */
@Composable
fun AdsPicture(url: String?, name: String, key: String, modifier: Modifier = Modifier) {
    StockImage(imageUrl = url, name = name, key = key, modifier = modifier)
}

// MARK: Days

/** A Karachi day's first minute, and its last (as the web's date boxes send them). */
object AdsDays {
    private val noColon = Regex("""([+-]\d{2})(\d{2})$""")

    /** Meta writes its times as "2026-10-14T23:59:00+0500" (no colon in the zone); the ERP's ISO reader wants one. */
    fun parse(s: String?): Instant? {
        val t = s?.trim() ?: return null
        return ERPDate.parse(if (t.contains('T')) t.replace(noColon, "$1:$2") else t)
    }

    /** A Meta time in the shop's date words ("Tue 14 Oct"); nothing where it can't be read. */
    fun say(s: String?): String = parse(s)?.let { ShopDate.stamp(it) } ?: ""

    fun startOfDay(d: Instant): Instant = LocalDate.parse(ERPDate.karachiDay(d)).atStartOfDay(ERPDate.karachi).toInstant()

    fun endOfDay(d: Instant): Instant = startOfDay(d).plusSeconds(86_400 - 60)

    /** The Karachi day a date picker's UTC-midnight millis names. */
    fun dayOf(utcMillis: Long): LocalDate = Instant.ofEpochMilli(utcMillis).atZone(ZoneOffset.UTC).toLocalDate()

    fun utcMillis(d: Instant): Long = LocalDate.parse(ERPDate.karachiDay(d)).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

    fun startOf(day: LocalDate): Instant = day.atStartOfDay(ERPDate.karachi).toInstant()
}

/** A label and a day at the right edge; tapping opens the calendar. Days before [min] can't be chosen. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdsDayRow(label: String, value: Instant, min: Instant?, onPick: (Instant) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button) { open = true }.ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(ShopDate.stamp(value), style = MaterialTheme.typography.bodyLarge, color = ErpColors.accent)
    }
    if (open) {
        val floor = min?.let { AdsDays.utcMillis(it) }
        val state = rememberDatePickerState(
            initialSelectedDateMillis = AdsDays.utcMillis(value),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean = floor == null || utcTimeMillis >= floor
            },
        )
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton(onClick = {
                    open = false
                    state.selectedDateMillis?.let { onPick(AdsDays.startOf(AdsDays.dayOf(it))) }
                }) { Text("Done") }
            },
            dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
        ) { DatePicker(state) }
    }
}

/** A day and a time (New ad's "Starts"): the calendar, then the clock, in Karachi's time. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdsDayTimeRow(label: String, value: Instant, min: Instant?, onPick: (Instant) -> Unit) {
    var step by remember { mutableStateOf(0) }
    var day by remember { mutableStateOf<LocalDate?>(null) }
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Button) { step = 1 }.ledgerRow(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        Text(ShopDate.stamp(value, withTime = true), style = MaterialTheme.typography.bodyLarge, color = ErpColors.accent)
    }
    if (step == 1) {
        val floor = min?.let { AdsDays.utcMillis(it) }
        val state = rememberDatePickerState(
            initialSelectedDateMillis = AdsDays.utcMillis(value),
            selectableDates = object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean = floor == null || utcTimeMillis >= floor
            },
        )
        DatePickerDialog(
            onDismissRequest = { step = 0 },
            confirmButton = {
                TextButton(onClick = { state.selectedDateMillis?.let { day = AdsDays.dayOf(it); step = 2 } ?: run { step = 0 } }) { Text("Next") }
            },
            dismissButton = { TextButton(onClick = { step = 0 }) { Text("Cancel") } },
        ) { DatePicker(state) }
    }
    if (step == 2) {
        val at = value.atOffset(ERPDate.karachi)
        val time = rememberTimePickerState(initialHour = at.hour, initialMinute = at.minute, is24Hour = false)
        AlertDialog(
            onDismissRequest = { step = 0 },
            title = { Text(label) },
            text = { TimePicker(time) },
            confirmButton = {
                TextButton(onClick = {
                    val d = day
                    step = 0
                    if (d != null) onPick(LocalDateTime.of(d, java.time.LocalTime.of(time.hour, time.minute)).toInstant(ERPDate.karachi))
                }) { Text("Done") }
            },
            dismissButton = { TextButton(onClick = { step = 0 }) { Text("Cancel") } },
        )
    }
}

/** A thin bar of how far a figure is towards a whole (the Overview's month and splits). */
@Composable
fun AdsMeter(value: Double, total: Double, spoken: String, modifier: Modifier = Modifier) {
    val whole = maxOf(total, 1.0)
    androidx.compose.material3.LinearProgressIndicator(
        progress = { (value.coerceIn(0.0, whole) / whole).toFloat() },
        modifier = modifier.fillMaxWidth().height(4.dp).semantics { contentDescription = spoken },
        color = ErpColors.accent,
        trackColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.18f),
        gapSize = 0.dp,
        drawStopIndicator = {},
    )
}

/** Chips that scroll sideways, flush with the page's own margin (the kit's ChipRow adds its own). */
@Composable
fun AdsChips(modifier: Modifier = Modifier, content: @Composable RowScope.() -> Unit) {
    Row(
        modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        content = content,
    )
}

/** A search box with a magnifier, flush with the page's margin. */
@Composable
fun AdsSearchField(placeholder: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    SearchBarField(
        value = value, onValueChange = onChange, modifier = modifier.fillMaxWidth(),
        placeholder = { Text(placeholder) },
        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
        singleLine = true,
        shape = Radius.chipShape,
    )
}
