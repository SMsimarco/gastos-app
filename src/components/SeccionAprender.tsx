"use client";

import { useCallback, useEffect, useState } from "react";
import type { PanelAprender } from "@/lib/inversiones/aprenderPanel";
import type { Candidato, FilaFicha } from "@/lib/inversiones/aprender";

const CRITERIOS: Array<{ clave: FilaFicha["criterio"]; nombre: string }> = [
  { clave: "valuacion", nombre: "Valuación" },
  { clave: "momento", nombre: "Momento" },
  { clave: "calidad", nombre: "Calidad" },
  { clave: "noticias", nombre: "Noticias" },
  { clave: "riesgo", nombre: "Riesgo" },
];
const NOMBRE_CRITERIO = Object.fromEntries(CRITERIOS.map((criterio) => [criterio.clave, criterio.nombre])) as Record<string, string>;

const usd = (valor: number) => `US$${Math.round(valor).toLocaleString("es-AR")}`;
const signo = (valor: number) => `${valor >= 0 ? "+" : "−"}${Math.abs(Math.round(valor))}`;
const fechaCorta = (fecha: string | null) => (fecha ? `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}` : "");

function aporteTexto(fila: FilaFicha) {
  if (fila.marcado) return "marcado";
  if (fila.aporte === null) return fila.criterio === "riesgo" ? "—" : "sin dato";
  return signo(fila.aporte);
}

function Ficha({ candidato, abierta }: { candidato: Candidato; abierta?: boolean }) {
  return (
    <details open={abierta} className="rounded-xl border border-border-soft bg-surface-2/40">
      <summary className="flex cursor-pointer items-center justify-between gap-3 p-3 text-sm">
        <span className="font-medium">{candidato.ticker}</span>
        <span className="text-muted">{Math.round(candidato.puntaje)} de 100 · ¿por qué?</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-border-soft p-3 text-sm">
        <p className="text-muted">Tu tesis: {candidato.tesis}</p>
        <ul className="flex flex-col gap-2">
          {candidato.componentes.map((fila) => (
            <li key={fila.criterio} className="flex flex-col gap-0.5 rounded-lg bg-surface-2 p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{NOMBRE_CRITERIO[fila.criterio]}</span>
                <span className={`tabular-nums ${fila.aporte !== null && fila.aporte < 0 ? "text-danger" : fila.aporte !== null && fila.aporte > 0 ? "text-accent" : "text-muted"}`}>{aporteTexto(fila)}</span>
              </div>
              <p>{fila.dato}</p>
              <p className="text-xs text-muted">Contra qué: {fila.referencia}</p>
              <p className="text-xs">{fila.enCriollo}</p>
              <p className="text-xs text-muted">
                {fila.fuente}
                {fila.fecha ? `, ${fechaCorta(fila.fecha)}` : ""}
                {fila.pesoEfectivo > 0 ? ` · pesa ${fila.pesoEfectivo}%` : ""}
              </p>
              {fila.historial && (
                <p className="text-xs text-muted">
                  Historial: {fila.historial.aciertos} de {fila.historial.casos} le ganaron a VOO
                  {fila.historial.pocosCasos ? " (con menos de 30 casos puede ser suerte)" : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-2">
          <div><p className="text-xs font-medium">Por qué sí</p><p className="text-sm">{candidato.porQueSi.length ? candidato.porQueSi.join(". ") + "." : "Nada destaca a favor."}</p></div>
          <div><p className="text-xs font-medium">Por qué no</p><p className="text-sm">{candidato.porQueNo.length ? candidato.porQueNo.join(". ") + "." : "Nada puntual en contra."}</p></div>
        </div>
        {candidato.queCambiaria.length > 0 && <div><p className="text-xs font-medium">Qué tendría que cambiar</p><ul className="list-disc pl-5 text-sm text-muted">{candidato.queCambiaria.map((texto) => <li key={texto}>{texto}</li>)}</ul></div>}
        {candidato.noticias.length > 0 && (
          <div><p className="text-xs font-medium">Noticias que se usaron</p>
            <ul className="flex flex-col gap-1 text-sm">{candidato.noticias.map((noticia) => <li key={noticia.url}><a href={noticia.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">{noticia.titular}</a> <span className="text-xs text-muted">({noticia.fuente}, {fechaCorta(noticia.publicadoAt)})</span></li>)}</ul>
          </div>
        )}
      </div>
    </details>
  );
}

function Comparacion({ panel }: { panel: PanelAprender }) {
  const columnas = [...panel.candidatos.map((c) => ({ nombre: c.ticker, puntaje: c.puntaje, filas: c.componentes })), ...(panel.voo ? [{ nombre: "VOO", puntaje: panel.voo.puntaje, filas: panel.voo.componentes }] : [])];
  return (
    <div className="overflow-x-auto rounded-xl border border-border-soft">
      <table className="w-full min-w-[320px] text-left text-sm">
        <thead><tr className="text-xs text-muted"><th className="p-2 font-normal">Criterio</th>{columnas.map((columna) => <th key={columna.nombre} className="p-2 text-right font-medium text-foreground">{columna.nombre}</th>)}</tr></thead>
        <tbody>
          {CRITERIOS.map((criterio) => (
            <tr key={criterio.clave} className="border-t border-border-soft">
              <td className="p-2 text-muted">{criterio.nombre}</td>
              {columnas.map((columna) => { const fila = columna.filas.find((item) => item.criterio === criterio.clave); return <td key={columna.nombre} className="p-2 text-right tabular-nums">{fila ? aporteTexto(fila) : "—"}</td>; })}
            </tr>
          ))}
          <tr className="border-t border-border font-medium"><td className="p-2">Puntaje</td>{columnas.map((columna) => <td key={columna.nombre} className="p-2 text-right tabular-nums">{Math.round(columna.puntaje)}</td>)}</tr>
        </tbody>
      </table>
      {!panel.voo && <p className="p-2 text-xs text-muted">Sin datos de VOO para comparar.</p>}
    </div>
  );
}

type FormActivo = { ticker: string; tesis: string; tomaGananciaPct: string; stopRevisionPct: string };
const FORM_VACIO: FormActivo = { ticker: "", tesis: "", tomaGananciaPct: "", stopRevisionPct: "" };

export function SeccionAprender() {
  const [panel, setPanel] = useState<PanelAprender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [form, setForm] = useState<FormActivo>(FORM_VACIO);
  const [editando, setEditando] = useState<string | null>(null);
  const [pesos, setPesos] = useState<Record<string, number> | null>(null);

  const cargar = useCallback(async () => {
    try {
      const respuesta = await fetch("/api/aprender");
      const data = await respuesta.json();
      if (!respuesta.ok) throw new Error(data.error ?? "No pude cargar aprender");
      setPanel(data);
      setPesos(data.pesos);
      setError(null);
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : "No pude cargar aprender");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde la API
    void cargar();
    window.addEventListener("plan-config-actualizada", cargar);
    return () => window.removeEventListener("plan-config-actualizada", cargar);
  }, [cargar]);

  async function enviar(url: string, metodo: string, cuerpo?: unknown, mensajeOk?: string) {
    setOcupado(true);
    setAviso(null);
    try {
      const respuesta = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
      const data = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(data.error ?? "No pude hacerlo");
      setAviso(data.aviso ?? mensajeOk ?? null);
      setError(null);
      await cargar();
      return true;
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : "No pude hacerlo");
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function guardarActivo(evento: React.FormEvent) {
    evento.preventDefault();
    const cuerpo = { ticker: form.ticker, tesis: form.tesis, tomaGananciaPct: form.tomaGananciaPct, stopRevisionPct: form.stopRevisionPct };
    const ok = editando ? await enviar(`/api/aprender/activos/${editando}`, "PATCH", cuerpo, "Activo actualizado.") : await enviar("/api/aprender/activos", "POST", cuerpo, "Activo agregado a tu lista.");
    if (ok) { setForm(FORM_VACIO); setEditando(null); }
  }

  if (error && !panel) return <section className="card p-4 text-sm text-danger">{error}</section>;
  if (!panel) return <section className="card p-4 text-sm text-muted">Cargando aprender…</section>;

  const progreso = Math.min(100, Math.round((panel.saldoUsd / panel.minimoCompraUsd) * 100));
  const sumaPesos = pesos ? Object.values(pesos).reduce((total, valor) => total + Number(valor), 0) : 0;
  const rendimiento = panel.rendimiento;

  return (
    <section id="aprender" className="flex flex-col gap-4">
      <div className="card flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div><p className="font-medium">Aprender</p><p className="text-sm text-muted">El 5% para aprender invirtiendo, en tu lista de activos.</p></div>
          <p className="text-2xl font-semibold tabular-nums">{usd(panel.saldoUsd)}</p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${progreso}%` }} /></div>
        <p className="text-sm text-muted">{panel.puedeComprar ? `Llegaste al mínimo de ${usd(panel.minimoCompraUsd)}.` : `Te faltan ${usd(panel.faltaUsd)} para llegar al mínimo de ${usd(panel.minimoCompraUsd)}. Hasta entonces no hay nada para elegir.`}</p>
        {panel.alertas.map((alerta) => <p key={`${alerta.tipo}-${String(alerta.datos.ticker)}`} className="rounded-xl border border-accent/40 bg-accent-soft p-3 text-sm">{alerta.mensaje}</p>)}
      </div>

      {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      {aviso && <p className="rounded-xl border border-border bg-surface-2 p-3 text-sm">{aviso}</p>}

      {panel.puedeComprar && (
        <div className="card flex flex-col gap-3 p-4">
          <p className="font-medium">Opciones de hoy</p>
          {panel.candidatos.length === 0 && <p className="text-sm text-muted">Ningún activo de tu lista pasa los filtros hoy. Podés esperar o sumar el saldo a VOO.</p>}
          {panel.candidatos.map((candidato, indice) => <Ficha key={candidato.ticker} candidato={candidato} abierta={indice === 0} />)}
          <div className="rounded-xl border border-border-soft bg-surface-2/40 p-3 text-sm">
            <p className="font-medium">Esperar o sumar a VOO</p>
            <p className="text-muted">{panel.opcionEsperar.motivo}</p>
          </div>
          {panel.advertencias.map((texto) => <p key={texto} className="text-xs text-muted">{texto}</p>)}
          {panel.candidatos.length > 0 && <div className="flex flex-col gap-2"><p className="text-sm font-medium">Comparación lado a lado</p><Comparacion panel={panel} /></div>}
          {panel.excluidos.length > 0 && (
            <div className="flex flex-col gap-1.5"><p className="text-sm font-medium">Por qué no los demás</p>
              <ul className="flex flex-col gap-1.5 text-sm">{panel.excluidos.map((excluido) => <li key={excluido.ticker}><strong>{excluido.ticker}</strong>: {excluido.detalle} <span className="text-muted">{excluido.queCambiaria}</span></li>)}</ul>
            </div>
          )}
          <p className="text-xs text-muted">{panel.descargo}</p>
        </div>
      )}

      <div className="card flex flex-col gap-3 p-4">
        <div><p className="font-medium">Cómo te va contra VOO</p><p className="text-sm text-muted">Lo que ganaste en aprender contra lo que habrías ganado poniendo lo mismo en VOO el mismo día.</p></div>
        {rendimiento && rendimiento.veredicto !== "sin_datos" && rendimiento.gananciaPct !== null && rendimiento.siVooPct !== null ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-muted">Aprender</p><p className="text-xl font-semibold tabular-nums">{signo(rendimiento.gananciaPct)}%</p><p className="text-xs text-muted">{usd(rendimiento.gananciaUsd)}</p></div>
              <div><p className="text-xs text-muted">Si fuera VOO</p><p className="text-xl font-semibold tabular-nums">{signo(rendimiento.siVooPct)}%</p><p className="text-xs text-muted">{usd(rendimiento.siVooGananciaUsd)}</p></div>
            </div>
            <p className="text-sm">{rendimiento.veredicto === "gana" ? "Por ahora aprender le gana a VOO" : rendimiento.veredicto === "pierde" ? "Por ahora VOO le gana a aprender" : "Por ahora están parejos"} ({signo(rendimiento.diferenciaPuntos ?? 0)} puntos). Con pocos meses puede ser suerte.</p>
          </>
        ) : (
          <p className="text-sm text-muted">Todavía no hay compras en aprender para comparar.</p>
        )}
      </div>

      <div className="card flex flex-col gap-3 p-4">
        <div><p className="font-medium">Tu lista de aprender</p><p className="text-sm text-muted">Solo estos activos pueden aparecer como opción. Cada uno con su tesis.</p></div>
        {panel.activos.length === 0 && <p className="text-sm text-muted">Todavía no sumaste ninguno.</p>}
        <ul className="flex flex-col gap-2">
          {panel.activos.map((activo) => (
            <li key={activo.id} className="flex flex-col gap-1 rounded-xl border border-border-soft p-3 text-sm">
              <div className="flex items-baseline justify-between gap-2"><strong>{activo.ticker}</strong><span className="text-muted tabular-nums">{activo.valorPosicionUsd > 0 ? `${usd(activo.valorPosicionUsd)} · ${signo(activo.gananciaPct)}%` : "sin posición"}</span></div>
              <p className="text-muted">{activo.tesis}</p>
              <p className="text-xs text-muted">Toma de ganancia: {activo.tomaGananciaPct ? `+${activo.tomaGananciaPct}%` : "—"} · Revisar tesis si baja: {activo.stopRevisionPct ? `${activo.stopRevisionPct}%` : "—"}{activo.conDatosDelLaboratorio ? "" : " · sin precio en el laboratorio"}</p>
              <div className="flex gap-3 text-xs">
                <button onClick={() => { setEditando(activo.id); setForm({ ticker: activo.ticker, tesis: activo.tesis, tomaGananciaPct: activo.tomaGananciaPct?.toString() ?? "", stopRevisionPct: activo.stopRevisionPct?.toString() ?? "" }); }} className="text-muted hover:text-foreground">Editar</button>
                <button disabled={ocupado} onClick={() => { if (window.confirm(`¿Quitar ${activo.ticker} de tu lista de aprender?`)) void enviar(`/api/aprender/activos/${activo.id}`, "DELETE"); }} className="text-muted hover:text-danger">Quitar</button>
              </div>
            </li>
          ))}
        </ul>
        <form onSubmit={guardarActivo} className="flex flex-col gap-2 border-t border-border-soft pt-3">
          <p className="text-sm font-medium">{editando ? `Editar ${form.ticker}` : "Sumar un activo"}</p>
          {!editando && <input value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })} placeholder="Ticker (ej: KO)" className="input-plan" maxLength={10} required />}
          <textarea value={form.tesis} onChange={(e) => setForm({ ...form, tesis: e.target.value })} placeholder="Tu tesis: por qué querés este activo" className="input-plan min-h-20" required />
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted">Toma de ganancia (%)<input type="number" min="1" value={form.tomaGananciaPct} onChange={(e) => setForm({ ...form, tomaGananciaPct: e.target.value })} className="input-plan" /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Revisar tesis si baja (%)<input type="number" min="1" value={form.stopRevisionPct} onChange={(e) => setForm({ ...form, stopRevisionPct: e.target.value })} className="input-plan" /></label>
          </div>
          <div className="flex gap-2">
            <button disabled={ocupado} className="pressable flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50">{editando ? "Guardar cambios" : "Agregar a mi lista"}</button>
            {editando && <button type="button" onClick={() => { setEditando(null); setForm(FORM_VACIO); }} className="pressable rounded-xl border border-border px-4 py-2.5 text-sm">Cancelar</button>}
          </div>
        </form>
      </div>

      <div className="card flex flex-col gap-3 p-4">
        <div><p className="font-medium">Lo que va aprendiendo</p><p className="text-sm text-muted">Mide cada sugerencia a 1, 4 y 12 semanas contra VOO, la hayas comprado o no. {panel.historial.casosMedidos} {panel.historial.casosMedidos === 1 ? "medición" : "mediciones"} hasta ahora.</p></div>
        {Object.keys(panel.historial.porCriterio).length === 0 ? <p className="text-sm text-muted">Todavía no hay mediciones cumplidas.</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {Object.entries(panel.historial.porCriterio).map(([criterio, dato]) => dato && <li key={criterio}>{NOMBRE_CRITERIO[criterio]}: {dato.aciertos} de {dato.casos} le ganaron a VOO{dato.casos < panel.historial.minCasos ? <span className="text-muted"> (con menos de {panel.historial.minCasos} casos puede ser suerte)</span> : null}</li>)}
          </ul>
        )}
        {panel.propuestasPesos.map((propuesta) => (
          <div key={propuesta.id} className="flex flex-col gap-2 rounded-xl border border-accent/40 p-3 text-sm">
            <p>{propuesta.texto}</p>
            <div className="flex gap-2">
              <button disabled={ocupado} onClick={() => void enviar(`/api/aprender/propuestas/${propuesta.id}`, "POST", { accion: "aceptar" }, "Pesos actualizados.")} className="pressable rounded-xl bg-accent px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">Aceptar</button>
              <button disabled={ocupado} onClick={() => void enviar(`/api/aprender/propuestas/${propuesta.id}`, "POST", { accion: "rechazar" }, "Propuesta rechazada.")} className="pressable rounded-xl border border-border px-3 py-2 text-xs disabled:opacity-50">Rechazar</button>
            </div>
          </div>
        ))}
        {pesos && (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Pesos del puntaje</summary>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {(["valuacion", "momento", "calidad", "noticias"] as const).map((clave) => (
                <label key={clave} className="flex flex-col gap-1 text-xs text-muted">{NOMBRE_CRITERIO[clave]}<input type="number" min="0" max="100" value={pesos[clave]} onChange={(e) => setPesos({ ...pesos, [clave]: Number(e.target.value) })} className="input-plan" /></label>
              ))}
            </div>
            <p className={`mt-2 text-xs ${sumaPesos === 100 ? "text-muted" : "text-danger"}`}>Suman {sumaPesos}; tienen que sumar 100.</p>
            <button disabled={ocupado || sumaPesos !== 100} onClick={() => void enviar("/api/aprender/pesos", "PATCH", { pesos }, "Pesos guardados.")} className="pressable mt-2 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black disabled:opacity-50">Guardar pesos</button>
          </details>
        )}
      </div>
    </section>
  );
}
