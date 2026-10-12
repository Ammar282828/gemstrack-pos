package erp.app.device

import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.FragmentActivity
import java.lang.ref.WeakReference
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * The activity in front and the system dialogs it can open for the app (permission, scanner, camera, a file
 * chooser). Registered once in MainActivity.onCreate (the Activity Result API wants that before STARTED), and
 * asked as suspending calls by the device features: the iPhone's `Presenter.top`.
 */
object Foreground {
    private var ref: WeakReference<FragmentActivity>? = null
    private var launch: Launchers? = null

    val activity: FragmentActivity? get() = ref?.get()
    val launchers: Launchers? get() = launch

    fun attach(activity: FragmentActivity) {
        ref = WeakReference(activity)
        launch = Launchers(activity)
    }

    fun detach(activity: FragmentActivity) {
        if (ref?.get() === activity) { ref = null; launch = null }
    }
}

class Launchers(activity: FragmentActivity) {
    private var onIntent: ((ActivityResult) -> Unit)? = null
    private var onSender: ((ActivityResult) -> Unit)? = null
    private var onPermission: ((Boolean) -> Unit)? = null
    private var onPicture: ((Boolean) -> Unit)? = null

    private val intentLauncher = activity.registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r -> onIntent?.invoke(r); onIntent = null }
    private val senderLauncher = activity.registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { r -> onSender?.invoke(r); onSender = null }
    private val permissionLauncher = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> onPermission?.invoke(ok); onPermission = null }
    private val pictureLauncher = activity.registerForActivityResult(ActivityResultContracts.TakePicture()) { ok -> onPicture?.invoke(ok); onPicture = null }

    suspend fun intent(intent: Intent): ActivityResult = suspendCancellableCoroutine { cont ->
        onIntent = { cont.resume(it) }
        cont.invokeOnCancellation { onIntent = null }
        intentLauncher.launch(intent)
    }

    suspend fun intentSender(request: IntentSenderRequest): ActivityResult = suspendCancellableCoroutine { cont ->
        onSender = { cont.resume(it) }
        cont.invokeOnCancellation { onSender = null }
        senderLauncher.launch(request)
    }

    suspend fun permission(name: String): Boolean = suspendCancellableCoroutine { cont ->
        onPermission = { cont.resume(it) }
        cont.invokeOnCancellation { onPermission = null }
        permissionLauncher.launch(name)
    }

    suspend fun takePicture(into: Uri): Boolean = suspendCancellableCoroutine { cont ->
        onPicture = { cont.resume(it) }
        cont.invokeOnCancellation { onPicture = null }
        pictureLauncher.launch(into)
    }
}
