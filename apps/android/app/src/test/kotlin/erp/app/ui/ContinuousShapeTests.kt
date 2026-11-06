package erp.app.ui

import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** The continuous (squircle) corner: a closed path that stays inside its box, shrinks to fit, and is kept per size. */
@RunWith(RobolectricTestRunner::class)
class ContinuousShapeTests {
    private val density = Density(2f)

    private fun path(shape: ContinuousRoundedShape, w: Float, h: Float, dir: LayoutDirection = LayoutDirection.Ltr): androidx.compose.ui.graphics.Path {
        val o = shape.createOutline(Size(w, h), dir, density)
        assertTrue(o is Outline.Generic, "a rounded box is a generic path")
        return (o as Outline.Generic).path
    }

    @Test fun pathIsClosedAndWithinTheBox() {
        val p = path(ContinuousRoundedShape(28.dp), 400f, 200f)
        val b = p.getBounds()
        // Touches all four edges (the straight parts) and never leaves them.
        assertEquals(0f, b.left, 0.01f); assertEquals(0f, b.top, 0.01f)
        assertEquals(400f, b.right, 0.01f); assertEquals(200f, b.bottom, 0.01f)
        assertTrue(!p.isEmpty)
    }

    @Test fun radiiShrinkToFitASmallBox() {
        // A 28 dp (56 px) corner on a 40 px tall box cannot reach 1.5287 x 56 along a side: it is shrunk, not drawn past the box.
        val p = path(ContinuousRoundedShape(28.dp), 300f, 40f)
        val b = p.getBounds()
        assertTrue(b.left >= -0.01f && b.top >= -0.01f && b.right <= 300.01f && b.bottom <= 40.01f)
        val r = ContinuousPaths.fitted(300f, 40f, 56f, 56f, 56f, 56f)
        assertTrue(r.all { it * ContinuousPaths.EXTENT * 2 <= 40.01f })
    }

    @Test fun cornerReachesAlongTheEdges() {
        val r = ContinuousPaths.fitted(1000f, 1000f, 56f, 0f, 0f, 0f)
        assertEquals(56f, r[0]); assertEquals(0f, r[1])
    }

    @Test fun squareCornersMakeARectangle() {
        val o = ContinuousRoundedShape(0.dp).createOutline(Size(10f, 10f), LayoutDirection.Ltr, density)
        assertTrue(o is Outline.Rectangle)
    }

    @Test fun rtlMirrorsTheStartAndEndCorners() {
        val shape = ContinuousRoundedShape(
            androidx.compose.foundation.shape.CornerSize(20.dp), androidx.compose.foundation.shape.CornerSize(0.dp),
            androidx.compose.foundation.shape.CornerSize(0.dp), androidx.compose.foundation.shape.CornerSize(0.dp),
        )
        val ltr = shape.createOutline(Size(300f, 300f), LayoutDirection.Ltr, density) as Outline.Generic
        val rtl = shape.createOutline(Size(300f, 300f), LayoutDirection.Rtl, density) as Outline.Generic
        // The start corner is the left one in LTR and the right one in RTL: two different paths.
        assertTrue(ltr.path !== rtl.path)
    }

    @Test fun pathIsKeptPerSize() {
        val a = ContinuousPaths.of(321f, 123f, 10f, 10f, 10f, 10f)
        val b = ContinuousPaths.of(321f, 123f, 10f, 10f, 10f, 10f)
        assertSame(a, b)
    }

    @Test fun copyKeepsTheShapeContinuous() {
        val base = ContinuousRoundedShape(28.dp)
        val joint = base.copy(bottomStart = androidx.compose.foundation.shape.CornerSize(4.dp))
        assertTrue(joint is ContinuousRoundedShape)
    }
}
