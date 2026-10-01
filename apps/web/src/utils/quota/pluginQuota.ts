import type { AuthFileItem } from '@/types';
import type { AuthFilesApiRequestScope } from '@/services/api/authFiles';
import { apiClient, createScopedApiRequestConfig } from '@/services/api/client';
import { normalizeAuthIndex } from '@/utils/authIndex';

export interface PluginQuotaMetric {
  key: string;
  label: string;
  value: number | null;
  unit: string;
  format: string;
  currency?: string;
}
export interface PluginQuotaBucket {
  window: string;
  remainingFraction: number | null;
  resetTime?: string;
  description?: string;
}
export interface PluginQuotaData {
  summary: PluginQuotaMetric[];
  subscription: Record<string, unknown> | null;
  groups: { displayName: string; buckets: PluginQuotaBucket[] }[];
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

export function parsePluginQuota(value: unknown): PluginQuotaData {
  const body = record(value);
  if (!Array.isArray(body.summary)) throw new Error('Invalid plugin quota summary');
  return {
    summary: body.summary.map(record).filter((item) => text(item.key) && text(item.label)).map((item) => ({
      key: text(item.key), label: text(item.label), value: finite(item.value), unit: text(item.unit), format: text(item.format),
      ...(text(item.currency) ? { currency: text(item.currency) } : {}),
    })),
    subscription: body.subscription && typeof body.subscription === 'object' && !Array.isArray(body.subscription) ? record(body.subscription) : null,
    groups: Array.isArray(body.groups) ? body.groups.map(record).map((group) => ({
      displayName: text(group.displayName),
      buckets: Array.isArray(group.buckets) ? group.buckets.map(record).map((bucket) => ({
        window: text(bucket.window), remainingFraction: finite(bucket.remainingFraction),
        ...(text(bucket.resetTime) ? { resetTime: text(bucket.resetTime) } : {}),
        ...(text(bucket.description) ? { description: text(bucket.description) } : {}),
      })) : [],
    })) : [],
  };
}

export const formatPluginQuotaPercent = (fraction: number | null, locale?: string): string =>
  fraction === null || !Number.isFinite(fraction)
    ? '-'
    : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(fraction * 100)}%`;

export function formatPluginQuotaMetric(metric: PluginQuotaMetric, locale?: string): string {
  if (finite(metric.value) === null) return '-';
  try {
    if (metric.format === 'currency') {
      if (!metric.currency || !/^[A-Z]{3}$/.test(metric.currency)) return '-';
      return new Intl.NumberFormat(locale, { style: 'currency', currency: metric.currency }).format(metric.value!);
    }
    if (metric.format !== 'number') return '-';
    const value = locale ? new Intl.NumberFormat(locale, { maximumFractionDigits: 12 }).format(metric.value!) : String(metric.value);
    return `${value}${metric.unit ? ` ${metric.unit}` : ''}`;
  } catch {
    return '-';
  }
}

const parsePluginResetTimeMs = (resetTime: string | undefined): number | null => {
  if (!resetTime) return null;
  const direct = Date.parse(resetTime);
  if (Number.isFinite(direct)) return direct;
  // Provider 形如 "YYYY-MM-DD HH:mm:ss"（空格分隔）在部分引擎解析失败时按 ISO 形态重试。
  const isoNormalized = Date.parse(resetTime.replace(' ', 'T'));
  return Number.isFinite(isoNormalized) ? isoNormalized : null;
};

const parsePluginRemainingFromDescription = (description: string | undefined): number | null => {
  if (!description) return null;
  const match = /^剩余\s*(-?\d+(?:\.\d+)?)\s*\/\s*共\s*-?\d+(?:\.\d+)?/.exec(description.trim());
  if (!match) return null;
  const remaining = Number(match[1]);
  return Number.isFinite(remaining) ? remaining : null;
};

/**
 * 纯展示聚合：resetTime 落在 (nowMs, nowMs + 24h] 且 description 呈
 * “剩余 X / 共 Y” 形态的桶，取 X 求和；解析不了的桶跳过并不计入。
 * 无可解析桶时返回 null（面板显示 “-”）；返回 0 表示有可解析桶但剩余为 0。
 */
export function sumPluginQuotaCreditsExpiringWithin24h(data: PluginQuotaData, nowMs: number): number | null {
  const horizonMs = nowMs + 86_400_000;
  let parseableBuckets = 0;
  let total = 0;
  for (const group of data.groups) {
    for (const bucket of group.buckets) {
      const resetMs = parsePluginResetTimeMs(bucket.resetTime);
      if (resetMs === null || resetMs <= nowMs || resetMs > horizonMs) continue;
      const remaining = parsePluginRemainingFromDescription(bucket.description);
      if (remaining === null) continue;
      parseableBuckets += 1;
      total += remaining;
    }
  }
  return parseableBuckets > 0 ? total : null;
}

export async function fetchPluginQuota(file: AuthFileItem, scope?: AuthFilesApiRequestScope): Promise<PluginQuotaData> {
  const index = normalizeAuthIndex(file.authIndex ?? file['auth_index'] ?? file['auth-index']);
  if (!index) throw new Error('Missing auth_index for plugin quota');
  const config = scope ? createScopedApiRequestConfig(scope) : undefined;
  const discovery = record(await apiClient.get<unknown>('/quota/providers', config));
  const provider = text(file.provider || file.type).toLowerCase();
  const supported = Array.isArray(discovery.providers) && discovery.providers.map(record).some((item) => item.provider === provider && Array.isArray(item.supported_providers) && item.supported_providers.includes(provider));
  if (!supported) throw new Error(`Plugin quota provider not supported: ${provider}`);
  return parsePluginQuota(await apiClient.post<unknown>('/quota/fetch', { auth_index: index }, config));
}
