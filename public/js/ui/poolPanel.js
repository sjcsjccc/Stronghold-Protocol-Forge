// public/js/ui/poolPanel.js — [local-patch 2026-10-20] 卡池余量面板: g.pool → m.pool.
// A modal listing every eligible visible chess of the match with its remaining / total shared-pool copies
// (SharedPool.entries: cap / left; a piece brought as 助战 carries support). Opened from the shop bar's 卡池
// button; the snapshot is asked on open and re-asked on the 刷新 button — the server pushes one m.pool per ask.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Modal, TierChip } from './components.js';
import { data } from '../data.js';
import { net } from '../net.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

export function PoolPanel({ onClose }) {
  const [snapshot, setSnapshot] = useState(null); // m.pool: { round, pool: { [baseId]: { cap, left, support? } } }
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const off = net.on('m.pool', (msg) => { setSnapshot({ round: msg?.round ?? null, pool: msg?.pool || {} }); setBusy(false); });
    return off;
  }, []);
  const ask = () => {
    setBusy(true);
    try { Promise.resolve(net.request('g.pool', {})).catch(() => setBusy(false)); } catch { setBusy(false); }
  };
  useEffect(() => { ask(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const entries = snapshot ? Object.entries(snapshot.pool) : [];
  const byTier = new Map();
  for (const [id, e] of entries) {
    const c = data.lookup('chess', id);
    const tier = c?.tier ?? 1;
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push({ id, e, name: c?.name || id });
  }
  const tiers = [...byTier.keys()].sort((a, b) => b - a);
  const totalLeft = entries.reduce((n, [, e]) => n + (e.left || 0), 0);
  const totalCap = entries.reduce((n, [, e]) => n + (e.cap || 0), 0);

  return html`<${Modal} open=${true} title=${t('卡池余量')}
      micro=${snapshot?.round != null ? t('第 {round} 回合', { round: snapshot.round }) : ''} onClose=${onClose} width="520px">
    <div style=${{ pointerEvents: 'auto', display: 'grid', gap: '12px' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <span style=${{ opacity: 0.75 }}>${t('全池 {left}/{cap} 张', { left: totalLeft, cap: totalCap })}${snapshot ? '' : t('（获取中…）')}</span>
        <span style=${{ display: 'flex', gap: '8px' }}>
          <button type="button" class="toolbtn" disabled=${busy} onClick=${ask} title=${t('向服务器询问最新余量')}>
            <${Icon} name="refresh" /><span>${t('刷新')}</span>
          </button>
          {/* the game's Modal mask is pointer-events:none — blank-click close and Esc are dead on touch, so the panel must carry its own close button */}
          <button type="button" class="toolbtn" onClick=${onClose} title=${t('关闭卡池面板')}>
            <${Icon} name="close" /><span>${t('关闭')}</span>
          </button>
        </span>
      </div>
      <div style=${{ maxHeight: '56vh', overflowY: 'auto', overscrollBehavior: 'contain', touchAction: 'pan-y', WebkitOverflowScrolling: 'touch', display: 'grid', gap: '12px', paddingRight: '4px' }}>
        ${tiers.map((tier) => html`<div key=${tier} style=${{ display: 'grid', gap: '2px' }}>
          <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', margin: '2px 0' }}>
            <${TierChip} tier=${tier} size="sm" />
            <b style=${{ fontSize: '13px' }}>${t('{tier} 星干员', { tier })}</b>
          </div>
          ${byTier.get(tier).sort((a, b) => a.name.localeCompare(b.name, 'zh')).map(({ id, e, name }) => html`
            <div key=${id} class=${cx((e.left || 0) === 0 && 't-dim')}
                style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '3px 8px', borderRadius: '6px' }}
                title=${e.support ? t('助战干员（他人以助战带来）') : undefined}>
              <span style=${{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ${name}${e.support ? html`<span style=${{ marginLeft: '6px', opacity: 0.7, fontSize: '12px' }}>${t('助战')}</span>` : null}
              </span>
              <b class="num" style=${{ flexShrink: 0, color: (e.left || 0) === 0 ? 'var(--accent-warn, #ff7a4d)' : (e.left || 0) <= 2 ? 'var(--accent-gold, #ffd24d)' : 'inherit' }}>
                ${e.left ?? 0}/${e.cap ?? 0}
              </b>
            </div>`)}
        </div>`)}
        ${snapshot && !entries.length ? html`<p style=${{ opacity: 0.7 }}>${t('没有可显示的卡池数据')}</p>` : null}
      </div>
    </div>
  <//>`;
}
