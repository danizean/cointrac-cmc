"use client";

import {
  AlertTriangle,
  ChevronRight,
  Clock,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed border border-transparent",
  secondary:
    "border border-border-strong bg-card text-foreground hover:bg-muted",
  ghost:
    "border border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
  danger:
    "border border-destructive/50 bg-destructive-soft text-destructive hover:bg-destructive hover:text-destructive-foreground",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-xs rounded-[8px]",
  md: "min-h-10 px-4 text-sm rounded-[10px]",
  lg: "min-h-11 px-5 text-sm rounded-[10px]",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className = "",
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-card text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({
  elevated = false,
  className = "",
  children,
}: {
  elevated?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-[14px] border border-border ${
        elevated ? "bg-card-elevated" : "bg-card"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export type BadgeTone = "neutral" | "brand" | "positive" | "warning" | "destructive" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  brand: "border-primary/35 bg-primary/12 text-link",
  positive: "border-positive/35 bg-positive-soft text-positive",
  warning: "border-warning/40 bg-warning-soft text-warning",
  destructive: "border-destructive/40 bg-destructive-soft text-destructive",
  info: "border-info/35 bg-info-soft text-info",
};

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-tight ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.label}-${idx}`} className="flex items-center gap-1.5">
              {idx > 0 ? (
                <ChevronRight className="h-3.5 w-3.5 text-subtle-foreground" aria-hidden="true" />
              ) : null}
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="inline-flex min-h-6 items-center rounded-[4px] hover:text-foreground"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "font-medium text-foreground" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageHeader({
  breadcrumbs,
  title,
  description,
  actions,
}: {
  breadcrumbs?: BreadcrumbItem[];
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumb items={breadcrumbs} /> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({
  id,
  title,
  description,
  action,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Divider({ className = "" }: { className?: string }) {
  return <hr className={`border-0 border-t border-border ${className}`} />;
}

export function Skeleton({ className = "h-12 w-full" }: { className?: string }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading"
      className={`animate-pulse rounded-[10px] bg-muted/80 ${className}`}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[14px] border border-border bg-card px-6 py-10 text-center">
      {icon ? (
        <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] border border-border bg-card-elevated text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorNotice({
  status,
  title,
  message,
  retryAfterSeconds,
  onRetry,
}: {
  status?: number;
  title?: string;
  message: string;
  retryAfterSeconds?: number;
  onRetry?: () => void;
}) {
  const isRateLimit = status === 429;
  const isAuth = status === 401;
  const heading =
    title ??
    (isRateLimit
      ? "Rate limit reached"
      : isAuth
        ? "Authentication required"
        : status === 503
          ? "Service temporarily unavailable"
          : "Request could not be completed");

  const hint = isRateLimit
    ? retryAfterSeconds
      ? `Wait ${retryAfterSeconds} seconds before retrying.`
      : "Wait briefly before retrying."
    : isAuth
      ? "Sign in again with your verified account."
      : status === 503
        ? "The CoinTrac intelligence backend could not be reached."
        : null;

  return (
    <div
      role="alert"
      className="rounded-[14px] border border-destructive/40 bg-destructive-soft p-4 text-foreground"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-destructive/30 bg-background/60 text-destructive">
          {isRateLimit ? (
            <Clock className="h-4 w-4" aria-hidden="true" />
          ) : isAuth ? (
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          ) : (
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-destructive">{heading}</p>
            {status && status > 0 ? (
              <span className="rounded-full border border-destructive/35 bg-background/60 px-2 py-0.5 font-mono text-[11px] font-semibold text-destructive">
                HTTP {status}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-foreground">{message}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
          {onRetry ? (
            <div className="pt-2">
              <Button variant="secondary" size="sm" onClick={onRetry}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Retry</span>
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function InfoTip({
  label,
  text,
  align = "right",
}: {
  label: string;
  text: string;
  align?: "right" | "center";
}) {
  const [open, setOpen] = useState(false);
  const tipId = useId();

  return (
    <span
      className="relative inline-flex items-center"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={tipId}
        onClick={() => setOpen((prev) => !prev)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-subtle-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open ? (
        <span
          id={tipId}
          role="tooltip"
          className={`absolute bottom-full z-30 mb-2 w-60 max-w-[calc(100vw-2rem)] rounded-[10px] border border-border-strong bg-card-elevated p-3 text-left text-xs font-normal leading-relaxed text-foreground shadow-md ${
            align === "center"
              ? "left-1/2 -translate-x-1/2"
              : "left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-0"
          }`}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

export function ProgressIndicator({
  completed,
  total,
  label,
}: {
  completed: number;
  total: number;
  label: string;
}) {
  const safeTotal = Math.max(1, total);
  const safeCompleted = Math.min(safeTotal, Math.max(0, completed));
  const pct = Math.round((safeCompleted / safeTotal) * 100);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold tabular-nums text-foreground">
          {safeCompleted} / {safeTotal}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        aria-valuenow={safeCompleted}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function Input({
  label,
  helper,
  error,
  id,
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  helper?: string;
  error?: string | null;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errId = `${fieldId}-error`;
  const helpId = `${fieldId}-help`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="block text-xs font-semibold text-foreground">
        {label}
      </label>
      <input
        id={fieldId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errId : helper ? helpId : undefined}
        className={`h-10 w-full rounded-[10px] border bg-input-bg px-3 text-sm text-foreground placeholder:text-subtle-foreground focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
          error ? "border-destructive" : "border-border"
        } ${className}`}
        {...rest}
      />
      {error ? (
        <p id={errId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : helper ? (
        <p id={helpId} className="text-xs text-subtle-foreground">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

export function Select({
  label,
  helper,
  error,
  id,
  className = "",
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  helper?: string;
  error?: string | null;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errId = `${fieldId}-error`;
  const helpId = `${fieldId}-help`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={fieldId} className="block text-xs font-semibold text-foreground">
        {label}
      </label>
      <select
        id={fieldId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errId : helper ? helpId : undefined}
        className={`h-10 w-full rounded-[10px] border bg-input-bg px-3 text-sm text-foreground focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
          error ? "border-destructive" : "border-border"
        } ${className}`}
        {...rest}
      >
        {children}
      </select>
      {error ? (
        <p id={errId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : helper ? (
        <p id={helpId} className="text-xs text-subtle-foreground">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
