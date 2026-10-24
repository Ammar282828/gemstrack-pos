package erp.app

import erp.app.device.LaunchLog
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class LaunchClockTests {
    private var t = 0L
    private fun log() = LaunchLog { t }

    @Test fun eachStepIsStampedOnceInMillisecondsFromTheStart() {
        val l = log()
        t = 120; l.mark("app:init")
        t = 480; l.mark("frame:first")
        t = 900; l.mark("frame:first")
        t = 1300; l.mark("shelf:orders", "40 cache")
        assertEquals(listOf("app:init" to 120, "frame:first" to 480, "shelf:orders" to 1300), l.marks.map { it.step to it.ms })
        assertEquals("40 cache", l.marks.last().detail)
    }

    @Test fun finishSendsOnceInTheRoutesShapeAndSaysAndroid() {
        val l = log()
        t = 100; l.mark("app:init")
        t = 2500
        val body = l.finish("home", "taheri", "0.1.0 (1)", "Test phone")!!
        assertEquals(setOf("marks", "business", "build", "device", "platform"), body.keys)
        assertEquals("android", body["platform"])
        assertEquals("taheri", body["business"])
        @Suppress("UNCHECKED_CAST")
        val marks = body["marks"] as List<Map<String, Any?>>
        assertEquals(listOf("app:init", "ready:home"), marks.map { it["step"] })
        assertEquals(2500, marks.last()["ms"])
        assertNull(l.finish("timeout", "taheri", "x", "y"), "a launch is reported once")
        t = 3000; l.mark("late")
        assertEquals(2, l.marks.size, "nothing is stamped after it is sent")
    }
}
