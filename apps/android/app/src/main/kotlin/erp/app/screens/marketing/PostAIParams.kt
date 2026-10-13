package erp.app.screens.marketing

/** What the AI sheet asks for, as the body of `/api/website/post/ai`'s `params` (NativePostAISheet.run), key for key. */
object PostAIParams {
    val shapes = listOf("9:16", "4:5", "1:1", "5:4", "3:4", "4:3", "2:3", "3:2", "16:9", "21:9")

    class Form(val instruction: String = "", val rawPrompt: String = "", val aspect: String = "9:16", val scene: String = "", val tidy: Boolean = true)

    fun build(request: PostAIRequest, form: Form, draft: PostDraft, config: MarketingValue): Map<String, Any?> {
        val words = draft.words
        val hero = PostComposerRules.hero(draft)
        val p = LinkedHashMap<String, Any?>()
        p["instruction"] = form.instruction
        p["brief"] = form.instruction
        p["tidy"] = form.tidy
        p["aspect"] = if (request.op == "paint") (if (request.target == "post") "1:1" else "9:16") else form.aspect
        if (form.rawPrompt.trim().isNotEmpty()) p["rawPrompt"] = form.rawPrompt
        if (request.op == "restage") {
            if (form.scene.isEmpty()) p["scene"] = form.instruction else p["sceneId"] = form.scene
        }
        val validWeight = PostComposerRules.validWeight(words)
        if (request.op == "caption" || request.op == "whole") {
            p["headline"] = words.s("headline")
            p["weight"] = validWeight
            p["metal"] = words.s("metal")
            p["stones"] = words.s("stones")
            p["collection"] = words.s("folder")
            p["numbers"] = config["posting"]["whatsappNumbers"].array.map { it.string }
            p["link"] = hero?.source?.s("url") ?: config.s("site")
        }
        if (request.op == "letter" || request.op == "paint") {
            val fields = PostComposerRules.fields(words)
            for ((k, v) in fields) p[k] = v
            p["specs"] = listOf(fields["details"] ?: "", validWeight).filter { it.isNotEmpty() }.joinToString(" | ")
            p["style"] = form.instruction
            p["headlineColour"] = "#FFFFFF"
            p["bodyColour"] = "#FFFFFF"
            p["align"] = "left"
            p["markCorner"] = "top-right"
        }
        return p
    }

    /** The story's layout after "Make the whole story": the AI's alignment and palette, the weight on its own line or not. */
    fun wholeStoryLayout(caption: MarketingValue): Map<String, Any?> = mapOf(
        "action" to "preset", "value" to if (caption.s("align") == "center") "center" else "stack-left",
        "palette" to caption.s("paletteId"), "weightOwnLine" to caption["weightOwnLine"].bool,
    )

    /** The restage that follows it: the 9:16 scene the AI chose (its id, and its brief when it wrote one). */
    fun wholeStoryScene(caption: MarketingValue): Map<String, Any?> {
        val params = linkedMapOf<String, Any?>("aspect" to "9:16", "sceneId" to caption.s("sceneId"))
        if (caption.s("sceneBrief").isNotEmpty()) params["scene"] = caption.s("sceneBrief")
        return params
    }
}
