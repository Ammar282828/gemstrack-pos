package erp.app.shots

import erp.app.ErpApp
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
}
