"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import {
  Brain,
  Check,
  Clock3,
  Flame,
  HelpCircle,
  LoaderCircle,
  RefreshCw,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { collection, doc, getDocs, orderBy, query, serverTimestamp, setDoc } from "firebase/firestore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SignOutButton } from "@/app/components/signout-button";
import { getFirebaseDb } from "@/app/lib/firebase-client";

type Answer = "yes" | "no" | "unknown";
type PersonaMode = "steady" | "focused" | "cocky" | "panicked";
type Phase = "question" | "reveal" | "result" | "timeout";
type Verdict = "won" | "lost";
type SessionStatus = "active" | "revealing" | "won" | "lost";
type UserStats = {
  matchesPlayed: number;
  wins: number;
  winStreak: number;
  averageAccuracy: number;
};

type GameScreenProps = {
  user: {
    uid: string;
    email?: string;
    name?: string;
  };
};

type Turn = {
  question: string;
  answer: Answer;
  persona: string;
  guess: string;
  mode: PersonaMode;
  confidence: number;
  createdAt: string;
};

type AiTurnResponse = {
  question: string;
  persona: string;
  guess: string;
  mode: PersonaMode;
  confidence: number;
  finished: boolean;
  source?: "gemini" | "fallback";
};

const TOTAL_QUESTIONS = 15;
const START_TIME_SECONDS = 75;
const REVEAL_SOUND_URL = new URL("../assets/apper.mp3", import.meta.url).toString();
const WIN_SOUND_URL = new URL("../assets/win.mp3", import.meta.url).toString();
const LOST_SOUND_URL = new URL("../assets/lost.mp3", import.meta.url).toString();

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatSessionTime(startSeconds: number, currentSeconds: number): string {
  const elapsedSeconds = startSeconds - currentSeconds;
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function CricketBatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path
        d="M7.5 3.5 12 8l-6.5 6.5-2-2L7.5 3.5Zm5.2 5.2 7.8 7.8-2.1 2.1-7.8-7.8 2.1-2.1ZM4.8 13.2l6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StumpsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none">
      <path
        d="M6 7v11M12 7v11M18 7v11M4 7h16M6 18h12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function getMoodStyles(mode: PersonaMode) {
  switch (mode) {
    case "cocky":
      return {
        label: "COCKY",
        chip:
          "border-amber-300/50 bg-amber-950/40 text-amber-100 shadow-[0_0_20px_rgba(255,186,8,0.35)]",
        persona: "text-amber-100/90",
      };
    case "panicked":
      return {
        label: "PANICKED",
        chip:
          "border-rose-300/50 bg-rose-950/40 text-rose-100 shadow-[0_0_20px_rgba(255,0,85,0.45)]",
        persona: "text-rose-100/90",
      };
    case "focused":
      return {
        label: "FOCUSED",
        chip:
          "border-cyan-300/50 bg-cyan-950/35 text-cyan-100 shadow-[0_0_20px_rgba(0,217,255,0.3)]",
        persona: "text-cyan-100/90",
      };
    default:
      return {
        label: "STEADY",
        chip:
          "border-white/20 bg-white/10 text-white shadow-[0_0_18px_rgba(255,255,255,0.12)]",
        persona: "text-white/80",
      };
  }
}

function getMoodFromState(questionCount: number, streak: number, timeLeft: number): PersonaMode {
  if (timeLeft <= 20) {
    return "panicked";
  }

  if (questionCount >= 11 || streak >= 6) {
    return "cocky";
  }

  if (questionCount >= 4) {
    return "focused";
  }

  return "steady";
}

function localFallbackQuestion(turnCount: number, streak: number, timeLeft: number): AiTurnResponse {
  const mode = getMoodFromState(turnCount, streak, timeLeft);
  const personaByMood: Record<PersonaMode, string> = {
    steady: "I am mapping the field quietly.",
    focused: "The pattern is sharpening now.",
    cocky: "This is getting embarrassingly close.",
    panicked: "Hold on, the clock is bullying me.",
  };

  const questions = [
    "Is your player primarily a top-order batter?",
    "Does your player bowl pace rather than spin?",
    "Is your player a wicketkeeper-batter?",
    "Has your player captained an IPL side?",
    "Is your player an overseas cricketer?",
    "Is your player known for finishing innings?",
    "Does your player usually bat in the top four?",
    "Is your player more famous for batting than bowling?",
    "Is your player left-handed with the bat?",
    "Has your player won multiple IPL titles?",
  ];

  return {
    question: questions[turnCount % questions.length],
    persona: personaByMood[mode],
    guess: mode === "panicked" ? "I am not fully certain yet." : "I am narrowing it down fast.",
    mode,
    confidence: Math.min(18 + turnCount * 6 + streak * 4, 96),
    finished: false,
    source: "fallback",
  };
}

function localFallbackReveal(turnCount: number, streak: number, timeLeft: number): AiTurnResponse {
  const mode = getMoodFromState(turnCount, streak, timeLeft);
  const personaByMood: Record<PersonaMode, string> = {
    steady: "I have one last read on the board.",
    focused: "The final shape is locking in.",
    cocky: "I think I have nailed it.",
    panicked: "One last guess before the buzzer steals the moment.",
  };

  return {
    question: "Is the answer correct?",
    persona: personaByMood[mode],
    guess:
      mode === "panicked"
        ? "I am leaning toward MS Dhoni, but I am not fully certain."
        : "I think your player is MS Dhoni.",
    mode,
    confidence: Math.min(45 + turnCount * 4 + streak * 3, 98),
    finished: true,
    source: "fallback",
  };
}

export function GameScreen({ user }: GameScreenProps) {
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [timeLeft, setTimeLeft] = useState(START_TIME_SECONDS);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeQuestion, setActiveQuestion] = useState<string>("Loading the first clue...");
  const [aiPersona, setAiPersona] = useState<string>("The game is warming up...");
  const [aiGuess, setAiGuess] = useState<string>("Waiting for the first read...");
  const [aiMode, setAiMode] = useState<PersonaMode>("steady");
  const [aiConfidence, setAiConfidence] = useState(0);
  const [phase, setPhase] = useState<Phase>("question");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [revealPrompt, setRevealPrompt] = useState("Is the answer correct?");
  const [isLoadingQuestion, setIsLoadingQuestion] = useState(true);
  const [isLoadingReveal, setIsLoadingReveal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [userStats, setUserStats] = useState<UserStats>({
    matchesPlayed: 0,
    wins: 0,
    winStreak: 0,
    averageAccuracy: 0,
  });
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  const audioContextRef = useRef<AudioContext | null>(null);
  const bgAudioRef = useRef<HTMLAudioElement | null>(null);
  const revealAudioRef = useRef<HTMLAudioElement | null>(null);
  const winAudioRef = useRef<HTMLAudioElement | null>(null);
  const lostAudioRef = useRef<HTMLAudioElement | null>(null);
  const phaseRef = useRef<Phase>("question");
  const timeoutHandledRef = useRef(false);

  const moodStyles = useMemo(() => getMoodStyles(aiMode), [aiMode]);
  const answeredCount = turns.length;
  const remainingQuestions = Math.max(TOTAL_QUESTIONS - answeredCount, 0);
  const progress = Array.from({ length: TOTAL_QUESTIONS }, (_, index) => index < answeredCount);
  const timerUrgent = timeLeft <= 20;
  const isQuestionPhase = phase === "question";
  const isRevealPhase = phase === "reveal";

  const persistSession = useCallback(
    async (
      nextTurns: Turn[],
      nextQuestion: AiTurnResponse,
      nextStreak: number,
      nextSessionId: string,
      status: SessionStatus,
      sessionPhase: Phase,
      currentVerdict: Verdict | null = verdict,
      currentTimeLeft: number = timeLeft,
    ) => {
      try {
        const db = getFirebaseDb();
        const sessionFields: Record<string, unknown> = {
          uid: user.uid,
          email: user.email ?? null,
          name: user.name ?? null,
          sessionId: nextSessionId,
          status,
          phase: sessionPhase,
          verdict: currentVerdict,
          updatedAt: serverTimestamp(),
          turns: nextTurns,
          currentQuestion: nextQuestion.question,
          aiPersona: nextQuestion.persona,
          aiGuess: nextQuestion.guess,
          aiMode: nextQuestion.mode,
          aiConfidence: nextQuestion.confidence,
          gameState: {
            questionCount: nextTurns.length,
            streak: nextStreak,
            timeLeft: currentTimeLeft,
            phase: sessionPhase,
            verdict: currentVerdict,
            finished: status === "won" || status === "lost",
          },
        };

        if (nextTurns.length === 0) {
          Object.assign(sessionFields, { startedAt: serverTimestamp() });
        }

        await setDoc(doc(db, "users", user.uid, "gameSessions", nextSessionId), sessionFields, { merge: true });
      } catch (error) {
        console.error("Failed to persist game session", error);
      }
    },
    [timeLeft, user.email, user.name, user.uid, verdict],
  );

  const loadUserStats = useCallback(async () => {
    try {
      setIsLoadingStats(true);
      const db = getFirebaseDb();
      const snapshot = await getDocs(
        query(collection(db, "users", user.uid, "gameSessions"), orderBy("updatedAt", "desc")),
      );

      const completedSessions = snapshot.docs
        .map((item) => item.data() as { status?: SessionStatus })
        .filter((session) => session.status === "won" || session.status === "lost");

      const matchesPlayed = completedSessions.length;
      const wins = completedSessions.filter((session) => session.status === "won").length;
      const averageAccuracy = matchesPlayed > 0 ? Math.round((wins / matchesPlayed) * 100) : 0;

      let winStreak = 0;
      for (const session of completedSessions) {
        if (session.status === "won") {
          winStreak += 1;
        } else {
          break;
        }
      }

      setUserStats({
        matchesPlayed,
        wins,
        winStreak,
        averageAccuracy,
      });
    } catch (error) {
      console.error("Failed to load user stats", error);
      setUserStats({
        matchesPlayed: 0,
        wins: 0,
        winStreak: 0,
        averageAccuracy: 0,
      });
    } finally {
      setIsLoadingStats(false);
    }
  }, [user.uid]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUserStats();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadUserStats]);

  useEffect(() => {
    const audio = new Audio("/bg.mp3");
    audio.loop = true;
    audio.volume = 0.12;
    audio.preload = "auto";
    bgAudioRef.current = audio;

    const startBackgroundMusic = () => {
      void audio.play().catch(() => {});
    };

    startBackgroundMusic();
    window.addEventListener("pointerdown", startBackgroundMusic, { once: true });
    window.addEventListener("keydown", startBackgroundMusic, { once: true });

    return () => {
      audio.pause();
      audio.src = "";
      bgAudioRef.current = null;
      revealAudioRef.current = null;
      winAudioRef.current = null;
      lostAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimeLeft((current) => {
        if (phaseRef.current !== "question" || current <= 0) {
          return current;
        }

        if (current <= 1) {
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (timeLeft !== 0 || timeoutHandledRef.current) {
      return;
    }

    if (phaseRef.current !== "question") {
      return;
    }

    timeoutHandledRef.current = true;
    setIsLoadingQuestion(false);
    setIsLoadingReveal(false);
    setVerdict("lost");
    playOutcomeSound("lost");
    setPhase("timeout");
    setErrorMessage(null);

    void persistSession(
      turns,
      {
        question: activeQuestion,
        persona: aiPersona,
        guess: aiGuess,
        mode: aiMode,
        confidence: aiConfidence,
        finished: true,
      },
      streak,
      sessionId,
      "lost",
      "timeout",
      "lost",
      0,
    );
    void loadUserStats();
  }, [
    activeQuestion,
    aiConfidence,
    aiGuess,
    aiMode,
    aiPersona,
    loadUserStats,
    persistSession,
    phaseRef,
    sessionId,
    streak,
    timeLeft,
    turns,
  ]);

  function getAudioContext() {
    if (typeof window === "undefined") {
      return null;
    }

    const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextConstructor) {
      return null;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor();
    }

    return audioContextRef.current;
  }

  function playSound(kind: "yes" | "no" | "maybe" | "reveal") {
    if (kind === "reveal") {
      if (!revealAudioRef.current) {
        const audio = new Audio(REVEAL_SOUND_URL);
        audio.preload = "auto";
        audio.volume = 0.55;
        revealAudioRef.current = audio;
      }

      const audio = revealAudioRef.current;
      audio.currentTime = 0;
      void audio.play().catch(() => {});
      return;
    }

    const context = getAudioContext();

    if (!context) {
      return;
    }

    if (context.state === "suspended") {
      void context.resume().catch(() => {});
    }

    const now = context.currentTime + 0.02;
    const notes =
      kind === "yes"
        ? [
            { frequency: 660, offset: 0, duration: 0.14, wave: "triangle", gain: 0.12 },
            { frequency: 880, offset: 0.08, duration: 0.16, wave: "triangle", gain: 0.1 },
          ]
        : kind === "no"
          ? [
              { frequency: 260, offset: 0, duration: 0.16, wave: "sawtooth", gain: 0.11 },
              { frequency: 190, offset: 0.1, duration: 0.2, wave: "sine", gain: 0.09 },
            ]
          : kind === "maybe"
            ? [
                { frequency: 520, offset: 0, duration: 0.08, wave: "square", gain: 0.08 },
                { frequency: 740, offset: 0.09, duration: 0.08, wave: "square", gain: 0.08 },
                { frequency: 620, offset: 0.18, duration: 0.1, wave: "triangle", gain: 0.08 },
              ]
            : [
                { frequency: 392, offset: 0, duration: 0.12, wave: "sine", gain: 0.09 },
                { frequency: 523.25, offset: 0.08, duration: 0.14, wave: "triangle", gain: 0.11 },
                { frequency: 659.25, offset: 0.16, duration: 0.16, wave: "triangle", gain: 0.12 },
                { frequency: 783.99, offset: 0.28, duration: 0.22, wave: "sine", gain: 0.13 },
              ];

    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();

      oscillator.type = note.wave as OscillatorType;
      oscillator.frequency.setValueAtTime(note.frequency, now + note.offset);
      gainNode.gain.setValueAtTime(0.0001, now + note.offset);
      gainNode.gain.exponentialRampToValueAtTime(note.gain, now + note.offset + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + note.offset + note.duration);

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);

      oscillator.start(now + note.offset);
      oscillator.stop(now + note.offset + note.duration + 0.05);
    }
  }

  function playOutcomeSound(outcome: Verdict) {
    const audioRef = outcome === "won" ? winAudioRef : lostAudioRef;
    const audioUrl = outcome === "won" ? WIN_SOUND_URL : LOST_SOUND_URL;

    if (!audioRef.current) {
      const audio = new Audio(audioUrl);
      audio.preload = "auto";
      audio.volume = 0.72;
      audioRef.current = audio;
    }

    const audio = audioRef.current;
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }

  async function requestQuestion(
    nextTurns: Turn[],
    nextStreak: number,
    nextSessionId: string,
    currentTimeLeft: number = timeLeft,
  ) {
    setIsLoadingQuestion(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/game/next-question", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: nextSessionId,
          turns: nextTurns,
          state: {
            questionCount: nextTurns.length,
            streak: nextStreak,
            timeLeft: currentTimeLeft,
            isInitial: nextTurns.length === 0,
          },
        }),
      });

      const payload = (await response.json()) as AiTurnResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Gemini request failed.");
      }

      setActiveQuestion(payload.question);
      setAiPersona(payload.persona);
      setAiGuess(payload.guess);
      setAiMode(payload.mode);
      setAiConfidence(Math.round(payload.confidence));
      setPhase("question");

      await persistSession(
        nextTurns,
        payload,
        nextStreak,
        nextSessionId,
        "active",
        "question",
        verdict,
        currentTimeLeft,
      );
      return payload;
    } catch (error) {
      console.error("Question generation failed", error);
      const fallback = localFallbackQuestion(nextTurns.length, nextStreak, timeLeft);
      setActiveQuestion(fallback.question);
      setAiPersona(fallback.persona);
      setAiGuess(fallback.guess);
      setAiMode(fallback.mode);
      setAiConfidence(Math.round(fallback.confidence));
      setErrorMessage("Using fallback question flow while Gemini is unavailable.");
      setPhase("question");
      await persistSession(
        nextTurns,
        fallback,
        nextStreak,
        nextSessionId,
        "active",
        "question",
        verdict,
        currentTimeLeft,
      );
      return fallback;
    } finally {
      setIsLoadingQuestion(false);
    }
  }

  async function requestReveal(
    nextTurns: Turn[],
    nextStreak: number,
    nextSessionId: string,
    currentTimeLeft: number = timeLeft,
  ) {
    setIsLoadingReveal(true);
    setErrorMessage(null);
    playSound("reveal");

    try {
      const response = await fetch("/api/game/next-question", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: nextSessionId,
          reveal: true,
          turns: nextTurns,
          state: {
            questionCount: nextTurns.length,
            streak: nextStreak,
            timeLeft: currentTimeLeft,
            isInitial: false,
          },
        }),
      });

      const payload = (await response.json()) as AiTurnResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Reveal request failed.");
      }

      setRevealPrompt(payload.question || "Is the answer correct?");
      setAiPersona(payload.persona);
      setAiGuess(payload.guess);
      setAiMode(payload.mode);
      setAiConfidence(Math.round(payload.confidence));
      setPhase("reveal");

      await persistSession(
        nextTurns,
        payload,
        nextStreak,
        nextSessionId,
        "revealing",
        "reveal",
        verdict,
        currentTimeLeft,
      );
      return payload;
    } catch (error) {
      console.error("Reveal generation failed", error);
      const fallback = localFallbackReveal(nextTurns.length, nextStreak, timeLeft);
      setRevealPrompt(fallback.question);
      setAiPersona(fallback.persona);
      setAiGuess(fallback.guess);
      setAiMode(fallback.mode);
      setAiConfidence(Math.round(fallback.confidence));
      setPhase("reveal");
      setErrorMessage("Using fallback reveal while Gemini is unavailable.");
      await persistSession(
        nextTurns,
        fallback,
        nextStreak,
        nextSessionId,
        "revealing",
        "reveal",
        verdict,
        currentTimeLeft,
      );
      return fallback;
    } finally {
      setIsLoadingReveal(false);
    }
  }

  async function initializeRound(nextSessionId = sessionId, currentTimeLeft = START_TIME_SECONDS) {
    await requestQuestion([], 0, nextSessionId, currentTimeLeft);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void initializeRound();
    }, 0);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAnswer(answer: Answer) {
    if (!isQuestionPhase || isLoadingQuestion || isLoadingReveal) {
      return;
    }

    playSound(answer === "yes" ? "yes" : answer === "no" ? "no" : "maybe");

    const nextStreak = answer === "unknown" ? Math.max(streak - 1, 0) : streak + 1;
    const completedTurn: Turn = {
      question: activeQuestion,
      answer,
      persona: aiPersona,
      guess: aiGuess,
      mode: aiMode,
      confidence: aiConfidence,
      createdAt: new Date().toISOString(),
    };
    const nextTurns = [...turns, completedTurn];

    setTurns(nextTurns);
    setStreak(nextStreak);

    if (nextTurns.length >= TOTAL_QUESTIONS) {
      await requestReveal(nextTurns, nextStreak, sessionId, timeLeft);
      return;
    }

    await requestQuestion(nextTurns, nextStreak, sessionId, timeLeft);
  }

  async function handleVerdict(isCorrect: boolean) {
    if (!isRevealPhase || isLoadingReveal) {
      return;
    }

    const nextVerdict: Verdict = isCorrect ? "won" : "lost";
    playOutcomeSound(nextVerdict);
    setVerdict(nextVerdict);
    setPhase("result");

    await persistSession(
      turns,
      {
        question: revealPrompt,
        persona: aiPersona,
        guess: aiGuess,
        mode: aiMode,
          confidence: aiConfidence,
          finished: true,
        },
        streak,
      sessionId,
      nextVerdict,
      "result",
      nextVerdict,
    );
    void loadUserStats();
  }

  function restartGame() {
    const nextSessionId = crypto.randomUUID();
    timeoutHandledRef.current = false;
    setSessionId(nextSessionId);
    setTimeLeft(START_TIME_SECONDS);
    setTurns([]);
    setActiveQuestion("Loading the first clue...");
    setAiPersona("The game is warming up...");
    setAiGuess("Waiting for the first read...");
    setAiMode("steady");
    setAiConfidence(0);
    setPhase("question");
    setVerdict(null);
    setRevealPrompt("Is the answer correct?");
    setErrorMessage(null);
    setStreak(0);
    setIsLoadingQuestion(true);
    setIsLoadingReveal(false);
    void initializeRound(nextSessionId, START_TIME_SECONDS);
  }

  const sessionTimeLabel = formatSessionTime(START_TIME_SECONDS, timeLeft);
  const winCopy = "You won. The AI read the board perfectly.";
  const lossCopy = "You lost. The final guess missed the target.";
  const timeoutCopy = "Time is up. The round is over, but you can retry and go again.";
  const resultTone =
    phase === "timeout"
      ? "border-amber-300/50 bg-amber-950/40 text-amber-100 shadow-[0_0_24px_rgba(255,186,8,0.25)]"
      : verdict === "won"
      ? "border-emerald-300/50 bg-emerald-950/40 text-emerald-100 shadow-[0_0_24px_rgba(0,255,136,0.25)]"
      : "border-rose-300/50 bg-rose-950/40 text-rose-100 shadow-[0_0_24px_rgba(255,0,85,0.25)]";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0a0a] px-4 py-6 text-white sm:px-6 sm:py-8 lg:px-8">
      <Image
        src="https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?w=1920"
        alt="Cricket stadium under floodlights"
        fill
        priority
        className="object-cover"
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,217,255,0.2),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(157,78,221,0.2),transparent_45%),linear-gradient(to_bottom,rgba(0,0,0,0.55),rgba(0,0,0,0.78))]" />

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-4xl flex-col">
        <div className="flex justify-end pb-4">
          <SignOutButton className="rounded-full border border-white/25 bg-black/35 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white transition hover:bg-black/55 disabled:cursor-not-allowed disabled:opacity-70" />
        </div>

        <motion.header
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 rounded-full border border-white/15 bg-white/5 px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-lg sm:px-6"
        >
          <div>
            <p className="font-heading text-lg font-bold">IPL MindReader</p>
            <p className="text-sm text-white/65">{remainingQuestions} Questions left</p>
          </div>

          <motion.div
            animate={{ scale: [1, 1.03, 1] }}
            transition={{ repeat: Number.POSITIVE_INFINITY, duration: 2, ease: "easeInOut" }}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 font-mono text-lg font-bold ${
              timerUrgent
                ? "border-rose-300/60 bg-rose-950/45 text-rose-100 shadow-[0_0_20px_rgba(255,0,85,0.52),0_0_42px_rgba(255,0,85,0.3)]"
                : "border-purple-300/55 bg-purple-950/45 text-white shadow-[0_0_20px_rgba(157,78,221,0.56),0_0_42px_rgba(255,0,85,0.2)]"
            }`}
          >
            <Clock3 className="h-5 w-5" />
            <span>{formatClock(timeLeft)}</span>
          </motion.div>

          <div className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold uppercase tracking-widest ${moodStyles.chip}`}>
            <Flame className="h-4 w-4 text-orange-300" />
            <span>{moodStyles.label}</span>
          </div>
        </motion.header>

        <section className="my-auto space-y-7 pb-44 pt-8 sm:pb-36 lg:pb-28">
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.45, ease: "easeOut" }}
            className="relative rounded-2xl border border-white/20 bg-white/10 px-6 pb-8 pt-10 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-md sm:px-8"
          >
            <div className="absolute -top-8 left-1/2 flex -translate-x-1/2 flex-col items-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 shadow-[0_0_20px_rgba(0,217,255,0.55)]">
                <Brain className="h-6 w-6 text-white" />
              </div>
              <p className="mt-2 text-xs font-medium uppercase tracking-widest text-white/60">AI&apos;S QUESTION</p>
            </div>

            <div className="space-y-4">
              <h1 className="text-center font-heading text-3xl font-bold leading-tight text-white md:text-4xl">
                {isQuestionPhase
                  ? isLoadingQuestion
                    ? "Gemini is plotting the next elimination clue..."
                    : activeQuestion
                  : revealPrompt}
              </h1>

              <div className="flex flex-wrap items-center justify-center gap-2 text-xs uppercase tracking-[0.25em] text-white/45">
                <span>
                  Question {Math.min(answeredCount + 1, TOTAL_QUESTIONS)} of {TOTAL_QUESTIONS}
                </span>
                <span className="hidden h-1 w-1 rounded-full bg-white/25 sm:inline-flex" />
                <span>Confidence {Math.round(aiConfidence)}%</span>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
              {progress.map((isFilled, index) => (
                <div
                  key={index}
                  className={`h-2 w-8 rounded-sm ${isFilled ? "bg-white/80" : "border border-white/35 bg-transparent"}`}
                />
              ))}
            </div>

            {errorMessage ? (
              <p className="mt-6 rounded-xl border border-amber-300/20 bg-amber-950/30 px-4 py-3 text-center text-sm text-amber-100/80">
                {errorMessage}
              </p>
            ) : null}
          </motion.div>

          {isQuestionPhase ? (
            <>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.45, ease: "easeOut" }}
                className="flex flex-col items-stretch justify-center gap-4 md:flex-row"
              >
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={isLoadingQuestion || isLoadingReveal}
                  onClick={() => void handleAnswer("yes")}
                  className="inline-flex flex-1 items-center justify-center gap-3 rounded-xl border-2 border-emerald-500 bg-emerald-950/90 px-6 py-4 text-sm font-bold uppercase tracking-wider text-white shadow-[0_0_20px_rgba(0,255,136,0.5),0_0_40px_rgba(0,255,136,0.2)] transition-all duration-300 hover:shadow-[0_0_26px_rgba(0,255,136,0.65),0_0_48px_rgba(0,255,136,0.3)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Check className="h-5 w-5" />
                  <span>YES</span>
                  <CricketBatIcon className="h-5 w-5" />
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={isLoadingQuestion || isLoadingReveal}
                  onClick={() => void handleAnswer("no")}
                  className="inline-flex flex-1 items-center justify-center gap-3 rounded-xl border-2 border-rose-500 bg-rose-950/90 px-6 py-4 text-sm font-bold uppercase tracking-wider text-white shadow-[0_0_20px_rgba(255,0,85,0.5),0_0_40px_rgba(255,0,85,0.2)] transition-all duration-300 hover:shadow-[0_0_26px_rgba(255,0,85,0.65),0_0_48px_rgba(255,0,85,0.3)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X className="h-5 w-5" />
                  <span>NO</span>
                  <StumpsIcon className="h-5 w-5" />
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={isLoadingQuestion || isLoadingReveal}
                  onClick={() => void handleAnswer("unknown")}
                  className="inline-flex flex-1 items-center justify-center gap-3 rounded-xl border-2 border-purple-500 bg-purple-950/90 px-6 py-4 text-sm font-bold uppercase tracking-wider text-white shadow-[0_0_20px_rgba(157,78,221,0.5),0_0_40px_rgba(157,78,221,0.2)] transition-all duration-300 hover:shadow-[0_0_26px_rgba(157,78,221,0.65),0_0_48px_rgba(157,78,221,0.3)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <HelpCircle className="h-5 w-5" />
                  <span>I DON&apos;T KNOW</span>
                </motion.button>
              </motion.div>

            </>
          ) : isRevealPhase ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.45, ease: "easeOut" }}
              className="space-y-5 rounded-2xl border border-amber-300/20 bg-amber-950/20 px-6 py-6 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-md"
            >
              <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-100/60">
                  Final Reveal
                </p>
                <h2 className="mt-3 font-heading text-3xl font-bold text-white md:text-4xl">
                  {revealPrompt}
                </h2>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 px-5 py-5 text-center">
                <p className="text-xs uppercase tracking-[0.25em] text-white/40">AI&apos;s guess</p>
                <p className="mt-3 text-2xl font-bold text-white md:text-3xl">{aiGuess}</p>
                <p className={`mt-3 text-sm italic ${moodStyles.persona}`}>{aiPersona}</p>
              </div>

              <div className="flex flex-col items-stretch gap-4 md:flex-row">
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => void handleVerdict(true)}
                  className="inline-flex flex-1 items-center justify-center gap-3 rounded-xl border-2 border-emerald-500 bg-emerald-950/90 px-6 py-4 text-sm font-bold uppercase tracking-wider text-white shadow-[0_0_20px_rgba(0,255,136,0.5),0_0_40px_rgba(0,255,136,0.2)] transition-all duration-300 hover:shadow-[0_0_26px_rgba(0,255,136,0.65),0_0_48px_rgba(0,255,136,0.3)]"
                >
                  <Check className="h-5 w-5" />
                  <span>YES</span>
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => void handleVerdict(false)}
                  className="inline-flex flex-1 items-center justify-center gap-3 rounded-xl border-2 border-rose-500 bg-rose-950/90 px-6 py-4 text-sm font-bold uppercase tracking-wider text-white shadow-[0_0_20px_rgba(255,0,85,0.5),0_0_40px_rgba(255,0,85,0.2)] transition-all duration-300 hover:shadow-[0_0_26px_rgba(255,0,85,0.65),0_0_48px_rgba(255,0,85,0.3)]"
                >
                  <X className="h-5 w-5" />
                  <span>NO</span>
                </motion.button>
              </div>
            </motion.div>
          ) : phase === "timeout" ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.45, ease: "easeOut" }}
              className={`space-y-5 rounded-2xl border px-6 py-6 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-md ${resultTone}`}
            >
              <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">Time Limit Reached</p>
                <h2 className="mt-3 font-heading text-3xl font-bold md:text-4xl">Time&apos;s Up</h2>
                <p className="mt-3 text-base text-white/85">{timeoutCopy}</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 px-5 py-5 text-center">
                <p className="text-xs uppercase tracking-[0.25em] text-white/45">Final AI guess</p>
                <p className="mt-3 text-2xl font-bold text-white md:text-3xl">{aiGuess}</p>
              </div>

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={restartGame}
                  className="inline-flex items-center justify-center gap-3 rounded-full border border-white/20 bg-white/10 px-6 py-4 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-white/15"
                >
                  <RefreshCw className="h-5 w-5" />
                  <span>Retry</span>
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.45, ease: "easeOut" }}
              className={`space-y-5 rounded-2xl border px-6 py-6 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-md ${resultTone}`}
            >
              <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">Round Result</p>
                <h2 className="mt-3 font-heading text-3xl font-bold md:text-4xl">
                  {verdict === "won" ? "You Won" : "You Lost"}
                </h2>
                <p className="mt-3 text-base text-white/85">
                  {verdict === "won" ? winCopy : lossCopy}
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 px-5 py-5 text-center">
                <p className="text-xs uppercase tracking-[0.25em] text-white/45">Final AI guess</p>
                <p className="mt-3 text-2xl font-bold text-white md:text-3xl">{aiGuess}</p>
              </div>

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={restartGame}
                  className="inline-flex items-center justify-center gap-3 rounded-full border border-white/20 bg-white/10 px-6 py-4 text-sm font-bold uppercase tracking-wider text-white transition hover:bg-white/15"
                >
                  <RefreshCw className="h-5 w-5" />
                  <span>Restart</span>
                </button>
              </div>
            </motion.div>
          )}

          <motion.footer
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.45, ease: "easeOut" }}
            className="flex flex-col items-center gap-4"
          >
            <div className="inline-flex items-center gap-2 rounded-full bg-[#ff6b35] px-4 py-2 text-sm font-bold text-white shadow-[0_0_16px_rgba(255,107,53,0.45)]">
              <Clock3 className="h-4 w-4" />
              <span className="font-mono">SESSION TIME: {sessionTimeLabel}</span>
            </div>

            {isQuestionPhase ? (
              <>
                <p className={`text-center text-sm italic ${moodStyles.persona}`}>{aiPersona}</p>
                <p className="text-center text-sm text-white/55">{aiGuess}</p>
              </>
            ) : isRevealPhase ? (
              <p className={`text-center text-sm italic ${moodStyles.persona}`}>{aiPersona}</p>
            ) : (
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.25em] text-white/70">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                <span>{verdict === "won" ? "Victory secured." : "The chase ends here."}</span>
              </div>
            )}
          </motion.footer>
        </section>
      </div>

      <motion.aside
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 0.45, ease: "easeOut" }}
        className="fixed bottom-4 left-1/2 z-20 w-[calc(100vw-2rem)] max-w-4xl -translate-x-1/2 rounded-3xl border border-white/15 bg-white/5 px-3 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-lg sm:px-4"
      >
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 text-xs font-bold text-white shadow-[0_0_18px_rgba(0,255,136,0.28)]">
              <Trophy className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">Win Streak</p>
              <p className="text-sm font-bold text-white">{isLoadingStats ? "--" : userStats.winStreak}</p>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 text-xs font-bold text-white shadow-[0_0_18px_rgba(0,217,255,0.28)]">
              <Users className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
                Matches Played
              </p>
              <p className="text-sm font-bold text-white">{isLoadingStats ? "--" : userStats.matchesPlayed}</p>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-400 to-purple-600 text-xs font-bold text-white shadow-[0_0_18px_rgba(157,78,221,0.28)]">
              <span className="text-[11px] font-black leading-none">%</span>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/45">
                Avg Accuracy
              </p>
              <p className="text-sm font-bold text-white">
                {isLoadingStats ? "--" : `${userStats.averageAccuracy}%`}
              </p>
            </div>
          </div>
        </div>
      </motion.aside>
    </main>
  );
}
