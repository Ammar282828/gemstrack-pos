package erp.app.nav

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Clear
import androidx.compose.material.icons.rounded.Domain
import androidx.compose.material.icons.rounded.PhoneAndroid
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.BuildConfig
import erp.app.auth.LocalSession
import erp.app.config.House

/**
 * Every place the ERP has, in its own groups (src/lib/nav.ts), when nothing is typed; the places that match, by
 * name or by the words people use for them, when something is. Also the way to Settings and the account.
 */
@Composable
fun SearchScreen() {
    val session = LocalSession.current
    val me by session.me.collectAsStateWithLifecycle()
    val role = me?.role ?: "none"
    val map = remember(role) { NavMap.current.visible(role) }
    val navigator = LocalNavigator.current
    var text by rememberSaveable { mutableStateOf("") }
    val q = text.trim()

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
        item {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                placeholder = { Text("Places in the ERP") },
                leadingIcon = { Icon(Icons.Rounded.Search, null) },
                trailingIcon = { if (text.isNotEmpty()) IconButton({ text = "" }) { Icon(Icons.Rounded.Clear, "Clear") } },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            )
        }
        if (q.isEmpty()) {
            for (g in map.groups.filter { it.label.isNotEmpty() }) {
                val entries = map.entries.filter { it.group == g.key }
                if (entries.isEmpty()) continue
                item(key = "h-${g.key}") { Header(g.label) }
                items(entries, key = { "e-${it.id}" }) { e -> Row(e.label, null, NavIcon.vector(e.icon)) { navigator.open(e.href) } }
            }
            // The map is already this person's: Settings is in it for owners only.
            map.settings?.let { s ->
                item(key = "settings") {
                    HorizontalDivider(Modifier.padding(vertical = 8.dp))
                    Row(s.label, null, NavIcon.vector(s.icon)) { navigator.open(s.href) }
                }
            }
            item(key = "account") {
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                Row("Businesses", null, Icons.Rounded.Domain) { navigator.open("/app/businesses") }
                if (session.isOwner) Row("This phone", null, Icons.Rounded.PhoneAndroid) { navigator.open("/app/phone") }
                Row("Signed in", me?.email ?: "", null, null)
                Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Button(
                        onClick = { session.signOut() },
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                    ) { Text("Sign out") }
                    Text(
                        "${House.storeName} · ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                        modifier = Modifier.padding(top = 12.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            val hits = map.search(q)
            if (hits.isEmpty()) {
                item(key = "none") {
                    Text(
                        "No results for \"$q\"",
                        modifier = Modifier.padding(24.dp),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            items(hits, key = { it.id }) { h ->
                Row(h.place.label, h.entry?.label?.takeIf { it != h.place.label }, NavIcon.vector(h.place.icon)) { navigator.open(h.place.href) }
            }
        }
    }
}

@Composable
private fun Header(label: String) {
    Text(
        label,
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp),
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.primary,
    )
}

/** One line of the list: an icon, a name, and under it the row it sits in (or the account's email). Tappable when `onClick` is given. */
@Composable
private fun Row(label: String, secondary: String?, icon: ImageVector?, onClick: (() -> Unit)? = {}) {
    androidx.compose.foundation.layout.Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) else Spacer(Modifier.width(24.dp))
        Column {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            if (secondary != null) Text(secondary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
