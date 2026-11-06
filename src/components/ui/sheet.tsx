"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const Sheet = SheetPrimitive.Root

const SheetTrigger = SheetPrimitive.Trigger

const SheetClose = SheetPrimitive.Close

const SheetPortal = SheetPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    className={cn(
      "glass-overlay fixed inset-0 z-50 bg-black/80 data-[state=open]:duration-300 data-[state=closed]:duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName

const sheetVariants = cva(
  "glass glass-sheet glass-window fixed z-50 gap-4 bg-background p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-300 data-[state=closed]:duration-200 data-[state=open]:ease-sheet data-[state=closed]:ease-exit",
  {
    variants: {
      side: {
        top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
        bottom:
          "inset-x-0 bottom-0 rounded-t-[1.75rem] border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
        right:
          "inset-y-0 right-0 h-full w-3/4  border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm",
      },
    },
    defaultVariants: {
      side: "right",
    },
  }
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

/**
 * A bottom sheet on a touch screen is pulled down to dismiss: the grabber at its top follows the finger
 * (it only ever moves down; a little pull is rubber-banded), and past 110 px, or a quick flick, it closes
 * through the same Close button the keyboard and screen reader use. Only the grabber drags, so the sheet's
 * own scrolling is untouched. Mouse and keyboard are unchanged (Esc, the X, a tap on the dim).
 */
function useSwipeDown(enabled: boolean) {
  const sheetRef = React.useRef<HTMLElement | null>(null)
  const closeRef = React.useRef<HTMLButtonElement | null>(null)
  const drag = React.useRef<{ y: number; t: number; dy: number } | null>(null)
  const apply = (dy: number, animate: boolean) => {
    const el = sheetRef.current
    if (!el) return
    el.style.transition = animate ? "transform 220ms cubic-bezier(0.32, 0.72, 0, 1)" : "none"
    el.style.transform = dy ? `translateY(${dy}px)` : ""
  }
  const handlers = enabled ? {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return
      drag.current = { y: e.clientY, t: Date.now(), dy: 0 };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current
      if (!d) return
      const raw = e.clientY - d.y
      // Down follows the finger; up is resisted to a few pixels.
      d.dy = raw > 0 ? raw : raw / 8
      apply(d.dy, false)
    },
    onPointerUp: () => {
      const d = drag.current
      drag.current = null
      if (!d) return
      const fast = d.dy > 40 && d.dy / Math.max(1, Date.now() - d.t) > 0.6
      if (d.dy > 110 || fast) { closeRef.current?.click(); window.setTimeout(() => apply(0, false), 250) }
      else apply(0, true)
    },
    onPointerCancel: () => { drag.current = null; apply(0, true) },
  } : {}
  return { sheetRef, closeRef, handlers }
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = "right", className, children, ...props }, ref) => {
  const swipe = useSwipeDown(side === "bottom")
  return (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={(node) => {
        swipe.sheetRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node
      }}
      data-side={side}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {side === "bottom" && (
        <div
          aria-hidden
          data-sheet-grabber=""
          className="absolute inset-x-0 top-0 z-10 flex h-7 cursor-grab touch-none items-start justify-center pt-2"
          {...swipe.handlers}
        >
          <span className="h-1 w-9 rounded-full bg-muted-foreground/30" />
        </div>
      )}
      {children}
      <SheetPrimitive.Close ref={swipe.closeRef} className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </SheetPrimitive.Close>
    </SheetPrimitive.Content>
  </SheetPortal>
  )
})
SheetContent.displayName = SheetPrimitive.Content.displayName

const SheetHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
SheetHeader.displayName = "SheetHeader"

const SheetFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-glass-footer="" className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
SheetFooter.displayName = "SheetFooter"

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold text-foreground", className)}
    {...props}
  />
))
SheetTitle.displayName = SheetPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SheetDescription.displayName = SheetPrimitive.Description.displayName

export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
