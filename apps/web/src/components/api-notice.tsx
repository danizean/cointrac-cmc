"use client";

import { ErrorNotice } from "@/components/ui/primitives";

interface ApiNoticeProps {
  status: number;
  message: string;
  retryAfterSeconds?: number;
  title?: string;
  onRetry?: () => void;
}

export function ApiNotice({
  status,
  message,
  retryAfterSeconds,
  title,
  onRetry,
}: ApiNoticeProps) {
  return (
    <ErrorNotice
      status={status}
      title={title}
      message={message}
      retryAfterSeconds={retryAfterSeconds}
      onRetry={onRetry}
    />
  );
}
