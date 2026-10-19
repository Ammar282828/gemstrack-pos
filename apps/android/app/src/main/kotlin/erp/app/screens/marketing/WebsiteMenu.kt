package erp.app.screens.marketing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Language
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import erp.app.auth.LocalSession
import erp.app.nav.NavIcon
import erp.app.nav.ScreenTitle
import erp.app.ui.NotAvailableState
import erp.app.ui.readableColumn

/** What each page is for, in the ERP's words. */
object WebsiteMenuWords {
    val about: Map<String, String> = mapOf(
        "/website/photos" to "Upload photographs to a collection on the site",
        "/website/edit" to "Rename it, change its words or weight, hide it, re-make its photo",
        "/website/weights" to "Record the weight the site draws on a photograph",
    )
}

/**
 * Website: the house's own site, as the places that change it (nav.ts "website": Add photos, Edit a piece, Photo weights),
 * each a native screen on the web page's own routes (Website*.kt). The tabs come from the house's map (nav-<house>.json),
 * already cut to its flags (Edit a piece, Photo weights) and to this person's role.
 *
 * Registered at /marketing/website and not at /website/photos, which is the real Add photos page.
 */
@Composable
fun WebsiteMenu() {
    ScreenTitle("Website")
    val me by LocalSession.current.me.collectAsStateWithLifecycle()
    val tabs = MarketingKit.tabs("website", me?.role ?: "none")
    if (tabs.isEmpty()) {
        NotAvailableState("This shop doesn't change its website from the ERP", why = "Its website is managed outside the ERP, so there are no website tools here.", icon = Icons.Filled.Language)
        return
    }
    Column(Modifier.fillMaxSize().readableColumn(720.dp).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        WebsiteCard(footer = { Text("What changes here is on the website within a minute; each change says where it goes first.") }) {
            for (t in tabs) MarketingLink(t.label, NavIcon.vector(t.icon), t.href, WebsiteMenuWords.about[t.href])
        }
        WebsiteCard {
            MarketingLink("Posts", Icons.AutoMirrored.Filled.Send, "/posts", "What went out, the queue, the site's pieces")
        }
    }
}
