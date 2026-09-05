import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { analyzeConversation, buildReport, transcribeSegment } from "./copilot.functions";

export type Speaker = "vendedor" | "cliente";

export type Turn = {
  id: string;
  speaker: Speaker;
  text: string;
  at: number;
};

export type Card = {
  id: string;
  title: string;
  category: string;
  urgency: string;
  bullets: string[];
  at: number;
  done?: boolean;
};

export type Insight = {
  leadName: string | null;
  company: string | null;
  stage: string;
  temperature: string;
  nextMove: string;
  facts: { label: string; value: string }[];
  objections: { category: string; quote: string }[];
  coach: string | null;
};

export type Report = Awaited<ReturnType<typeof buildReport>>;

const SEGMENT_MS = 6000;

function pickMime() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

async function blobToBase64(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const emptyInsight: Insight = {
  leadName: null,
  company: null,
  stage: "abertura",
  temperature: "morno",
  nextMove: "Abra com rapport curto e vá para a pergunta de diagnóstico.",
  facts: [],
  objections: [],
  coach: null,
};

export function useCopilot() {
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [insight, setInsight] = useState<Insight>(emptyInsight);
  const [report, setReport] = useState<Report | null>(null);
  const [buildingReport, setBuildingReport] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [context, setContext] = useState("");
  const [listenClient, setListenClient] = useState(true);

  const streamsRef = useRef<MediaStream[]>([]);
  const stopFlag = useRef(false);
  const turnsRef = useRef<Turn[]>([]);
  const contextRef = useRef("");
  const analyzing = useRef(false);
  const pendingAnalysis = useRef(false);

  const transcribe = useServerFn(transcribeSegment);
  const analyze = useServerFn(analyzeConversation);
  const report_ = useServerFn(buildReport);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [live]);

  const words = (s: Speaker) =>
    turns.filter((t) => t.speaker === s).reduce((n, t) => n + t.text.split(/\s+/).length, 0);
  const sellerWords = words("vendedor");
  const clientWords = words("cliente");
  const talkRatio = sellerWords + clientWords === 0 ? 0.5 : sellerWords / (sellerWords + clientWords);

  const runAnalysis = useCallback(async () => {
    if (analyzing.current) {
      pendingAnalysis.current = true;
      return;
    }
    analyzing.current = true;
    try {
      const list = turnsRef.current;
      const sw = list
        .filter((t) => t.speaker === "vendedor")
        .reduce((n, t) => n + t.text.split(/\s+/).length, 0);
      const cw = list
        .filter((t) => t.speaker === "cliente")
        .reduce((n, t) => n + t.text.split(/\s+/).length, 0);
      const result = await analyze({
        data: {
          turns: list.slice(-70).map((t) => ({ speaker: t.speaker, text: t.text })),
          context: contextRef.current || undefined,
          talkRatio: sw + cw === 0 ? 0.5 : sw / (sw + cw),
        },
      });

      setInsight((prev) => ({
        leadName: result.leadName ?? prev.leadName,
        company: result.company ?? prev.company,
        stage: result.stage ?? prev.stage,
        temperature: result.temperature ?? prev.temperature,
        nextMove: result.nextMove ?? prev.nextMove,
        facts: result.facts?.length ? dedupeFacts([...prev.facts, ...result.facts]) : prev.facts,
        objections: result.objections?.length
          ? dedupeObjections([...prev.objections, ...result.objections])
          : prev.objections,
        coach: result.coach ?? null,
      }));

      if (result.cards?.length) {
        setCards((prev) => {
          const known = new Set(prev.map((c) => c.title.toLowerCase()));
          const fresh = result
            .cards!.filter((c) => c.title && !known.has(c.title.toLowerCase()))
            .map((c) => ({
              id: crypto.randomUUID(),
              title: c.title,
              category: c.category ?? "Condução",
              urgency: c.urgency ?? "media",
              bullets: (c.bullets ?? []).slice(0, 3),
              at: Date.now(),
            }));
          return [...fresh, ...prev].slice(0, 40);
        });
      }
    } catch (e) {
      setError(readableError(e));
    } finally {
      analyzing.current = false;
      if (pendingAnalysis.current) {
        pendingAnalysis.current = false;
        void runAnalysis();
      }
    }
  }, [analyze]);

  const pushTurn = useCallback(
    (speaker: Speaker, text: string) => {
      const turn: Turn = { id: crypto.randomUUID(), speaker, text, at: Date.now() };
      turnsRef.current = [...turnsRef.current, turn];
      setTurns(turnsRef.current);
      void runAnalysis();
    },
    [runAnalysis],
  );

  const recordLoop = useCallback(
    (stream: MediaStream, speaker: Speaker) => {
      const mime = pickMime();
      const step = () => {
        if (stopFlag.current || !stream.active) return;
        let recorder: MediaRecorder;
        try {
          recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        } catch {
          return;
        }
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = async () => {
          step();
          const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
          if (blob.size < 6000) return;
          try {
            const audioBase64 = await blobToBase64(blob);
            const { text } = await transcribe({
              data: { audioBase64, mimeType: blob.type || "audio/webm" },
            });
            const clean = text.trim();
            if (clean.length > 2 && !/^[.\s]*$/.test(clean)) pushTurn(speaker, clean);
          } catch (e) {
            setError(readableError(e));
          }
        };
        recorder.start();
        setTimeout(() => {
          if (recorder.state === "recording") recorder.stop();
        }, SEGMENT_MS);
      };
      step();
    },
    [pushTurn, transcribe],
  );

  const start = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamsRef.current = [mic];
      stopFlag.current = false;

      if (listenClient) {
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        display.getVideoTracks().forEach((t) => t.stop());
        const audioTracks = display.getAudioTracks();
        if (audioTracks.length === 0) {
          setError(
            "Você compartilhou sem o áudio da aba. Pare e comece de novo marcando 'Compartilhar áudio da guia'.",
          );
        } else {
          const clientStream = new MediaStream(audioTracks);
          streamsRef.current.push(display);
          recordLoop(clientStream, "cliente");
        }
      }

      recordLoop(mic, "vendedor");
      setLive(true);
      setElapsed(0);
      setReport(null);
    } catch (e) {
      setError(readableError(e));
      stopFlag.current = true;
      streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      streamsRef.current = [];
    } finally {
      setStarting(false);
    }
  }, [listenClient, recordLoop]);

  const stop = useCallback(async () => {
    stopFlag.current = true;
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    setLive(false);
    if (turnsRef.current.length === 0) return;
    setBuildingReport(true);
    try {
      const list = turnsRef.current;
      const sw = list
        .filter((t) => t.speaker === "vendedor")
        .reduce((n, t) => n + t.text.split(/\s+/).length, 0);
      const cw = list
        .filter((t) => t.speaker === "cliente")
        .reduce((n, t) => n + t.text.split(/\s+/).length, 0);
      const r = await report_({
        data: {
          turns: list.map((t) => ({ speaker: t.speaker, text: t.text })),
          context: contextRef.current || undefined,
          talkRatio: sw + cw === 0 ? 0.5 : sw / (sw + cw),
          durationSec: elapsed,
        },
      });
      setReport(r);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBuildingReport(false);
    }
  }, [elapsed, report_]);

  const dismissCard = useCallback((id: string) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, done: true } : c)));
  }, []);

  const reset = useCallback(() => {
    turnsRef.current = [];
    setTurns([]);
    setCards([]);
    setInsight(emptyInsight);
    setReport(null);
    setElapsed(0);
    setError(null);
  }, []);

  useEffect(
    () => () => {
      stopFlag.current = true;
      streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    },
    [],
  );

  return {
    live,
    starting,
    error,
    setError,
    turns,
    cards,
    insight,
    report,
    buildingReport,
    elapsed,
    talkRatio,
    context,
    setContext,
    listenClient,
    setListenClient,
    start,
    stop,
    dismissCard,
    reset,
  };
}

function dedupeFacts(list: { label: string; value: string }[]) {
  const map = new Map<string, { label: string; value: string }>();
  list.forEach((f) => map.set(f.label.toLowerCase(), f));
  return [...map.values()].slice(0, 14);
}

function dedupeObjections(list: { category: string; quote: string }[]) {
  const map = new Map<string, { category: string; quote: string }>();
  list.forEach((o) => map.set(o.quote.toLowerCase().slice(0, 60), o));
  return [...map.values()].slice(0, 20);
}

function readableError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("NotAllowedError") || msg.includes("Permission denied"))
    return "Permissão de áudio negada. Libere o microfone e o compartilhamento para continuar.";
  if (msg.includes("_402")) return "Créditos de IA esgotados nesta conta.";
  if (msg.includes("_429")) return "Muitas chamadas em sequência. Aguarde alguns segundos.";
  return msg.slice(0, 200);
}
