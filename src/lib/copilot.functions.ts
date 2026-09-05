import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

function apiKey() {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  return key;
}

function extFor(mime: string) {
  const base = mime.split(";")[0];
  const map: Record<string, string> = {
    "audio/webm": "webm",
    "video/webm": "webm",
    "audio/mp4": "mp4",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/ogg": "ogg",
  };
  return map[base] ?? "webm";
}

/** Transcribe one self-contained audio segment. */
export const transcribeSegment = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        audioBase64: z.string().min(100),
        mimeType: z.string().default("audio/webm"),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append("model", "openai/gpt-4o-mini-transcribe");
    form.append("language", "pt");
    form.append(
      "file",
      new Blob([bytes], { type: data.mimeType.split(";")[0] }),
      `segment.${extFor(data.mimeType)}`,
    );

    const res = await fetch(`${GATEWAY}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}` },
      body: form,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`transcription_${res.status}: ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as { text?: string };
    return { text: (json.text ?? "").trim() };
  });

async function gemini(system: string, user: string, schemaHint: string) {
  const res = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3.7-flash",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${system}\n\nResponda SOMENTE com JSON válido no formato:\n${schemaHint}` },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ai_${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? (JSON.parse(match[0]) as Record<string, unknown>) : {};
  }
}

const turnSchema = z.array(
  z.object({ speaker: z.enum(["vendedor", "cliente"]), text: z.string() }),
);

const SYSTEM_LIVE = `Você é um copiloto sênior de vendas consultivas B2B em português do Brasil, ouvindo uma reunião ao vivo.
Sua função: manter o vendedor no controle da conversa. Você identifica dados do lead, dores, objeções e o estágio do funil,
e devolve respostas curtas, prontas para serem faladas em voz alta — nunca teoria, nunca parágrafos longos.
Regras: máximo 2 bullets por card, cada bullet com no máximo 18 palavras, tom consultivo e direto.
Só crie cards realmente úteis para o momento atual da conversa. Se nada novo aconteceu, devolva listas vazias.`;

const LIVE_SCHEMA = `{
  "leadName": string | null,
  "company": string | null,
  "stage": "abertura" | "descoberta" | "diagnostico" | "proposta" | "objecao" | "fechamento",
  "temperature": "frio" | "morno" | "quente",
  "nextMove": string,
  "facts": [{ "label": string, "value": string }],
  "objections": [{ "category": "Preço"|"Técnico"|"Prazo"|"Concorrência"|"Confiança"|"Autoridade"|"Necessidade", "quote": string }],
  "cards": [{ "title": string, "category": string, "urgency": "alta"|"media"|"baixa", "bullets": [string] }],
  "coach": string | null
}`;

export const analyzeConversation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        turns: turnSchema,
        context: z.string().max(4000).optional(),
        talkRatio: z.number().min(0).max(1).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const transcript = data.turns
      .slice(-70)
      .map((t) => `${t.speaker === "vendedor" ? "VENDEDOR" : "CLIENTE"}: ${t.text}`)
      .join("\n");

    const user = [
      data.context ? `Contexto do meu produto/oferta:\n${data.context}` : "",
      data.talkRatio !== undefined
        ? `Proporção de fala do vendedor até agora: ${Math.round(data.talkRatio * 100)}%.`
        : "",
      `Transcrição parcial da reunião:\n${transcript}`,
      `Devolva os cards de resposta apenas para o que o CLIENTE disse mais recentemente. Em "coach", escreva uma instrução de 1 frase (ex: "Você está falando demais — devolva com uma pergunta") ou null.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    return (await gemini(SYSTEM_LIVE, user, LIVE_SCHEMA)) as {
      leadName?: string | null;
      company?: string | null;
      stage?: string;
      temperature?: string;
      nextMove?: string;
      facts?: { label: string; value: string }[];
      objections?: { category: string; quote: string }[];
      cards?: { title: string; category: string; urgency: string; bullets: string[] }[];
      coach?: string | null;
    };
  });

const REPORT_SCHEMA = `{
  "summary": string,
  "score": number,
  "leadName": string | null,
  "objections": [{ "category": string, "quote": string, "handled": boolean, "betterAnswer": string }],
  "signals": [string],
  "risks": [string],
  "nextSteps": [string],
  "followUpEmail": string
}`;

export const buildReport = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        turns: turnSchema,
        context: z.string().max(4000).optional(),
        talkRatio: z.number().min(0).max(1),
        durationSec: z.number(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const transcript = data.turns
      .map((t) => `${t.speaker === "vendedor" ? "VENDEDOR" : "CLIENTE"}: ${t.text}`)
      .join("\n");

    const user = `${data.context ? `Oferta: ${data.context}\n\n` : ""}Duração: ${Math.round(
      data.durationSec / 60,
    )} min. Vendedor falou ${Math.round(data.talkRatio * 100)}% do tempo.

Transcrição completa:
${transcript}

Avalie a call com rigor de gestor comercial. "score" é de 0 a 100. "followUpEmail" é um e-mail curto de follow-up em português pronto para enviar.`;

    return (await gemini(
      "Você é um gestor comercial sênior analisando a gravação de uma reunião de vendas em português do Brasil. Seja específico e direto, sem elogios vazios.",
      user,
      REPORT_SCHEMA,
    )) as {
      summary?: string;
      score?: number;
      leadName?: string | null;
      objections?: { category: string; quote: string; handled: boolean; betterAnswer: string }[];
      signals?: string[];
      risks?: string[];
      nextSteps?: string[];
      followUpEmail?: string;
    };
  });
