package erp.app.shots

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import erp.app.ErpApp
import erp.app.screens.ads.AdsPage
import erp.app.screens.ads.AdsTwoPane
import erp.app.screens.marketing.InterestPieces
import erp.app.screens.marketing.PostAlbumPhoto
import erp.app.screens.marketing.PostAlbumStrip
import erp.app.screens.marketing.PostTrayCard
import erp.app.screens.marketing.PostTrayModel
import erp.app.screens.marketing.PostsDemo
import erp.app.screens.marketing.SiteFunnelSection
import erp.app.screens.marketing.SiteRankSection
import erp.app.screens.marketing.SiteRanks
import erp.app.screens.marketing.SiteSourcesSection
import erp.app.screens.marketing.WebsiteDemo
import erp.app.screens.marketing.WebsiteInterestList
import erp.app.screens.marketing.rememberDesignEngine
import erp.app.ui.AppClock
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Website -> Interest (the site's report), its lower half (the funnel, where visitors came from and are, the pieces ranked),
 * Live, and a post's photo strip. Everything reads the demo's made-up site (WebsiteDemo, PostsDemo). A shot holds one screen's
 * worth, so the report's lower parts are drawn on their own from the same demo answer. Phone and tablet, light and dark;
 * nothing here changes with the house but its accent, so only Taheri records.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class SiteReportShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    @Test fun website_interest() {
        onlyTaheri()
        showPlace("/website/interest")
        shoot("website-interest")
    }

    /** The funnel, the sources with their Sources | Kinds switch, and the places with Cities | Countries. */
    @Test fun website_interest_report() {
        onlyTaheri()
        show {
            val n = WebsiteDemo.siteReport("30d", AppClock.now()).let { it.now to it.before }
            AdsPage {
                AdsTwoPane(
                    left = {
                        SiteFunnelSection(n.first, n.second)
                        SiteRankSection(
                            "Where they came from", SiteRanks.sourceRows(n.first.sources), total = n.first.sessions, empty = "No sessions yet.",
                            alt = SiteRanks.channelRows(n.first.channels), picks = listOf("Sources", "Kinds"),
                        )
                    },
                    right = {
                        SiteRankSection(
                            "Where they are", SiteRanks.cityRows(n.first.countries, n.first.cities), total = n.first.sessions, empty = "No sessions yet.",
                            alt = SiteRanks.countryRows(n.first.countries), picks = listOf("Cities", "Countries"),
                        )
                        SiteSourcesSection(n.first.sources)
                    },
                )
            }
        }
        shoot("website-interest-report")
    }

    /** The piece rankings under the report: saved first, with the other three a tap away. */
    @Test fun website_interest_pieces() {
        onlyTaheri()
        show {
            AdsPage { InterestPieces(WebsiteDemo.interest(), WebsiteInterestList.Saved) {} }
        }
        shoot("website-interest-pieces")
    }

    @Test fun website_live() {
        onlyTaheri()
        showPlace("/website/interest/live", below = listOf("/website/interest"))
        shoot("website-live")
    }

    /** A post's card with two photos on it and one more of the piece offered beneath (hero alone is where it starts). */
    @Test fun post_album() {
        onlyTaheri()
        show {
            val scope = rememberCoroutineScope()
            val engine = rememberDesignEngine()
            val piece = remember { PostsDemo.state(AppClock.now()).pieces.first() }
            val model = remember { PostTrayModel(engine, scope) }
            val card = remember { PostTrayCard(piece).also { it.album.add(PostAlbumPhoto.own(piece, 0)) } }
            Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                PostAlbumStrip(card, model, "example.test", false) {}
            }
        }
        shoot("post-album")
    }
}
