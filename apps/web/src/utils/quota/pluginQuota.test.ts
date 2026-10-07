import { describe, expect, it, vi, beforeEach } from 'vitest';
import workbuddy from '../../../../../../cpamp-quota-fixtures/workbuddy-success.json';
import qoder from '../../../../../../cpamp-quota-fixtures/qoder-success.json';
import providers from '../../../../../../cpamp-quota-fixtures/providers.json';
import missing from '../../../../../../cpamp-quota-fixtures/missing-auth-failure.json';
import unknown from '../../../../../../cpamp-quota-fixtures/unknown-auth-failure.json';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/services/api/client', () => ({
  apiClient: mocks,
  createScopedApiRequestConfig: (scope: { apiBase: string; managementKey: string }) => ({ baseURL: `${scope.apiBase}/v0/management`, headers: { Authorization: `Bearer ${scope.managementKey}` }, cpampScopedRequest: true }),
}));
import { parsePluginQuota, formatPluginQuotaMetric, fetchPluginQuota } from './pluginQuota';
import { WORKBUDDY_CONFIG, QODER_CONFIG } from '@/components/quota/quotaConfigs';
import { isQuotaRefreshSupportedProvider } from '@/features/authFiles/constants';
const scope = { apiBase: 'https://cpamp.example', managementKey: 'synthetic-login' };
beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue(providers.body); });
describe('plugin quota (real sanitized fixtures; adversarial cases synthetic)', () => {
  it('registers both providers with credential-scoped lifecycle configs', () => {
    for (const [provider, config] of [['workbuddy', WORKBUDDY_CONFIG], ['qoder', QODER_CONFIG]] as const) {
      expect(isQuotaRefreshSupportedProvider(provider)).toBe(true);
      expect(config.type).toBe(provider);
      expect(config.buildSuccessState(parsePluginQuota(qoder.response.body), { name: 'fixture', provider, auth_index: 'fixture' }).data?.summary[1].value).toBe(qoder.response.body.summary[1].value);
    }
  });
  it.each([workbuddy, qoder])('retains summary and independent groups', (fixture) => {
    const data = parsePluginQuota(fixture.response.body);
    expect(data.summary.map((metric) => metric.value)).toEqual(fixture.response.body.summary.map((metric) => metric.value));
    expect(data.groups).toHaveLength(fixture.response.body.groups.length);
    expect(data.subscription).toBeNull();
  });
  it('does not turn unknown values into zero or credits into currency', () => {
    const data = parsePluginQuota({ summary: [{ key: 'credits_used', label: 'Used', value: null, unit: 'credits', format: 'number' }, { key: 'credits_remaining', label: 'Balance', value: 0, unit: 'credits', format: 'number', currency: 'USD' }] });
    expect(formatPluginQuotaMetric(data.summary[0])).toBe('-');
    expect(formatPluginQuotaMetric(data.summary[1])).toBe('0 credits');
    expect(formatPluginQuotaMetric({ ...data.summary[1], value: Infinity })).toBe('-');
    expect(formatPluginQuotaMetric({ ...data.summary[1], format: 'unknown' })).toBe('-');
  });
  it('posts only auth_index through the scoped management client', async () => {
    mocks.post.mockResolvedValue(qoder.response.body);
    await fetchPluginQuota({ name: 'synthetic', provider: 'qoder', auth_index: qoder.request.auth_index }, scope);
    expect(mocks.get).toHaveBeenCalledWith('/quota/providers', expect.objectContaining({ baseURL: 'https://cpamp.example/v0/management' }));
    expect(mocks.post).toHaveBeenCalledWith('/quota/fetch', { auth_index: qoder.request.auth_index }, expect.objectContaining({ headers: { Authorization: 'Bearer synthetic-login' }, cpampScopedRequest: true }));
  });
  it('resolves the index through the existing authIndex convention (camelCase and numeric)', async () => {
    mocks.post.mockResolvedValue(qoder.response.body);
    await fetchPluginQuota({ name: 'synthetic', provider: 'qoder', authIndex: 'camel-index' }, scope);
    await fetchPluginQuota({ name: 'synthetic', provider: 'qoder', authIndex: 42 }, scope);
    expect(mocks.post).toHaveBeenNthCalledWith(1, '/quota/fetch', { auth_index: 'camel-index' }, expect.anything());
    expect(mocks.post).toHaveBeenNthCalledWith(2, '/quota/fetch', { auth_index: '42' }, expect.anything());
  });
  it.each([missing, unknown])('preserves real 400/404 response errors without parsing them as quota', async (fixture) => {
    const error = Object.assign(new Error(fixture.response.body.error), { status: fixture.response.http_status });
    mocks.post.mockRejectedValue(error);
    await expect(fetchPluginQuota({ name: 'fixture', provider: 'qoder', auth_index: 'fixture' }, scope)).rejects.toBe(error);
  });
  it('rejects malformed summary (synthetic), but preserves finite excess and unknown fractions', () => {
    expect(() => parsePluginQuota({ summary: null })).toThrow(/summary/);
    const parsed = parsePluginQuota({ summary: [], groups: [{ displayName: 'same', buckets: [{ remainingFraction: null }, { remainingFraction: 1.2 }, { remainingFraction: -0.2 }] }] });
    expect(parsed.groups[0].buckets.map((bucket) => bucket.remainingFraction)).toEqual([null, 1.2, -0.2]);
  });
  it('rejects missing indices without making a request', async () => {
    await expect(fetchPluginQuota({ name: 'missing', provider: 'qoder' }, scope)).rejects.toThrow(/auth_index/);
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.post).not.toHaveBeenCalled();
  });
  it('rejects unadvertised providers and preserves transport failures', async () => {
    mocks.get.mockResolvedValue({ providers: [] });
    await expect(fetchPluginQuota({ name: 'synthetic', provider: 'qoder', auth_index: 'fixture' }, scope)).rejects.toThrow(/supported/);
    expect(mocks.post).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue(providers.body); mocks.post.mockRejectedValue(new Error('synthetic 502'));
    await expect(fetchPluginQuota({ name: 'synthetic', provider: 'qoder', auth_index: 'fixture' }, scope)).rejects.toThrow('synthetic 502');
  });
});
