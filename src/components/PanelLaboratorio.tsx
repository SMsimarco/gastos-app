"use client";

import { useEffect, useState } from "react";
import type { FilaFundamentalPanel, FilaMacroPanel } from "@/lib/laboratorio/panel";
import type { EventoCalendarioPanel, EventoMercadoPanel, NoticiaPanel, PanelEnVivo } from "@/lib/laboratorio/panelData";

const REFRESCO_MS = 60_000;

const usd = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD" });
const numero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 });

function colorVariacion(valor: number | null) {
  if (valor === null || valor === 0) return "text-muted";
  return valor > 0 ? "text-positive" : "text-danger";
}

function conSigno(valor: number | null, sufijo = "%") {
  if (valor === null) return "—";
  return `${valor > 0 ? "+" : ""}${numero.format(valor)}${sufijo}`;
}

function hora(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fechaCorta(fecha: string) {
  const [anio, mes, dia] = fecha.split("-");
  return `${dia}/${mes}/${anio}`;
}

const NOMBRE_TAREA = { monitor: "Monitor", noticias: "Noticias (empresas y mercado)", gdelt: "Noticias GDELT", macro: "Macro, Argentina y calendario", fundamentales: "Fundamentales y SEC" } as const;
const NOMBRE_TEMA: Record<string, string> = {
  fed: "Fed",
  inflacion: "Inflación",
  guerra: "Guerra",
  petroleo: "Petróleo",
  china: "China",
  elecciones_eeuu: "Elecciones EE.UU.",
  argentina: "Argentina",
};

function valorConUnidad(fila: FilaMacroPanel): string {
  const valor = numero.format(fila.valor);
  if (fila.unidad === "%") return `${valor}%`;
  if (fila.unidad === "$") return `$${valor}`;
  if (fila.unidad === "US$") return `US$${valor}`;
  if (fila.unidad === "pb") return `${valor} pb`;
  return valor;
}

function etiquetaCalendario(evento: EventoCalendarioPanel): string {
  switch (evento.tipo) {
    case "fed":
      return "Reunión de la Fed (tasas)";
    case "macro":
      return String(evento.detalle.descripcion ?? "Publicación macro");
    case "dividendo":
      return `Dividendo de ${evento.ticker}: US$${numero.format(Number(evento.detalle.monto))} (fecha ex)`;
    default:
      return `Balance de ${evento.ticker}`;
  }
}

function TablaMacro({ filas, vacio }: { filas: FilaMacroPanel[]; vacio: string }) {
  if (filas.length === 0) return <p className="text-sm text-muted">{vacio}</p>;
  return (
    <div className="card divide-y divide-border-soft">
      {filas.map((fila) => (
        <div key={fila.serie} className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-medium">{fila.nombre}</p>
            <p className="text-xs text-muted">al {fechaCorta(fila.fecha)}</p>
          </div>
          <div className="text-right">
            <p className="font-medium tabular-nums">{valorConUnidad(fila)}</p>
            <p className={`text-xs tabular-nums ${fila.tipoVariacion === "interanual" ? "text-muted" : colorVariacion(fila.variacion)}`}>
              {fila.tipoVariacion === "interanual"
                ? `${conSigno(fila.variacion)} interanual`
                : conSigno(fila.variacion, fila.tipoVariacion === "pct" ? "%" : fila.unidad === "pb" ? " pb" : " pp")}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function FilaFundamental({ fila }: { fila: FilaFundamentalPanel }) {
  const valor = (n: number | null, sufijo = "") => (n === null ? "—" : `${numero.format(n)}${sufijo}`);
  return (
    <div className="px-4 py-3">
      <p className="font-semibold">{fila.ticker}</p>
      <p className="text-xs text-muted tabular-nums">
        P/E {valor(fila.pe)} · margen neto {valor(fila.margenNeto, "%")} · ingresos {fila.crecimientoIngresos === null ? "—" : conSigno(fila.crecimientoIngresos)} · beta {valor(fila.beta)}
      </p>
      <p className="mt-0.5 text-xs text-muted">
        {fila.analistas ? `${fila.analistas.compra} de ${fila.analistas.total} analistas recomiendan comprar` : "sin recomendaciones de analistas"}
        {fila.sorpresa && (
          <>
            {" · último balance "}
            <span className={colorVariacion(fila.sorpresa.pct)}>{conSigno(fila.sorpresa.pct)}</span>
            {" contra lo esperado"}
          </>
        )}
        {fila.insiders && ` · directivos (90 días): ${fila.insiders.compras} compras y ${fila.insiders.ventas} ventas`}
      </p>
    </div>
  );
}

function describirEvento(evento: EventoMercadoPanel): string {
  const d = evento.detalle;
  switch (evento.tipo) {
    case "movimiento":
      return `${evento.ticker} se movió ${conSigno(Number(d.variacion_pct))} (${usd.format(Number(d.precio))})`;
    case "vix":
      return `VIX ${conSigno(Number(d.variacion_pct))}: de ${numero.format(Number(d.anterior))} a ${numero.format(Number(d.actual))}`;
    case "noticia_relevante":
      return `Noticia relevante sobre ${(d.tickers as string[] | undefined)?.join(", ") ?? evento.ticker}: ${String(d.titular ?? "")}`;
    case "balance_hoy":
      return `${evento.ticker} presenta balance hoy`;
    default:
      return evento.tipo;
  }
}

function Sentimiento({ valor }: { valor: number | null }) {
  if (valor === null) return <span className="text-muted">sin procesar</span>;
  const etiqueta = valor >= 0.25 ? "positivo" : valor <= -0.25 ? "negativo" : "neutral";
  return <span className={colorVariacion(valor >= 0.25 ? 1 : valor <= -0.25 ? -1 : 0)}>{etiqueta} ({conSigno(valor, "")})</span>;
}

function Noticia({ noticia }: { noticia: NoticiaPanel }) {
  const etiqueta = noticia.tema ? (NOMBRE_TEMA[noticia.tema] ?? noticia.tema) : (noticia.tickers.length ? noticia.tickers.join(", ") : noticia.ticker);
  return (
    <li className="border-t border-border-soft pt-3 first:border-t-0 first:pt-0">
      <a href={noticia.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:text-accent">
        {noticia.resumen ?? noticia.titular}
      </a>
      <p className="mt-1 text-xs text-muted">
        {etiqueta} · {hora(noticia.publicadoAt)} · <Sentimiento valor={noticia.sentimiento} />
        {noticia.relevancia !== null && <> · relevancia {numero.format(noticia.relevancia)}</>}
      </p>
    </li>
  );
}

export function PanelLaboratorio({ panelInicial }: { panelInicial: PanelEnVivo }) {
  const [panel, setPanel] = useState(panelInicial);
  const [errorRefresco, setErrorRefresco] = useState(false);

  // Se actualiza sola cada 60 segundos, y solo mientras la pestaña está visible.
  useEffect(() => {
    let activo = true;
    async function refrescar() {
      if (document.visibilityState !== "visible") return;
      try {
        const respuesta = await fetch("/api/laboratorio", { cache: "no-store" });
        if (!respuesta.ok) throw new Error();
        const data = (await respuesta.json()) as { panel: PanelEnVivo };
        if (activo) {
          setPanel(data.panel);
          setErrorRefresco(false);
        }
      } catch {
        if (activo) setErrorRefresco(true);
      }
    }
    const intervalo = setInterval(refrescar, REFRESCO_MS);
    document.addEventListener("visibilitychange", refrescar);
    return () => {
      activo = false;
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", refrescar);
    };
  }, []);

  const sinDatos = panel.precios.every((fila) => fila.precio === null) && panel.noticias.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 p-5 pb-12">
      <div role="note" className="sticky top-0 z-10 -mx-5 border-b border-danger/40 bg-danger/10 px-5 py-2 text-center text-xs font-semibold uppercase tracking-[0.14em] text-danger backdrop-blur-md">
        Simulado — plata ficticia
      </div>

      <header>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Experimento</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Laboratorio</h1>
        <p className="mt-2 text-sm text-muted">
          Esto es lo que van a ver los bots simulados. Por ahora solo se recolectan datos: todavía no hay bots ni operaciones, y nada de acá toca tu plan real.
        </p>
      </header>

      <section className="text-xs text-muted">
        <p>
          Actualizado {hora(panel.generadoAt)}
          {errorRefresco && <span className="text-danger"> · no pude refrescar, muestro lo último que tengo</span>}
        </p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {panel.fuentes.length === 0 && <li>Todavía no corrió ninguna recolección.</li>}
          {panel.fuentes.map((fuente) => (
            <li key={fuente.tarea} className={fuente.ok ? "" : "text-danger"}>
              {NOMBRE_TAREA[fuente.tarea]}: {fuente.ok ? "ok" : "con errores"} · {hora(fuente.ts)}
              {fuente.error && ` · ${fuente.error}`}
            </li>
          ))}
        </ul>
      </section>

      {sinDatos && (
        <p className="card p-4 text-sm text-muted">Todavía no hay datos. Aparecen cuando corran las tareas programadas (precios con el mercado abierto, noticias cada 30 minutos, macro una vez por día).</p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Precios del universo</h2>
        <div className="card divide-y divide-border-soft">
          {panel.precios.map((fila) => (
            <div key={fila.ticker} className="flex items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-semibold">{fila.ticker}</p>
                <p className="text-xs text-muted tabular-nums">
                  RSI {fila.rsi14 === null ? "—" : numero.format(fila.rsi14)}
                  {fila.tendencia && (fila.tendencia === "sobre_sma50" ? " · sobre su media de 50" : " · bajo su media de 50")}
                  {fila.distanciaMax52s !== null && ` · ${numero.format(fila.distanciaMax52s)}% del máx. anual`}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium tabular-nums">{fila.precio === null ? "—" : usd.format(fila.precio)}</p>
                <p className={`text-xs tabular-nums ${colorVariacion(fila.variacionDia)}`}>{conSigno(fila.variacionDia)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Fundamentales y analistas</h2>
        {panel.fundamentales.every((fila) => fila.fechaDatos === null) ? (
          <p className="text-sm text-muted">Sin fundamentales todavía: se cargan una vez por día después del cierre.</p>
        ) : (
          <div className="card divide-y divide-border-soft">
            {panel.fundamentales.map((fila) => (
              <FilaFundamental key={fila.ticker} fila={fila} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">VIX y macro de EE.UU.</h2>
        <TablaMacro filas={panel.macro.filter((fila) => fila.grupo === "eeuu")} vacio="Sin datos macro todavía." />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Argentina</h2>
        <TablaMacro filas={panel.macro.filter((fila) => fila.grupo === "argentina")} vacio="Sin datos de Argentina todavía." />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Noticias</h2>
        {panel.noticias.length === 0 ? (
          <p className="text-sm text-muted">Sin noticias todavía.</p>
        ) : (
          <ul className="card flex flex-col gap-3 p-4">
            {panel.noticias.map((noticia) => (
              <Noticia key={noticia.id} noticia={noticia} />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Hechos materiales (SEC)</h2>
        {panel.filings.length === 0 ? (
          <p className="text-sm text-muted">Sin presentaciones recientes todavía.</p>
        ) : (
          <ul className="card divide-y divide-border-soft">
            {panel.filings.map((filing) => (
              <li key={filing.id} className="px-4 py-3 text-sm">
                <a href={filing.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-accent">
                  {filing.ticker} · {filing.descripcion ?? filing.formulario}
                </a>
                <p className="mt-0.5 text-xs text-muted">{filing.formulario} · {fechaCorta(filing.fecha)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Calendario</h2>
        {panel.calendario.length === 0 ? (
          <p className="text-sm text-muted">Sin balances, publicaciones macro ni dividendos próximos.</p>
        ) : (
          <ul className="card divide-y divide-border-soft">
            {panel.calendario.map((evento) => (
              <li key={evento.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>{etiquetaCalendario(evento)}</span>
                <span className="tabular-nums text-muted">{fechaCorta(evento.fecha)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Eventos del monitor</h2>
        <p className="-mt-1 text-xs text-muted">Los marcados despertarían al bot reactivo cuando los bots estén activos.</p>
        {panel.eventos.length === 0 ? (
          <p className="text-sm text-muted">Sin eventos todavía.</p>
        ) : (
          <ul className="card divide-y divide-border-soft">
            {panel.eventos.map((evento) => (
              <li key={evento.id} className="px-4 py-3 text-sm">
                <p>{describirEvento(evento)}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {hora(evento.ts)}
                  {evento.disparoDecision && <span className="text-accent"> · dispararía una decisión</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-center text-xs text-muted">Datos de Alpaca (IEX), FRED, Finnhub, SEC EDGAR, argentinadatos y dolarapi. Experimento simulado, no es asesoramiento financiero.</p>
    </div>
  );
}
