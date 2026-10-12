package erp.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import erp.app.config.House
import erp.app.ui.theme.ErpTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen() // before super: swaps the splash theme for Theme.Erp
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        House.applyIntent(intent)
        setContent { ErpTheme { Placeholder() } }
    }
}

// The real shell (navigation, sign-in) replaces this; it proves the palette, logo and font reach the screen.
@Composable
private fun Placeholder() {
    val futura = FontFamily(Font(R.font.futura_lt_light))
    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeDrawingPadding()
            .padding(horizontal = 32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(
            painterResource(R.drawable.brand_logo),
            contentDescription = stringResource(R.string.app_name),
            modifier = Modifier.widthIn(max = 280.dp),
        )
        Text(
            House.storeName,
            modifier = Modifier.padding(top = 24.dp),
            color = MaterialTheme.colorScheme.primary,
            style = MaterialTheme.typography.headlineMedium,
            fontFamily = futura,
        )
    }
}
