"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { armarSerieGrafico, type RangoGrafico } from "@/lib/laboratorio/bots/grafico";
import type { BotPanel, CorridaPanel } from "@/lib/laboratorio/bots/panelBots";
import { CHART_CHROME, PALETTE_CATEGORICA } from "@/lib/palette";
import type { PanelEnVivo } from "@/lib/laboratorio/panelData";

const usd = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD" });
const numero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

function conSigno(valor: number | null, sufijo = "%") {
  if (valor === null) return "—";
  return `${valor > 0 ? "+" : valor < 0 ? "−" : ""}${numero.format(Math.abs(valor))}${sufijo}`;
}

function colorVariacion(valor: number | null) {
  if (valor === null || valor === 0) return "text-muted";
  return valor > 0 ? "text-positive" : "text-danger";
}

function hora(ts: string) {
  return new Date(ts).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const COLORES = { A: PALETTE_CATEGORICA[0], B: PALETTE_CATEGORICA[1], C: PALETTE_CATEGORICA[2], VOO: CHART_CHROME.axis } as const;
const RANGOS: Array<{ id: RangoGrafico; etiqueta: string }> = [
  { id: "hoy", etiqueta: "Hoy" },
  { id: "semana", etiqueta: "Semana" },
  { id: "mes", etiqueta: "Mes" },
  { id: "todo", etiqueta: "Todo" },
];
const tooltipStyle = { background: "#111b2b", border: "1px solid #314158", borderRadius: 8, color: CHART_CHROME.texto, fontSize: 13 };

// --- Tabla de posiciones ---

function TablaPosiciones({ comparacion }: { comparacion: PanelEnVivo["comparacion"] }) {
  const voo = comparacion.tabla.find((fila) => fila.clave === "VOO")?.metricas;
  if (comparacion.tabla.length === 0) {
    return <p className="text-sm text-muted">Todavía no hay cierres: la tabla aparece después del primer cierre de la rueda (a las 19:10 de Argentina).</p>;
  }
  return (
    <div className="card divide-y divide-border-soft">
      {comparacion.tabla.map((fila, indice) => {
        const m = fila.metricas;
        const contraVoo = fila.clave === "VOO" || !voo ? null : Math.round((m.rendimientoNetoPct - voo.rendimientoBrutoPct) * 100) / 100;
        return (
          <div key={fila.clave} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{indice + 1}. {fila.nombre}</p>
                <p className="text-xs text-muted tabular-nums">
                  Bruto {conSigno(m.rendimientoBrutoPct)} · IA {usd.format(m.costoIaUsd)} · caída máx. {numero.format(m.drawdownMaxPct)}%
                  {m.volatilidadAnualPct !== null && ` · volatilidad ${numero.format(m.volatilidadAnualPct)}%`}
                </p>
                {fila.clave !== "VOO" && (
                  <p className="text-xs text-muted tabular-nums">
                    {m.operaciones} {m.operaciones === 1 ? "operación" : "operaciones"}
                    {m.pctGanadoras !== null && ` · ${numero.format(m.pctGanadoras)}% ganando hoy`}
                    {contraVoo !== null && <> · contra VOO <span className={colorVariacion(contraVoo)}>{conSigno(contraVoo, " pts")}</span></>}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="font-medium tabular-nums">{usd.format(m.valorUsd)}</p>
                <p className={`text-xs tabular-nums ${colorVariacion(m.rendimientoNetoPct)}`}>{conSigno(m.rendimientoNetoPct)} neto de IA</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Gráfico ---

function GraficoBots({ grafico }: { grafico: PanelEnVivo["grafico"] }) {
  const [rango, setRango] = useState<RangoGrafico>("todo");
  const datos = useMemo(() => armarSerieGrafico({ snapshots: grafico.snapshots, botsPorId: grafico.botsPorId, rango, ahora: new Date() }), [grafico, rango]);
  return (
    <div className="card p-4">
      <div className="mb-3 flex gap-1">
        {RANGOS.map((opcion) => (
          <button key={opcion.id} onClick={() => setRango(opcion.id)} className={`pressable rounded-lg px-3 py-1 text-xs ${rango === opcion.id ? "bg-accent font-medium text-black" : "text-muted hover:text-foreground"}`}>
            {opcion.etiqueta}
          </button>
        ))}
      </div>
      {datos.length < 2 ? (
        <p className="py-6 text-center text-sm text-muted">{rango === "hoy" ? "Hoy todavía no hay suficientes puntos: se guarda uno cada 15 minutos con el mercado abierto." : "Hace falta más de un día de datos para dibujar la línea."}</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={datos} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={CHART_CHROME.gridline} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="etiqueta" stroke={CHART_CHROME.axis} tick={{ fontSize: 11 }} minTickGap={24} />
            <YAxis stroke={CHART_CHROME.axis} tick={{ fontSize: 11 }} domain={["auto", "auto"]} tickFormatter={(valor: number) => numero.format(valor)} width={56} />
            <Tooltip contentStyle={tooltipStyle} formatter={(valor) => usd.format(Number(valor))} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="A" name="Bot A" stroke={COLORES.A} strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="B" name="Bot B" stroke={COLORES.B} strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="C" name="Bot C" stroke={COLORES.C} strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="VOO" name="VOO sin tocar" stroke={COLORES.VOO} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// --- Las tres preguntas ---

function TresPreguntas({ comparacion }: { comparacion: PanelEnVivo["comparacion"] }) {
  const { preguntas } = comparacion;
  const aclaracion = `Van ${preguntas.dias} ${preguntas.dias === 1 ? "cierre" : "cierres"}: muy pocos para sacar conclusiones.`;
  const tarjetas = [
    {
      titulo: "¿Más información mejora las decisiones?",
      detalle: "Bot B (ve todo) contra Bot C (solo precios)",
      cuerpo: preguntas.masInformacion
        ? `${conSigno(preguntas.masInformacion.difNetoPuntos, " pts")} de rendimiento neto de IA, con ${usd.format(Math.abs(preguntas.masInformacion.costoIaExtraUsd))} ${preguntas.masInformacion.costoIaExtraUsd >= 0 ? "más" : "menos"} de IA.`
        : null,
      valor: preguntas.masInformacion?.difNetoPuntos ?? null,
    },
    {
      titulo: "¿Reaccionar durante el día mejora las decisiones?",
      detalle: "Bot A (también decide ante eventos) contra Bot B (una vez por día)",
      cuerpo: preguntas.reaccionar
        ? `${conSigno(preguntas.reaccionar.difNetoPuntos, " pts")}, con ${Math.abs(preguntas.reaccionar.operacionesExtra)} ${Math.abs(preguntas.reaccionar.operacionesExtra) === 1 ? "operación" : "operaciones"} ${preguntas.reaccionar.operacionesExtra >= 0 ? "más" : "menos"} y ${usd.format(Math.abs(preguntas.reaccionar.costoIaExtraUsd))} ${preguntas.reaccionar.costoIaExtraUsd >= 0 ? "más" : "menos"} de IA.`
        : null,
      valor: preguntas.reaccionar?.difNetoPuntos ?? null,
    },
    {
      titulo: "¿Alguno le gana a comprar VOO y no hacer nada?",
      detalle: "Rendimiento neto de cada bot menos el de VOO",
      cuerpo: preguntas.contraVoo.length > 0 ? preguntas.contraVoo.map((fila) => `Bot ${fila.clave} ${conSigno(fila.difPuntos, " pts")}`).join(" · ") : null,
      valor: null,
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      {tarjetas.map((tarjeta) => (
        <article key={tarjeta.titulo} className="card p-4">
          <p className="text-sm font-semibold">{tarjeta.titulo}</p>
          <p className="text-xs text-muted">{tarjeta.detalle}</p>
          <p className={`mt-2 text-sm tabular-nums ${colorVariacion(tarjeta.valor)}`}>{tarjeta.cuerpo ?? "Todavía sin datos para esta comparación."}</p>
          <p className="mt-1 text-xs text-muted">{aclaracion}</p>
        </article>
      ))}
    </div>
  );
}

// --- Presupuesto ---

function Presupuesto({ presupuesto }: { presupuesto: PanelEnVivo["presupuesto"] }) {
  return (
    <div className="card p-4">
      <p className="text-sm tabular-nums">
        {usd.format(presupuesto.gastadoUsd)} <span className="text-muted">de {usd.format(presupuesto.topeUsd)} este mes ({numero.format(presupuesto.pctUsado)}%)</span>
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full ${presupuesto.pctUsado >= 90 ? "bg-danger" : "bg-accent"}`} style={{ width: `${Math.min(100, presupuesto.pctUsado)}%` }} />
      </div>
      {presupuesto.porTipo.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-xs text-muted tabular-nums">
          {presupuesto.porTipo.map((fila) => (
            <li key={fila.tipo} className="flex justify-between gap-3"><span>{fila.etiqueta}</span><span>{usd.format(fila.usd)}</span></li>
          ))}
        </ul>
      )}
      {presupuesto.porBot.length > 0 && (
        <p className="mt-2 text-xs text-muted tabular-nums">Costo propio por bot (decisiones y lecciones): {presupuesto.porBot.map((fila) => `${fila.clave} ${usd.format(fila.usd)}`).join(" · ")}</p>
      )}
      <p className="mt-2 text-xs text-muted">Con el tope alcanzado, los bots dejan de llamar a la IA hasta el mes siguiente; la recolección de datos sigue.</p>
    </div>
  );
}

// --- Diario por bot ---

const ACCION_TEXTO: Record<string, string> = { comprar: "Compró", vender: "Vendió", mantener: "Mantuvo" };

function EntradaCorrida({ corrida }: { corrida: CorridaPanel }) {
  const [detalle, setDetalle] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  async function verBriefing() {
    if (detalle) {
      setDetalle(null);
      return;
    }
    setCargando(true);
    try {
      const respuesta = await fetch(`/api/laboratorio/corridas/${corrida.id}`, { cache: "no-store" });
      const data = (await respuesta.json()) as { corrida?: { briefing: unknown; respuesta_ia: unknown; tokens_entrada: number; tokens_salida: number }; error?: string };
      if (!respuesta.ok || !data.corrida) throw new Error(data.error ?? `Error ${respuesta.status}`);
      setDetalle(JSON.stringify({ briefing_que_vio_la_ia: data.corrida.briefing, respuesta_de_la_ia: data.corrida.respuesta_ia, tokens: { entrada: data.corrida.tokens_entrada, salida: data.corrida.tokens_salida } }, null, 2));
    } catch (error) {
      setDetalle(error instanceof Error ? error.message : "No pude abrir el briefing");
    }
    setCargando(false);
  }
  return (
    <li className="py-2">
      <p className="text-xs text-muted">
        {hora(corrida.ts)} · {corrida.disparador === "evento" ? "por evento" : "diaria"} · {corrida.estado === "sin_cambios" ? "no operó" : corrida.estado === "ok" ? "operó" : corrida.estado === "simulada" ? "simulada" : corrida.estado}
        {corrida.modelo ? ` · ${corrida.modelo}` : ""}
      </p>
      {corrida.error && <p className="text-xs text-danger">{corrida.error}</p>}
      {corrida.resumenMercado && <p className="mt-1 text-xs">{corrida.resumenMercado}</p>}
      <ul className="mt-1 flex flex-col gap-1 text-xs">
        {corrida.decisiones.map((decision, indice) => (
          <li key={`${decision.ticker}-${indice}`}>
            <span className="font-medium">
              {ACCION_TEXTO[decision.accion] ?? decision.accion} {decision.ticker}
              {decision.accion !== "mantener" && ` ${usd.format(decision.montoAprobadoUsd)}`}
              {decision.accion !== "mantener" && decision.montoPropuestoUsd !== decision.montoAprobadoUsd && <span className="text-muted"> (propuso {usd.format(decision.montoPropuestoUsd)})</span>}
            </span>
            {decision.precioEjecucion !== null && <span className="text-muted"> · a {usd.format(decision.precioEjecucion)}</span>}
            {decision.estadoOrden !== "sin_orden" && decision.estadoOrden !== "filled" && <span className="text-muted"> · orden {decision.estadoOrden}</span>}
            {decision.razon && <span className="text-muted"> · {decision.razon}</span>}
            {decision.ajuste && <span className="text-accent"> · {decision.ajuste}</span>}
          </li>
        ))}
      </ul>
      <button onClick={verBriefing} disabled={cargando} className="pressable mt-1 text-xs text-accent disabled:opacity-50">{cargando ? "Abriendo…" : detalle ? "Ocultar lo que vio la IA" : "Ver lo que vio la IA (briefing exacto)"}</button>
      {detalle && <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-surface-2 p-2 text-[10px] leading-snug">{detalle}</pre>}
    </li>
  );
}

function DiarioDeBot({ bot }: { bot: BotPanel }) {
  return (
    <details className="px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">{bot.nombre} <span className="text-xs font-normal text-muted">· {bot.historial.length} {bot.historial.length === 1 ? "corrida" : "corridas"} recientes</span></summary>
      {bot.historial.length === 0 ? (
        <p className="mt-2 text-xs text-muted">Todavía no corrió.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border-soft">
          {bot.historial.map((corrida) => <EntradaCorrida key={corrida.id} corrida={corrida} />)}
        </ul>
      )}
    </details>
  );
}

// --- Sección completa ---

export function SeccionComparacion({ panel }: { panel: PanelEnVivo }) {
  const bots = panel.bots.bots;
  const conResumen = bots.filter((bot) => bot.ultimaCorrida?.resumenMercado);
  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Tabla de posiciones</h2>
        <p className="-mt-1 text-xs text-muted">Ordenada por rendimiento neto de lo que cuesta la IA de cada bot. Sale de los cierres de cada rueda. Plata ficticia.</p>
        <TablaPosiciones comparacion={panel.comparacion} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Evolución</h2>
        <GraficoBots grafico={panel.grafico} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Las tres preguntas del experimento</h2>
        <TresPreguntas comparacion={panel.comparacion} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Evaluación</h2>
        <div className="card flex flex-col gap-1.5 p-4 text-sm">
          {panel.comparacion.evaluacion.map((linea, indice) => (
            <p key={indice} className={indice === panel.comparacion.evaluacion.length - 1 ? "text-xs text-muted" : "tabular-nums"}>{linea}</p>
          ))}
          <p className="text-xs text-muted">Solo números, sin opinión. La app no ofrece pasar a plata real.</p>
        </div>
      </section>

      {conResumen.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Briefing del día de cada bot</h2>
          <p className="-mt-1 text-xs text-muted">Cómo ve cada bot el mercado en su última decisión, pensado para leerlo cada día.</p>
          <div className="card divide-y divide-border-soft">
            {conResumen.map((bot) => (
              <div key={bot.clave} className="px-4 py-3">
                <p className="text-xs text-muted">{bot.nombre} · {hora(bot.ultimaCorrida!.ts)}</p>
                <p className="mt-1 text-sm leading-relaxed">{bot.ultimaCorrida!.resumenMercado}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Diario de cada bot</h2>
        <p className="-mt-1 text-xs text-muted">Cada corrida con qué propuso, por qué, qué recortó el gestor de riesgo, qué se ejecutó y a qué precio. Se puede abrir el briefing exacto que vio la IA.</p>
        <div className="card divide-y divide-border-soft">
          {bots.length === 0 ? <p className="px-4 py-3 text-sm text-muted">Los bots aparecen cuando activás el laboratorio.</p> : bots.map((bot) => <DiarioDeBot key={bot.clave} bot={bot} />)}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Presupuesto de IA</h2>
        <Presupuesto presupuesto={panel.presupuesto} />
      </section>
    </>
  );
}
