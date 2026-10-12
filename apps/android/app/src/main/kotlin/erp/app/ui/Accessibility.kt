package erp.app.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp

/** Text so large (font scale from 1.3, where iOS's accessibility sizes begin) that side-by-side figures should stack. */
@Composable
fun isLargeText(): Boolean = LocalDensity.current.fontScale >= 1.3f

/** The smallest a tap target may be (Material and TalkBack: 48 dp). */
val MinTouchTarget = 48.dp
