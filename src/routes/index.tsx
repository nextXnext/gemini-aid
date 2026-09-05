import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Download,
  Gauge,
  Mic,
  MonitorSpeaker,
  Radio,
  Sparkles,
  Square,
  Target,
  Trash2,
  UserRound,
} from "lucide-react";
import { useCopilot, type Card as CardType } from "@/lib/useCopilot";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SalesCopilot — Copiloto de vendas ao vivo em chamadas" },
      {
        name: "description",
        content:
          "Copiloto de IA que escuta sua reunião, transcreve em tempo real, detecta objeções e sugere a resposta certa antes de você travar.",
      },
      { property: "og:title", content: "SalesCopilot — Copiloto de vendas ao vivo" },
      {
        property: "og:description",
        content:
          "Transcrição ao vivo, cards de resposta para objeções, medidor de fala e relatório de fechamento em cada call.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Copilot,
});

const stageOrder = ["abertura", "descoberta", "diagnostico", "proposta", "objecao", "fechamento"];
const stageLabel: Record<string, string> = {
  abertura: "Abertura",
  descoberta: "Descoberta",
  diagnostico: "Diagnóstico",
  proposta: "Proposta",
  objecao: "Objeção",
  fechamento: "Fechamento",
};

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, "0");
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function Copilot() {
  const c = useCopilot();
  const [compact, setCompact] = useState(false);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [c.turns.length]);

  const openCards = useMemo(() => c.cards.filter((x) => !x.done), [c.cards]);
  const tooTalkative = c.talkRatio > 0.68 && c.turns.length > 4;

  if (!c.live && !c.report && c.turns.length === 0) {
    return <Setup c={c} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-4 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-block size-2.5 rounded-full ${c.live ? "bg-destructive animate-pulse-dot" : "bg-muted-foreground/40"}`}
            />
            <span className="font-display text-sm font-semibold tracking-tight">
              {c.live ? "Ao vivo" : "Chamada encerrada"}
            </span>
            <span className="font-mono text-sm text-muted-foreground">{fmt(c.elapsed)}</span>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserRound className="size-4" />
            <span className="text-foreground">{c.insight.leadName ?? "Identificando lead…"}</span>
            {c.insight.company ? <span>· {c.insight.company}</span> : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setCompact((v) => !v)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {compact ? "Painel completo" : "Modo discreto"}
            </button>
            {c.live ? (
              <button
                onClick={() => void c.stop()}
                className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-1.5 text-sm font-semibold text-destructive-foreground transition-opacity hover:opacity-90"
              >
                <Square className="size-3.5" /> Encerrar
              </button>
            ) : (
              <button
                onClick={c.reset}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Trash2 className="size-3.5" /> Nova call
              </button>
            )}
          </div>
        </div>
        {c.error ? (
          <div className="border-t border-border bg-signal/15 px-5 py-2 text-xs text-signal-foreground">
            {c.error}
          </div>
        ) : null}
      </header>

      <main
        className={`mx-auto grid max-w-[1500px] gap-5 px-5 py-5 ${compact ? "" : "lg:grid-cols-[minmax(0,1fr)_360px]"}`}
      >
        <div className="grid gap-5">
          {(tooTalkative || c.insight.coach) && (
            <div className="animate-card-in flex items-start gap-3 rounded-xl border border-signal/40 bg-signal/12 px-4 py-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-signal-foreground" />
              <p className="text-sm text-signal-foreground">
                {c.insight.coach ??
                  "Você está dominando a conversa. Faça uma pergunta aberta e devolva a palavra ao cliente."}
              </p>
            </div>
          )}

          <section className="grid gap-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="size-4" /> Respostas sugeridas
              </h2>
              <span className="text-xs text-muted-foreground">{openCards.length} abertos</span>
            </div>
            {openCards.length === 0 ? (
              <p className="panel px-4 py-6 text-sm text-muted-foreground">
                Assim que o cliente levantar uma objeção ou uma dúvida, a resposta aparece aqui.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {openCards.map((card) => (
                  <AnswerCard key={card.id} card={card} onDone={() => c.dismissCard(card.id)} />
                ))}
              </div>
            )}
          </section>

          {!compact && (
            <section className="panel flex max-h-[46vh] flex-col overflow-hidden">
              <div className="hairline flex items-center gap-2 px-4 py-3">
                <Radio className="size-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Transcrição ao vivo</h2>
              </div>
              <div className="grid gap-3 overflow-y-auto px-4 py-4">
                {c.turns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Ouvindo a chamada…</p>
                ) : (
                  c.turns.map((t) => (
                    <div key={t.id} className="grid gap-1">
                      <span
                        className={`text-[11px] font-semibold uppercase tracking-wider ${t.speaker === "vendedor" ? "text-primary" : "text-positive-foreground"}`}
                      >
                        {t.speaker === "vendedor" ? "Você" : "Cliente"}
                      </span>
                      <p className="text-sm leading-relaxed text-foreground/90">{t.text}</p>
                    </div>
                  ))
                )}
                <div ref={transcriptEnd} />
              </div>
            </section>
          )}

          {c.buildingReport ? (
            <div className="panel px-4 py-6 text-sm text-muted-foreground">
              Montando o relatório da chamada…
            </div>
          ) : null}
          {c.report ? <ReportPanel report={c.report} turns={c.turns} /> : null}
        </div>

        {!compact && (
          <aside className="grid content-start gap-5">
            <div className="panel grid gap-4 px-4 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Target className="size-4 text-primary" /> Condução
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {stageOrder.map((s) => (
                  <span
                    key={s}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                      s === c.insight.stage
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {stageLabel[s]}
                  </span>
                ))}
              </div>
              <div className="rounded-lg bg-accent px-3 py-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-accent-foreground">
                  Próximo movimento
                </span>
                <p className="mt-1 text-sm text-foreground">{c.insight.nextMove}</p>
              </div>
              <div className="grid gap-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Gauge className="size-3.5" /> Você fala
                  </span>
                  <span
                    className={`font-mono ${tooTalkative ? "text-destructive" : "text-foreground"}`}
                  >
                    {Math.round(c.talkRatio * 100)}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full transition-all duration-500 ${tooTalkative ? "bg-destructive" : "bg-primary"}`}
                    style={{ width: `${Math.round(c.talkRatio * 100)}%` }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Ideal em descoberta: você abaixo de 45%.
                </p>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Temperatura do lead</span>
                <span className="font-medium capitalize">{c.insight.temperature}</span>
              </div>
            </div>

            <div className="panel grid gap-3 px-4 py-4">
              <h2 className="text-sm font-semibold">Ficha do lead</h2>
              {c.insight.facts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nome, negócio, dores e contexto aparecem aqui conforme o cliente fala.
                </p>
              ) : (
                <dl className="grid gap-2">
                  {c.insight.facts.map((f) => (
                    <div key={f.label} className="grid gap-0.5 border-b border-border pb-2 last:border-0">
                      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {f.label}
                      </dt>
                      <dd className="text-sm">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            <div className="panel grid gap-3 px-4 py-4">
              <h2 className="text-sm font-semibold">Objeções detectadas</h2>
              {c.insight.objections.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma até agora.</p>
              ) : (
                c.insight.objections.map((o) => (
                  <div key={o.quote} className="grid gap-1">
                    <span className="w-fit rounded-md bg-signal/20 px-2 py-0.5 text-[11px] font-semibold text-signal-foreground">
                      {o.category}
                    </span>
                    <p className="text-xs italic text-muted-foreground">“{o.quote}”</p>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}

function AnswerCard({ card, onDone }: { card: CardType; onDone: () => void }) {
  const urgent = card.urgency === "alta";
  return (
    <article
      className={`animate-card-in grid gap-2 rounded-xl border bg-surface px-4 py-3 shadow-card ${
        urgent ? "border-signal/60" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <span
            className={`w-fit rounded-md px-2 py-0.5 text-[11px] font-semibold ${
              urgent ? "bg-signal/20 text-signal-foreground" : "bg-accent text-accent-foreground"
            }`}
          >
            {card.category}
          </span>
          <h3 className="text-sm font-semibold leading-snug">{card.title}</h3>
        </div>
        <button
          onClick={onDone}
          aria-label="Marcar como usado"
          className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent"
        >
          <Check className="size-3.5" />
        </button>
      </div>
      <ul className="grid gap-1.5">
        {card.bullets.map((b, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed">
            <ArrowRight className="mt-1 size-3.5 shrink-0 text-primary" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function ReportPanel({
  report,
  turns,
}: {
  report: NonNullable<ReturnType<typeof useCopilot>["report"]>;
  turns: ReturnType<typeof useCopilot>["turns"];
}) {
  const markdown = useMemo(() => {
    const lines = [
      `# Relatório da chamada${report.leadName ? ` — ${report.leadName}` : ""}`,
      "",
      `**Nota da call:** ${report.score ?? "-"}/100`,
      "",
      "## Resumo",
      report.summary ?? "-",
      "",
      "## Objeções",
      ...(report.objections ?? []).map(
        (o) =>
          `- **${o.category}** — “${o.quote}” ${o.handled ? "(tratada)" : "(não tratada)"}\n  - Melhor resposta: ${o.betterAnswer}`,
      ),
      "",
      "## Sinais de compra",
      ...(report.signals ?? []).map((s) => `- ${s}`),
      "",
      "## Riscos",
      ...(report.risks ?? []).map((s) => `- ${s}`),
      "",
      "## Próximos passos",
      ...(report.nextSteps ?? []).map((s) => `- ${s}`),
      "",
      "## E-mail de follow-up",
      report.followUpEmail ?? "-",
      "",
      "## Transcrição",
      ...turns.map((t) => `**${t.speaker === "vendedor" ? "Você" : "Cliente"}:** ${t.text}`),
    ];
    return lines.join("\n");
  }, [report, turns]);

  const download = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "relatorio-call.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel grid gap-5 px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Relatório de fechamento</h2>
        <div className="flex gap-2">
          <button
            onClick={() => void navigator.clipboard.writeText(markdown)}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            <Copy className="size-3.5" /> Copiar
          </button>
          <button
            onClick={download}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Download className="size-3.5" /> Baixar
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="grid size-16 place-items-center rounded-xl bg-primary text-primary-foreground">
          <span className="font-display text-xl font-bold">{report.score ?? "–"}</span>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-foreground/90">{report.summary}</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <ReportList title="Objeções">
          {(report.objections ?? []).map((o) => (
            <li key={o.quote} className="grid gap-1 border-b border-border pb-3 last:border-0">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-signal/20 px-2 py-0.5 text-[11px] font-semibold text-signal-foreground">
                  {o.category}
                </span>
                <span
                  className={`text-[11px] font-medium ${o.handled ? "text-positive-foreground" : "text-destructive"}`}
                >
                  {o.handled ? "tratada" : "não tratada"}
                </span>
              </div>
              <p className="text-xs italic text-muted-foreground">“{o.quote}”</p>
              <p className="text-sm">{o.betterAnswer}</p>
            </li>
          ))}
        </ReportList>
        <div className="grid gap-5">
          <ReportList title="Sinais de compra">
            {(report.signals ?? []).map((s) => (
              <li key={s} className="text-sm">
                {s}
              </li>
            ))}
          </ReportList>
          <ReportList title="Riscos">
            {(report.risks ?? []).map((s) => (
              <li key={s} className="text-sm">
                {s}
              </li>
            ))}
          </ReportList>
          <ReportList title="Próximos passos">
            {(report.nextSteps ?? []).map((s) => (
              <li key={s} className="text-sm">
                {s}
              </li>
            ))}
          </ReportList>
        </div>
      </div>

      {report.followUpEmail ? (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">E-mail de follow-up</h3>
          <pre className="whitespace-pre-wrap rounded-lg bg-muted px-4 py-3 font-sans text-sm leading-relaxed">
            {report.followUpEmail}
          </pre>
        </div>
      ) : null}
    </section>
  );
}

function ReportList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <ul className="grid gap-2">{children}</ul>
    </div>
  );
}

function Setup({ c }: { c: ReturnType<typeof useCopilot> }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid max-w-3xl gap-8 px-5 py-16">
        <header className="grid gap-3">
          <span className="w-fit rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground">
            Copiloto de vendas em tempo real
          </span>
          <h1 className="text-4xl font-bold leading-tight">
            Nunca mais trave numa objeção no meio da call.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
            Ele escuta você e o cliente, transcreve tudo, monta a ficha do lead e entrega a resposta
            pronta no segundo em que a objeção aparece — mais o relatório de fechamento no fim.
          </p>
        </header>

        <div className="panel grid gap-5 px-6 py-6">
          <div className="grid gap-2">
            <label htmlFor="ctx" className="text-sm font-semibold">
              Sobre o que você vende
            </label>
            <p className="text-xs text-muted-foreground">
              Quanto mais específico, melhores as respostas: oferta, preço, prazo, diferenciais e as
              objeções que você mais ouve.
            </p>
            <textarea
              id="ctx"
              value={c.context}
              onChange={(e) => c.setContext(e.target.value)}
              rows={6}
              placeholder="Ex: Vendo gestão de tráfego pago para clínicas. Ticket R$ 3.500/mês, contrato de 6 meses. Diferencial: time dedicado e relatório semanal. Objeções comuns: 'já tentei agência e não deu certo', 'está caro', 'não tenho Instagram'."
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-relaxed outline-none transition-shadow focus:ring-2 focus:ring-ring/40"
            />
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-4 py-3">
            <input
              type="checkbox"
              checked={c.listenClient}
              onChange={(e) => c.setListenClient(e.target.checked)}
              className="mt-1 size-4 accent-primary"
            />
            <span className="grid gap-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                <MonitorSpeaker className="size-4" /> Escutar também o áudio do cliente
              </span>
              <span className="text-xs text-muted-foreground">
                Ao iniciar, escolha a aba do Google Meet e marque{" "}
                <strong>“Compartilhar áudio da guia”</strong>. Sem isso, ele só ouve o seu
                microfone.
              </span>
            </span>
          </label>

          <button
            onClick={() => void c.start()}
            disabled={c.starting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Mic className="size-4" />
            {c.starting ? "Preparando…" : "Iniciar copiloto"}
          </button>

          {c.error ? <p className="text-sm text-destructive">{c.error}</p> : null}
        </div>

        <div className="grid gap-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Para ficar fora da tela compartilhada</p>
          <p>
            No Meet, compartilhe apenas <strong>a janela do Meet</strong> ou{" "}
            <strong>a guia do navegador</strong> — nunca “tela inteira”. Deixe este painel numa
            segunda janela ao lado; ele não aparece para o cliente. Invisibilidade mesmo com a tela
            inteira compartilhada só é possível em um aplicativo instalado no computador.
          </p>
        </div>
      </div>
    </div>
  );
}
