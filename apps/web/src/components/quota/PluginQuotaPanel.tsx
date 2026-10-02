import { useState, type JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { IconClock, IconSidebarQuota } from '@/components/ui/icons';
import { useInterval } from '@/hooks/useInterval';
import { QuotaProgressBar } from '@/features/accounts/components/QuotaProgressBar';
import cardStyles from '@/features/accounts/components/QuotaWindowCard.module.scss';
import type { PluginQuotaState } from './quotaConfigs';
import {
  formatPluginQuotaMetric,
  sumPluginQuotaCreditsExpiringWithin24h,
} from '@/utils/quota/pluginQuota';

// 与 QuotaWindowCard 的剩余比例进度条同阈值语义（剩余越多越偏绿）。
const BALANCE_REMAINING_HIGH_THRESHOLD = 70;
const BALANCE_REMAINING_MEDIUM_THRESHOLD = 30;

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
  /** 仅余额行使用：remaining/size 均为有限正数时才渲染进度条。 */
  balancePercent?: number | null;
}

const PluginMetricRow = ({
  icon,
  tone,
  label,
  value,
  balancePercent = null,
}: PluginMetricRowProps): JSX.Element => (
  <div data-plugin-quota-metric="true">
    <div className={cardStyles.compareItem}>
      <span className={metricIconClass(tone)} aria-hidden="true">
        {icon}
      </span>
      <span className={cardStyles.metricLabel}>{label}</span>
      <strong className={cardStyles.metricValue}>{value}</strong>
    </div>
    {balancePercent !== null ? (
      <div className={cardStyles.compareList} data-plugin-quota-balance-progress="true">
        <QuotaProgressBar
          percent={balancePercent}
          highThreshold={BALANCE_REMAINING_HIGH_THRESHOLD}
          mediumThreshold={BALANCE_REMAINING_MEDIUM_THRESHOLD}
        />
      </div>
    ) : null}
  </div>
);

/**
 * 插件积分面板：只渲染两个指标（余额积分、24 小时内过期积分）。刷新/陈旧
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
  const balanceSize = data?.summary.find((metric) => metric.key === 'credits_size') ?? null;
  const balancePercent =
    balance &&
    balanceSize &&
    balance.value !== null &&
    Number.isFinite(balance.value) &&
    balance.value > 0 &&
    balanceSize.value !== null &&
    Number.isFinite(balanceSize.value) &&
    balanceSize.value > 0
      ? (balance.value / balanceSize.value) * 100
      : null;
  const expiringSum = data ? sumPluginQuotaCreditsExpiringWithin24h(data, nowMs) : null;
  return (
    <div data-plugin-quota-panel>
      {state?.error ? <div role="alert">{state.error}</div> : null}
      <PluginMetricRow
        icon={<IconSidebarQuota size={16} />}
        tone="blue"
        label={balance?.label || t('plugin_quota.balance')}
        value={balance ? formatPluginQuotaMetric(balance, i18n.language) : '-'}
        balancePercent={balancePercent}
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
