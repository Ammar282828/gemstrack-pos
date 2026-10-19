package erp.app.shots

import erp.app.ErpApp
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Insights: the overview (findings, Instagram's figures, the ads/own split, the charts, the paid platforms, Facebook), the
 * posts and the audience, from the demo's made-up month (InsightsDemo). Phone and tablet, light and dark. Nothing here
 * changes with the house but its accent, which the overview shows, so only that records for both.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class InsightsShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    @Test fun insights_overview() {
        showPlace("/insights")
        shoot("insights-overview")
    }

    @Test fun insights_posts() {
        onlyTaheri()
        showPlace("/insights/posts", below = listOf("/insights"))
        shoot("insights-posts")
    }

    @Test fun insights_audience() {
        onlyTaheri()
        showPlace("/insights/audience", below = listOf("/insights"))
        shoot("insights-audience")
    }
}
