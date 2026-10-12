package erp.app.web

import erp.app.data.JsonText
import erp.core.Json

/**
 * The page bridge's pure parts: who may ask, how a call and its answer are written. The page side is
 * src/lib/native-app.ts (`Capacitor.nativePromise(plugin, method, options)` and `Capacitor.addListener`);
 * the shim below is what makes `window.Capacitor` exist inside the app, as the iPhone's WebBridge.script does.
 */
object BridgeProtocol {
    /**
     * Only the ERP's own page may ask the phone for anything. A frame inside it (an Instagram or Meta preview, a
     * video) can reach the listener too, and must never get the Google sign-in, the delete code kept behind a
     * fingerprint, a file or the share sheet.
     */
    fun originAllowed(scheme: String?, host: String?, port: Int, isMainFrame: Boolean, serverHost: String): Boolean =
        isMainFrame && scheme == "https" && host != null && host.equals(serverHost, ignoreCase = true) && (port == -1 || port == 443)

    /** A call as the shim posts it: `{id, plugin, method, options}`. Null unless it names a plugin and a method. */
    class Call(val id: Any?, val plugin: String, val method: String, val options: Map<String, Any?>)

    fun parse(text: String?): Call? {
        val m = Json.parse(text ?: return null) as? Map<*, *> ?: return null
        val plugin = m["plugin"] as? String ?: return null
        val method = m["method"] as? String ?: return null
        @Suppress("UNCHECKED_CAST")
        return Call(m["id"], plugin, method, (m["options"] as? Map<String, Any?>) ?: emptyMap())
    }

    /** What goes back: `result` (an empty object for "done"), or `error` as "code|message", which the shim turns into an Error with `.code`. */
    fun reply(id: Any?, result: Any? = null): String = JsonText.of(mapOf("id" to id, "result" to (result ?: emptyMap<String, Any?>())))!!

    fun failure(id: Any?, code: String, message: String): String = JsonText.of(mapOf("id" to id, "error" to "$code|$message"))!!

    const val OBJECT_NAME = "erp"

    /**
     * Injected before the page's own scripts. `window.erp` is the listener object `addWebMessageListener` puts
     * on the ERP's pages (and no other origin's); calls carry an id and the answer finds its promise by it.
     */
    val script: String = """
    (() => {
      if (window.Capacitor && window.Capacitor.__erpNative) return;
      const listeners = {};
      const pending = {};
      let seq = 0;
      const fail = (e) => { const m = String((e && e.message) || e); const i = m.indexOf('|'); const err = new Error(i > 0 ? m.slice(i + 1) : m); err.code = i > 0 ? m.slice(0, i) : 'failed'; throw err; };
      if (window.$OBJECT_NAME) window.$OBJECT_NAME.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        const p = pending[m.id]; if (!p) return; delete pending[m.id];
        if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
      };
      window.Capacitor = {
        __erpNative: true,
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        nativePromise: (plugin, method, options) => new Promise((resolve, reject) => {
          if (!window.$OBJECT_NAME) return reject(new Error('unavailable|The app cannot answer here'));
          const id = ++seq; pending[id] = { resolve, reject };
          window.$OBJECT_NAME.postMessage(JSON.stringify({ id, plugin, method, options: options || {} }));
        }).catch(fail),
        addListener: (plugin, event, cb) => {
          const k = plugin + ':' + event; (listeners[k] = listeners[k] || []).push(cb);
          return { remove: () => { listeners[k] = (listeners[k] || []).filter((f) => f !== cb); } };
        },
      };
      window.__erpEmit = (plugin, event, data) => (listeners[plugin + ':' + event] || []).slice().forEach((f) => { try { f(data); } catch (e) {} });
    })();
    """.trimIndent()

    /**
     * A download the web view cannot take itself (a blob: address, or the ERP's own file): the page reads it and
     * hands it to the share sheet through the same calls native-app.ts uses.
     */
    fun downloadHook(href: String, name: String): String {
        val h = JsonText.of(href)!!
        val n = JsonText.of(name)!!
        return """
        (async () => {
          try {
            const r = await fetch($h, { credentials: 'include' }); const blob = await r.blob();
            const bytes = new Uint8Array(await blob.arrayBuffer()); let s = '';
            for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            const file = $n.replace(/[\\/:*?"<>|]+/g, '-') || 'file';
            const { uri } = await window.Capacitor.nativePromise('Filesystem', 'writeFile', { path: 'shared/' + Date.now() + '/' + file, data: btoa(s), directory: 'CACHE', recursive: true });
            await window.Capacitor.nativePromise('Share', 'share', { files: [uri], title: file });
          } catch (e) { if (!e || e.code !== 'cancelled') console.warn('[app] download failed', e); }
        })();
        """.trimIndent()
    }
}
