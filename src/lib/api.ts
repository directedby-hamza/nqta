'use client';
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly operationRejected = false,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: options?.method || 'GET',
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      data.error || 'Please try again.',
      response.status,
      data.operationRejected === true,
    );
  return data as T;
}
export const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Please try again.';
export const money = (minor: number, currency = 'MAD') =>
  new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
export const initials = (name: string) =>
  name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('en', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Africa/Casablanca',
  }).format(new Date(value));
