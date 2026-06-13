// The three full-screen overlays opened from the scorecard: Pokinn (bag),
// Mínir hringir (saved rounds + export) and Stillingar (settings). All state
// lives in App.jsx — these only render props and call back up.
import { X } from 'lucide-react';
import { screenStyles } from './theme';
import { summarizeRound, fmtRoundDate } from './utils';

// One row on the settings screen: descriptive label + on/off switch.
const SettingRow = ({ label, checked, onChange, theme }) => (
  <div
    onClick={() => onChange(!checked)}
    style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
      padding: '13px 12px', border: `1px solid ${theme.scLine}`, borderRadius: theme.radius,
      cursor: 'pointer'
    }}
  >
    <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>{label}</span>
    <div style={{
      width: '42px', height: '24px', borderRadius: '12px', position: 'relative', flex: 'none',
      backgroundColor: checked ? theme.scText : 'transparent',
      border: `1px solid ${checked ? theme.scText : theme.scLine}`,
      boxSizing: 'border-box', transition: 'background-color 0.15s ease'
    }}>
      <div style={{
        position: 'absolute', top: '3px', left: checked ? '23px' : '3px',
        width: '16px', height: '16px', borderRadius: '50%',
        backgroundColor: checked ? theme.scBg : theme.scText, transition: 'left 0.15s ease'
      }} />
    </div>
  </div>
);

// BAG SCREEN — opened from settings, so it sits one layer above it (z 10001).
export function BagScreen({
  theme, bag, newClubName, setNewClubName, newClubMax, setNewClubMax,
  adjustClubMax, toggleClub, deleteClub, addClub, resetBag, onClose,
}) {
  const s = screenStyles(theme);
  return (
    <div style={s.screen(10001)}>
      <div style={s.screenHeader}>
        <div />
        <h2 style={s.screenTitle}>Pokinn</h2>
        <div onClick={onClose} title="Loka" style={s.screenClose}>
          <X size={24} />
        </div>
      </div>

      <div style={s.screenBody}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', marginBottom: '28px' }}>
          {bag.map((c) => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px',
              border: `1px solid ${theme.scLine}`, borderRadius: theme.radius, padding: '6px 10px',
              opacity: c.enabled ? 1 : 0.4, minWidth: 0, boxSizing: 'border-box'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
                <button onClick={() => deleteClub(c.id)} title="Eyða kylfu" style={{ ...s.clubStepBtn, width: '20px', height: '20px', opacity: 0.65 }}>
                  <X size={13} />
                </button>
                <span onClick={() => toggleClub(c.id)} title="Smelltu til að taka úr/í pokann" style={{
                  cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8rem',
                  textDecoration: c.enabled ? 'none' : 'line-through',
                  minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}>{c.label}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1px' }}>
                <button onClick={() => adjustClubMax(c.id, -5)} style={s.clubStepBtn}>{"−"}</button>
                <span className="num" style={{ fontSize: '0.95rem', fontWeight: 700, minWidth: '36px', textAlign: 'center' }}>
                  {c.max}<span style={{ fontSize: '0.6em', opacity: 0.7 }}>m</span>
                </span>
                <button onClick={() => adjustClubMax(c.id, 5)} style={s.clubStepBtn}>+</button>
              </div>
            </div>
          ))}
        </div>

        {/* Add a club: name + max distance, inserted sorted by distance */}
        <div style={s.sectionHeading}>Bæta við kylfu</div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '28px' }}>
          <input
            type="text" value={newClubName} onChange={(e) => setNewClubName(e.target.value)}
            placeholder="Nafn" style={s.bagInput}
          />
          <input
            type="number" inputMode="numeric" className="no-spinners"
            value={newClubMax} onChange={(e) => setNewClubMax(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addClub(); }}
            placeholder="Metrar" style={{ ...s.bagInput, flex: '0 0 90px' }}
          />
          <button onClick={addClub} style={{
            padding: '0 14px', background: theme.scText, color: theme.scBg, border: 'none',
            borderRadius: theme.radius, fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer',
            textTransform: 'uppercase', letterSpacing: '0.5px'
          }}>Bæta við</button>
        </div>

        <button onClick={resetBag} style={{
          background: 'transparent', color: theme.scText, border: `1px solid ${theme.scLine}`,
          borderRadius: theme.radius, padding: '12px 14px', fontWeight: 'bold', fontSize: '0.8rem',
          cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px', width: '100%',
          marginBottom: 'calc(env(safe-area-inset-bottom, 20px) + 20px)'
        }}>Sjálfgefinn poki</button>
      </div>
    </div>
  );
}

// ROUNDS SCREEN — saved rounds + data export, sits above the scorecard.
export function RoundsScreen({
  theme, rounds, expandedRound, setExpandedRound, selectedRounds, toggleRoundSel,
  exportRound, deleteRound, copyAIPrompt, exportAllData, onClose,
}) {
  const s = screenStyles(theme);
  return (
    <div style={s.screen(10000)}>
      <div style={s.screenHeader}>
        <div />
        <h2 style={s.screenTitle}>Mínir hringir</h2>
        <div onClick={onClose} title="Loka" style={s.screenClose}>
          <X size={24} />
        </div>
      </div>

      <div style={s.screenBody}>
        {rounds.length === 0 ? (
          <div style={{ fontSize: '0.85rem', opacity: 0.6, margin: '0 2px 28px' }}>Engir vistaðir hringir.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px', marginBottom: '28px' }}>
            {rounds.map((r) => {
              const sum = summarizeRound(r);
              const diffText = sum.holesPlayed === 0 ? '–' : sum.diff === 0 ? '±0' : sum.diff > 0 ? `+${sum.diff}` : `${sum.diff}`;
              const open = expandedRound === r.date;
              return (
                <div key={r.date} style={{ border: `1px solid ${theme.scLine}`, borderRadius: theme.radius }}>
                  <div onClick={() => setExpandedRound(open ? null : r.date)} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                    padding: '10px 12px', cursor: 'pointer'
                  }}>
                    {/* Tick = include this round in the AI prompt */}
                    <span
                      onClick={(e) => { e.stopPropagation(); toggleRoundSel(r.date); }}
                      title="Velja fyrir AI greiningu"
                      style={{
                        width: '20px', height: '20px', borderRadius: '4px', flex: 'none',
                        border: `1px solid ${selectedRounds.includes(r.date) ? theme.scText : theme.scLine}`,
                        backgroundColor: selectedRounds.includes(r.date) ? theme.scText : 'transparent',
                        color: theme.scBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', boxSizing: 'border-box'
                      }}
                    >{selectedRounds.includes(r.date) ? '✓' : ''}</span>
                    <span style={{ fontWeight: 'bold', fontSize: '0.85rem', flex: 1 }}>{fmtRoundDate(r.date)}</span>
                    <span className="num" style={{ fontSize: '1rem', fontWeight: 700 }}>
                      {sum.total}<span style={{ fontSize: '0.75em', opacity: 0.7 }}> ({diffText})</span>
                    </span>
                  </div>
                  {open && (
                    <div style={{
                      borderTop: `1px solid ${theme.scLine}`, padding: '10px 12px',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px'
                    }}>
                      <div style={{ fontSize: '0.8rem', lineHeight: 1.6 }}>
                        <div>ÚT {sum.out} · INN {sum.inn} · Samtals {sum.total}</div>
                        {sum.puttsTotal > 0 && <div>Pútt {sum.puttsTotal}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flex: 'none' }}>
                        <button onClick={() => exportRound(r)} style={{
                          background: 'transparent', color: theme.scText, border: `1px solid ${theme.scLine}`,
                          borderRadius: theme.radius, padding: '6px 10px', fontWeight: 'bold', fontSize: '0.7rem',
                          cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px'
                        }}>Sækja</button>
                        <button onClick={() => deleteRound(r.date)} style={{
                          background: 'transparent', color: '#d32f2f', border: '1px solid #d32f2f',
                          borderRadius: theme.radius, padding: '6px 10px', fontWeight: 'bold', fontSize: '0.7rem',
                          cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px'
                        }}>Eyða</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Export — AI prompt from the ticked rounds, or all data as JSON */}
        <div style={s.sectionHeading}>Sækja gögn</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: 'calc(env(safe-area-inset-bottom, 20px) + 20px)' }}>
          <button
            onClick={copyAIPrompt}
            style={{ ...s.actionBtn, flex: 'none', display: 'block', width: '100%', boxSizing: 'border-box', opacity: selectedRounds.length ? 1 : 0.5 }}
          >Sækja AI prompt{selectedRounds.length ? ` (${selectedRounds.length})` : ''}</button>
          <button
            onClick={exportAllData}
            style={{ ...s.actionBtn, flex: 'none', display: 'block', width: '100%', boxSizing: 'border-box' }}
          >Sækja alla hringi</button>
        </div>
      </div>
    </div>
  );
}

// SETTINGS SCREEN — sits above the scorecard. The bag opens from its bottom.
export function SettingsScreen({
  theme, trackScore, setTrackScore, trackPutts, setTrackPutts, trackGame, setTrackGame,
  darkMode, setDarkMode, simpleView, setSimpleView, showClubRec, setShowClubRec,
  statSheet, setStatSheet, snjallskra, setSnjallskra, handicap, setHandicap,
  onOpenBag, onClose,
}) {
  const s = screenStyles(theme);
  return (
    <div style={s.screen(10000)}>
      <div style={s.screenHeader}>
        <div />
        <h2 style={s.screenTitle}>Stillingar</h2>
        <div onClick={onClose} title="Loka" style={s.screenClose}>
          <X size={24} />
        </div>
      </div>

      <div style={s.screenBody}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
          <SettingRow label="Telja pútt" checked={trackPutts} onChange={setTrackPutts} theme={theme} />
          <SettingRow label="Telja leik" checked={trackGame} onChange={setTrackGame} theme={theme} />
          <SettingRow label="Telja skot" checked={trackScore} onChange={setTrackScore} theme={theme} />
          <SettingRow label="Dökkur hamur" checked={darkMode} onChange={setDarkMode} theme={theme} />
          <SettingRow label="Fleiri tölur" checked={!simpleView} onChange={(v) => setSimpleView(!v)} theme={theme} />
          <SettingRow label="Kaddí" checked={showClubRec} onChange={setShowClubRec} theme={theme} />
          <SettingRow label="Skrá gögn sjálfur" checked={statSheet} onChange={setStatSheet} theme={theme} />
          <SettingRow label="Snjallskrá" checked={snjallskra} onChange={setSnjallskra} theme={theme} />
          {/* Handicap is typed in — GolfBox is cross-origin, unreadable from here */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
            padding: '13px 12px', border: `1px solid ${theme.scLine}`, borderRadius: theme.radius
          }}>
            <span style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>Forgjöf</span>
            <input
              type="text" inputMode="decimal" value={handicap}
              onChange={(e) => setHandicap(e.target.value)} placeholder="t.d. 23,4"
              style={{
                width: '90px', padding: '8px', borderRadius: theme.radius, border: `1px solid ${theme.scLine}`,
                background: 'transparent', color: theme.scText, fontSize: '1rem', textAlign: 'center',
                boxSizing: 'border-box', outline: 'none', fontFamily: theme.sans
              }}
            />
          </div>
        </div>

        {/* The bag lives behind settings; its overlay sits above this screen */}
        <button onClick={onOpenBag} style={{
          ...s.actionBtn, flex: 'none', display: 'block', width: '100%', boxSizing: 'border-box',
          marginTop: '28px', marginBottom: 'calc(env(safe-area-inset-bottom, 20px) + 20px)'
        }}>Opna pokann</button>
      </div>
    </div>
  );
}
