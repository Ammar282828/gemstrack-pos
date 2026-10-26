package erp.app.screens.ads

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.MaterialTheme
import erp.app.ui.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.auth.LocalSession
import erp.app.nav.ScreenTitle
import erp.app.ui.FailureAlert
import erp.app.ui.RowAction
import erp.app.ui.ShopDate
import erp.app.ui.SwipeActions
import erp.app.ui.Tone
import erp.app.ui.ValueInput
import erp.app.ui.ValueRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** What making a rule says before it asks (AdsRules.swift newRuleName / newRuleWords), as plain functions. */
object AdsRulesLogic {
    /** "Tell me what's not working — Rs 500", as Meta will file it (rules.ts ruleSpecs). */
    fun newRuleName(chosen: AdsHinted?, amount: Double?, currency: String): String =
        "${chosen?.label ?: "Rule"} — ${AdsFormat.money(amount ?: 0.0, currency)}"

    /** What the rule will do, in its own words with the amount in, and what it costs. */
    fun newRuleWords(kind: String, chosen: AdsHinted?, amount: Double?, currency: String): String {
        val money = AdsFormat.money(amount ?: 0.0, currency)
        val hint = (chosen?.hint ?: "").replace("this much", money).replace("above this", "above $money")
        val acts = if (kind.startsWith("pause")) "It pauses ad sets by itself: a paused one stops spending until it is switched on again."
        else "It only sends a Facebook notification; nothing is paused."
        return "$hint\nMeta checks it itself around the clock on every ad set in the account, even with the ERP closed. $acts The rule costs nothing itself."
    }

    fun switchOnWords(r: AdsRuleRow): String =
        "${r.summary}.\nMeta then checks it by itself on every ad set in the account and acts on what it finds, even with the ERP closed. The rule costs nothing itself."
}

/**
 * Ads → Rules (src/app/ads/rules/page.tsx): watchdogs Meta runs on the ad account by itself (pause what's spending with
 * nothing to show, a daily ceiling, a word when results get expensive), and the log of every change made to the ads
 * from the ERP. A rule acts on its own, every ad set, with the ERP closed: making one or switching one on says exactly
 * what it will do and asks first. Switching one off is at once, like pausing.
 */
@Composable
fun AdsRulesScreen() {
    val session = LocalSession.current
    val backend = LocalAdsBackend.current
    val scope = rememberCoroutineScope()
    val mayUse = adsMayUse(session.role)

    var status by remember { mutableStateOf<AdsStatusAnswer?>(null) }
    var data by remember { mutableStateOf<AdsRulesAnswer?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }
    var loadProblem by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var kind by remember { mutableStateOf("notify_no_results") }
    var amount by remember { mutableStateOf("500") }
    var making by remember { mutableStateOf(false) }
    var switchingOn by remember { mutableStateOf<AdsRuleRow?>(null) }
    var deleting by remember { mutableStateOf<AdsRuleRow?>(null) }
    var failure by remember { mutableStateOf<String?>(null) }
    var refreshing by remember { mutableStateOf(false) }

    ScreenTitle("Rules")

    val currency = data?.currency ?: status?.currency ?: "PKR"
    val chosen = data?.kinds?.firstOrNull { it.key == kind }
    val amountValue = AdsAmount.parse(amount)

    suspend fun loadRules() {
        try {
            data = backend.rules()
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
            if (s.ready) loadRules()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            problem = adsWords(e)
        }
    }

    suspend fun act(id: String, block: suspend () -> Unit) {
        busy = id
        try {
            block()
            loadRules()
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
            isRefreshing = refreshing, onRefresh = { scope.launch { refreshing = true; loadRules(); refreshing = false } },
            modifier = Modifier.fillMaxSize(),
        ) {
            AdsPage {
                AdsAlertsSection(s0)
                loadProblem?.let { p ->
                    AdsSection(null) {
                        AdsWarningRow(p, Tone.problem)
                        AdsActionRow("Try again", { scope.launch { loadRules() } })
                    }
                }
                AdsTwoPane(
                    left = {
                        AdsSection("A new rule", footer = { Text("Meta checks these itself around the clock and acts on every ad set in the account: the ERP doesn't need to be open.") }) {
                            for (k in data?.kinds ?: emptyList()) AdsChoiceRow(k.label, k.key == kind, { kind = k.key }, subtitle = k.hint)
                            ValueRow(if (chosen?.needs == "cost") "Per result ($currency)" else "Today ($currency)") {
                                ValueInput(amount, { amount = it }, prompt = "Amount", label = "Amount", keyboard = KeyboardType.Decimal)
                            }
                            AdsActionRow("Make the rule", { making = true }, enabled = busy == null && amountValue != null && data != null, busy = busy == "new", tone = Tone.house)
                        }
                    },
                    right = {
                        AdsSection("Rules on the account", footer = { if (data?.rules?.isNotEmpty() == true) Text("Swipe a rule to delete it.") }) {
                            val d = data
                            if (d != null) {
                                if (d.rules.isEmpty()) AdsRow { Text("None yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                for (r in d.rules) {
                                    SwipeActions(end = RowAction("Delete", Icons.Filled.Delete, Tone.problem) { deleting = r }) {
                                        Row(
                                            Modifier.fillMaxWidth().background(ErpColors.card).ledgerRow(),
                                            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                                Text(r.name)
                                                Text(r.summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            }
                                            if (busy == r.id) {
                                                erp.app.ui.SkeletonLoading(compact = true, label = "Working")
                                            } else {
                                                Switch(
                                                    checked = r.enabled,
                                                    onCheckedChange = { on -> if (on) switchingOn = r else scope.launch { act(r.id) { backend.setRule(r.id, false) } } },
                                                    enabled = busy == null,
                                                    modifier = Modifier.semantics { contentDescription = "On: ${r.name}" },
                                                    colors = SwitchDefaults.colors(checkedTrackColor = ErpColors.accent, checkedThumbColor = ErpColors.onAccent),
                                                )
                                            }
                                        }
                                    }
                                }
                            } else if (loadProblem == null) {
                                AdsReading("Reading the rules…")
                            }
                        }
                        AdsSection("Changes made from the ERP") {
                            val d = data
                            if (d != null) {
                                if (d.log.isEmpty()) AdsRow { Text("Nothing yet.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                for (r in d.log) {
                                    AdsRow(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                        Text(r.words(currency), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium))
                                        Text(
                                            listOf(ShopDate.say(r.at, withTime = true), r.name ?: r.target ?: "", r.by).filter { it.isNotEmpty() }.joinToString(" · "),
                                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }
                        }
                    },
                )
            }
        }
        else -> AdsNotReady(status, problem) { scope.launch { load(fresh = true) } }
    }

    if (making) {
        AdsConfirm(
            title = "Make “${AdsRulesLogic.newRuleName(chosen, amountValue, currency)}”?",
            message = AdsRulesLogic.newRuleWords(kind, chosen, amountValue, currency),
            confirm = "Make the rule", cancel = "Not now", onDismiss = { making = false },
            onConfirm = { amountValue?.let { v -> scope.launch { act("new") { backend.makeRule(kind, v) } } } },
        )
    }
    switchingOn?.let { r ->
        AdsConfirm(
            title = "Switch on “${r.name}”?", message = AdsRulesLogic.switchOnWords(r), confirm = "Switch it on",
            onDismiss = { switchingOn = null }, onConfirm = { scope.launch { act(r.id) { backend.setRule(r.id, true) } } },
        )
    }
    deleting?.let { r ->
        AdsConfirm(
            title = "Delete “${r.name}”?", message = "Meta stops checking it. Ad sets it paused stay paused until switched on.",
            confirm = "Delete", destructive = true, onDismiss = { deleting = null }, onConfirm = { scope.launch { act(r.id) { backend.deleteRule(r.id) } } },
        )
    }
    FailureAlert(failure, { failure = null }, "Meta didn't take that")
}
