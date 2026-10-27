package erp.app.screens.ads

import erp.app.ui.icons.Symbols
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import erp.app.ui.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import erp.app.ui.TextButton
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import erp.app.ui.FilterChip
import erp.app.ui.FullScreenSheet
import erp.app.ui.PickerRow
import erp.app.ui.Tone
import erp.app.ui.ToggleRow
import erp.app.ui.color
import erp.app.ui.ledgerRow
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.TabularDigits
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The audience sheet's edits as plain functions (AdsAudienceEditor.swift add / remove / setRadius / use). */
object AdsAudienceEdit {
    /** A city is added with a 25 km radius; picking one replaces a lone "Pakistan" (a country covers its cities). */
    fun add(draft: AdsAudience, p: AdsPlace): AdsAudience {
        val place = if (p.type == "city" && p.radiusKm == null) p.copy(radiusKm = 25.0) else p
        val lone = draft.places.size == 1
        val rest = draft.places.filter { x -> x.id != place.id && !(place.type != "country" && x.type == "country" && lone) }
        return draft.copy(places = rest + place)
    }

    fun remove(draft: AdsAudience, p: AdsPlace): AdsAudience = draft.copy(places = draft.places.filter { it.id != p.id })

    fun setRadius(draft: AdsAudience, p: AdsPlace, km: Double?): AdsAudience =
        draft.copy(places = draft.places.map { if (it.id == p.id) it.copy(radiusKm = km) else it })

    /** The age a range starts at moves the end up with it. */
    fun ageFrom(draft: AdsAudience, v: Int): AdsAudience = draft.copy(ageMin = v, ageMax = if (draft.ageMax < v) v else draft.ageMax)

    /** "off", "include" or "exclude": how the sheet uses one of the shop's audiences. */
    fun use(draft: AdsAudience, id: String): String = when {
        draft.include.any { it.id == id } -> "include"
        draft.exclude.any { it.id == id } -> "exclude"
        else -> "off"
    }

    fun setUse(draft: AdsAudience, a: AdsAudienceRow, v: String): AdsAudience {
        val n = AdsNamed(a.id, a.name)
        val include = draft.include.filter { it.id != a.id }
        val exclude = draft.exclude.filter { it.id != a.id }
        return draft.copy(include = if (v == "include") include + n else include, exclude = if (v == "exclude") exclude + n else exclude)
    }

    fun position(draft: AdsAudience, key: String, on: Boolean): AdsAudience =
        draft.copy(igPositions = if (on) (if (key in draft.igPositions) draft.igPositions else draft.igPositions + key) else draft.igPositions.filter { it != key })

    /** Meta's limits: a city's radius 17–80 km, a pin's 1–80 km (targeting.ts cityRadius, pinRadius). */
    fun radiusOptions(type: String): List<Int> = if (type == "pin") listOf(1, 2, 3, 5, 8, 10, 15, 25, 40) else listOf(17, 25, 40, 60, 80)
}

private val cityShortcuts = listOf("Karachi", "Lahore", "Islamabad", "Rawalpindi", "Hyderabad, Sindh", "Dubai")
private val interestShortcuts = listOf("Jewellery", "Gold", "Diamonds", "Engagement ring", "Wedding", "Luxury goods", "Bridal")

/**
 * Who an ad is shown to (src/app/ads/audience-editor.tsx), as a sheet: places (with a radius around a city), ages,
 * gender, interests, the house's own audiences in or out, Advantage+ audience, and where on Instagram, with Meta's
 * estimate of how many people that is, asked again a moment after each change. Used by New ad and by each ad set of
 * the designer; every search and the estimate are the web's own routes. "Around this phone" is left out: the app does
 * not ask for the phone's location.
 */
@Composable
fun AdsAudienceSheet(
    title: String,
    draft: AdsAudience,
    goal: String,
    positions: List<AdsChoice>,
    onDismiss: () -> Unit,
    done: (AdsAudience) -> Unit,
) {
    val backend = LocalAdsBackend.current
    val scope = rememberCoroutineScope()
    val where = remember(positions) { positions.ifEmpty { AdsChoice.instagramPlaces } }
    val initial = draft
    var draft by remember { mutableStateOf(initial) }
    var estimate by remember { mutableStateOf<AdsEstimate?>(null) }
    var estimating by remember { mutableStateOf(false) }
    var placeQ by remember { mutableStateOf("") }
    var placeHits by remember { mutableStateOf<List<AdsPlace>?>(null) }
    var interestQ by remember { mutableStateOf("") }
    var interestHits by remember { mutableStateOf<List<AdsInterestHit>?>(null) }
    var audiences by remember { mutableStateOf<List<AdsAudienceRow>?>(null) }
    var showAudiences by remember { mutableStateOf(initial.include.isNotEmpty() || initial.exclude.isNotEmpty()) }

    suspend fun loadAudiences() {
        if (audiences != null) return
        audiences = try { backend.audiences().audiences } catch (e: CancellationException) { throw e } catch (e: Exception) { emptyList() }
    }

    // Meta's estimate, a moment after the last change.
    LaunchedEffect(draft) {
        if (draft.places.isEmpty()) return@LaunchedEffect
        delay(700)
        estimating = true
        val e = try { backend.estimate(draft, goal) } catch (c: CancellationException) { throw c } catch (_: Exception) { null }
        estimate = e
        estimating = false
    }
    LaunchedEffect(placeQ) {
        val q = placeQ.trim()
        if (q.length < 2) { placeHits = null; return@LaunchedEffect }
        delay(350)
        placeHits = try { backend.places(q) } catch (c: CancellationException) { throw c } catch (_: Exception) { emptyList() }
    }
    LaunchedEffect(interestQ) {
        val q = interestQ.trim()
        if (q.length < 2) { interestHits = null; return@LaunchedEffect }
        delay(350)
        interestHits = try { backend.interests(q) } catch (c: CancellationException) { throw c } catch (_: Exception) { emptyList() }
    }
    LaunchedEffect(Unit) { if (showAudiences) loadAudiences() }

    FullScreenSheet(
        title = title, onCancel = onDismiss, confirmText = "Done", confirmEnabled = draft.places.isNotEmpty(),
        onConfirm = { done(draft); onDismiss() },
    ) {
        AdsPage {
            AdsTwoPane(
                left = {
                    // The estimate
                    AdsSection(null, footer = { Text(draft.words) }) {
                        Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Symbols.People, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            val e = estimate
                            val upper = e?.upper
                            when {
                                e != null && upper != null && upper > 0 ->
                                    Text("About ${AdsFormat.compact(e.lower ?: 0.0)}–${AdsFormat.compact(upper)} people", Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge.copy(fontFeatureSettings = TabularDigits))
                                estimating -> Text("Estimating the audience…", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                else -> Text("Meta gave no estimate for this audience.", Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (estimating && estimate != null) erp.app.ui.SkeletonLoading(compact = true, label = "Estimating")
                        }
                    }
                    // Where
                    AdsSection(
                        "Where",
                        footer = { Text("People who live in, or were recently in, these places. A city takes the people around it too.") },
                    ) {
                        for (p in draft.places) PlaceRow(p, { r -> draft = AdsAudienceEdit.setRadius(draft, p, r) }) { draft = AdsAudienceEdit.remove(draft, p) }
                        if (draft.places.isEmpty()) AdsRow { Text("Choose at least one place.", color = Tone.problem.color()) }
                        AdsRow(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                placeQ, { placeQ = it }, Modifier.fillMaxWidth(), placeholder = { Text("A city, area or country") }, singleLine = true,
                                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(capitalization = KeyboardCapitalization.Words, autoCorrectEnabled = false),
                            )
                            val hits = placeHits
                            if (hits != null && placeQ.trim().isNotEmpty()) {
                                if (hits.isEmpty()) Text("Nothing by that name.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                for (h in hits) {
                                    Column(
                                        Modifier.fillMaxWidth().clickable(role = Role.Button) { draft = AdsAudienceEdit.add(draft, h); placeQ = ""; placeHits = null }.padding(vertical = 6.dp),
                                        verticalArrangement = Arrangement.spacedBy(2.dp),
                                    ) {
                                        Text(h.name)
                                        Text(listOfNotNull(h.detail, h.type).filter { it.isNotEmpty() }.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                            AdsChips {
                                for (c in cityShortcuts) AdsTonalButton("+ ${c.substringBefore(',')}", {
                                    scope.launch {
                                        val hits = try { backend.places(c) } catch (e: CancellationException) { throw e } catch (_: Exception) { return@launch }
                                        (hits.firstOrNull { it.type == "city" } ?: hits.firstOrNull())?.let { draft = AdsAudienceEdit.add(draft, it) }
                                    }
                                })
                                AdsTonalButton("+ All Pakistan", { draft = AdsAudienceEdit.add(draft, AdsPlace.pakistan) })
                            }
                        }
                    }
                    // Ages and who
                    AdsSection("Ages and who") {
                        PickerRow("From age", draft.ageMin.toString(), (18..65).map { it.toString() to it.toString() }) { draft = AdsAudienceEdit.ageFrom(draft, it.toInt()) }
                        PickerRow("To age", draft.ageMax.toString(), (draft.ageMin..65).map { it.toString() to (if (it == 65) "65+" else it.toString()) }) { draft = draft.copy(ageMax = it.toInt()) }
                        AdsRow {
                            AdsChips {
                                FilterChip("Everyone", draft.gender == "all", { draft = draft.copy(gender = "all") })
                                FilterChip("Women", draft.gender == "women", { draft = draft.copy(gender = "women") })
                                FilterChip("Men", draft.gender == "men", { draft = draft.copy(gender = "men") })
                            }
                        }
                    }
                },
                right = {
                    // Interests
                    AdsSection(
                        "Interests",
                        footer = { Text(if (draft.interests.isEmpty()) "None: Meta finds the people itself (often the cheapest)." else "Shown to people with any of these interests.") },
                    ) {
                        for (i in draft.interests) {
                            Row(Modifier.fillMaxWidth().ledgerRow(), verticalAlignment = Alignment.CenterVertically) {
                                Text(i.name, Modifier.weight(1f))
                                IconButton(onClick = { draft = draft.copy(interests = draft.interests.filter { it.id != i.id }) }) {
                                    Icon(Symbols.Cancel, "Remove ${i.name}", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                        AdsRow(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(interestQ, { interestQ = it }, Modifier.fillMaxWidth(), placeholder = { Text("Jewellery, gold, weddings…") }, singleLine = true)
                            AdsChips {
                                for (s in interestShortcuts) AdsTonalButton(s, { interestQ = s })
                                if (draft.interests.isNotEmpty()) AdsTonalButton("More like these", {
                                    scope.launch {
                                        interestHits = try { backend.suggestions(draft.interests.map { it.name }) } catch (e: CancellationException) { throw e } catch (_: Exception) { emptyList() }
                                    }
                                }, icon = Symbols.AutoAwesome)
                            }
                            interestHits?.let { hits ->
                                if (hits.isEmpty()) Text("Nothing found.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                for (h in hits) {
                                    val on = draft.interests.any { it.id == h.id }
                                    Row(
                                        Modifier.fillMaxWidth().clickable(enabled = !on, role = Role.Button) { draft = draft.copy(interests = draft.interests + AdsNamed(h.id, h.name)) }.padding(vertical = 6.dp),
                                        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                            Text(h.name)
                                            if (!h.path.isNullOrEmpty()) Text(h.path, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                                        }
                                        h.size?.let { Text(AdsFormat.compact(it), style = MaterialTheme.typography.bodySmall.copy(fontFeatureSettings = TabularDigits), color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                        Icon(if (on) Symbols.Check else Symbols.AddCircle, if (on) "Added" else "Add ${h.name}", tint = ErpColors.accent)
                                    }
                                }
                            }
                        }
                    }
                    // The house's audiences
                    AdsSection("The shop's audiences") {
                        val list = audiences
                        when {
                            !showAudiences -> AdsActionRow("Include or leave out customers, Instagram engagers, lookalikes…", {
                                showAudiences = true
                                scope.launch { loadAudiences() }
                            })
                            list != null -> {
                                if (list.isEmpty()) AdsRow { Text("None yet: make them on Audiences.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                for (a in list) {
                                    val bits = listOf(a.kind, a.sizeWords ?: "", if (a.ready) "" else "not ready").filter { it.isNotEmpty() }
                                    AdsRow(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                        Text(a.name)
                                        Text(bits.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        val use = AdsAudienceEdit.use(draft, a.id)
                                        AdsChips {
                                            FilterChip("Not used", use == "off", { draft = AdsAudienceEdit.setUse(draft, a, "off") })
                                            FilterChip("Reach", use == "include", { draft = AdsAudienceEdit.setUse(draft, a, "include") })
                                            FilterChip("Leave out", use == "exclude", { draft = AdsAudienceEdit.setUse(draft, a, "exclude") })
                                        }
                                    }
                                }
                            }
                            else -> AdsReading("Reading the audiences…")
                        }
                    }
                    // Advantage+
                    AdsSection(
                        null,
                        footer = {
                            Text(
                                if (draft.advantage) "On: the ages, gender, interests and audiences above are Meta's starting point, and it goes beyond them when it finds better people. Places and \"leave out\" stay firm; nobody under 25 is shown it unless allowed above."
                                else "Off: the ages, gender and interests above are strict limits.",
                            )
                        },
                    ) { ToggleRow("Advantage+ audience", draft.advantage, { draft = draft.copy(advantage = it) }) }
                    // Placements
                    AdsSection(
                        "Where it appears",
                        footer = { if (draft.placements != "auto" && draft.igPositions.isEmpty()) Text("None chosen: Meta uses the feed, stories and reels.") },
                    ) {
                        PickerRow(
                            "Where it appears", draft.placements,
                            listOf("instagram" to "Instagram only", "instagram_facebook" to "Instagram + Facebook", "auto" to "Everywhere (Meta decides)"),
                        ) { draft = draft.copy(placements = it) }
                        if (draft.placements != "auto") for (p in where) ToggleRow(p.label, p.key in draft.igPositions, { draft = AdsAudienceEdit.position(draft, p.key, it) })
                    }
                },
            )
        }
    }
}

@Composable
private fun PlaceRow(p: AdsPlace, setRadius: (Double?) -> Unit, remove: () -> Unit) {
    Row(Modifier.fillMaxWidth().ledgerRow(), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (p.type == "pin") Symbols.PinDrop else Symbols.LocationOn, contentDescription = null, tint = ErpColors.accent)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(p.name)
            if (!p.detail.isNullOrEmpty()) Text(p.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (p.type == "city" || p.type == "pin") {
            var open by remember { mutableStateOf(false) }
            val now = erp.core.swiftRounded(p.radiusKm ?: 0.0).toInt()
            androidx.compose.foundation.layout.Box {
                TextButton(onClick = { open = true }) { Text(if (now > 0) "+$now km" else "City only") }
                DropdownMenu(open, { open = false }) {
                    if (p.type == "city") DropdownMenuItem(text = { Text("City only") }, onClick = { open = false; setRadius(null) })
                    for (k in AdsAudienceEdit.radiusOptions(p.type)) DropdownMenuItem(text = { Text("+$k km") }, onClick = { open = false; setRadius(k.toDouble()) })
                }
            }
        }
        IconButton(onClick = remove) { Icon(Symbols.Cancel, "Remove ${p.name}", tint = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
