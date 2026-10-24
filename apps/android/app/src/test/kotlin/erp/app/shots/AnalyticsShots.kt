package erp.app.shots

import erp.app.ErpApp
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Analytics, as the owner on this month (the default period): the Overview and the Sales tab; Taheri's look is the baseline. */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class AnalyticsShots(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return ShotConfigs.all.map { arrayOf<Any>(it) }
        }
    }

    @Test fun analytics_overview() {
        onlyTaheri()
        showPlace("/analytics")
        shoot("analytics-overview")
    }

    @Test fun analytics_sales() {
        onlyTaheri()
        showPlace("/analytics/sales", below = listOf("/analytics"))
        shoot("analytics-sales")
    }

    // Ranked share bars, not a pie; the section picker sits above (Sales is the open section).
    @Test fun analytics_categories() {
        onlyTaheri()
        showPlace("/analytics/categories", below = listOf("/analytics"))
        shoot("analytics-categories")
    }
}
