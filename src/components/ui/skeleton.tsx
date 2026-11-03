import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse motion-reduce:animate-none rounded-md bg-muted-foreground/[.12]", className)}
      {...props}
    />
  )
}

export { Skeleton }
