package erp.app.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/**
 * One Material Symbol from its SVG path data. The SVGs are drawn in a 960 box with y running up from -960, hence the shift
 * (a few older ones are drawn in a plain 24 box: [box] 24); `Icon` tints it, so the black here is never seen.
 */
internal fun symbol(name: String, mirror: Boolean, pathData: String, box: Float = 960f): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, box, box, autoMirror = mirror)
        .addGroup(translationY = if (box == 960f) 960f else 0f)
        .addPath(PathParser().parsePathString(pathData).toNodes(), fill = SolidColor(Color.Black))
        .clearGroup()
        .build()
