import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge as ShadBadge } from "@/components/ui/badge";
import { Button as ShadButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input as ShadInput } from "@/components/ui/input";
import { Label as ShadLabel } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
  NativeSelectOptGroup,
} from "@/components/ui/native-select";
import { Textarea as ShadTextarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Tone = "default" | "info" | "success" | "warning" | "danger" | "muted";

const badgeTone: Record<Tone, "default" | "secondary" | "destructive" | "outline" | "ghost" | "link"> = {
  default: "secondary",
  info: "outline",
  success: "outline",
  warning: "outline",
  danger: "destructive",
  muted: "outline",
};

export function SurfaceCard({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <Card
      className={cn(
        "gap-0 border-border/70 bg-card/95 py-0 shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur",
        className
      )}
      {...props}
    >
      {children}
    </Card>
  );
}

export function SubtleCard({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <Card
      className={cn(
        "gap-0 border-border/60 bg-muted/40 py-0 shadow-none",
        className
      )}
      {...props}
    >
      {children}
    </Card>
  );
}

export function Badge({
  className,
  tone = "default",
  children,
  ...props
}: ComponentPropsWithoutRef<"span"> & { tone?: Tone }) {
  return (
    <ShadBadge
      variant={badgeTone[tone]}
      className={cn(
        tone === "info" && "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
        tone === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        tone === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        tone === "muted" && "border-border/60 bg-muted/60 text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </ShadBadge>
  );
}

export function Button({
  className,
  tone = "default",
  children,
  ...props
}: ComponentPropsWithoutRef<"button"> & {
  tone?: "default" | "primary" | "success" | "danger";
}) {
  return (
    <ShadButton
      variant={tone === "danger" ? "destructive" : tone === "default" ? "outline" : "default"}
      className={cn(
        "rounded-xl",
        tone === "primary" && "bg-primary text-primary-foreground hover:bg-primary/90",
        tone === "success" && "bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500",
        className
      )}
      {...props}
    >
      {children}
    </ShadButton>
  );
}

export function Input({
  className,
  ...props
}: ComponentPropsWithoutRef<"input">) {
  return <ShadInput className={cn("rounded-xl", className)} {...props} />;
}

type SelectProps = Omit<ComponentPropsWithoutRef<"select">, "size"> & {
  size?: "sm" | "default";
  children: ReactNode;
};

export function Select({
  className,
  children,
  size = "default",
  ...props
}: SelectProps) {
  return (
    <NativeSelect className={className} size={size} {...props}>
      {children}
    </NativeSelect>
  );
}

export { NativeSelectOption, NativeSelectOptGroup };

export function Textarea({
  className,
  ...props
}: ComponentPropsWithoutRef<"textarea">) {
  return <ShadTextarea className={cn("rounded-xl", className)} {...props} />;
}

export function FieldLabel({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"label">) {
  return (
    <ShadLabel className={cn("mb-1 block text-xs text-muted-foreground", className)} {...props}>
      {children}
    </ShadLabel>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  titleId,
  titleAs = "h2",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  titleId?: string;
  titleAs?: "h1" | "h2" | "h3";
}) {
  const TitleTag = titleAs;

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            {eyebrow}
          </div>
        ) : null}
        <TitleTag id={titleId} className="text-lg font-semibold tracking-tight text-foreground">
          {title}
        </TitleTag>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function AlertPanel({
  className,
  children,
  tone = "danger",
  ...props
}: ComponentPropsWithoutRef<"div"> & { tone?: Exclude<Tone, "default"> }) {
  return (
    <Alert
      variant={tone === "danger" ? "destructive" : "default"}
      className={cn(
        tone === "info" && "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200",
        tone === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
        tone === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200",
        tone === "muted" && "border-border/60 bg-muted/50 text-muted-foreground",
        className
      )}
      {...props}
    >
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

export function AuthActionButton({
  className,
  tone = "primary",
  children,
  ...props
}: ComponentPropsWithoutRef<"button"> & { tone?: "primary" | "secondary" }) {
  return (
    <ShadButton
      variant={tone === "primary" ? "default" : "outline"}
      className={cn("min-h-11 w-full rounded-xl", className)}
      {...props}
    >
      {children}
    </ShadButton>
  );
}

export function AuthActionLink({
  className,
  tone = "secondary",
  children,
  ...props
}: ComponentPropsWithoutRef<"a"> & { tone?: "primary" | "secondary" }) {
  return (
    <a
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium transition-colors",
        tone === "primary"
          ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-border bg-background hover:bg-muted",
        className
      )}
      {...props}
    >
      {children}
    </a>
  );
}
