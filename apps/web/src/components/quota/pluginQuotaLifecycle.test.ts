import { beforeEach, describe, expect, it } from 'vitest';
import { QODER_CONFIG } from './quotaConfigs';
import { refreshQuotaWithConfig } from './quotaRefresh';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { getQuotaCredentialStoreKey } from '@/utils/quota/credentialScope';
import { parsePluginQuota } from '@/utils/quota/pluginQuota';
import missing from '../../../../../../cpamp-quota-fixtures/missing-auth-failure.json';
import unknown from '../../../../../../cpamp-quota-fixtures/unknown-auth-failure.json';
const file = { name: 'fixture.json', provider: 'qoder', auth_index: 'fixture' };
const data = (value: number) => parsePluginQuota({ summary: [{ key: 'credits_remaining', label: 'Balance', value, format: 'number', unit: 'credits' }], groups: [] });
const deferred = () => { let resolve!: (value: ReturnType<typeof data>) => void; let reject!: (error: Error) => void; const promise = new Promise<ReturnType<typeof data>>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const run = (fetchQuota: typeof QODER_CONFIG.fetchQuota, currentState?: ReturnType<typeof QODER_CONFIG.buildSuccessState>) => refreshQuotaWithConfig({ config: { ...QODER_CONFIG, fetchQuota }, file, setQuota: useQuotaStore.getState().setPluginQuota, t: ((key: string) => key) as never, isCurrent: () => true, currentState });
beforeEach(() => useQuotaStore.getState().clearQuotaCache());
describe('plugin lifecycle synthetic delays, real failure status fixtures', () => {
  it.each(['success', 'error'])('drops older %s after newer success', async (outcome) => {
    const old = deferred(); const first = run(() => old.promise); await run(async () => data(20));
    if (outcome === 'success') old.resolve(data(10)); else old.reject(new Error('old error'));
    expect(await first).toBeNull();
    expect(useQuotaStore.getState().pluginQuota[getQuotaCredentialStoreKey(file)].data?.summary[0].value).toBe(20);
  });
  it.each(['success', 'error'])('drops late %s after clearing credential scope', async (outcome) => {
    const old = deferred(); const first = run(() => old.promise); useQuotaStore.getState().clearQuotaCache();
    if (outcome === 'success') old.resolve(data(10)); else old.reject(new Error('old error'));
    expect(await first).toBeNull(); expect(useQuotaStore.getState().pluginQuota).toEqual({});
  });
  it.each([missing, unknown])('retains last success and other accounts on real fixture failure', async (fixture) => {
    const previous = QODER_CONFIG.buildSuccessState(data(30), file);
    const other = { ...file, name: 'other.json', auth_index: 'other' };
    const otherState = QODER_CONFIG.buildSuccessState(data(40), other);
    useQuotaStore.getState().setPluginQuota({ [getQuotaCredentialStoreKey(file)]: previous, [getQuotaCredentialStoreKey(other)]: otherState });
    await run(async () => { throw Object.assign(new Error(JSON.stringify(fixture)), { status: fixture.response.http_status }); }, previous);
    expect(useQuotaStore.getState().pluginQuota[getQuotaCredentialStoreKey(file)]).toMatchObject({ status: 'error', data: previous.data, fetchedAtMs: previous.fetchedAtMs });
    expect(useQuotaStore.getState().pluginQuota[getQuotaCredentialStoreKey(other)]).toEqual(otherState);
  });
});
