package erp.app.ui

import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

/** The pure rules behind the motion helpers (the springs themselves come from the theme and are looked at in MotionTests). */
class ErpMotionTests {
    @Test fun only_the_first_six_rows_arrive_thirty_milliseconds_apart() {
        assertEquals(listOf(0L, 30L, 60L, 90L, 120L, 150L), (0..5).map { ErpMotion.appearDelay(it) })
        assertNull(ErpMotion.appearDelay(6))
        assertNull(ErpMotion.appearDelay(Int.MAX_VALUE))
        assertNull(ErpMotion.appearDelay(-1))
    }

    @Test fun a_later_step_is_forward_and_an_earlier_one_back() {
        assertTrue(ErpMotion.forward(0, 1))
        assertTrue(ErpMotion.forward(2, 2))
        assertFalse(ErpMotion.forward(3, 1))
    }

    @Test fun a_figure_that_grew_rolls_up() {
        assertTrue(ErpMotion.rollsUp(100.0, 250.0))
        assertTrue(ErpMotion.rollsUp(100.0, 100.0))
        assertFalse(ErpMotion.rollsUp(250.0, 100.0))
    }

    @Test fun a_held_button_widens_and_the_others_keep_their_share() {
        assertEquals(1f + SQUEEZE_GROWTH, squeezeWeight(pressed = 1, index = 1))
        assertEquals(1f, squeezeWeight(pressed = 1, index = 0))
        assertEquals(1f, squeezeWeight(pressed = 1, index = 2))
        assertEquals(1f, squeezeWeight(pressed = -1, index = 1))
    }

    @Test fun the_shared_axis_is_materials_thirty_dp_and_the_fade_through_starts_at_ninety_two_percent() {
        assertEquals(30, ErpMotion.AXIS_DP)
        assertEquals(0.92f, ErpMotion.FADE_THROUGH_SCALE)
    }
}
