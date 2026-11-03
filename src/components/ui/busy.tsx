import * as React from "react"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * A button's label that turns into the spinning circle while an action runs,
 * without the button changing width: the label stays in the layout (hidden) and
 * the circle sits over it. For an action in progress — saving, sending, preparing
 * a PDF — never for data that is loading (that is a skeleton).
 */
function BusyLabel({
  busy,
  children,
  className,
}: {
  busy: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={cn("relative inline-flex items-center justify-center", className)}>
      <span className={busy ? "invisible" : undefined}>{children}</span>
      {busy && <Loader2 className="absolute h-4 w-4 animate-spin" aria-hidden="true" />}
    </span>
  )
}

export { BusyLabel }
