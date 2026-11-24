import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set as fbSet, update, remove } from 'firebase/database';
import { get, set as idbSet } from 'idb-keyval';
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
  Award,
} from 'lucide-react';

const firebaseConfig = {
  apiKey: "AIzaSyADzQWBW8q2BU5uU-ZL_CefvYedjZrPE28",
  authDomain: "meetup-draw-3b7b7.firebaseapp.com",
  databaseURL: "https://meetup-draw-3b7b7-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "meetup-draw-3b7b7",
  storageBucket: "meetup-draw-3b7b7.firebasestorage.app",
  messagingSenderId: "146187800604",
  appId: "1:146187800604:web:cb626b0ac6ce2934338fd9",
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

interface WinnerAnnouncement {
  id: string;
  name: string;
  handle: string;
  drawnAt: number;
}

interface Poll {
  active: boolean;
  showResults: boolean;
  question: string;
  options: string[];
  votes: Record<string, number>;
}

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

  const [connected, setConnected] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [poll, setPoll] = useState<Poll>({
    active: false,
    showResults: false,
    question: 'Which topic should we cover next meetup?',
    options: ['AI & Local LLMs', 'WebAssembly & Rust', 'System Design', 'DevOps & Cloud'],
    votes: {},
  });
  const [latestWinner, setLatestWinner] = useState<WinnerAnnouncement | null>(null);
  const [activeTab, setActiveTab] = useState<'raffle' | 'poll'>('raffle');
  const [isDrawing, setIsDrawing] = useState(false);
  const [highlightedName, setHighlightedName] = useState<string | null>(null);

  const [draftQuestion, setDraftQuestion] = useState(poll.question);
  const [draftOptions, setDraftOptions] = useState(poll.options.join('\n'));

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
  const [celebratedWinnerId, setCelebratedWinnerId] = useState<string | null>(null);

  // Monitor Firebase connection status
  useEffect(() => {
    const connRef = ref(db, '.info/connected');
    return onValue(connRef, (snap) => {
      setConnected(Boolean(snap.val()));
    });
  }, []);

  // Load local IndexedDB fallback on Host boot
  useEffect(() => {
    if (isParticipant) return;
    get(`meetup_participants_${roomId}`).then((data) => {
      if (data) setParticipants(data);
    });
    get(`meetup_poll_${roomId}`).then((data) => {
      if (data) {
        setPoll(data);
        setDraftQuestion(data.question);
        setDraftOptions(data.options.join('\n'));
      }
    });
  }, [isParticipant, roomId]);

  // Subscribe to Firebase Realtime Database
  useEffect(() => {
    const participantsRef = ref(db, `rooms/${roomId}/participants`);
    const unsubParticipants = onValue(
      participantsRef,
      (snap) => {
        setDbError(null);
        const val = snap.val() || {};
        const list: Participant[] = Object.entries(val).map(([id, item]: [string, any]) => ({
          id,
          name: item.name || 'Anonymous',
          handle: item.handle || '',
          hasWon: Boolean(item.hasWon),
          joinedAt: item.joinedAt || Date.now(),
        }));
        list.sort((a, b) => a.joinedAt - b.joinedAt);
        setParticipants(list);
        if (!isParticipant) {
          idbSet(`meetup_participants_${roomId}`, list);
        } else if (val[participantId]) {
          setJoined(true);
        }
      },
      (err) => setDbError(err.message)
    );

    const pollRef = ref(db, `rooms/${roomId}/poll`);
    const unsubPoll = onValue(
      pollRef,
      (snap) => {
        const val = snap.val();
        if (val) {
          const syncedPoll: Poll = {
            active: Boolean(val.active),
            showResults: Boolean(val.showResults),
            question: val.question || '',
            options: Array.isArray(val.options) ? val.options : [],
            votes: val.votes || {},
          };
          setPoll(syncedPoll);
          if (!isParticipant) {
            idbSet(`meetup_poll_${roomId}`, syncedPoll);
          }
        } else {
          setPoll((prev) => ({ ...prev, active: false, showResults: false, votes: {} }));
        }
      },
      (err) => setDbError(err.message)
    );

    const winnerRef = ref(db, `rooms/${roomId}/winner`);
    const unsubWinner = onValue(
      winnerRef,
      (snap) => {
        const val = snap.val();
        setLatestWinner(val || null);
      },
      (err) => setDbError(err.message)
    );

    return () => {
      unsubParticipants();
      unsubPoll();
      unsubWinner();
    };
  }, [roomId, isParticipant, participantId]);

  // Trigger confetti on participant's own phone when they win!
  useEffect(() => {
    if (
      isParticipant &&
      latestWinner &&
      latestWinner.id === participantId &&
      celebratedWinnerId !== latestWinner.drawnAt.toString()
    ) {
      setCelebratedWinnerId(latestWinner.drawnAt.toString());
      confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 } });
    }
  }, [isParticipant, latestWinner, participantId, celebratedWinnerId]);

  // Participant Handlers
  const handleParticipantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    const cleanName = nameInput.trim();
    const cleanHandle = handleInput.trim();
    localStorage.setItem('p_name', cleanName);
    localStorage.setItem('p_handle', cleanHandle);

    try {
      await fbSet(ref(db, `rooms/${roomId}/participants/${participantId}`), {
        name: cleanName,
        handle: cleanHandle,
        hasWon: false,
        joinedAt: Date.now(),
      });
      setJoined(true);
      setDbError(null);
    } catch (err: any) {
      setDbError(err.message || 'Failed to submit entry');
    }
  };

  const handleCastVote = async (index: number) => {
    try {
      await fbSet(ref(db, `rooms/${roomId}/poll/votes/${participantId}`), index);
      setDbError(null);
    } catch (err: any) {
      setDbError(err.message || 'Failed to submit vote');
    }
  };

  // Host Handlers
  const eligibleParticipants = participants.filter((p) => !p.hasWon);
  const pastWinners = participants.filter((p) => p.hasWon);

  const runDraw = () => {
    if (eligibleParticipants.length === 0 || isDrawing) return;
    setIsDrawing(true);

    let ticks = 0;
    const totalTicks = 25;
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
        setIsDrawing(false);

        const announcement: WinnerAnnouncement = {
          id: winner.id,
          name: winner.name,
          handle: winner.handle,
          drawnAt: Date.now(),
        };

        await update(ref(db, `rooms/${roomId}/participants/${winner.id}`), { hasWon: true });
        await fbSet(ref(db, `rooms/${roomId}/winner`), announcement);

        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      }
    }, 80);
  };

  const resetWinners = async () => {
    const updates: Record<string, any> = {};
    participants.forEach((p) => {
      updates[`rooms/${roomId}/participants/${p.id}/hasWon`] = false;
    });
    updates[`rooms/${roomId}/winner`] = null;
    await update(ref(db), updates);
  };

  const clearAllData = async () => {
    if (!window.confirm('Clear all participants, winners, and votes?')) return;
    await remove(ref(db, `rooms/${roomId}`));
    await idbSet(`meetup_participants_${roomId}`, []);
    await idbSet(`meetup_poll_${roomId}`, null);
    setParticipants([]);
    setLatestWinner(null);
    setPoll((prev) => ({ ...prev, active: false, showResults: false, votes: {} }));
  };

  const startPoll = async () => {
    const cleanedOptions = draftOptions
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean);
    if (!draftQuestion.trim() || cleanedOptions.length < 2) return;

    const newPoll: Poll = {
      active: true,
      showResults: false,
      question: draftQuestion.trim(),
      options: cleanedOptions,
      votes: {},
    };
    await fbSet(ref(db, `rooms/${roomId}/poll`), newPoll);
  };

  const closePoll = async () => {
    await update(ref(db, `rooms/${roomId}/poll`), { active: false, showResults: true });
  };

  const toggleShareResults = async () => {
    await update(ref(db, `rooms/${roomId}/poll`), { showResults: !poll.showResults });
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
    const myVote = poll.votes?.[participantId];
    const hasVoted = typeof myVote === 'number';
    const totalVotes = Object.keys(poll.votes || {}).length;
    const isMeWinner = latestWinner && latestWinner.id === participantId;
    const canSeePollResults = poll.showResults || hasVoted;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-950">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300">
              Room: {roomId}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              {connected ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Live</span>
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
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
              {dbError}
            </div>
          )}

          {/* LIVE WINNER BANNER ON PARTICIPANT PHONE */}
          {latestWinner && (
            <div
              className={`p-4 rounded-2xl border text-center space-y-1 transition-all ${
                isMeWinner
                  ? 'bg-gradient-to-br from-amber-500/20 via-indigo-500/20 to-emerald-500/20 border-amber-400 shadow-lg shadow-amber-500/10'
                  : 'bg-slate-950 border-amber-500/40'
              }`}
            >
              <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-300">
                <Award className="w-4 h-4" />
                {isMeWinner ? '🎉 Congratulations! You Won!' : 'Latest Draw Winner'}
              </div>
              <p className="text-xl font-extrabold text-white">{latestWinner.name}</p>
              {latestWinner.handle && (
                <p className="text-xs text-indigo-300">{latestWinner.handle}</p>
              )}
            </div>
          )}

          {!joined ? (
            <form onSubmit={handleParticipantSubmit} className="space-y-4">
              <h1 className="text-2xl font-bold text-white">Join the Meetup Draw</h1>
              <p className="text-sm text-slate-400">
                Enter your details below to enter the raffle and vote in live polls.
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
                className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-white transition"
              >
                Enter Raffle
              </button>
            </form>
          ) : (
            <div className="space-y-5">
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3">
                <CheckCircle2 className="text-emerald-400 shrink-0 w-5 h-5" />
                <div>
                  <p className="font-semibold text-sm text-emerald-200">
                    Registered: {nameInput}
                  </p>
                  <p className="text-xs text-emerald-300/80">
                    Results update automatically on this screen.
                  </p>
                </div>
              </div>

              {/* POLL VOTING & LIVE RESULTS ON PHONE */}
              {(poll.active || poll.showResults) && poll.options.length > 0 ? (
                <div className="space-y-3 pt-3 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                      {poll.active ? 'Live Poll' : 'Poll Results'}
                    </span>
                    <span className="text-xs text-slate-400">{totalVotes} votes</span>
                  </div>
                  <h2 className="text-lg font-bold text-white">{poll.question}</h2>

                  <div className="space-y-2.5">
                    {poll.options.map((opt, idx) => {
                      const count = Object.values(poll.votes || {}).filter((v) => v === idx).length;
                      const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
                      const isSelected = myVote === idx;

                      return (
                        <button
                          key={idx}
                          disabled={!poll.active}
                          onClick={() => handleCastVote(idx)}
                          className={`w-full text-left p-3.5 rounded-xl border transition relative overflow-hidden ${
                            isSelected
                              ? 'border-indigo-400 bg-indigo-950/50 text-white'
                              : 'border-slate-800 bg-slate-950 text-slate-200 hover:border-slate-700'
                          } ${!poll.active ? 'cursor-default' : ''}`}
                        >
                          {canSeePollResults && (
                            <div
                              className="absolute inset-y-0 left-0 bg-indigo-500/20 transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          )}
                          <div className="relative flex items-center justify-between gap-2">
                            <span className="font-medium text-sm">
                              {opt} {isSelected && '✓'}
                            </span>
                            {canSeePollResults && (
                              <span className="text-xs font-semibold text-indigo-300 shrink-0">
                                {count} ({pct}%)
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                !latestWinner && (
                  <p className="text-center text-sm text-slate-500 py-3">
                    Waiting for host to launch a poll or start the draw...
                  </p>
                )
              )}

              <button
                onClick={() => setJoined(false)}
                className="w-full text-xs text-slate-500 hover:text-slate-300 pt-1"
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
  const totalVotes = Object.keys(poll.votes || {}).length;

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
            <div className="text-xs text-slate-400 break-all bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              {joinUrl}
            </div>
            <div className="flex justify-center gap-4 text-xs text-slate-400 pt-1">
              <span className="flex items-center gap-1">
                <Users className="w-4 h-4 text-indigo-400" /> {participants.length} Registered
              </span>
              <span className="flex items-center gap-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    connected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                  }`}
                />
                {connected ? 'Firebase Synced' : 'Offline Cache'}
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
                    onClick={handleExportParticipants}
                    title="Export Participants & Winners to CSV"
                    className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                  >
                    <Download className="w-3.5 h-3.5" /> CSV
                  </button>
                )}
                <button
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
              ) : latestWinner ? (
                <div className="space-y-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-sm font-semibold">
                    <Sparkles className="w-4 h-4" /> Winner Broadcasted to Phones!
                  </span>
                  <h1 className="text-4xl md:text-6xl font-extrabold text-white">
                    {latestWinner.name}
                  </h1>
                  {latestWinner.handle && (
                    <p className="text-xl text-indigo-300">{latestWinner.handle}</p>
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
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={startPoll}
                    className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm text-white"
                  >
                    {poll.active ? 'Update & Reset Votes' : 'Push Poll to Phones'}
                  </button>
                  {(poll.active || poll.showResults) && (
                    <button
                      type="button"
                      onClick={toggleShareResults}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sm text-indigo-300"
                    >
                      {poll.showResults ? 'Hide Live Tallies Before Voting' : 'Broadcast Results to All Phones'}
                    </button>
                  )}
                  {poll.active && (
                    <button
                      type="button"
                      onClick={closePoll}
                      className="px-4 py-2.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-sm text-emerald-300"
                    >
                      Close Poll & Show Final Results
                    </button>
                  )}
                </div>
              </div>

              {(poll.active || poll.showResults) && (
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
                      const count = Object.values(poll.votes || {}).filter((v) => v === idx).length;
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
