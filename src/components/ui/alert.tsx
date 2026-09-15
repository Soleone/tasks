import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive:
          "bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current",
      },
      // Sync-replacement confirmation keeps destructive emphasis with
      // readable body copy.
      tone: {
        confirmation: "border-destructive/50",
      },
      // Stacked actions sit below full-width copy instead of reserving
      // the absolute-action gutter.
      layout: {
        stacked: "has-data-[slot=alert-action]:pr-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  tone,
  layout,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant, tone, layout }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, tone, ...props }: React.ComponentProps<"div"> & {
  tone?: "destructive"
}) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        tone === "destructive" && "text-destructive",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, layout, ...props }: React.ComponentProps<"div"> & {
  // Stacked confirmation actions: bottom-right below full-width copy.
  layout?: "stacked"
}) {
  return (
    <div
      data-slot="alert-action"
      className={cn(
        "absolute top-2 right-2",
        layout === "stacked" && "static flex flex-wrap justify-end gap-2 pt-2",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
