package erp.app.data

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.Dispatchers

/**
 * The app being on screen at all (any of its Activities started). A poll that belongs to the whole app (the staff books every 25 s,
 * the online-orders count every two minutes) asks [await] before each round, so a phone in a pocket makes no requests and the
 * round after the app comes back is the first one.
 */
object Foreground {
    /** Returns at once while the app is in front; otherwise waits for it to come back. */
    suspend fun await() {
        val lifecycle = withContext(Dispatchers.Main.immediate) { ProcessLifecycleOwner.get().lifecycle }
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return
        suspendCancellableCoroutine<Unit> { cont ->
            val observer = object : LifecycleEventObserver {
                override fun onStateChanged(source: androidx.lifecycle.LifecycleOwner, event: Lifecycle.Event) {
                    if (event == Lifecycle.Event.ON_START) {
                        lifecycle.removeObserver(this)
                        if (cont.isActive) cont.resumeWith(Result.success(Unit))
                    }
                }
            }
            // Observers are added on the main thread; this runs on the caller's, so hop over.
            val main = android.os.Handler(android.os.Looper.getMainLooper())
            main.post { lifecycle.addObserver(observer) }
            cont.invokeOnCancellation { main.post { lifecycle.removeObserver(observer) } }
        }
    }
}
