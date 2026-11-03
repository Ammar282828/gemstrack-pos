package erp.app.ui

import erp.app.data.ErpApi
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class QuickPrintTests {
    @Test fun aPdfStartsWithItsMagic() {
        assertTrue(looksLikePdf("%PDF-1.7 rest".toByteArray()))
        assertFalse(looksLikePdf("<html>sign in</html>".toByteArray()))
        assertFalse(looksLikePdf(ByteArray(0)))
    }

    @Test fun aRefusalIsSaidInWordsThePersonCanActOn() {
        assertEquals("This one is for the owners. Sign in as an owner to share it.", quickPdfProblem(ErpApi.Failure(403, "x")))
        assertEquals("The ERP is busy.", quickPdfProblem(ErpApi.Failure(503, "The ERP is busy.")))
    }

    @Test fun aPdfAnswerIsReady() = kotlinx.coroutines.test.runTest {
        val out = prepareQuickPdf { "%PDF-1.4 body".toByteArray() }
        assertTrue(out is QuickPdfOutcome.Ready)
    }

    @Test fun anErrorPageThatCameBackAs200IsNotShared() = kotlinx.coroutines.test.runTest {
        val out = prepareQuickPdf { "<html>sign in</html>".toByteArray() }
        assertEquals("The ERP's answer was not a PDF.", (out as QuickPdfOutcome.Failed).why)
    }

    @Test fun aFailureBecomesTheUsualWords() = kotlinx.coroutines.test.runTest {
        val out = prepareQuickPdf { throw ErpApi.Failure(401, "x") }
        assertEquals("This one is for the owners. Sign in as an owner to share it.", (out as QuickPdfOutcome.Failed).why)
        val slow = prepareQuickPdf { throw java.io.InterruptedIOException() }
        assertEquals("The ERP took too long to draw it. Check the connection and try again.", (slow as QuickPdfOutcome.Failed).why)
    }

    @Test fun aCancellationIsNotAFailure() = kotlinx.coroutines.test.runTest {
        var thrown = false
        try { prepareQuickPdf { throw kotlinx.coroutines.CancellationException("left") } } catch (e: kotlinx.coroutines.CancellationException) { thrown = true }
        assertTrue(thrown)
    }
}
