import * as React from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
} from "lucide-react"

import { cn } from "@repo/ui/lib/utils"
import { buttonVariants, type Button } from "@repo/ui/components/button"
/*
 * Diverges from the generated component (ADR-0031: owned source). ADR-0046 §12
 * routes the primitives' six operator-read strings through `UiStrings` so an
 * app can translate them; `useUiStrings` falls back to English with no provider
 * mounted, so this package still has no i18n dependency.
 */
import { useUiStrings } from "@repo/ui/ui-strings"

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  // ADR-0046 §12: injectable, English by default.
  const strings = useUiStrings()

  return (
    <nav
      role="navigation"
      /* `pagination` upstream — the landmark's name, ADR-0046 §12 (`D7.6`). */
      aria-label={strings.pagination}
      data-slot="pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn("flex flex-row items-center gap-1", className)}
      {...props}
    />
  )
}

function PaginationItem({ ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = {
  isActive?: boolean
} & Pick<React.ComponentProps<typeof Button>, "size"> &
  React.ComponentProps<"a">

function PaginationLink({
  className,
  isActive,
  size = "icon",
  ...props
}: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? "page" : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      className={cn(
        buttonVariants({
          variant: isActive ? "outline" : "ghost",
          size,
        }),
        className
      )}
      {...props}
    />
  )
}

function PaginationPrevious({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  // ADR-0046 §12: injectable, English by default.
  const strings = useUiStrings()

  return (
    <PaginationLink
      /* `Go to previous page` upstream — ADR-0046 §12 (`D7.6`). */
      aria-label={strings.previousPage}
      size="default"
      className={cn("gap-1 px-2.5 sm:pl-2.5", className)}
      {...props}
    >
      <ChevronLeftIcon />
      {/* `Previous` upstream — ADR-0046 §12. */}
      <span className="hidden sm:block">{strings.previous}</span>
    </PaginationLink>
  )
}

function PaginationNext({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  // ADR-0046 §12: injectable, English by default.
  const strings = useUiStrings()

  return (
    <PaginationLink
      /* `Go to next page` upstream — ADR-0046 §12 (`D7.6`). */
      aria-label={strings.nextPage}
      size="default"
      className={cn("gap-1 px-2.5 sm:pr-2.5", className)}
      {...props}
    >
      {/* `Next` upstream — ADR-0046 §12. */}
      <span className="hidden sm:block">{strings.next}</span>
      <ChevronRightIcon />
    </PaginationLink>
  )
}

function PaginationEllipsis({
  className,
  ...props
}: React.ComponentProps<"span">) {
  // ADR-0046 §12: injectable, English by default.
  const strings = useUiStrings()

  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn("flex size-9 items-center justify-center", className)}
      {...props}
    >
      <MoreHorizontalIcon className="size-4" />
      {/* `More pages` upstream — ADR-0046 §12. */}
      <span className="sr-only">{strings.morePages}</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationLink,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
}
