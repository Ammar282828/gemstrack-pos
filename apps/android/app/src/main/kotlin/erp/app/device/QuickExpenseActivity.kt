package erp.app.device

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import erp.app.ErpApp
import erp.app.MainActivity
import erp.app.auth.Session
import erp.app.auth.Sessions
import erp.app.config.Business
import erp.app.config.Businesses
import erp.app.config.House
import erp.app.config.Prefs
import erp.app.data.ErpApi
import erp.app.nav.AppShell
import erp.app.nav.ThemeChoice
import erp.app.screens.money.ExpenseFigures
import erp.app.screens.money.ExpenseFormSheet
import erp.app.screens.money.QuickExpense
import erp.app.ui.FilterChip
import erp.app.ui.TextButton
import kotlinx.coroutines.launch

/**
 * "Add expense" without opening the app (the iPhone's `AddExpenseIntent`; decisions.md#quick-expense): a small window over whatever
 * is on screen, started by the launcher shortcut (long-press the icon) or the Quick Settings tile. It is the Expenses sheet itself
 * (`ExpenseFormSheet`: date, category or a new one, paid by, a partner's salary, a karigar and his hisaab), filed with the same write
 * (`addExpense`, owners only, kept on the phone and sent by the Outbox with no line). The business starts on the one last used, else
 * House of Mina, else the open one ([QuickExpense.choose]); a chip row changes it, and nothing here switches the app's open business.
 * Signed out, or not an owner: it says so and offers the app. The phone's lock asks first, as for any money.
 */
class QuickExpenseActivity : FragmentActivity() {
    private val signedIn: Boolean get() = Sessions.current.state.value == Session.State.SignedIn

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        House.applyIntent(intent)
        ErpApp.ensureFirebase()
        ThemeChoice.load()
        setContent {
            val all by Businesses.list.collectAsStateWithLifecycle()
            var chosen by rememberSaveable {
                mutableStateOf(
                    QuickExpense.choose(all.map { it.id }, Prefs.string(QuickExpense.LAST_KEY), Businesses.current.id) { id ->
                        all.firstOrNull { it.id == id }?.let { Businesses.auth(it)?.currentUser != null } ?: false
                    },
                )
            }
            val business = all.firstOrNull { it.id == chosen }
            if (business == null) { finish(); return@setContent }
            val session = Sessions.of(business)
            AppShell(session) {
                QuickExpenseContent(
                    session, all, onPick = { chosen = it },
                    onOpenApp = { openApp(business); finish() },
                    onClose = { finish() },
                    onFiled = { note ->
                        Prefs.putString(QuickExpense.LAST_KEY, business.id)
                        Toast.makeText(applicationContext, note + " · " + business.displayName, Toast.LENGTH_SHORT).show()
                        finish()
                    },
                )
            }
        }
    }

    override fun onPause() {
        AppLock.paused(signedIn)
        super.onPause()
    }

    override fun onStop() {
        AppLock.stopped(signedIn)
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        AppLock.resumed(this, signedIn)
        lifecycleScope.launch { AppLock.unlockIfNeeded(this@QuickExpenseActivity) }
    }

    /** The app on that business's Expenses (`shoperp://open`, AppRouter): to sign in, or to see the expense in the books. */
    private fun openApp(b: Business) {
        val url = "shoperp://open?b=" + java.net.URLEncoder.encode(b.id, "UTF-8") + "&p=" + java.net.URLEncoder.encode("/expenses", "UTF-8")
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url), this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    companion object {
        /** What the launcher shortcut and the tile fire: this window, a task of its own (both start outside the app). */
        fun launch(context: Context): Intent =
            Intent(context, QuickExpenseActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_MULTIPLE_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
    }
}

@Composable
private fun QuickExpenseContent(
    session: Session, businesses: List<Business>, onPick: (String) -> Unit, onOpenApp: () -> Unit, onClose: () -> Unit, onFiled: (String) -> Unit,
) {
    val state by session.state.collectAsStateWithLifecycle()
    val name = session.business.displayName
    val refusal = QuickExpense.refusal(name, state, session.isOwner)
    if (refusal != null) {
        AlertDialog(
            onDismissRequest = onClose,
            title = { Text("Add expense") },
            text = {
                androidx.compose.foundation.layout.Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(refusal)
                    BusinessChips(businesses, session.business.id, onPick)
                }
            },
            confirmButton = { TextButton(onClick = onOpenApp) { Text("Open the app") } },
            dismissButton = { TextButton(onClick = onClose) { Text("Close") } },
        )
    } else if (state == Session.State.SignedIn) {
        val categories = remember(session.shop.expenseCategories) { ExpenseFigures.formCategories(session.shop.expenseCategories, emptyList()) }
        ExpenseFormSheet(
            null, categories, session.shop.partnership, onDismiss = onClose, onSaved = { onFiled(it.title) },
            api = ErpApi.forBusiness(session.business),
            header = { BusinessChips(businesses, session.business.id, onPick) },
        )
    }
}

/** Which business it files to: a chip each when this phone holds more than one; nothing otherwise. */
@Composable
private fun ColumnScope.BusinessChips(businesses: List<Business>, chosen: String, onPick: (String) -> Unit) {
    if (businesses.size < 2) return
    Text("Files to", style = androidx.compose.material3.MaterialTheme.typography.labelLarge, color = erp.app.ui.theme.ErpColors.quiet)
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        businesses.forEach { b -> FilterChip(b.shortName, chosen = b.id == chosen, onClick = { onPick(b.id) }) }
    }
}
