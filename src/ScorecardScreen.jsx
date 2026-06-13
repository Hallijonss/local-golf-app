// The scorecard overlay (z 9999): the 18-hole table with score shapes, putt
// checkmarks and match summaries, plus the action buttons. All state lives in
// App.jsx; html2canvas export renders static cells via the isExporting flag.
import React from 'react';
import { X, Settings } from 'lucide-react';
import { courseData } from './courseData';
import { screenStyles } from './theme';
import {
  getScoreStyles, calculateTotal, matchSummary, isSheetComplete, allShotsMarked,
} from './utils';

const renderScoreShape = (shape, col) => {
  const base = { width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' };
  if (shape === 'circle') return <div style={{ ...base, border: `1.5px solid ${col}`, borderRadius: '50%' }} />;
  if (shape === 'double-circle') return (
    <div style={{ ...base, border: `1.5px solid ${col}`, borderRadius: '50%', padding: '2px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', height: '100%', border: `1px solid ${col}`, borderRadius: '50%' }} />
    </div>
  );
  if (shape === 'square') return <div style={{ ...base, border: `1.5px solid ${col}` }} />;
  if (shape === 'double-square') return (
    <div style={{ ...base, border: `1.5px solid ${col}`, padding: '2px', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', height: '100%', border: `1px solid ${col}` }} />
    </div>
  );
  if (shape === 'red-square') return <div style={{ ...base, backgroundColor: '#d32f2f' }} />;
  return null;
};

export default function ScorecardScreen({
  theme, scores, putts, matchPlay, trackScore, trackPutts, trackGame,
  statSheet, snjallskra, sheets, marks, isExporting, scorecardRef,
  handleScoreChange, handlePuttsChange, updateMatch,
  saveRound, saveScorecardImage, startPiP, openGolfBox, clearRound,
  onGoToHole, onOpenRounds, onOpenSettings, onClose,
}) {
  const s = screenStyles(theme);

  const SQUARE_CELL_SIZE = '44px';
  const cellStyle = {
    display: 'flex', justifyContent: 'center', alignItems: 'center', height: SQUARE_CELL_SIZE,
    borderBottom: `1px solid ${theme.scLine}`, borderRight: `1px solid ${theme.scLine}`, boxSizing: 'border-box', position: 'relative',
    color: theme.scText
  };
  const summaryCellStyle = { ...cellStyle, fontWeight: 'bold', backgroundColor: theme.scAccent, color: theme.scText };

  const getGridCols = () => {
    const cols = ['40px', '40px'];
    if (trackScore) cols.push('1fr');
    if (trackPutts) cols.push('1fr');
    if (trackGame) cols.push('75px');
    return cols.join(' ');
  };

  const invisibleInputStyle = {
    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
    boxSizing: 'border-box', textAlign: 'center', fontSize: '1.2rem',
    border: 'none', background: 'transparent', outline: 'none', margin: 0, padding: 0, zIndex: 2
  };

  const clearBtnStyle = {
    width: '100%', background: '#fff', color: '#d32f2f', padding: '15px', border: '2px solid #d32f2f',
    borderRadius: theme.radius, fontWeight: 'bold', fontSize: '1rem', cursor: 'pointer',
    textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 'calc(env(safe-area-inset-bottom, 20px) + 20px)',
    boxShadow: theme.shadow
  };

  const renderRow = (holeData, index) => {
    const scoreVal = scores[index] || 0;
    const { shape, textColor } = getScoreStyles(scoreVal, holeData.par, theme.scText);
    return (
      <React.Fragment key={index}>
        <div
          onClick={() => onGoToHole(index)}
          style={{ ...cellStyle, fontWeight: 'bold', cursor: 'pointer', backgroundColor: theme.scHead }}
          title={`Fara á holu ${holeData.hole}`}
        >
          {holeData.hole}
        </div>
        <div style={{ ...cellStyle, fontWeight: 'normal' }}>{holeData.par}</div>

        {trackScore && (
          <div style={{ ...cellStyle }}>
            <div style={{ position: 'absolute', zIndex: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {renderScoreShape(shape, theme.scShape)}
            </div>
            {isExporting ? (
              <div style={{ ...invisibleInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textColor, fontWeight: 'bold' }}>
                {scoreVal || ''}
              </div>
            ) : (
              <input
                type="number" inputMode="numeric" className="no-spinners"
                value={scoreVal || ''} onChange={(e) => handleScoreChange(e.target.value, index)}
                style={{ ...invisibleInputStyle, color: textColor, fontWeight: 'bold' }}
              />
            )}
          </div>
        )}

        {trackPutts && (
          <div style={{ ...cellStyle }}>
            {/* Small check when the hole's data is complete: every sheet question
                answered (Skrá gögn sjálfur) or every non-putt stroke marked (Snjallskrá) */}
            {!isExporting && (
              (statSheet && isSheetComplete(sheets[index], holeData.par)) ||
              (snjallskra && allShotsMarked(scores[index] || 0, putts[index] || 0, marks[index]))
            ) && (
              <span style={{ position: 'absolute', top: '1px', right: '3px', fontSize: '0.6rem', opacity: 0.7, zIndex: 3, pointerEvents: 'none' }}>✓</span>
            )}
            {isExporting ? (
              <div style={{ ...invisibleInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.scText, fontWeight: 'bold' }}>
                {putts[index] || ''}
              </div>
            ) : (
              <input
                type="number" inputMode="numeric" className="no-spinners"
                value={putts[index] || ''} onChange={(e) => handlePuttsChange(e.target.value, index)}
                style={{ ...invisibleInputStyle, color: theme.scText, fontWeight: 'bold' }}
              />
            )}
          </div>
        )}

        {trackGame && (
          <div style={{ ...cellStyle, padding: '0' }}>
            {isExporting ? (
              <div style={{ ...invisibleInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.scText, fontWeight: 'normal', fontSize: '0.9rem' }}>
                {matchPlay[index] === 'A' ? 'Halli' : matchPlay[index] === 'B' ? 'Hinir' : matchPlay[index] === 'H' ? 'Féll' : ''}
              </div>
            ) : (
              <select
                value={matchPlay[index]} onChange={(e) => updateMatch(e.target.value, index)}
                style={{ ...invisibleInputStyle, color: theme.scText, appearance: 'none', textAlignLast: 'center', fontWeight: 'bold', fontSize: '0.95rem' }}
              >
                <option value=""></option>
                <option value="A">Halli</option>
                <option value="B">Hinir</option>
                <option value="H">Féll</option>
              </select>
            )}
          </div>
        )}

      </React.Fragment>
    );
  };

  return (
    <div style={s.screen(9999)}>
      <div style={s.screenHeader}>
        <div onClick={onOpenSettings} title="Stillingar" style={{ cursor: 'pointer', color: 'white', opacity: 0.85, display: 'flex', alignItems: 'center', justifySelf: 'start' }}>
          <Settings size={20} />
        </div>
        <h2 style={s.screenTitle}>Skorkort</h2>
        <div onClick={onClose} title="Loka" style={s.screenClose}>
          <X size={24} />
        </div>
      </div>

      <div style={s.screenBody}>
        <div style={{ display: 'flex', justifyContent: 'center', width: '100%' }}>
          <div ref={scorecardRef} style={{ background: theme.scCell, borderRadius: '0', border: `2px solid ${theme.scLine}`, overflow: 'hidden', marginBottom: '25px', width: '100%', boxShadow: theme.shadow }}>
            <div style={{ display: 'grid', gridTemplateColumns: getGridCols(), textAlign: 'center', fontSize: '0.8rem', backgroundColor: theme.scHead, borderBottom: `2px solid ${theme.scLine}`, color: theme.scText }}>
              <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>H</strong>
              <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>P</strong>
              {trackScore && <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>SKOR</strong>}
              {trackPutts && <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>PÚTT</strong>}
              {trackGame && <strong style={{ ...cellStyle, borderTop: 'none', backgroundColor: 'transparent' }}>LEIKUR</strong>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: getGridCols(), textAlign: 'center', fontSize: '1.1rem', backgroundColor: theme.scCell, color: theme.scText }}>
              {courseData.slice(0, 9).map((hole, i) => renderRow(hole, i))}
              <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.scLine}` }}>ÚT</div>
              <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.scLine}` }}>{courseData.slice(0, 9).reduce((sum, h) => sum + h.par, 0)}</div>
              {trackScore && <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.scLine}` }}>{calculateTotal(scores, 0, 9)}</div>}
              {trackPutts && <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.scLine}` }}>{calculateTotal(putts, 0, 9)}</div>}
              {trackGame && <div style={{ ...summaryCellStyle, borderBottom: `2px solid ${theme.scLine}` }}><span style={{ fontSize: '0.65rem' }}>{matchSummary(matchPlay, 0, 9)}</span></div>}
              {courseData.slice(9, 18).map((hole, i) => renderRow(hole, i + 9))}
              <div style={{ ...summaryCellStyle }}>INN</div>
              <div style={summaryCellStyle}>{courseData.slice(9, 18).reduce((sum, h) => sum + h.par, 0)}</div>
              {trackScore && <div style={summaryCellStyle}>{calculateTotal(scores, 9, 18)}</div>}
              {trackPutts && <div style={summaryCellStyle}>{calculateTotal(putts, 9, 18)}</div>}
              {trackGame && <div style={{ ...summaryCellStyle }}><span style={{ fontSize: '0.65rem' }}>{matchSummary(matchPlay, 9, 18)}</span></div>}
              <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}>TOT</div>
              <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}>{courseData.reduce((sum, h) => sum + h.par, 0)}</div>
              {trackScore && <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}>{calculateTotal(scores, 0, 18)}</div>}
              {trackPutts && <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}>{calculateTotal(putts, 0, 18)}</div>}
              {trackGame && <div style={{ ...summaryCellStyle, backgroundColor: theme.scAccent, borderBottom: 'none' }}><span style={{ fontSize: '0.65rem' }}>{matchSummary(matchPlay, 0, 18)}</span></div>}
            </div>
          </div>
        </div>

        {/* Buttons live directly under the card — no section headings */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px', width: '100%', marginBottom: '28px' }}>
          <div style={{ display: 'flex', gap: '15px', width: '100%' }}>
            <button onClick={saveRound} style={{ ...s.actionBtn, background: theme.darkGreen, color: '#fff', border: `2px solid ${theme.darkGreen}` }}>Vista hring</button>
            <button onClick={saveScorecardImage} style={s.actionBtn}>Vista mynd</button>
          </div>
          <button onClick={onOpenRounds} style={{ ...s.actionBtn, width: '100%', flex: 'none' }}>
            Mínir hringir
          </button>
          <div style={{ display: 'flex', gap: '15px', width: '100%' }}>
            <button onClick={startPiP} style={{ ...s.actionBtn, color: '#4A90E2', border: '2px solid #4A90E2' }}>Opna í PiP</button>
            <button onClick={openGolfBox} style={s.actionBtn}>Skrá í GolfBox</button>
          </div>
        </div>

        {/* Start a fresh round — destructive, always last */}
        <button onClick={clearRound} style={clearBtnStyle}>Byrja nýjan hring</button>
      </div>
    </div>
  );
}
