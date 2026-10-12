import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border border-transparent px-2.5 py-0.5 text-ios-cap font-semibold tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        // The app's Pill: the tone's ink on the tone at 13%. One badge at most per card.
        late: "bg-tone-late/[.13] text-tone-late-ink",
        owed: "bg-tone-owed/[.13] text-tone-owed-ink",
        settled: "bg-tone-settled/[.13] text-tone-settled-ink",
        credit: "bg-tone-credit/[.13] text-tone-credit-ink",
        working: "bg-tone-working/[.13] text-tone-working-ink",
        quiet: "bg-tone-quiet/[.13] text-tone-quiet-ink",
        house: "bg-tone-house/[.13] text-tone-house-ink",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
