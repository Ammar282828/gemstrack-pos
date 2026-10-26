package erp.app.shots

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import erp.app.ErpApp
import erp.app.ui.LedgerDivider
import erp.app.ui.LedgerSection
import kotlin.test.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.ParameterizedRobolectricTestRunner.Parameters
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Android 16's grouped list (`ui/Segmented.kt`): every row of a section is its own tile, 2 dp from the next, whether or not the
 * rows are separated by a `LedgerDivider`; a row with no height leaves no gap behind it.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], application = ErpApp::class)
class SegmentedTests(config: ShotConfig) : ShotBase(config) {
    companion object {
        @JvmStatic
        @Parameters(name = "{0}")
        fun configs(): Collection<Array<Any>> {
            ShotEnv.demo()
            return listOf(arrayOf<Any>(ShotConfigs.all[0]))
        }
    }

    @Composable
    private fun Row(tag: String, height: Int = 40) {
        Box(Modifier.fillMaxWidth().height(height.dp).testTag(tag))
    }

    @Test fun rowsAreTilesTwoDpApartWithOrWithoutDividers() {
        show {
            LedgerSection("Group") {
                Row("a"); LedgerDivider(); Row("b"); Row("c")
                Row("none", height = 0)
            }
        }
        val a = compose.onNodeWithTag("a").getUnclippedBoundsInRoot()
        val b = compose.onNodeWithTag("b").getUnclippedBoundsInRoot()
        val c = compose.onNodeWithTag("c").getUnclippedBoundsInRoot()
        assertEquals(2.dp, b.top - a.bottom)
        assertEquals(2.dp, c.top - b.bottom)
        assertEquals(40.dp, a.bottom - a.top)
    }
}
