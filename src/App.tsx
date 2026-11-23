import React, { useState, useEffect, useRef } from 'react';
import { joinRoom } from 'trystero/torrent';
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

const APP_ID = 'meetup-local-first-draw-v1';

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
    const room = joinRoom({ appId: APP_ID }, roomId);
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
        broadcastState({ poll }, peerId);
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
