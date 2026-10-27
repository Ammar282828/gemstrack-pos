package erp.app.screens.design

import erp.app.ui.icons.Symbols
import erp.app.ui.Loading
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import erp.app.screens.marketing.MarketingPhoto
import erp.app.screens.marketing.MarketingRequest
import erp.app.ui.NotAvailableState
import erp.app.ui.PickerRow
import erp.app.ui.Radius
import erp.app.ui.SkeletonLoading
import erp.app.ui.ledgerCard
import erp.app.ui.theme.ErpColors
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.launch

/**
 * Saved › In the ad account (saved-shelf.tsx AccountAds; owner and marketing): the ads already running in Meta, any of which can be
 * kept in a folder through the Saved ads route, as ever. GET /api/ads/campaigns?range=maximum, then POST /api/ads/studio/saved { fromAd, folder }.
 */
@Composable
fun DesignAccountAds(folders: List<DesignFolder>, onKept: () -> Unit) {
    class Ad(val id: String, val name: String, val image: String, val status: String, val place: String)

    val scope = rememberCoroutineScope()
    var ads by remember { mutableStateOf<List<Ad>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    // A refused Keep is said in an alert, not in place of the list.
    var problem by remember { mutableStateOf<String?>(null) }
    var q by remember { mutableStateOf("") }
    var to by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        if (ads != null) return@LaunchedEffect
        try {
            val r = MarketingRequest.get("/api/ads/campaigns?range=maximum")
            ads = r["campaigns"].array.flatMap { c ->
                c["adsets"].array.flatMap { s ->
                    s["ads"].array.map { a ->
                        Ad(a.s("id"), a.s("name"), a.s("image").ifEmpty { a.s("thumbnail") }, a.s("effectiveStatus"), "${c.s("name")} › ${s.s("name")}")
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = e.message
        }
    }

    val words = q.lowercase().split(' ').filter { it.isNotEmpty() }
    val shown = (ads ?: emptyList()).filter { a -> val hay = "${a.name} ${a.place}".lowercase(); words.all { hay.contains(it) } }

    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(q, { q = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), singleLine = true, placeholder = { Text("Find an ad") })
        PickerRow("Keep into", to, listOf("" to "Unfiled") + folders.map { it.id to it.name }) { to = it }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                error != null -> NotAvailableState("Couldn’t read the ad account", why = error, icon = Symbols.Campaign)
                ads == null -> SkeletonLoading(Modifier.fillMaxSize(), label = "Reading the ad account")
                shown.isEmpty() -> NotAvailableState("No ads", why = "The ad account has none that match.", icon = Symbols.Campaign)
                else -> LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(shown, key = { it.id }) { a ->
                        Row(Modifier.fillMaxWidth().ledgerCard(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Box(Modifier.size(52.dp).clip(Radius.thumbShape).background(ErpColors.ground)) { if (a.image.isNotEmpty()) MarketingPhoto(a.image, Modifier.size(52.dp)) }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(a.name, maxLines = 1, style = MaterialTheme.typography.titleSmall)
                                Text(a.place, maxLines = 1, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(if (a.status == "ACTIVE") "Running" else a.status.lowercase().replace('_', ' '), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            IconButton(
                                onClick = {
                                    busy = a.id
                                    scope.launch {
                                        try {
                                            MarketingRequest.send("/api/ads/studio/saved", mapOf("fromAd" to a.id, "folder" to to.ifEmpty { null }))
                                            onKept()
                                        } catch (e: CancellationException) {
                                            throw e
                                        } catch (e: Exception) {
                                            problem = e.message
                                        } finally {
                                            busy = null
                                        }
                                    }
                                },
                                enabled = busy == null, modifier = Modifier.semantics { contentDescription = "Keep in a folder" },
                            ) {
                                if (busy == a.id) Loading(Modifier.size(26.dp)) else Icon(Symbols.Download, null)
                            }
                        }
                    }
                }
            }
        }
    }
    erp.app.ui.FailureAlert(problem, onDismiss = { problem = null }, title = "Could not keep it")
}
