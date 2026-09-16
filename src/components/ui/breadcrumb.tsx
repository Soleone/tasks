import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "cn";

function Breadcrumb({ ...props }: ComponentProps<"nav">) {
  return <nav aria-label="breadcrumb" data-slot="breadcrumb" {...props} />;
}

const breadcrumbListVariants = cva(
  "flex flex-wrap items-center gap-1.5 text-sm break-words text-muted-foreground sm:gap-2.5",
  {
    variants: {
      density: {
        default: "",
        // Single-line status treatment: quiet type, tight spacing, truncation.
        compact:
          "flex-nowrap gap-x-1.5 overflow-hidden text-xs break-normal whitespace-nowrap sm:gap-x-1.5",
      },
    },
    defaultVariants: {
      density: "default",
    },
  },
);

function BreadcrumbList({
  className,
  density,
  ...props
}: ComponentProps<"ol"> & VariantProps<typeof breadcrumbListVariants>) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(breadcrumbListVariants({ density }), className)}
      {...props}
    />
  );
}

function BreadcrumbItem({ className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    />
  );
}

function BreadcrumbLink({ className, ...props }: ComponentProps<"a">) {
  return (
    <a
      data-slot="breadcrumb-link"
      className={cn("transition-colors hover:text-foreground", className)}
      {...props}
    />
  );
}

function BreadcrumbPage({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn("font-normal text-foreground", className)}
      {...props}
    />
  );
}

function BreadcrumbSeparator({ children, className, ...props }: ComponentProps<"li">) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      className={cn("inline-flex shrink-0 items-center [&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? <ChevronRight aria-hidden="true" />}
      {/* Exposed separator text keeps text queries and live-region announcements stable. */}
      <span className="sr-only">{" · "}</span>
    </li>
  );
}

function BreadcrumbEllipsis({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn("flex size-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontal className="size-4" />
      <span className="sr-only">More</span>
    </span>
  );
}

export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
};
