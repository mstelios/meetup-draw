import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  set as fbSet,
  onValue,
  remove,
  update,
} from 'firebase/database';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { QRCodeSVG } from 'qrcode.react';
import confetti from 'canvas-confetti';
import {
  Trophy,
  Users,
  BarChart3,
  Trash2,
  Sparkles,
  CheckCircle2,
  RefreshCw,
  Download,
  Wifi,
  WifiOff,
} from 'lucide-react';

const firebaseConfig = {
  apiKey: "AIzaSyADzQWBW8q2BU5uU-ZL_CefvYedjZrPE28",
  authDomain: "meetup-draw-3b7b7.firebaseapp.com",
  databaseURL: "https://meetup-draw-3b7b7-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "meetup-draw-3b7b7",
  storageBucket: "meetup-draw-3b7b7.firebasestorage.app",
  messagingSenderId: "146187800604",
  appId: "1:146187800604:web:cb626b0ac6ce2934338fd9",
  measurementId: "G-5NX8XPK50P"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

interface Participant {
  id: string;
  name: string;
  handle: string;
  hasWon: boolean;
  joinedAt: number;
}

interface Poll {
  active: boolean;
  question: string;
  options: string[];
  votes: Record<string, number>;
}

const DEFAULT_POLL: Poll = {
  active: false,
  question: 'Which topic should we cover next meetup?',
  options: ['AI & Local LLMs', 'WebAssembly & Rust', 'System Design', 'DevOps & Cloud'],
  votes: {},
};

function downloadCSV(filename: string, rows: string[][]) {
  const csvContent = rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const urlRoomId = params.get('room');
  const isParticipant = Boolean(urlRoomId);

  const [roomId] = useState<string>(() => {
    if (urlRoomId) return urlRoomId;
    const saved = localStorage.getItem('host_room_id');
    if (saved) return saved;
    const fresh = Math.random().toString(36).substring(2, 8).toUpperCase();
    localStorage.setItem('host_room_id', fresh);
    return fresh;
  });

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [poll, setPoll] = useState<Poll>(DEFAULT_POLL);
  const [activeTab, setActiveTab] = useState<'raffle' | 'poll'>('raffle');
  const [isDrawing, setIsDrawing] = useState(false);
  const [highlightedName, setHighlightedName] = useState<string | null>(null);
  const [currentWinner, setCurrentWinner] = useState<Participant | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const [draftQuestion, setDraftQuestion] = useState(DEFAULT_POLL.question);
  const [draftOptions, setDraftOptions] = useState(DEFAULT_POLL.options.join('\n'));

  const [participantId] = useState(() => {
    let id = localStorage.getItem('participant_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('participant_id', id);
    }
    return id;
  });
  const [nameInput, setNameInput] = useState(() => localStorage.getItem('p_name') || '');
  const [handleInput, setHandleInput] = useState(() => localStorage.getItem('p_handle') || '');
  const [joined, setJoined] = useState(false);
  const [myVote, setMyVote] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Monitor Firebase connection status
  useEffect(() => {
    const connectedRef = ref(db, '.info/connected');
    const unsub = onValue(connectedRef, (snap) => {
      setIsConnected(Boolean(snap.val()));
    });
    return () => unsub();
  }, []);

  // Load local-first IndexedDB cache immediately on Host boot
  useEffect(() => {
    if (isParticipant) return;
    idbGet(`meetup_participants_${roomId}`).then((cached) => {
      if (Array.isArray(cached) && cached.length > 0) setParticipants(cached);
    });
    idbGet(`meetup_poll_${roomId}`).then((cached) => {
      if (cached) {
        setPoll(cached);
        setDraftQuestion(cached.question || DEFAULT_POLL.question);
        setDraftOptions((cached.options || DEFAULT_POLL.options).join('\n'));
      }
    });
  }, [isParticipant, roomId]);

  // Subscribe to Firebase Realtime Database for Room Participants & Poll
  useEffect(() => {
    const participantsRef = ref(db, `rooms/${roomId}/participants`);
    const unsubParticipants = onValue(
      participantsRef,
      (snapshot) => {
        setDbError(null);
        const val = snapshot.val();
        if (!val) {
          setParticipants([]);
          if (!isParticipant) idbSet(`meetup_participants_${roomId}`, []);
          return;
        }
        const list: Participant[] = Object.values(val);
        list.sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
        setParticipants(list);
        if (!isParticipant) {
          idbSet(`meetup_participants_${roomId}`, list);
        } else if (val[participantId]) {
          setJoined(true);
        }
      },
      (err) => {
        setDbError(err.message);
      }
    );

    const pollRef = ref(db, `rooms/${roomId}/poll`);
    const unsubPoll = onValue(
      pollRef,
      (snapshot) => {
        const val = snapshot.val();
        if (!val) {
          setPoll((prev) => ({ ...prev, active: false, votes: {} }));
          return;
        }
        const loadedPoll: Poll = {
          active: Boolean(val.active),
          question: val.question || DEFAULT_POLL.question,
          options: Array.isArray(val.options) ? val.options : DEFAULT_POLL.options,
          votes: val.votes || {},
        };
        setPoll(loadedPoll);
        if (!isParticipant) {
          idbSet(`meetup_poll_${roomId}`, loadedPoll);
        } else if (loadedPoll.votes[participantId] !== undefined) {
          setMyVote(loadedPoll.votes[participantId]);
        } else {
          setMyVote(null);
        }
      },
      (err) => {
        setDbError(err.message);
      }
    );

    return () => {
      unsubParticipants();
      unsubPoll();
    };
  }, [roomId, isParticipant, participantId]);

  // Participant Handlers
  const handleParticipantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim() || submitting) return;
    setSubmitting(true);
    setDbError(null);
    try {
      const cleanName = nameInput.trim();
      const cleanHandle = handleInput.trim();
      localStorage.setItem('p_name', cleanName);
      localStorage.setItem('p_handle', cleanHandle);

      const pRef = ref(db, `rooms/${roomId}/participants/${participantId}`);
      await fbSet(pRef, {
        id: participantId,
        name: cleanName,
        handle: cleanHandle,
        hasWon: false,
        joinedAt: Date.now(),
      });
      setJoined(true);
    } catch (err: any) {
      setDbError(err?.message || 'Failed to join draw. Check Firebase rules.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCastVote = async (index: number) => {
    setMyVote(index);
    try {
      const voteRef = ref(db, `rooms/${roomId}/poll/votes/${participantId}`);
      await fbSet(voteRef, index);
    } catch (err: any) {
      setDbError(err?.message || 'Failed to submit vote.');
    }
  };

  // Host Handlers
  const eligibleParticipants = participants.filter((p) => !p.hasWon);
  const pastWinners = participants.filter((p) => p.hasWon);

  const runDraw = () => {
    if (eligibleParticipants.length === 0 || isDrawing) return;
    setIsDrawing(true);
    setCurrentWinner(null);

    let ticks = 0;
    const totalTicks = 28;
    const interval = setInterval(async () => {
      const randomCandidate =
        eligibleParticipants[Math.floor(Math.random() * eligibleParticipants.length)];
      setHighlightedName(randomCandidate.name);
      ticks++;

      if (ticks >= totalTicks) {
        clearInterval(interval);
        const array = new Uint32Array(1);
        window.crypto.getRandomValues(array);
        const winner = eligibleParticipants[array[0] % eligibleParticipants.length];

        setHighlightedName(null);
        setCurrentWinner(winner);
        setIsDrawing(false);

        const winnerRef = ref(db, `rooms/${roomId}/participants/${winner.id}`);
        await update(winnerRef, { hasWon: true });

        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      }
    }, 80);
  };

  const resetWinners = async () => {
    const updates: Record<string, any> = {};
    participants.forEach((p) => {
      updates[`rooms/${roomId}/participants/${p.id}/hasWon`] = false;
    });
    if (Object.keys(updates).length > 0) {
      await update(ref(db), updates);
    }
    setCurrentWinner(null);
  };

  const clearAllData = async () => {
    if (!window.confirm('Clear all participants, winners, and votes for this room?')) return;
    await remove(ref(db, `rooms/${roomId}`));
    await idbSet(`meetup_participants_${roomId}`, []);
    await idbSet(`meetup_poll_${roomId}`, DEFAULT_POLL);
    setParticipants([]);
    setCurrentWinner(null);
    setPoll(DEFAULT_POLL);
  };

  const startPoll = async () => {
    const cleanedOptions = draftOptions
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean);
    if (!draftQuestion.trim() || cleanedOptions.length < 2) return;

    const newPoll: Poll = {
      active: true,
      question: draftQuestion.trim(),
      options: cleanedOptions,
      votes: {},
    };
    await fbSet(ref(db, `rooms/${roomId}/poll`), newPoll);
  };

  const closePoll = async () => {
    await update(ref(db, `rooms/${roomId}/poll`), { active: false });
  };

  const handleExportParticipants = () => {
    const rows = [
      ['Name', 'Handle / Email', 'Status', 'Joined At'],
      ...participants.map((p) => [
        p.name,
        p.handle || '-',
        p.hasWon ? 'Winner' : 'Eligible',
        new Date(p.joinedAt).toLocaleString(),
      ]),
    ];
    downloadCSV(`meetup-raffle-${roomId}.csv`, rows);
  };

  const handleExportPoll = () => {
    const total = Object.keys(poll.votes).length;
    const rows = [
      ['Question', poll.question],
      ['Option', 'Votes', 'Percentage'],
      ...poll.options.map((opt, idx) => {
        const count = Object.values(poll.votes).filter((v) => v === idx).length;
        const pct = total > 0 ? `${Math.round((count / total) * 100)}%` : '0%';
        return [opt, String(count), pct];
      }),
    ];
    downloadCSV(`meetup-poll-${roomId}.csv`, rows);
  };

  // ==========================================
  // VIEW 1: PARTICIPANT MOBILE VIEW
  // ==========================================
  if (isParticipant) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-950">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <span className="text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300">
              Room: {roomId}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              {isConnected ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Live Connected</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                  <span>Connecting...</span>
                </>
              )}
            </span>
          </div>

          {dbError && (
            <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              Database error: {dbError}
            </div>
          )}

          {!joined ? (
            <form onSubmit={handleParticipantSubmit} className="space-y-4">
              <h1 className="text-2xl font-bold text-white">Join the Meetup Draw</h1>
              <p className="text-sm text-slate-400">
                Enter your details below to enter the raffle and participate in live polls.
              </p>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Full Name *</label>
                <input
                  type="text"
                  required
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="e.g. Elena Papadopoulou"
                  className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Email or Social Handle (Optional)
                </label>
                <input
                  type="text"
                  value={handleInput}
                  onChange={(e) => setHandleInput(e.target.value)}
                  placeholder="e.g. @elena_dev or elena@email.com"
                  className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold text-white transition"
              >
                {submitting ? 'Joining...' : 'Enter Raffle'}
              </button>
            </form>
          ) : (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3">
                <CheckCircle2 className="text-emerald-400 shrink-0" />
                <div>
                  <p className="font-semibold text-emerald-200">You're in the draw, {nameInput}!</p>
                  <p className="text-xs text-emerald-300/80">Keep this tab open to vote in polls.</p>
                </div>
              </div>

              {poll.active ? (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                    Live Poll
                  </span>
                  <h2 className="text-lg font-bold text-white">{poll.question}</h2>
                  <div className="space-y-2">
                    {poll.options.map((opt, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleCastVote(idx)}
                        className={`w-full text-left px-4 py-3 rounded-xl border transition font-medium ${
                          myVote === idx
                            ? 'bg-indigo-600 border-indigo-400 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-center text-sm text-slate-500 py-4">
                  Waiting for host to launch a poll or start the draw...
                </p>
              )}

              <button
                type="button"
                onClick={() => setJoined(false)}
                className="w-full text-xs text-slate-500 hover:text-slate-300"
              >
                Edit my name / handle
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW 2: HOST PROJECTOR / STAGE VIEW
  // ==========================================
  const joinUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  const totalVotes = Object.keys(poll.votes).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
            <h2 className="text-lg font-bold text-white">Scan to Join & Vote</h2>
            <div className="bg-white p-4 rounded-xl inline-block">
              <QRCodeSVG value={joinUrl} size={190} />
            </div>
            <div className="text-xs text-slate-400 break-all bg-slate-950 p-2.5 rounded-lg border border-slate-800 select-all">
              {joinUrl}
            </div>
            <div className="flex justify-center gap-4 text-xs text-slate-400 pt-1">
              <span className="flex items-center gap-1">
                <Users className="w-4 h-4 text-indigo-400" /> {participants.length} Registered
              </span>
              <span className="flex items-center gap-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                  }`}
                />
                {isConnected ? 'Firebase Live' : 'Offline Cache'}
              </span>
            </div>
            {dbError && (
              <p className="text-xs text-rose-400 bg-rose-500/10 p-2 rounded-lg">{dbError}</p>
            )}
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-200">
                Pool ({eligibleParticipants.length}/{participants.length})
              </h3>
              <div className="flex items-center gap-3">
                {participants.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportParticipants}
                    title="Export Participants & Winners to CSV"
                    className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" /> CSV
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearAllData}
                  title="Reset everything"
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Reset
                </button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
              {participants.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-6">
                  Waiting for attendees to scan the QR code...
                </p>
              )}
              {participants.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                    p.hasWon
                      ? 'bg-slate-950/50 text-slate-500 line-through'
                      : 'bg-slate-950 text-slate-200'
                  }`}
                >
                  <div>
                    <span className="font-medium">{p.name}</span>
                    {p.handle && <span className="text-xs text-slate-500 ml-2">{p.handle}</span>}
                  </div>
                  {p.hasWon && (
                    <span className="text-[10px] uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 no-underline">
                      Won
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex gap-3 bg-slate-900 p-1.5 rounded-xl border border-slate-800 w-fit">
            <button
              type="button"
              onClick={() => setActiveTab('raffle')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === 'raffle'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Trophy className="w-4 h-4" /> Raffle Draw
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('poll')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                activeTab === 'poll'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BarChart3 className="w-4 h-4" /> Topic / Poll Voting
            </button>
          </div>

          {activeTab === 'raffle' ? (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center min-h-[420px] text-center space-y-8">
              {isDrawing ? (
                <div className="space-y-2">
                  <p className="text-sm uppercase tracking-widest text-indigo-400 animate-pulse">
                    Selecting Winner...
                  </p>
                  <div className="text-4xl md:text-6xl font-extrabold text-white">
                    {highlightedName}
                  </div>
                </div>
              ) : currentWinner ? (
                <div className="space-y-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-sm font-semibold">
                    <Sparkles className="w-4 h-4" /> Winner!
                  </span>
                  <h1 className="text-4xl md:text-6xl font-extrabold text-white">
                    {currentWinner.name}
                  </h1>
                  {currentWinner.handle && (
                    <p className="text-xl text-indigo-300">{currentWinner.handle}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Trophy className="w-16 h-16 text-slate-700 mx-auto mb-2" />
                  <h1 className="text-3xl font-bold text-slate-200">Ready to Draw</h1>
                  <p className="text-slate-400">
                    {eligibleParticipants.length} eligible participants in the pool
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={runDraw}
                disabled={eligibleParticipants.length === 0 || isDrawing}
                className="px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-lg font-bold text-white shadow-lg shadow-indigo-600/20 transition"
              >
                {isDrawing ? 'Drawing...' : 'Pick Random Winner'}
              </button>

              {pastWinners.length > 0 && (
                <div className="w-full pt-6 border-t border-slate-800 flex items-center justify-between text-sm">
                  <span className="text-slate-400">
                    Previous winners excluded: <strong>{pastWinners.length}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={resetWinners}
                    className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Re-include winners
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 space-y-6">
              <div className="space-y-4">
                <h2 className="text-xl font-bold text-white">Configure Live Poll</h2>
                <input
                  type="text"
                  value={draftQuestion}
                  onChange={(e) => setDraftQuestion(e.target.value)}
                  placeholder="Enter poll question..."
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white"
                />
                <textarea
                  rows={3}
                  value={draftOptions}
                  onChange={(e) => setDraftOptions(e.target.value)}
                  placeholder="One option per line..."
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-sm"
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={startPoll}
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm text-white"
                  >
                    {poll.active ? 'Update & Reset Votes' : 'Push Poll to Phones'}
                  </button>
                  {poll.active && (
                    <button
                      type="button"
                      onClick={closePoll}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm text-slate-300"
                    >
                      Close Poll
                    </button>
                  )}
                </div>
              </div>

              {poll.active && (
                <div className="pt-6 border-t border-slate-800 space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white">{poll.question}</h3>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-slate-400">{totalVotes} total votes</span>
                      <button
                        type="button"
                        onClick={handleExportPoll}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-emerald-400"
                      >
                        <Download className="w-3.5 h-3.5" /> Export CSV
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {poll.options.map((option, idx) => {
                      const count = Object.values(poll.votes).filter((v) => v === idx).length;
                      const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                      return (
                        <div key={idx} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium text-slate-200">{option}</span>
                            <span className="text-slate-400">
                              {count} ({pct}%)
                            </span>
                          </div>
                          <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500 transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
