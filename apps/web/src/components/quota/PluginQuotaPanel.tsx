import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { IconClock, IconSidebarQuota } from '@/components/ui/icons';
import { useInterval } from '@/hooks/useInterval';
import cardStyles from '@/features/accounts/components/QuotaWindowCard.module.scss';
import type { PluginQuotaState } from './quotaConfigs';
import {
  formatPluginQuotaMetric,
  sumPluginQuotaCreditsExpiringWithin24h,
} from '@/utils/quota/pluginQuota';

type MetricTone = 'blue' | 'amber';

const metricIconClass = (tone: MetricTone): string =>
  tone === 'blue'
    ? `${cardStyles.rowIcon} ${cardStyles.rowIconBlue}`
    : `${cardStyles.rowIcon} ${cardStyles.rowIconAmber}`;

interface PluginMetricRowProps {
  icon: JSX.Element;
  tone: MetricTone;
  label: string;
  value: string;
}

const PluginMetricRow = ({
  icon,
  tone,
  label,
  value,
}: PluginMetricRowProps): JSX.Element => (
  <div data-plugin-quota-metric="true">
    <div className={cardStyles.compareItem}>
      <span className={metricIconClass(tone)} aria-hidden="true">
        {icon}
      </span>
      <span className={cardStyles.metricLabel}>{label}</span>
      <strong className={cardStyles.metricValue}>{value}</strong>
    </div>
  </div>
);

/**
 * 插件积分面板：只渲染两个指标（余额积分、24 小时内过期积分），不画进度条
 * （世豪 2026-10-07 裁定：workbuddy/qoder 都按两行纯数字，无进度条）。刷新/陈旧
 * 状态不渲染任何提示行（各行观感一致，刷新期间静默保留上次成功数据）；
 * 仅真实错误以 alert 呈现、无数据时呈现 unknown 行。列表与 detail 变体同构，
 * 不再有分组折叠、分组明细、订阅块或已用/总额行。
 */
export function PluginQuotaPanel({ state }: { state?: PluginQuotaState; refreshing?: boolean }) {
  const { t, i18n } = useTranslation();
  const data = state?.data;
  // 24h 过期窗口的“当前时间”快照：挂载时取值并每 60s 推进（同 AccountQuotaTab 的重置记录时钟），
  // 避免 render 期间调用 Date.now() 违反纯渲染规则。
  const [nowMs, setNowMs] = useState(() => Date.now());
  useInterval(() => setNowMs(Date.now()), 60_000);
  const balance = data?.summary.find((metric) => metric.key === 'credits_remaining') ?? null;
  const expiringSum = data ? sumPluginQuotaCreditsExpiringWithin24h(data, nowMs) : null;
  return (
    <div data-plugin-quota-panel>
      {state?.error ? <div role="alert">{state.error}</div> : null}
      <PluginMetricRow
        icon={<IconSidebarQuota size={16} />}
        tone="blue"
        label={balance?.label || t('plugin_quota.balance')}
        value={balance ? formatPluginQuotaMetric(balance, i18n.language) : '-'}
      />
      <PluginMetricRow
        icon={<IconClock size={16} />}
        tone="amber"
        label={t('plugin_quota.expires_24h')}
        value={
          expiringSum === null
            ? '-'
            : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 12 }).format(
                expiringSum
              )
        }
      />
    </div>
  );
}
