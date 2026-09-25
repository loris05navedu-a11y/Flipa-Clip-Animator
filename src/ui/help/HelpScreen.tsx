import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { useApp } from '../../app/store';
import { DEFAULT_SHORTCUTS, formatCombo } from '../../editor/shortcuts';
import { useT } from '../../i18n';
import { pushBack } from '../components/back';
import { IconButton } from '../components/ui';

export default function HelpScreen() {
  const t = useT();
  const back = useApp((a) => a.previous);
  const go = useApp((a) => a.go);
  useEffect(() => pushBack(() => (go(back), true)), [go, back]);
  const main = ['undo', 'redo', 'copy', 'paste', 'cut', 'save', 'playPause', 'prevFrame', 'nextFrame', 'newFrame', 'duplicateFrame', 'toggleOnion', 'fit', 'swapColors', 'brushBigger', 'brushSmaller', 'escape'];
  return (
    <div className="settings-screen" data-testid="help">
      <header className="home-header">
        <div className="row">
          <IconButton icon={ArrowLeft} label={t('common.back')} onClick={() => go(back)} />
          <h1 style={{ fontSize: 20 }}>{t('help.title')}</h1>
        </div>
      </header>
      <main className="help-body scroll">
        <p>{t('help.intro')}</p>
        <h2>{t('help.start')}</h2>
        <ol>
          <li>{t('help.start1')}</li>
          <li>{t('help.start2')}</li>
          <li>{t('help.start3')}</li>
          <li>{t('help.start4')}</li>
        </ol>
        <h2>{t('help.gestures')}</h2>
        <ul>
          <li>{t('help.g1')}</li>
          <li>{t('help.g2')}</li>
          <li>{t('help.g3')}</li>
          <li>{t('help.g4')}</li>
          <li>{t('help.g5')}</li>
        </ul>
        <h2>{t('help.tools')}</h2>
        <p>{t('help.toolsText')}</p>
        <h2>{t('help.timeline')}</h2>
        <p>{t('help.timelineText')}</p>
        <h2>{t('help.audio')}</h2>
        <p>{t('help.audioText')}</p>
        <h2>{t('help.saving')}</h2>
        <p>{t('help.savingText')}</p>
        <h2>{t('help.shortcuts')}</h2>
        <table className="shortcut-table">
          <tbody>
            {main.map((a) => (
              <tr key={a}>
                <td>{t(`action.${a}`)}</td>
                <td>
                  {DEFAULT_SHORTCUTS[a].map((c) => (
                    <kbd key={c}>{formatCombo(c)}</kbd>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>{t('help.limits')}</h2>
        <p>{t('help.limitsText')}</p>
      </main>
    </div>
  );
}
