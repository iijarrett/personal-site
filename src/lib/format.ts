export const statusLabel = (status: string): string => status.replace(/-/g, " ");

/** YYYY-MM-DD in UTC, so the build output does not depend on the build machine's time zone. */
export const isoDate = (date: Date): string => date.toISOString().slice(0, 10);
