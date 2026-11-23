import React, { useState, useEffect, useRef } from 'react';
import { joinRoom } from 'trystero/nostr';
import { get, set } from 'idb-keyval';
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
} from 'lucide-react';

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

const APP_ID = 'meetup-local-first-draw-v3';
const NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
];

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
  const [poll, setPoll] = useState<Poll>({
    active: false,
    question: 'Which topic should we cover next meetup?',
    options: ['AI & Local LLMs', 'WebAssembly & Rust', 'System Design', 'DevOps & Cloud'],
    votes: {},
  });
  const [activeTab, setActiveTab] = useState<'raffle' | 'poll'>('raffle');
  const [isDrawing, setIsDrawing] = useState(false);
  const [highlightedName, setHighlightedName] = useState<string | null>(null);
  const [currentWinner, setCurrentWinner] = useState<Participant | null>(null);
  const [peerCount, setPeerCount] = useState(0);

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
  const [hostPoll, setHostPoll] = useState<Poll | null>(null);
  const [myVote, setMyVote] = useState<number | null>(null);
  const [connectedToHost, setConnectedToHost] = useState(false);

  const sendJoinRef = useRef<any>(null);
  const sendVoteRef = useRef<any>(null);
  const broadcastStateRef = useRef<any>(null);
  const pollRef = useRef<Poll>(poll);
  pollRef.current = poll;

  useEffect(() => {
    if (isParticipant) return;
    get('meetup_participants').then((data) => {
      if (data) setParticipants(data);
    });
    get('meetup_poll').then((data) => {
      if (data) {
        setPoll(data);
        setDraftQuestion(data.question);
        setDraftOptions(data.options.join('\n'));
      }
    });
  }, [isParticipant]);

  useEffect(() => {
    if (isParticipant) return;
    set('meetup_participants', participants);
  }, [participants, isParticipant]);

  useEffect(() => {
    if (isParticipant) return;
    set('meetup_poll', poll);
    if (broadcastStateRef.current) {
      broadcastStateRef.current({ poll });
    }
  }, [poll, isParticipant]);

  useEffect(() => {
    const room = joinRoom({ appId: APP_ID, relayUrls: NOSTR_RELAYS }, roomId);
    const [sendJoin, getJoin] = room.makeAction('join');
    const [sendVote, getVote] = room.makeAction('vote');
    const [broadcastState, getState] = room.makeAction('state');

    sendJoinRef.current = sendJoin;
    sendVoteRef.current = sendVote;
    broadcastStateRef.current = broadcastState;

    room.onPeerJoin((peerId) => {
      setPeerCount((c) => c + 1);
      if (isParticipant) {
        setConnectedToHost(true);
        const savedName = localStorage.getItem('p_name');
        const savedHandle = localStorage.getItem('p_handle');
        if (savedName) {
          sendJoin({ id: participantId, name: savedName, handle: savedHandle || '' }, peerId);
        }
      } else {
        broadcastState({ poll: pollRef.current }, peerId);
      }
    });

    room.onPeerLeave(() => {
      setPeerCount((c) => Math.max(0, c - 1));
    });

    if (!isParticipant) {
      getJoin((data: any) => {
        setParticipants((prev) => {
          const exists = prev.find((p) => p.id === data.id);
          if (exists) {
            return prev.map((p) =>
              p.id === data.id ? { ...p, name: data.name, handle: data.handle } : p
            );
          }
          return [
            ...prev,
            {
              id: data.id,
              name: data.name,
              handle: data.handle,
              hasWon: false,
              joinedAt: Date.now(),
            },
          ];
        });
      });

      getVote((data: any) => {
        setPoll((prev) => ({
          ...prev,
          votes: { ...prev.votes, [data.participantId]: data.optionIndex },
        }));
      });
    } else {
      getState((data: any) => {
        setConnectedToHost(true);
        if (data.poll) setHostPoll(data.poll);
      });
    }

    return () => {
      room.leave();
    };
  }, [roomId, isParticipant, participantId]);

  const handleParticipantSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    localStorage.setItem('p_name', nameInput.trim());
    localStorage.setItem('p_handle', handleInput.trim());
    sendJoinRef.current?.({
      id: participantId,
      name: nameInput.trim(),
      handle: handleInput.trim(),
    });
    setJoined(true);
  };

  const handleCastVote = (index: number) => {
    setMyVote(index);
    sendVoteRef.current?.({ participantId, optionIndex: index });
  };

  const eligibleParticipants = participants.filter((p) => !p.hasWon);
  const pastWinners = participants.filter((p) => p.hasWon);

  const runDraw = () => {
    if (eligibleParticipants.length === 0 || isDrawing) return;
    setIsDrawing(true);
    setCurrentWinner(null);

    let ticks = 0;
    const totalTicks = 28;
    const interval = setInterval(() => {
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

        setParticipants((prev) =>
          prev.map((p) => (p.id === winner.id ? { ...p, hasWon: true } : p))
        );

        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      }
    }, 80);
  };

  const resetWinners = () => {
    setParticipants((prev) => prev.map((p) => ({ ...p, hasWon: false })));
    setCurrentWinner(null);
  };

  const clearAllData = () => {
    if (!window.confirm('Clear all participants, winners, and votes?')) return;
    setParticipants([]);
    setCurrentWinner(null);
    setPoll((prev) => ({ ...prev, votes: {} }));
    set('meetup_participants', []);
  };

  const startPoll = () => {
    const cleanedOptions = draftOptions
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean);
    if (!draftQuestion.trim() || cleanedOptions.length < 2) return;

    setPoll({
      active: true,
      question: draftQuestion.trim(),
      options: cleanedOptions,
      votes: {},
    });
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

  if (isParticipant) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-950">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <span className="text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300">
              Room: {roomId}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <span
                className={`w-2 h-2 rounded-full ${
                  connectedToHost || peerCount > 0 ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                }`}
              />
              {connectedToHost || peerCount > 0 ? 'Connected to Stage' : 'Connecting P2P...'}
            </span>
          </div>

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
                className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-white transition"
              >
                Enter Raffle
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

              {hostPoll?.active ? (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
                    Live Poll
                  </span>
                  <h2 className="text-lg font-bold text-white">{hostPoll.question}</h2>
                  <div className="space-y-2">
                    {hostPoll.options.map((opt, idx) => (
                      <button
                        key={idx}
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

  const joinUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  const totalVotes = Object.keys(poll.votes).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
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
                <span className="w-2 h-2 rounded-full bg-emerald-400" /> {peerCount} Live Peers
              </span>
            </div>
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

        <div className="lg:col-span-8 space-y-6">
          <div className="flex gap-3 bg-slate-900 p-1.5 rounded-xl border border-slate-800 w-fit">
            <button
              type="button"
              onClick={() => setActiveTab('raffle')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition cursor-pointer ${
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
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition cursor-pointer ${
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
                      onClick={() => setPoll((p) => ({ ...p, active: false }))}
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
