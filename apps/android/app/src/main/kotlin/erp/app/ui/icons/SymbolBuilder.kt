package erp.app.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * One Material Symbol from its SVG path data. The SVGs are drawn in a 960 box with y running up from -960, hence the shift;
 * `Icon` tints it, so the black here is never seen.
 */
internal fun symbol(name: String, mirror: Boolean, pathData: String): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 960f, 960f, autoMirror = mirror)
        .addGroup(translationY = 960f)
        .addPath(PathParser().parsePathString(pathData).toNodes(), fill = SolidColor(Color.Black))
        .clearGroup()
        .build()
