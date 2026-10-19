package erp.app.shots

import erp.app.ErpApp
import erp.app.screens.marketing.MarketingKit
import erp.app.screens.marketing.PostQueueSpreadLogic
import erp.app.screens.marketing.PostQueueSpreadPage
import erp.app.screens.marketing.PostsDemo
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Posts and Post a piece: the hub the marketing accounts open on, the website's pieces, a queued piece to send, and the
 * composer's first step. The hub reads the demo's made-up posts (PostsDemo), not a server; the composer opens empty, as a
 * new piece does. Phone and tablet, light and dark; the house shows in the accent and the site, so both flavors record.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class MarketingShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    @Test fun posts_hub() {
        showPlace("/posts")
        shoot("posts-hub")
    }

    @Test fun post_composer_first_step() {
        showPlace("/website/post", below = listOf("/posts"))
        shoot("post-composer-1")
    }

    @Test fun post_pieces() {
        onlyTaheri()
        showPlace("/marketing/pieces", below = listOf("/posts"))
        shoot("post-pieces")
    }

    @Test fun post_piece() {
        onlyTaheri()
        showPlace("/marketing/piece?id=Rings%2FR-102.webp", below = listOf("/posts", "/marketing/pieces"))
        shoot("post-piece")
    }

    @Test fun post_queue() {
        onlyTaheri()
        showPlace("/marketing/queue?id=q1", below = listOf("/posts"))
        shoot("post-queue")
    }

    /** A failed piece: the bar says what is left to send, the places say what went and what did not. */
    @Test fun post_queue_failed() {
        onlyTaheri()
        showPlace("/marketing/queue?id=q2", below = listOf("/posts"))
        shoot("post-queue-failed")
    }

    /** The tray before anything is picked, and on one piece (`?id=`, as a piece's "Send or queue it" opens it). */
    @Test fun post_tray_empty() {
        onlyTaheri()
        showPlace("/marketing/tray", below = listOf("/posts"))
        shoot("post-tray-empty")
    }

    @Test fun post_tray_one_piece() {
        onlyTaheri()
        showPlace(MarketingKit.trayPath("Rings/R-101.webp"), below = listOf("/posts", "/marketing/piece?id=Rings%2FR-101.webp"))
        shoot("post-tray")
    }

    /** Spread over the day: the window and when each waiting piece would go (the sheet's page, drawn from the demo's queue). */
    @Test fun post_spread() {
        onlyTaheri()
        show {
            val now = erp.app.ui.AppClock.now()
            val state = PostsDemo.state(now)
            val first = java.time.LocalTime.of(13, 0)
            val last = java.time.LocalTime.of(20, 30)
            PostQueueSpreadPage(state, first, last, PostQueueSpreadLogic.planned(state.waiting.size, first, last, now), null, {}, {})
        }
        shoot("post-spread")
    }
}
