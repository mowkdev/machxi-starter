/**
 * The one door `@repo/ui` comes through (ADR-0032 §The D3 shape).
 *
 * Every layer above `shared` imports design-system components from here, and a
 * lint rule refuses `@repo/ui/components/*` anywhere else. The point is that a
 * change on the other side of the boundary — a primitive renamed upstream, a
 * wrapper that gives one app defaults the other does not want — is one edit
 * here instead of a grep across every page.
 *
 * Re-exports only, and deliberately so: a component with app-specific
 * behaviour is not a re-export, it is a `shared/ui` component of its own, and
 * it goes in a file beside this one.
 *
 * Named rather than `export *` because the door is also the inventory: what
 * this app uses from the design system is readable in one screen, and adding
 * to it is a visible line in a diff.
 */

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog";
export {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@repo/ui/components/avatar";
export { Badge } from "@repo/ui/components/badge";
export {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@repo/ui/components/breadcrumb";
export { Button, buttonVariants } from "@repo/ui/components/button";
export { Checkbox } from "@repo/ui/components/checkbox";
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  // Two names, no new component and no new dependency (`D6.3`): the theme
  // choice is one-of-three, and a radio group is what says so to a screen
  // reader. Widening the door is the visible line in a diff ADR-0031 wants.
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
export {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@repo/ui/components/field";
export { Input } from "@repo/ui/components/input";
export { Label } from "@repo/ui/components/label";
export {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@repo/ui/components/popover";
export {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
export { Separator } from "@repo/ui/components/separator";
export {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/components/sheet";
export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@repo/ui/components/sidebar";
export { Skeleton } from "@repo/ui/components/skeleton";
export { Spinner } from "@repo/ui/components/spinner";
export { Switch } from "@repo/ui/components/switch";
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
export { Textarea } from "@repo/ui/components/textarea";
export { Toaster, toast } from "@repo/ui/components/sonner";
export { useIsMobile } from "@repo/ui/hooks/use-mobile";
export { cn } from "@repo/ui/lib/utils";

// Not re-exports: app components with behaviour of their own (see their files).
export { AppLoader } from "./app-loader";
export { ConfirmDialog, type ConfirmDialogProps } from "./confirm-dialog";
export { QueryError } from "./query-error";
export { RecordError } from "./record-error";
