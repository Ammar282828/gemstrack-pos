"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "@/lib/utils"
import { MIN_OPTIONS_FOR_RECENTS, isRememberable, recentsKeyFor, rememberRecent, useRecents } from "@/lib/recents"

/**
 * Radix's Select, with a "Recent" group.
 *
 * Every Select with enough options to scroll (MIN_OPTIONS_FOR_RECENTS) shows
 * this browser's last few picks first. The items are MOVED up, not copied:
 * Radix portals the selected item's text into the trigger, and a value that
 * appears twice in the list would print twice in the box.
 *
 * The memory is keyed by `recentsKey`, or — when a caller gives none — by
 * the set of option values, so identical lists share one memory. A list that
 * changes over time (categories) should be given a key so its recents survive
 * an addition. `recentsKey={false}` turns the group off for a Select that
 * already ranks its own options.
 */
interface RecentsScope {
  explicit: string | false | undefined
  /** Set by SelectContent from what it renders; read by Root when a value is picked. */
  keyRef: React.MutableRefObject<string | undefined>
}
const RecentsContext = React.createContext<RecentsScope | null>(null)

type SelectProps = React.ComponentProps<typeof SelectPrimitive.Root> & {
  recentsKey?: string | false
}

const Select: React.FC<SelectProps> = ({ recentsKey, onValueChange, children, ...props }) => {
  const keyRef = React.useRef<string | undefined>(undefined)
  const scope = React.useMemo<RecentsScope>(() => ({ explicit: recentsKey, keyRef }), [recentsKey])
  return (
    <RecentsContext.Provider value={scope}>
      <SelectPrimitive.Root
        {...props}
        onValueChange={(v) => {
          rememberRecent(keyRef.current, v)
          onValueChange?.(v)
        }}
      >
        {children}
      </SelectPrimitive.Root>
    </RecentsContext.Provider>
  )
}

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

/** Walks fragments and groups to find every SelectItem, by value. */
function collectItems(children: React.ReactNode, into: Map<string, React.ReactElement>): void {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    const el = child as React.ReactElement<{ value?: unknown; children?: React.ReactNode }>
    if (el.type === SelectItem) {
      if (typeof el.props.value === "string") into.set(el.props.value, el)
    } else if (el.type === React.Fragment || el.type === SelectGroup) {
      collectItems(el.props.children, into)
    }
  })
}

/** The same tree without the items whose values are in `drop`; a group left with no items goes too. */
function withoutItems(children: React.ReactNode, drop: Set<string>): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child
    const el = child as React.ReactElement<{ value?: unknown; children?: React.ReactNode }>
    if (el.type === SelectItem) {
      return typeof el.props.value === "string" && drop.has(el.props.value) ? null : el
    }
    if (el.type === React.Fragment || el.type === SelectGroup) {
      const inner = withoutItems(el.props.children, drop)
      if (el.type === SelectGroup) {
        const left = new Map<string, React.ReactElement>()
        collectItems(inner, left)
        if (left.size === 0) return null
      }
      return React.cloneElement(el, undefined, inner)
    }
    return el
  })
}

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => {
  const scope = React.useContext(RecentsContext)
  const items = new Map<string, React.ReactElement>()
  collectItems(children, items)
  const values = [...items.keys()]
  // A "none" row is not a choice; it does not make a short list long.
  const enough = values.filter(isRememberable).length >= MIN_OPTIONS_FOR_RECENTS
  const key =
    scope?.explicit === false || !enough ? undefined
    : scope?.explicit ?? recentsKeyFor(values)
  if (scope) scope.keyRef.current = key
  const recents = useRecents(key)

  const onTop = recents.filter((v) => items.has(v))
  const body = onTop.length === 0 ? children : (
    <>
      <SelectGroup>
        <SelectLabel className="pl-8 pr-2 pt-1.5 pb-1 text-2xs font-normal uppercase tracking-wide text-muted-foreground">Recent</SelectLabel>
        {onTop.map((v) => React.cloneElement(items.get(v)!, { key: `recent:${v}` }))}
      </SelectGroup>
      <SelectSeparator />
      {withoutItems(children, new Set(onTop))}
    </>
  )

  return (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        position === "popper" &&
          "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
        className
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "p-1",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]"
        )}
      >
        {body}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
  )
})
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
