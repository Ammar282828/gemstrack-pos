package erp.app

import erp.app.device.CrashCatcher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CrashCatcherTests {
    private fun deep(n: Int): Throwable = if (n == 0) IllegalStateException("boom") else try { deep(n - 1).let { throw it } } catch (e: Throwable) { RuntimeException("wrap $n", e) }

    @Test fun the_report_names_the_screen_and_the_error() {
        CrashCatcher.route = "/orders/ORD-1"
        val text = CrashCatcher.report(Thread.currentThread(), IllegalArgumentException("bad weight"), at = 0L)
        assertTrue(text.contains("Last screen: /orders/ORD-1"))
        assertTrue(text.contains("IllegalArgumentException: bad weight"))
        assertTrue(text.contains("1970-01-01T00:00:00Z"))
    }

    @Test fun the_stack_is_cut_to_sixty_lines() {
        CrashCatcher.route = null
        val text = CrashCatcher.report(Thread.currentThread(), deep(80), at = 0L)
        val stack = text.substringAfter("Last screen: none yet\n\n")
        assertEquals(60, stack.lines().size)
    }
}
