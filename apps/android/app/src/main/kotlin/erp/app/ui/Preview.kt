package erp.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.PreviewLightDark
import androidx.compose.ui.unit.dp
import erp.app.ui.theme.ErpColors
import erp.app.ui.theme.ErpTheme
import erp.core.logic.Money
import erp.core.logic.OrderStage

// Previews of the kit in light and dark (the device's scheme is what the preview toolbar flips).

@Composable
private fun Page(content: @Composable () -> Unit) {
    ErpTheme {
        Column(
            Modifier.background(ErpColors.ground).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) { content() }
    }
}

@PreviewLightDark
@Composable
private fun LedgerPreview() = Page {
    Column(Modifier.heroSheen(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LedgerHeading("Owed to you", count = 4, trailing = "PKR 4.5 lac")
        HeroAmount(450_000.0, lac = true)
        MoneySplit(total = 200_000.0, paid = 120_000.0, due = 80_000.0)
    }
    SectionCard("In the drawer", count = 2, trailing = "PKR 26,000") {
        MoneyRow("Cash", 12_000.0)
        MoneyRow("Refund", 3_000.0, tone = Tone.late, signed = true)
        PerforationDivider()
        MoneyRow("Total", 9_000.0, emphasis = true)
    }
}

@PreviewLightDark
@Composable
private fun BadgesPreview() = Page {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Pill("Late 2 days", tone = Tone.late)
        Pill("PKR 86,000 due", tone = Tone.owed)
        Pill("Paid", tone = Tone.settled)
        Pill("In credit", tone = Tone.credit)
        Pill("With the karigars", tone = Tone.working)
        Pill("Cancelled")
    }
    Column(Modifier.ledgerCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Monogram("Sana Demo", size = MonogramSize.hero)
        StageTrack(OrderStage.karigar, labels = true)
        PaidBar(paid = 40_000.0, total = 100_000.0)
        PaidRing(paid = 100_000.0, total = 100_000.0)
        ContactActions("0300 1234567")
        QuickAction("Call", Icons.Filled.Call, {}, prominent = true)
    }
}

@PreviewLightDark
@Composable
private fun ChipsPreview() = Page {
    ChipRow {
        FilterChip("All", chosen = true, onClick = {}, count = 12)
        FilterChip("Late", chosen = false, onClick = {}, count = 3)
        FilterChip("Ready", chosen = false, onClick = {})
    }
    FigureRow {
        FigureTile("This month", Money.pkrLac(1_250_000.0), Modifier.share(), detail = "up on September")
        FigureTile("Weight", Weight.grams(12.5), Modifier.share())
    }
    TwoLine("Sana Demo", subtitle = "ORD-000123 · Due today", trailing = Money.pkr(86_000.0), trailingLabel = "Due")
    NotAvailableState("Owners only", why = "Ask the owner to open this page.")
}

@PreviewLightDark
@Composable
private fun StatesPreview() = Page {
    SkeletonLoading()
    NoteBanner(Note("Payment recorded", "PKR 20,000 on ORD-000123"))
    NoteBanner(Note("Not saved", "The ERP is not answering", failed = true))
}

@PreviewLightDark
@Composable
private fun EntryPreview() = Page {
    EntrySteps(EntryStep.pieces, {}, states = mapOf(EntryStep.customer to EntryStepState.done, EntryStep.payment to EntryStepState.attention))
    TransactionReview(
        customer = "Sana Demo", contact = "+92 300 1234567",
        pieces = listOf(TransactionReviewRow("Ring", "PKR 120,000")),
        figures = listOf(TransactionReviewRow("Total", "PKR 120,000"), TransactionReviewRow("Advance", "PKR 20,000")),
    )
}
