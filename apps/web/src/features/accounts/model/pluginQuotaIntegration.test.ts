import { describe, expect, it } from 'vitest';
import qoder from '../../../../../../../cpamp-quota-fixtures/qoder-success.json';
import workbuddy from '../../../../../../../cpamp-quota-fixtures/workbuddy-success.json';
import { QODER_CONFIG } from '@/components/quota/quotaConfigs';
import { parsePluginQuota } from '@/utils/quota/pluginQuota';
import { resolveAccountQuota, type AccountQuotaStores } from './accountQuotaSummary';
import { buildAccountQuotaDisplayWindows } from './accountQuotaDisplayWindows';
import type { AccountRow } from './accountRows';

describe('plugin summary/window integration (real sanitized qoder fixture)', () => {
  const file = { name: 'fixture.json', provider: 'qoder', auth_index: 'fixture' };
  const state = QODER_CONFIG.buildSuccessState(parsePluginQuota(qoder.response.body), file);
  const stores = { antigravityQuota: {}, claudeQuota: {}, codexQuota: {}, devinQuota: {}, kimiQuota: {}, metaQuota: {}, xaiQuota: {}, pluginQuota: { [QODER_CONFIG.getStoreKey?.(file) ?? file.name]: state } } as AccountQuotaStores;
  it('keeps credit values without inventing a cycle percentage', () => {
    const summary = resolveAccountQuota(file, stores);
    expect(summary.source).toBe('cache');
    expect(summary.status).toBe('ok');
    expect(summary.remainingPercent).toBeNull();
    expect(summary.usedPercent).toBeNull();
    expect(summary.creditsBalance).toBe(`${qoder.response.body.summary[0].value} credits`);
  });
  it('does not reuse old credential data for another auth_index (synthetic)', () => {
    expect(resolveAccountQuota({ ...file, auth_index: 'new-credential' }, stores).source).toBe('none');
  });
  it('keeps real WorkBuddy duplicate display names separate', () => {
    const wbFile = { ...file, provider: 'workbuddy' };
    const wbData = parsePluginQuota(workbuddy.response.body);
    const wbState = { ...state, data: wbData };
    const wbStores = { ...stores, pluginQuota: { [QODER_CONFIG.getStoreKey?.(wbFile) ?? wbFile.name]: wbState } };
    const windows = buildAccountQuotaDisplayWindows({ provider: 'workbuddy', raw: wbFile, quota: resolveAccountQuota(wbFile, wbStores) } as unknown as AccountRow, { stores: wbStores, t: ((key: string) => key) as never, translateQuotaWindowLabel: (label) => label ?? '-' });
    expect(windows).toHaveLength(wbData.groups.reduce((count, group) => count + group.buckets.length, 0));
    expect(new Set(windows.map((window) => window.key)).size).toBe(windows.length);
    expect(windows.map((window) => window.remainingPercent)).toEqual(wbData.groups.flatMap((group) => group.buckets.map((bucket) => bucket.remainingFraction === null ? null : bucket.remainingFraction * 100)));
  });
  it('preserves every independent bucket including duplicate group names', () => {
    const windows = buildAccountQuotaDisplayWindows({ provider: 'qoder', raw: file, quota: resolveAccountQuota(file, stores) } as unknown as AccountRow, { stores, t: ((key: string) => key) as never, translateQuotaWindowLabel: (label) => label ?? '-' });
    expect(windows).toHaveLength(qoder.response.body.groups.reduce((count, group) => count + group.buckets.length, 0));
    expect(new Set(windows.map((window) => window.key)).size).toBe(windows.length);
    expect(windows[0].remainingPercent).toBe(qoder.response.body.groups[0].buckets[0].remainingFraction * 100);
    expect(windows.every((window) => window.kind === 'unknown' && window.limitWindowSeconds === null)).toBe(true);
  });
});
