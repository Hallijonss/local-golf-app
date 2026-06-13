// Design tokens + shared style factories. Styling is inline style objects from
// makeTheme(dark) — no CSS frameworks; keep this approach.

export const baseTheme = {
  darkGreen: '#0a4d2a',
  softWhite: 'rgba(255, 255, 255, 0.95)',
  frostedWhite: 'rgba(255, 255, 255, 0.85)',
  glassBorder: '1px solid rgba(9, 82, 40, 0.15)',
  shadow: '0 4px 12px rgba(0,0,0,0.15)',
  radius: '4px',
  ink: '#0a4d2a',
  panelShadow: '0 2px 14px rgba(0,0,0,0.28)',
  sans: "'Barlow', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  num: "'Barlow Condensed', 'Barlow', 'Helvetica Neue', sans-serif",
};

// Mode-dependent tokens merged over the base. The whole HUD + scorecard read
// from these, so flipping `dark` re-themes everything (sc* = scorecard screen).
export const makeTheme = (dark) => ({
  ...baseTheme,
  ...(dark ? {
    panel: 'rgba(9, 26, 21, 0.68)', panelText: '#eef3ea', hairLight: 'rgba(255,255,255,0.22)', accent: '#f0d28c',
    scBg: '#0f211a', scText: '#e7efe6', scLine: 'rgba(255,255,255,0.20)', scHead: '#0b1813', scCell: '#12251c', scAccent: '#17392b', scShape: '#e7efe6',
    chip: { bg: 'rgba(10,26,20,0.94)', fg: '#ffffff', border: 'rgba(255,255,255,0.55)' },
  } : {
    panel: 'rgba(255,255,255,0.93)', panelText: '#16241d', hairLight: 'rgba(10,40,28,0.18)', accent: '#9a6f1e',
    scBg: '#f5f8f5', scText: '#0a4d2a', scLine: 'rgba(10,77,42,0.65)', scHead: '#eef3f0', scCell: '#ffffff', scAccent: '#dff0e4', scShape: '#0a4d2a',
    chip: { bg: 'rgba(255,255,255,0.97)', fg: '#16241d', border: 'rgba(10,40,28,0.5)' },
  }),
});

export const microLabel = {
  fontSize: '0.52rem', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase',
  opacity: 0.62, fontFamily: baseTheme.sans,
};

// Frosted glass card used by every floating element over the map.
export const cardStyleFor = (theme) => ({
  background: theme.panel, backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
  border: `1px solid ${theme.hairLight}`, boxShadow: theme.panelShadow, color: theme.panelText,
});

// Styles shared by the scorecard + bag/rounds/settings screens.
export const screenStyles = (theme) => ({
  actionBtn: {
    flex: 1, padding: '15px 5px', background: 'transparent', border: `2px solid ${theme.scLine}`, borderRadius: theme.radius,
    fontWeight: 'bold', fontSize: '0.95rem', color: theme.scText, cursor: 'pointer',
    textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'center'
  },
  // Section heading inside a screen (smallcaps, left-aligned).
  sectionHeading: { ...microLabel, fontSize: '0.62rem', opacity: 0.55, margin: '0 0 12px 2px' },
  // Small stepper for the bag editor (scorecard-themed, smaller than the footer steppers).
  clubStepBtn: {
    width: '24px', height: '24px', border: 'none', background: 'transparent', color: theme.scText,
    fontSize: '1.4rem', fontWeight: 300, cursor: 'pointer', display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: 0, lineHeight: 1, touchAction: 'manipulation'
  },
  // Text fields on the bag screen (add-club form).
  bagInput: {
    minWidth: 0, flex: 1, padding: '10px', borderRadius: theme.radius,
    border: `1px solid ${theme.scLine}`, background: 'transparent', color: theme.scText,
    fontSize: '1rem', boxSizing: 'border-box', outline: 'none', fontFamily: theme.sans
  },
  // Full-screen overlay shell + its dark-green header bar.
  screen: (zIndex) => ({
    position: 'absolute', inset: 0, backgroundColor: theme.scBg, zIndex,
    display: 'flex', flexDirection: 'column', color: theme.scText
  }),
  screenHeader: {
    padding: 'max(env(safe-area-inset-top), 20px) 20px 20px', background: theme.darkGreen,
    display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center'
  },
  screenTitle: { margin: 0, color: 'white', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '900', justifySelf: 'center' },
  screenClose: { cursor: 'pointer', color: 'white', opacity: 0.85, display: 'flex', alignItems: 'center', justifySelf: 'end' },
  screenBody: { flex: 1, overflowY: 'auto', padding: '20px', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' },
});
