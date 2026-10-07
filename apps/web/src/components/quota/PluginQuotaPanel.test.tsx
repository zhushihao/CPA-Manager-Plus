import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import workbuddy from '../../../../../../cpamp-quota-fixtures/workbuddy-success.json';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import {
  formatPluginQuotaMetric,
  parsePluginQuota,
  sumPluginQuotaCreditsExpiringWithin24h,
} from '@/utils/quota/pluginQuota';
import { PluginQuotaPanel } from './PluginQuotaPanel';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }) }));

const HOUR_MS = 3_600_000;
// Provider resetTime 形如 "YYYY-MM-DD HH:mm:ss"（空格分隔、本地时区，见真实 fixture），
// 合成数据用同一形态生成，避免依赖运行环境对非标准格式的解析差异。
const localProviderTime = (ms: number): string => {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

describe('plugin panel: real fixture and explicitly synthetic edge cases', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders exactly two native metric rows (balance and 24h expiring) without redundant status sentences (real fixture)', () => {
    vi.useFakeTimers();
    // 自 2026-10-07 12:00 起的 24h 窗口内，真实 fixture 只有 "2026-10-08 00:02:40"（剩余 0）一个桶。
    vi.setSystemTime(new Date('2026-10-07T12:00:00').getTime());
    const html = renderToStaticMarkup(<PluginQuotaPanel state={{ status: 'success', data: parsePluginQuota(workbuddy.response.body), fetchedAtMs: 1000 }} />);
    expect(html).not.toContain('plugin_quota.success');
    expect(html).not.toContain('plugin_quota.last_success');
    expect(html.match(/data-plugin-quota-metric="true"/g)).toHaveLength(2);
    expect(html).toContain('剩余积分');
    expect(html).toContain('8,313 credits');
    // 世豪 2026-10-07 裁定：workbuddy/qoder 都只渲染两行纯数字，不画进度条。
    expect(html).not.toContain('width:');
    expect(html).toContain('plugin_quota.expires_24h');
    expect(html).toContain('>0<');
    expect(html).not.toContain('plugin_quota.groups_toggle');
    expect(html).not.toContain('plugin_quota.remaining_ratio');
    expect(html).not.toContain('plugin_quota.reset');
    expect(html).not.toContain('plugin_quota.subscription');
    expect(html).not.toContain('role="region"');
    expect(html).not.toContain('已用积分');
    expect(html).not.toContain('总额度');
    expect(html).not.toContain('CodeBuddy个人版运营补偿包');
  });
  it('keeps stale data visible under error status with the alert message (real fixture)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T12:00:00').getTime());
    const html = renderToStaticMarkup(<PluginQuotaPanel state={{ status: 'error', data: parsePluginQuota(workbuddy.response.body), fetchedAtMs: 1000, error: 'synthetic 404' }} />);
    expect(html).toContain('synthetic 404');
    expect(html).not.toContain('plugin_quota.stale');
    expect(html).not.toContain('plugin_quota.loading');
    expect(html).not.toContain('plugin_quota.last_success');
    expect(html).not.toContain('plugin_quota.success');
    expect(html).toContain('8,313 credits');
    expect(html).toContain('>0<');
  });
  it('renders no refreshing or stale notice while loading, keeping the last data visible (synthetic)', () => {
    vi.useFakeTimers();
    const html = renderToStaticMarkup(<PluginQuotaPanel refreshing state={{ status: 'loading', data: parsePluginQuota({ summary: [], subscription: null, groups: [] }) }} />);
    expect(html).not.toContain('plugin_quota.loading');
    expect(html).not.toContain('plugin_quota.stale');
    expect(html.match(/data-plugin-quota-metric="true"/g)).toHaveLength(2);
  });
  it('sums only buckets resetting within the next 24 hours with a parseable description (synthetic)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00').getTime());
    const nowMs = Date.now();
    const data = parsePluginQuota({
      summary: [],
      subscription: null,
      groups: [
        {
          displayName: 'in-window',
          buckets: [
            { window: 'cycle', remainingFraction: 0.05, resetTime: localProviderTime(nowMs + 2 * HOUR_MS), description: '剩余 5 / 共 100' },
            { window: 'cycle', remainingFraction: 0.07, resetTime: localProviderTime(nowMs + 30 * HOUR_MS), description: '剩余 7 / 共 100' },
            { window: 'cycle', remainingFraction: 0.03, resetTime: localProviderTime(nowMs - HOUR_MS), description: '剩余 3 / 共 100' },
          ],
        },
        {
          displayName: 'skipped',
          buckets: [
            { window: 'cycle', remainingFraction: 0.1, resetTime: localProviderTime(nowMs + HOUR_MS), description: '剩余 abc / 共 100' },
            { window: 'cycle', remainingFraction: 0.1, resetTime: localProviderTime(nowMs + HOUR_MS) },
            { window: 'cycle', remainingFraction: 0.9, resetTime: 'not-a-date', description: '剩余 9 / 共 9' },
          ],
        },
      ],
    });
    expect(sumPluginQuotaCreditsExpiringWithin24h(data, nowMs)).toBe(5);
    const html = renderToStaticMarkup(<PluginQuotaPanel state={{ status: 'success', data, fetchedAtMs: 1000 }} />);
    expect(html).toContain('>5<');
    expect(html).not.toContain('>7<');
    expect(html).not.toContain('>3<');
    expect(html).not.toContain('>9<');
  });
  it('shows 0 instead of the dash when an in-window bucket parses to zero remaining (synthetic)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00').getTime());
    const nowMs = Date.now();
    const data = parsePluginQuota({
      summary: [],
      subscription: null,
      groups: [{ displayName: 'g', buckets: [{ window: 'cycle', remainingFraction: 0, resetTime: localProviderTime(nowMs + 3 * HOUR_MS), description: '剩余 0 / 共 50' }] }],
    });
    expect(sumPluginQuotaCreditsExpiringWithin24h(data, nowMs)).toBe(0);
    const html = renderToStaticMarkup(<PluginQuotaPanel state={{ status: 'success', data, fetchedAtMs: 1000 }} />);
    expect(html).toContain('>0<');
  });
  it('shows the dash when no in-window bucket has a parseable description (synthetic)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00').getTime());
    const nowMs = Date.now();
    const data = parsePluginQuota({
      summary: [],
      subscription: null,
      groups: [
        { displayName: 'g', buckets: [{ window: 'cycle', remainingFraction: 0.5, resetTime: localProviderTime(nowMs + HOUR_MS), description: '剩余 5' }] },
        { displayName: 'h', buckets: [{ window: 'cycle', remainingFraction: 0.2, description: '剩余 2 / 共 10' }] },
      ],
    });
    expect(sumPluginQuotaCreditsExpiringWithin24h(data, nowMs)).toBeNull();
    const html = renderToStaticMarkup(<PluginQuotaPanel state={{ status: 'success', data, fetchedAtMs: 1000 }} />);
    expect(html).not.toContain('>5<');
    expect(html).not.toContain('>2<');
  });
  it('renders two dash rows without data and never prints unknown as zero (synthetic)', () => {
    const html = renderToStaticMarkup(<PluginQuotaPanel />);
    expect(html).not.toContain('plugin_quota.unknown');
    expect(html.match(/data-plugin-quota-metric="true"/g)).toHaveLength(2);
    expect(html).toContain('plugin_quota.balance');
    expect(html).not.toContain('width:');
  });
  it('marks the missing balance as dash instead of zero and hides foreign summary metrics (synthetic)', () => {
    const data = parsePluginQuota({ summary: [{ key: 'credits_used', label: '已用积分', value: 40500, unit: 'credits', format: 'number' }], subscription: null, groups: [] });
    const html = renderToStaticMarkup(<PluginQuotaPanel state={{ status: 'success', data }} />);
    expect(html).toContain('plugin_quota.balance');
    expect(html).toContain('>-');
    expect(html).not.toContain('已用积分');
    expect(html).not.toContain('40,500');
    expect(html).not.toContain('width:');
  });
  it('renders no progress bar even with a balance and parseable buckets (2026-10-07 ruling, synthetic)', () => {
    const data = parsePluginQuota({
      summary: [
        { key: 'credits_remaining', label: '剩余积分', value: 998, unit: 'credits', format: 'number' },
        { key: 'credits_size', label: '总额度', value: 1000, unit: 'credits', format: 'number' },
      ],
      subscription: null,
      groups: [{ displayName: 'g', buckets: [{ window: 'cycle', remainingFraction: 0.998, resetTime: '2026-10-08 00:02:40', description: '剩余 998 / 共 1000' }] }],
    });
    const html = renderToStaticMarkup(<PluginQuotaPanel state={{ status: 'success', data }} />);
    expect(html).toContain('998 credits');
    expect(html).not.toContain('width:');
  });
  it('localizes every key in all four shipped locales', () => {
    const locales = [en, zhCN, zhTW, ru] as unknown as Record<string, Record<string, string>>[];
    const keys = Object.keys(en.plugin_quota);
    expect(keys.length).toBeGreaterThan(0);
    for (const locale of locales) {
      for (const key of keys) {
        expect(typeof locale.plugin_quota[key]).toBe('string');
        expect(locale.plugin_quota[key].length).toBeGreaterThan(0);
      }
    }
    expect(zhCN.plugin_quota.balance).not.toBe(en.plugin_quota.balance);
    expect(zhTW.plugin_quota.stale).not.toBe(zhCN.plugin_quota.stale);
    expect(zhCN.plugin_quota.expires_24h).not.toBe(ru.plugin_quota.expires_24h);
  });
  it('uses explicit currency only, preserving zero and negative values (synthetic)', () => {
    const metric = { key: 'synthetic_cost', label: 'Cost', value: 0, unit: '', format: 'currency', currency: 'USD' };
    expect(formatPluginQuotaMetric(metric, 'en-US')).toBe('$0.00');
    expect(formatPluginQuotaMetric({ ...metric, currency: 'not-valid' }, 'en-US')).toBe('-');
    expect(formatPluginQuotaMetric({ ...metric, format: 'number', value: -4, unit: 'credits' }, 'en-US')).toBe('-4 credits');
  });
});
