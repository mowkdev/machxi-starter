import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/*
 * Deliberate divergence from the generated component (ADR-0031: these are owned
 * source). Upstream reads `theme` from `next-themes`, which is a Next.js
 * package; ADR-0031 puts dark mode in the `.dark` class and the tokens below,
 * so the toaster inherits the palette from the same variables as everything
 * else and neither app needs a theme library to make it match.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

/*
 * `toast` is re-exported here rather than imported from `sonner` by an app.
 * ADR-0031 keeps the design system's runtime dependencies in this package, and
 * the imperative half of the toast API is part of the component's surface: an
 * app that called `sonner` directly would need its own copy of the dependency
 * and could drift from the version this `Toaster` renders with.
 */
export { toast } from "sonner"

export { Toaster }
