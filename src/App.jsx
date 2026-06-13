// App = the state holder. ALL persistent state, the handlers that mutate it,
// the persistence/wind/GPS/back-button effects and the global modals live here;
// the screens (MapScreen, ScorecardScreen, Bag/Rounds/SettingsScreen) are
// presentation that calls back up via props.
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { courseData } from './courseData';
import { makeTheme } from './theme';
import {
  calculateDistanceInMeters, loadJSON, loadRound, loadRounds, loadSheets, loadMarks,
  loadBag, freshBag, deriveShots, summarizeRound, ROUNDS_KEY, MAX_ROUNDS,
  MIN_EXPORT_HOLES, EXPORT_README, downloadJSON, copyText, buildAIPrompt,
} from './utils';
import MapScreen from './MapScreen';
import ScorecardScreen from './ScorecardScreen';
import { BagScreen, RoundsScreen, SettingsScreen } from './Screens';
import easterEggImg from './assets/easter-egg.png';

export default function App() {
  const [currentHoleIndex, setCurrentHoleIndex] = useState(() => {
    const saved = localStorage.getItem('currentHoleIndex');
    const n = saved !== null ? parseInt(saved, 10) : 0;
    return Number.isNaN(n) ? 0 : Math.min(17, Math.max(0, n));
  });

  const [scores, setScores] = useState(() => loadRound('myScores', 0));
  const [putts, setPutts] = useState(() => loadRound('myPutts', 0));
  const [matchPlay, setMatchPlay] = useState(() => loadRound('myMatch', ''));

  const [gbUser, setGbUser] = useState(() => localStorage.getItem('gbUser') || '');
  const [gbPass, setGbPass] = useState(() => localStorage.getItem('gbPass') || '');
  const [showLoginModal, setShowLoginModal] = useState(false);

  const [trackScore, setTrackScore] = useState(() => loadJSON('trackScore', true));
  const [trackPutts, setTrackPutts] = useState(() => loadJSON('trackPutts', false));
  const [trackGame, setTrackGame] = useState(() => loadJSON('trackGame', false));
  // "Snjallskrá" — GPS shot-mark mode.
  const [snjallskra, setSnjallskra] = useState(() => loadJSON('snjallskra', false));
  // "Skrá gögn sjálfur" — post-hole stat sheet on/off.
  const [statSheet, setStatSheet] = useState(() => loadJSON('statSheet', false));
  // Shot marks for the live round + brief button-press flashes.
  const [marks, setMarks] = useState(loadMarks);
  const [markFlash, setMarkFlash] = useState(false);
  const [vitiFlash, setVitiFlash] = useState(false);
  // Length of the shot just recorded (metres) — shown briefly, then fades away.
  const [lastShotLen, setLastShotLen] = useState(null);
  const shotLenTimer = useRef(null);
  // Live-round stat sheets + which hole's sheet is open (null = closed) + draft.
  const [sheets, setSheets] = useState(loadSheets);
  const [sheetHole, setSheetHole] = useState(null);
  const [sheetDraft, setSheetDraft] = useState({});

  // Simple view: map shows only the centre distance (no elevation, wind, F/B).
  const [simpleView, setSimpleView] = useState(() => loadJSON('simpleView', false));

  // Club bag + whether the club recommendation ("KYLFA") is shown.
  const [bag, setBag] = useState(loadBag);
  const [showClubRec, setShowClubRec] = useState(() => loadJSON('showClubRec', true));
  // Bag editor, settings and saved rounds live on their own screens (opened from
  // the scorecard).
  const [showBag, setShowBag] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRounds, setShowRounds] = useState(false);

  // Saved rounds archive ('myRounds') + which round is expanded in Mínir hringir,
  // and the save-before-clear question for Byrja nýjan hring.
  const [rounds, setRounds] = useState(loadRounds);
  const [expandedRound, setExpandedRound] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  // Rounds ticked for the AI-prompt export (dates; not persisted).
  const [selectedRounds, setSelectedRounds] = useState([]);
  // Player handicap index — manual entry in Stillingar. GolfBox is another website,
  // so the browser's same-origin policy stops us reading it from their page.
  const [handicap, setHandicap] = useState(() => localStorage.getItem('myHandicap') || '');
  const [newClubName, setNewClubName] = useState('');
  const [newClubMax, setNewClubMax] = useState('');

  // Dark / light theme for the whole app (HUD + scorecard). Defaults to dark.
  const [darkMode, setDarkMode] = useState(() => loadJSON('darkMode', true));
  const theme = useMemo(() => makeTheme(darkMode), [darkMode]);

  const [hideEasterEgg, setHideEasterEgg] = useState(false);

  const [gpsLocation, setGpsLocation] = useState(null);
  const [gpsError, setGpsError] = useState(false);
  const [targetPoint, setTargetPoint] = useState(null);
  const [isTeeView, setIsTeeView] = useState(true);
  const [showScorecard, setShowScorecard] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // --- WIND STATE (Open-Meteo, free/keyless; the only feature needing network) ---
  // { speed: m/s, fromDeg: meteorological direction the wind blows FROM } or null.
  const [wind, setWind] = useState(null);

  const scorecardRef = useRef(null);
  const videoRef = useRef(null);
  const loginFormRef = useRef(null);

  const currentHole = courseData[currentHoleIndex] || courseData[0];

  // --- WIND FETCH ---
  // One request for the course (wind is ~uniform over 1.5km); refresh every 10 min.
  useEffect(() => {
    let cancelled = false;
    const fetchWind = async () => {
      try {
        const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=64.1678&longitude=-21.7357&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m&wind_speed_unit=ms');
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled && j.current) setWind({ speed: j.current.wind_speed_10m, fromDeg: j.current.wind_direction_10m, gust: j.current.wind_gusts_10m, tempC: j.current.temperature_2m });
      } catch { /* wind is non-critical; ignore failures (e.g. offline) */ }
    };
    fetchWind();
    const id = setInterval(fetchWind, 10 * 60 * 1000);
    // Refresh when the app returns to foreground (e.g. phone unlocked mid-round).
    const onVisible = () => { if (document.visibilityState === 'visible') fetchWind(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  useEffect(() => {
    localStorage.setItem('currentHoleIndex', currentHoleIndex);
    localStorage.setItem('myScores', JSON.stringify(scores));
    localStorage.setItem('myPutts', JSON.stringify(putts));
    localStorage.setItem('myMatch', JSON.stringify(matchPlay));
    localStorage.setItem('trackScore', JSON.stringify(trackScore));
    localStorage.setItem('trackPutts', JSON.stringify(trackPutts));
    localStorage.setItem('trackGame', JSON.stringify(trackGame));
    localStorage.setItem('snjallskra', JSON.stringify(snjallskra));
    localStorage.setItem('statSheet', JSON.stringify(statSheet));
    localStorage.setItem('mySheets', JSON.stringify(sheets));
    localStorage.setItem('myMarks', JSON.stringify(marks));
    localStorage.setItem('myHandicap', handicap);
    localStorage.setItem('simpleView', JSON.stringify(simpleView));
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    localStorage.setItem('myBag', JSON.stringify(bag));
    localStorage.setItem('showClubRec', JSON.stringify(showClubRec));
  }, [currentHoleIndex, scores, putts, matchPlay, trackScore, trackPutts, trackGame, snjallskra, statSheet, sheets, marks, handicap, simpleView, darkMode, bag, showClubRec]);

  // Saved rounds live in their own key; the live-round keys above stay as-is.
  useEffect(() => {
    localStorage.setItem(ROUNDS_KEY, JSON.stringify(rounds));
  }, [rounds]);

  // Match the browser/PWA status-bar colour to the theme (fixes the green top border).
  useEffect(() => {
    let m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
    m.content = darkMode ? '#0b1813' : '#0a4d2a';
  }, [darkMode]);

  // --- GPS WATCH (live view only) ---
  useEffect(() => {
    if (isTeeView) return;
    setGpsError(false);
    if (!("geolocation" in navigator)) { setGpsError(true); return; }

    let lastAccepted = null; // last accepted { lat, lng }
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        setGpsError(false); // a successful callback means GPS works, even if we skip this fix
        const { latitude: lat, longitude: lng, accuracy } = position.coords;
        // Accept the first fix immediately; afterwards drop noisy/tiny moves.
        if (lastAccepted) {
          if (accuracy > 25) return;
          if (calculateDistanceInMeters(lastAccepted.lat, lastAccepted.lng, lat, lng) < 2) return;
        }
        lastAccepted = { lat, lng };
        setGpsLocation({ lat, lng, accuracy });
      },
      (error) => {
        console.error("GPS Error:", error.message);
        setGpsError(true);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 1000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [isTeeView]);

  // Clear any pending shot-length timer on unmount.
  useEffect(() => () => { clearTimeout(shotLenTimer.current); }, []);

  useEffect(() => { setTargetPoint(null); }, [currentHoleIndex]);

  // Post-hole stat sheet: leaving a hole that has a score but no sheet yet slides
  // the sheet up for that hole (only while "Skrá gögn sjálfur" is on). The ref
  // guard means re-runs from scores/sheets changes never fire it.
  const prevHoleRef = useRef(currentHoleIndex);
  useEffect(() => {
    const prev = prevHoleRef.current;
    prevHoleRef.current = currentHoleIndex;
    if (prev === currentHoleIndex || !statSheet) return;
    if ((scores[prev] || 0) > 0 && sheets[prev] == null) {
      setSheetDraft({});
      setSheetHole(prev);
    }
  }, [currentHoleIndex, statSheet, scores, sheets]);

  // --- SCORE / PUTT / MATCH handlers ---
  const adjustScore = (amount) => {
    const newScores = [...scores];
    const currentVal = newScores[currentHoleIndex] || 0;
    newScores[currentHoleIndex] = currentVal === 0 ? currentHole.par : Math.max(0, currentVal + amount);
    setScores(newScores);
  };

  const adjustPutts = (amount) => {
    const newPutts = [...putts];
    const currentVal = newPutts[currentHoleIndex] || 0;
    newPutts[currentHoleIndex] = currentVal === 0 ? 1 : Math.max(0, currentVal + amount);
    setPutts(newPutts);
  };

  const toggleMatchPlay = (teamValue) => {
    const newMatch = [...matchPlay];
    newMatch[currentHoleIndex] = newMatch[currentHoleIndex] === teamValue ? '' : teamValue;
    setMatchPlay(newMatch);
  };

  const handleScoreChange = (val, index = currentHoleIndex) => {
    const parsed = parseInt(val, 10);
    const newScores = [...scores];
    newScores[index] = isNaN(parsed) ? 0 : Math.max(0, parsed);
    setScores(newScores);
  };

  const handlePuttsChange = (val, index = currentHoleIndex) => {
    const parsed = parseInt(val, 10);
    const newPutts = [...putts];
    newPutts[index] = isNaN(parsed) ? 0 : Math.max(0, parsed);
    setPutts(newPutts);
  };

  const updateMatch = (val, index = currentHoleIndex) => {
    const newMatch = [...matchPlay];
    newMatch[index] = val;
    setMatchPlay(newMatch);
  };

  // --- IMAGE EXPORT / PIP / GOLFBOX (fragile by nature — don't refactor) ---
  const saveScorecardImage = async () => {
    setIsExporting(true);
    setTimeout(async () => {
      if (!scorecardRef.current) { setIsExporting(false); return; }
      try {
        const { default: html2canvas } = await import('html2canvas');
        const canvas = await html2canvas(scorecardRef.current, { backgroundColor: theme.scBg, scale: 2 });
        const link = document.createElement('a');
        const dateString = new Date().toISOString().split('T')[0];
        link.download = `Mosgolf_Skorkort_${dateString}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      } catch { /* export failed; just reset */ }
      setIsExporting(false);
    }, 150);
  };

  const handleGolfBoxLogin = () => {
    localStorage.setItem('gbUser', gbUser);
    localStorage.setItem('gbPass', gbPass);
    setShowLoginModal(false);
    openGolfBox();
  };

  const startPiP = async () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 450;
      const ctx = canvas.getContext('2d');
      const drawCanvas = () => {
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, 800, 450);
        const cols = 9, rows = 2, cellW = 800 / cols, cellH = 450 / rows;
        ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
        for (let i = 0; i < 18; i++) {
          const col = i % cols, row = Math.floor(i / cols), x = col * cellW, y = row * cellH;
          ctx.strokeRect(x, y, cellW, cellH);
          ctx.beginPath(); ctx.moveTo(x, y + 30); ctx.lineTo(x + cellW, y + 30); ctx.stroke();
          ctx.fillStyle = '#AAAAAA'; ctx.font = '16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(i + 1, x + cellW / 2, y + 15);
          const scoreVal = scores[i], scoreText = (scoreVal && scoreVal !== 0) ? scoreVal : '';
          ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 80px sans-serif';
          ctx.fillText(scoreText, x + cellW / 2, y + 30 + (cellH - 30) / 2);
        }
        ctx.fillStyle = Date.now() % 1000 < 500 ? theme.darkGreen : '#111111';
        ctx.beginPath(); ctx.arc(785, 435, 6, 0, Math.PI * 2); ctx.fill();
      };
      drawCanvas();
      const intervalId = setInterval(drawCanvas, 500);
      const stream = canvas.captureStream(30);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        await videoRef.current.requestPictureInPicture();
        videoRef.current.addEventListener('leavepictureinpicture', () => clearInterval(intervalId), { once: true });
      }
    } catch {
      alert("Gat ekki opnað PiP. Vafrinn þinn gæti lokað á það.");
    }
  };

  const openGolfBox = () => {
    if (!gbUser || !gbPass) { setShowLoginModal(true); return; }
    if (loginFormRef.current) {
      const gbWindow = window.open('', 'golfbox_window');
      if (!gbWindow) { alert("Sprettigluggi lokaður. Vinsamlegast leyfðu sprettiglugga."); return; }
      loginFormRef.current.target = 'golfbox_window';
      loginFormRef.current.submit();
      setTimeout(() => {
        if (gbWindow && !gbWindow.closed) gbWindow.location.href = 'https://www.golfbox.dk/site/my_golfbox/score/whs/newWHSScore.asp';
      }, 2000);
    }
  };

  // --- SAVED ROUNDS ---
  // Build a round object (schema in utils.js) from the live round + weather snapshot.
  const buildRound = () => ({
    schemaVersion: 1,
    date: new Date().toISOString(),
    course: 'Mosgolf',
    weather: wind ? { speed: wind.speed, fromDeg: wind.fromDeg, gust: wind.gust, tempC: wind.tempC } : null,
    holes: courseData.map((h, i) => ({
      hole: h.hole, par: h.par,
      score: scores[i] || 0, putts: putts[i] || 0, match: matchPlay[i] || '',
      sheet: sheets[i] || null, marks: marks[i] || [], shots: deriveShots(i, marks, scores, putts),
    })),
  });
  // Built outside the setState updater so StrictMode's double-invoke stays pure.
  const archiveCurrentRound = () => {
    const r = buildRound();
    setRounds((prev) => [r, ...prev].slice(0, MAX_ROUNDS));
  };
  const saveRound = () => {
    if (!scores.some((s) => s > 0)) { alert('Ekkert skor til að vista.'); return; }
    archiveCurrentRound();
    alert('Hringur vistaður!');
  };
  const deleteRound = (date) => {
    if (window.confirm('Eyða þessum hring?')) setRounds((prev) => prev.filter((r) => r.date !== date));
  };

  // Export: all saved rounds plus the current round, keeping only rounds with at
  // least MIN_EXPORT_HOLES scored holes (filters out abandoned cards).
  const exportAllData = () => {
    const candidates = scores.some((s) => s > 0) ? [buildRound(), ...rounds] : rounds;
    const good = candidates.filter((r) => summarizeRound(r).holesPlayed >= MIN_EXPORT_HOLES);
    if (!good.length) { alert(`Engin gögn með a.m.k. ${MIN_EXPORT_HOLES} skráðar holur.`); return; }
    downloadJSON(
      { exportedAt: new Date().toISOString(), readme: EXPORT_README, rounds: good },
      `Mosgolf_Gogn_${new Date().toISOString().split('T')[0]}.json`
    );
  };
  // Single round from Mínir hringir — named after the round's own date.
  const exportRound = (r) => {
    downloadJSON(
      { exportedAt: new Date().toISOString(), readme: EXPORT_README, rounds: [r] },
      `Mosgolf_Gogn_${r.date.split('T')[0]}.json`
    );
  };

  // --- AI COACHING PROMPT ---
  const toggleRoundSel = (date) =>
    setSelectedRounds((prev) => prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date]);

  const copyAIPrompt = async () => {
    const sel = rounds.filter((r) => selectedRounds.includes(r.date));
    if (!sel.length) { alert('Hakaðu við hringina sem á að greina.'); return; }
    const ok = await copyText(buildAIPrompt(sel, handicap));
    alert(ok ? 'AI prompt afritað á klemmuspjald.' : 'Tókst ekki að afrita.');
  };

  // --- CLEAR ROUND ---
  const doClearRound = () => {
    setScores(Array(18).fill(0));
    setPutts(Array(18).fill(0));
    setMatchPlay(Array(18).fill(''));
    setSheets(Array(18).fill(null));
    setSheetHole(null);
    setMarks(Array(18).fill().map(() => []));
    setShowScorecard(false);
    setCurrentHoleIndex(0);
  };
  // With scores on the card, offer to archive first (Já / Nei / Hætta við modal);
  // an empty card keeps the old simple confirm.
  const clearRound = () => {
    if (scores.some((s) => s > 0)) setShowClearConfirm(true);
    else if (window.confirm("Þurrka út allt?")) doClearRound();
  };

  // --- SHOT MARKS (Snjallskrá) handlers ---
  // Live view records at the GPS fix. Tee view records at the tap marker —
  // manual entry for hazards, forgotten shots and off-course testing.
  const canMark = snjallskra && (isTeeView ? !!targetPoint : !!gpsLocation);
  // drop = Víti: this position is the relief point after a penalty (the previous
  // swing went into a penalty area / was unplayable; counts as swing + penalty).
  const addMark = (drop = false) => {
    if (!canMark) return;
    const mk = isTeeView
      ? { lat: targetPoint.lat, lng: targetPoint.lng, accuracy: null, t: Date.now(), manual: true }
      : { lat: gpsLocation.lat, lng: gpsLocation.lng, accuracy: gpsLocation.accuracy ?? null, t: Date.now() };
    if (drop) mk.drop = true;
    // Length of this shot: from the previous mark, or the tee for the first one.
    const cur = marks[currentHoleIndex] || [];
    const from = cur.length ? cur[cur.length - 1] : currentHole.teeLocation;
    setLastShotLen(calculateDistanceInMeters(from.lat, from.lng, mk.lat, mk.lng));
    clearTimeout(shotLenTimer.current);
    shotLenTimer.current = setTimeout(() => setLastShotLen(null), 2600);
    setMarks((prev) => prev.map((m, i) => (i === currentHoleIndex ? [...m, mk] : m)));
    (drop ? setVitiFlash : setMarkFlash)(true);
    setTimeout(() => (drop ? setVitiFlash : setMarkFlash)(false), 350);
    if (isTeeView) setTargetPoint(null); // consumed — ready to place the next one
  };
  const undoLastMark = () => {
    if (!(marks[currentHoleIndex] || []).length) return;
    if (window.confirm('Afturkalla síðasta högg?')) {
      setMarks((prev) => prev.map((m, i) => (i === currentHoleIndex ? m.slice(0, -1) : m)));
    }
  };
  // Long-press = undo; a normal tap that follows a fired long-press is swallowed.
  const markPress = useRef({ timer: null, fired: false });
  const markPressStart = () => {
    markPress.current.fired = false;
    markPress.current.timer = setTimeout(() => {
      markPress.current.fired = true;
      markPress.current.timer = null;
      undoLastMark();
    }, 600);
  };
  const markPressEnd = () => {
    if (markPress.current.timer) { clearTimeout(markPress.current.timer); markPress.current.timer = null; }
  };
  const markClick = () => { if (!markPress.current.fired) addMark(); };

  // --- STAT SHEET handlers ---
  const openSheet = (i) => {
    const existing = sheets[i];
    setSheetDraft(existing && typeof existing === 'object' ? existing : {});
    setSheetHole(i);
  };
  // Tap a chosen answer again to unselect it — partial sheets are fine by design.
  const setSheetField = (field, val) =>
    setSheetDraft((d) => ({ ...d, [field]: d[field] === val ? null : val }));
  const saveSheet = () => {
    const s = {
      tee: sheetDraft.tee ?? null, green: sheetDraft.green ?? null,
      bunker: sheetDraft.bunker ?? null, penalty: sheetDraft.penalty ?? null,
      firstPutt: sheetDraft.firstPutt ?? null,
    };
    setSheets((prev) => prev.map((v, i) => (i === sheetHole ? s : v)));
    setSheetHole(null);
  };
  // Loka (and tapping outside the box) marks the hole 'skipped' so it isn't asked
  // again; when re-editing an already saved sheet it closes without touching data.
  // Stable identity (useCallback) because the back-button effect depends on it.
  const skipSheet = useCallback(() => {
    setSheets((prev) => prev.map((v, i) => (i === sheetHole && (v == null || v === 'skipped')) ? 'skipped' : v));
    setSheetHole(null);
  }, [sheetHole]);

  // --- ANDROID BACK BUTTON ---
  // Keep ONE history entry alive while any overlay is open: hardware back then
  // closes the topmost layer (re-arming the entry while layers remain) and only
  // exits the app from a bare live view. X-button closes consume the entry.
  const anyOverlay = showScorecard || showBag || showRounds || showSettings ||
    showClearConfirm || showLoginModal || sheetHole !== null;
  const hadOverlayRef = useRef(false);

  // A reload while an overlay was open leaves a stale entry — drop it once.
  useEffect(() => {
    if (window.history.state && window.history.state.overlay) window.history.replaceState(null, '');
  }, []);

  useEffect(() => {
    const h = window.history;
    if (anyOverlay && !hadOverlayRef.current) {
      if (!(h.state && h.state.overlay)) h.pushState({ overlay: true }, '');
    } else if (!anyOverlay && hadOverlayRef.current) {
      if (h.state && h.state.overlay) h.back();
    }
    hadOverlayRef.current = anyOverlay;
  }, [anyOverlay]);

  useEffect(() => {
    const onPop = () => {
      // Top of the visual stack first (modals > sheet > bag > pages > scorecard).
      const layersOpen = [showClearConfirm, showLoginModal, sheetHole !== null, showBag, showRounds, showSettings, showScorecard].filter(Boolean).length;
      if (showClearConfirm) setShowClearConfirm(false);
      else if (showLoginModal) setShowLoginModal(false);
      else if (sheetHole !== null) skipSheet();
      else if (showBag) setShowBag(false);
      else if (showRounds) setShowRounds(false);
      else if (showSettings) setShowSettings(false);
      else if (showScorecard) setShowScorecard(false);
      else return; // nothing open: a real back navigation, let it through
      if (layersOpen > 1) window.history.pushState({ overlay: true }, '');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [showClearConfirm, showLoginModal, sheetHole, showBag, showRounds, showSettings, showScorecard, skipSheet]);

  // --- BAG handlers ---
  const adjustClubMax = (id, delta) =>
    setBag((prev) => prev.map((c) => c.id === id ? { ...c, max: Math.min(350, Math.max(20, c.max + delta)) } : c));
  const toggleClub = (id) =>
    setBag((prev) => prev.map((c) => c.id === id ? { ...c, enabled: !c.enabled } : c));
  const resetBag = () => { if (window.confirm('Endurstilla pokann?')) setBag(freshBag()); };
  const deleteClub = (id) => setBag((prev) => prev.filter((c) => c.id !== id));
  // Add a club from the name + max fields; insert it where its max distance
  // belongs in the list (longest first, like the default bag).
  const addClub = () => {
    const label = newClubName.trim();
    const max = Math.round(Number(newClubMax));
    if (!label || !Number.isFinite(max) || max < 20 || max > 350) return;
    const club = { id: 'c' + Date.now().toString(36), label, max, enabled: true };
    setBag((prev) => {
      const idx = prev.findIndex((c) => c.max < max);
      const next = [...prev];
      next.splice(idx === -1 ? next.length : idx, 0, club);
      return next;
    });
    setNewClubName('');
    setNewClubMax('');
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100dvh', width: '100vw',
      fontFamily: theme.sans, backgroundColor: '#e2e8e4',
      position: 'relative', overflow: 'hidden'
    }}>
      <style>{`
        .no-spinners::-webkit-inner-spin-button,
        .no-spinners::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        .no-spinners { -moz-appearance: textfield; }
        .punchy-map-tiles { filter: contrast(1.05) saturate(1.2) brightness(1.0); }
        .num { font-family: ${theme.num}; font-feature-settings: 'tnum' 1; font-variant-numeric: tabular-nums; }
        @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>

      <video ref={videoRef} muted playsInline style={{ display: 'none' }} />
      <form ref={loginFormRef} method="POST" action="https://www.golfbox.dk/login.asp?lcid=1039" style={{ display: 'none' }}>
        <input type="hidden" name="loginform.submitted" value="true" />
        <input type="hidden" name="command" value="login" />
        <input type="hidden" name="loginform.username" value={gbUser} />
        <input type="hidden" name="loginform.password" value={gbPass} />
        <input type="hidden" name="loginform.submit" value="LOGIN" />
      </form>

      {/* LOGIN MODAL OVERLAY */}
      {showLoginModal && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: theme.softWhite, padding: '30px', borderRadius: theme.radius, width: '90%', maxWidth: '400px', textAlign: 'center', border: `1px solid ${theme.darkGreen}` }}>
            <h3 style={{ marginTop: 0, color: theme.darkGreen, fontSize: '1.4rem', textTransform: 'uppercase' }}>Tengja við GolfBox</h3>
            <p style={{ fontSize: '0.9rem', color: '#555', marginBottom: '20px' }}>Skráðu þig inn til að opna GolfBox í sér glugga á meðan skorkortið er opið í PiP.</p>
            <input type="text" placeholder="Notendanafn" value={gbUser} onChange={(e) => setGbUser(e.target.value)} style={{ width: '100%', padding: '12px', marginBottom: '15px', borderRadius: theme.radius, border: '1px solid #ccc', fontSize: '1rem', boxSizing: 'border-box' }} />
            <input type="password" placeholder="Lykilorð" value={gbPass} onChange={(e) => setGbPass(e.target.value)} style={{ width: '100%', padding: '12px', marginBottom: '25px', borderRadius: theme.radius, border: '1px solid #ccc', fontSize: '1rem', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowLoginModal(false)} style={{ flex: 1, padding: '12px', background: 'transparent', color: theme.darkGreen, border: `1px solid ${theme.darkGreen}`, borderRadius: theme.radius, fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase' }}>Hætta við</button>
              <button onClick={handleGolfBoxLogin} style={{ flex: 1, padding: '12px', background: theme.darkGreen, color: '#fff', border: 'none', borderRadius: theme.radius, fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase' }}>Vista & Skrá</button>
            </div>
          </div>
        </div>
      )}

      {/* SAVE-BEFORE-CLEAR MODAL (Já = save+clear / Nei = clear / Hætta við) */}
      {showClearConfirm && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100000, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ background: theme.softWhite, padding: '25px', borderRadius: theme.radius, width: '90%', maxWidth: '400px', textAlign: 'center', border: `1px solid ${theme.darkGreen}` }}>
            <h3 style={{ marginTop: 0, marginBottom: '20px', color: theme.darkGreen, fontSize: '1.15rem', textTransform: 'uppercase' }}>Vista hringinn áður en þú þurrkar út?</h3>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { archiveCurrentRound(); doClearRound(); setShowClearConfirm(false); }} style={{ flex: 1, padding: '12px 6px', background: theme.darkGreen, color: '#fff', border: 'none', borderRadius: theme.radius, fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase' }}>Já</button>
              <button onClick={() => { doClearRound(); setShowClearConfirm(false); }} style={{ flex: 1, padding: '12px 6px', background: 'transparent', color: '#d32f2f', border: '1px solid #d32f2f', borderRadius: theme.radius, fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase' }}>Nei</button>
              <button onClick={() => setShowClearConfirm(false)} style={{ flex: 1, padding: '12px 6px', background: 'transparent', color: theme.darkGreen, border: `1px solid ${theme.darkGreen}`, borderRadius: theme.radius, fontSize: '0.9rem', fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase' }}>Hætta við</button>
            </div>
          </div>
        </div>
      )}

      <MapScreen
        theme={theme}
        currentHoleIndex={currentHoleIndex} setCurrentHoleIndex={setCurrentHoleIndex}
        isTeeView={isTeeView} setIsTeeView={setIsTeeView}
        gpsLocation={gpsLocation} gpsError={gpsError}
        targetPoint={targetPoint} setTargetPoint={setTargetPoint}
        wind={wind} simpleView={simpleView} bag={bag} showClubRec={showClubRec}
        snjallskra={snjallskra} statSheet={statSheet} marks={marks}
        canMark={canMark} markFlash={markFlash} vitiFlash={vitiFlash} lastShotLen={lastShotLen}
        markClick={markClick} markPressStart={markPressStart} markPressEnd={markPressEnd} addMark={addMark}
        openSheet={openSheet} sheetHole={sheetHole} sheetDraft={sheetDraft}
        setSheetField={setSheetField} saveSheet={saveSheet} skipSheet={skipSheet}
        scores={scores} putts={putts} matchPlay={matchPlay}
        adjustScore={adjustScore} adjustPutts={adjustPutts} toggleMatchPlay={toggleMatchPlay}
        trackScore={trackScore} trackPutts={trackPutts} trackGame={trackGame}
        onOpenScorecard={() => setShowScorecard(true)}
      />

      {showScorecard && (
        <ScorecardScreen
          theme={theme}
          scores={scores} putts={putts} matchPlay={matchPlay}
          trackScore={trackScore} trackPutts={trackPutts} trackGame={trackGame}
          statSheet={statSheet} snjallskra={snjallskra} sheets={sheets} marks={marks}
          isExporting={isExporting} scorecardRef={scorecardRef}
          handleScoreChange={handleScoreChange} handlePuttsChange={handlePuttsChange} updateMatch={updateMatch}
          saveRound={saveRound} saveScorecardImage={saveScorecardImage}
          startPiP={startPiP} openGolfBox={openGolfBox} clearRound={clearRound}
          onGoToHole={(index) => { setCurrentHoleIndex(index); setShowScorecard(false); }}
          onOpenRounds={() => setShowRounds(true)}
          onOpenSettings={() => setShowSettings(true)}
          onClose={() => setShowScorecard(false)}
        />
      )}

      {showBag && (
        <BagScreen
          theme={theme} bag={bag}
          newClubName={newClubName} setNewClubName={setNewClubName}
          newClubMax={newClubMax} setNewClubMax={setNewClubMax}
          adjustClubMax={adjustClubMax} toggleClub={toggleClub}
          deleteClub={deleteClub} addClub={addClub} resetBag={resetBag}
          onClose={() => setShowBag(false)}
        />
      )}

      {showRounds && (
        <RoundsScreen
          theme={theme} rounds={rounds}
          expandedRound={expandedRound} setExpandedRound={setExpandedRound}
          selectedRounds={selectedRounds} toggleRoundSel={toggleRoundSel}
          exportRound={exportRound} deleteRound={deleteRound}
          copyAIPrompt={copyAIPrompt} exportAllData={exportAllData}
          onClose={() => setShowRounds(false)}
        />
      )}

      {showSettings && (
        <SettingsScreen
          theme={theme}
          trackScore={trackScore} setTrackScore={setTrackScore}
          trackPutts={trackPutts} setTrackPutts={setTrackPutts}
          trackGame={trackGame} setTrackGame={setTrackGame}
          darkMode={darkMode} setDarkMode={setDarkMode}
          simpleView={simpleView} setSimpleView={setSimpleView}
          showClubRec={showClubRec} setShowClubRec={setShowClubRec}
          statSheet={statSheet} setStatSheet={setStatSheet}
          snjallskra={snjallskra} setSnjallskra={setSnjallskra}
          handicap={handicap} setHandicap={setHandicap}
          onOpenBag={() => setShowBag(true)}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* EASTER EGG */}
      {scores[5] === 7 && !hideEasterEgg && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.95)', zIndex: 99999, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
          <img src={easterEggImg} alt="Easter Egg" style={{ maxWidth: '80%', maxHeight: '60%', borderRadius: theme.radius, boxShadow: '0 10px 30px rgba(0,0,0,0.8)', border: '4px solid white' }} />
          <button onClick={() => setHideEasterEgg(true)} style={{ marginTop: '30px', background: theme.darkGreen, color: 'white', padding: '12px 30px', border: 'none', borderRadius: theme.radius, fontSize: '1.2rem', fontWeight: '900', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Loka
          </button>
        </div>
      )}
    </div>
  );
}
