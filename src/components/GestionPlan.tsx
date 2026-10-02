"use client";

import { useState } from "react";
import { IconCheck } from "@/components/icons";

type ClaveBolsillo = "gastos" | "emergencia" | "largo_plazo" | "aprender" | "por_invertir";
type Bolsillo = {
  id: string;
  clave: ClaveBolsillo;
  nombre: string;
  moneda: "ARS" | "USD";
  saldo: number;
  meta: number | null;
  orden: number;
};
type ConfigPlan = {
  pct_gastos: number;
  pct_largo_plazo: number;
  pct_aprender: number;
  emergencia_primero: boolean;
  meses_emergencia: number;
  gasto_mensual_manual: number | null;
  minimo_compra_usd: number;
} | null;
type DetalleReparto = Record<ClaveBolsillo, number> & {
  metaEmergenciaUsd: number;
  explicacion: string[];
  acciones: string[];
};
type RepartoPendiente = {
  id: string;
  monto_ars: number;
  tc_referencia: number;
  detalle: DetalleReparto;
} | null;
type Porcentajes = { pct_gastos: number; pct_largo_plazo: number; pct_aprender: number };

const fmtArs = (valor: number) => Math.round(valor).toLocaleString("es-AR");
const fmtUsd = (valor: number) => Number(valor).toFixed(2);
const CAMPOS_PCT = ["pct_gastos", "pct_largo_plazo", "pct_aprender"] as const;
const ETIQUETAS_PCT: Record<(typeof CAMPOS_PCT)[number], string> = {
  pct_gastos: "Gastos",
  pct_largo_plazo: "Largo plazo",
  pct_aprender: "Aprender",
};

export function GestionPlan({
  bolsillosIniciales,
  configInicial,
  gastoMensualArsInicial,
  gastoMensualFuenteInicial,
  mepReferenciaInicial,
  repartoPendienteInicial,
}: {
  bolsillosIniciales: Bolsillo[];
  configInicial: ConfigPlan;
  gastoMensualArsInicial: number | null;
  gastoMensualFuenteInicial: "calculado" | "manual";
  mepReferenciaInicial: number | null;
  repartoPendienteInicial: RepartoPendiente;
}) {
  const [bolsillos, setBolsillos] = useState(bolsillosIniciales);
  const [reparto, setReparto] = useState(repartoPendienteInicial);
  const [config, setConfig] = useState(configInicial);
  const [porcentajes, setPorcentajes] = useState<Porcentajes>({
    pct_gastos: configInicial?.pct_gastos ?? 25,
    pct_largo_plazo: configInicial?.pct_largo_plazo ?? 65,
    pct_aprender: configInicial?.pct_aprender ?? 10,
  });
  const [procesando, setProcesando] = useState(false);
  const [tcUsado, setTcUsado] = useState(reparto ? String(reparto.tc_referencia) : "");
  const [ajustando, setAjustando] = useState<ClaveBolsillo | null>(null);
  const [valorAjuste, setValorAjuste] = useState<Record<string, string>>({});
  const [montoDisponible, setMontoDisponible] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function leerRespuesta(res: Response) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "No pude completar la operación");
    return data;
  }

  async function aplicarReparto() {
    if (!reparto) return;
    setProcesando(true);
    setError(null);
    try {
      const data = await leerRespuesta(await fetch(`/api/plan/repartos/${reparto.id}/aplicar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tc_usado: Number(tcUsado) }),
      }));
      setBolsillos(data.bolsillos);
      setReparto(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude aplicar el reparto");
    } finally {
      setProcesando(false);
    }
  }

  async function descartarReparto() {
    if (!reparto) return;
    setProcesando(true);
    setError(null);
    try {
      await leerRespuesta(await fetch(`/api/plan/repartos/${reparto.id}/descartar`, { method: "POST" }));
      setReparto(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude descartar el reparto");
    } finally {
      setProcesando(false);
    }
  }

  async function guardarAjuste(clave: ClaveBolsillo) {
    const saldoReal = Number(valorAjuste[clave]);
    if (!Number.isFinite(saldoReal) || saldoReal < 0) return;
    setError(null);
    try {
      const data = await leerRespuesta(await fetch(`/api/plan/bolsillos/${clave}/ajuste`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saldo_real: saldoReal }),
      }));
      if (data.bolsillo) setBolsillos((actuales) => actuales.map((b) => b.clave === clave ? data.bolsillo : b));
      setAjustando(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude ajustar el saldo");
    }
  }

  async function calcularRepartoManual(evento: React.FormEvent) {
    evento.preventDefault();
    const monto = Number(montoDisponible);
    if (!Number.isFinite(monto) || monto <= 0) return;
    setProcesando(true);
    setError(null);
    try {
      const data = await leerRespuesta(await fetch("/api/plan/reparto-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto }),
      }));
      setReparto(data.reparto);
      setTcUsado(String(data.reparto.tc_referencia));
      setMontoDisponible("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude calcular el reparto");
    } finally {
      setProcesando(false);
    }
  }

  async function guardarConfig(cambios: Record<string, unknown>) {
    setProcesando(true);
    setError(null);
    try {
      const data = await leerRespuesta(await fetch("/api/plan/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      }));
      setConfig(data.config);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude guardar la configuración");
    } finally {
      setProcesando(false);
    }
  }

  function cambiarPorcentaje(campo: keyof Porcentajes, valor: number) {
    const nuevo = Math.max(0, Math.min(100, Math.round(valor)));
    const otros = CAMPOS_PCT.filter((actual) => actual !== campo);
    const restante = 100 - nuevo;
    const sumaOtros = porcentajes[otros[0]] + porcentajes[otros[1]];
    const primerOtro = sumaOtros === 0 ? Math.round(restante / 2) : Math.round(restante * porcentajes[otros[0]] / sumaOtros);
    setPorcentajes({ ...porcentajes, [campo]: nuevo, [otros[0]]: primerOtro, [otros[1]]: restante - primerOtro });
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-6 p-5 pb-12 mx-auto">
      <header className="pt-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Tu política</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Plan de inversión</h1>
        <p className="mt-1 text-sm text-muted">Cada cobro de Clientes se reparte con tus reglas.</p>
      </header>

      {reparto ? (
        <section className="card flex flex-col gap-4 p-4 border-accent/50">
          <div className="flex items-start justify-between gap-3">
            <div><p className="text-sm text-muted">Reparto pendiente</p><p className="text-2xl font-semibold tabular-nums">${fmtArs(reparto.monto_ars)}</p></div>
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent">MEP ${fmtArs(reparto.tc_referencia)}</span>
          </div>
          <ul className="flex flex-col gap-1.5 text-sm text-muted">
            {reparto.detalle.explicacion.map((linea) => <li key={linea}>{linea}</li>)}
          </ul>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
            {reparto.detalle.acciones.map((accion) => <li key={accion}>{accion}</li>)}
          </ol>
          <p className="text-xs text-muted">Sugerencia según tu plan, no asesoramiento financiero.</p>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Cotización que usaste en ARQ
            <input type="number" min="1" value={tcUsado} onChange={(e) => setTcUsado(e.target.value)} className="input-plan" />
          </label>
          <div className="flex gap-2">
            <button onClick={aplicarReparto} disabled={procesando || Number(tcUsado) <= 0} className="pressable flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50">Ya lo hice en ARQ</button>
            <button onClick={descartarReparto} disabled={procesando} className="pressable rounded-xl border border-border px-4 py-2.5 text-sm disabled:opacity-50">Descartar</button>
          </div>
        </section>
      ) : (
        <form onSubmit={calcularRepartoManual} className="card flex flex-col gap-3 p-4">
          <div><p className="font-medium">Simular plata disponible</p><p className="text-sm text-muted">Usa las mismas reglas que un cobro.</p></div>
          <div className="flex gap-2">
            <input type="number" min="1" value={montoDisponible} onChange={(e) => setMontoDisponible(e.target.value)} placeholder="Ej: 690000" className="input-plan min-w-0 flex-1" />
            <button disabled={procesando || !montoDisponible} className="pressable rounded-xl bg-accent px-4 text-sm font-semibold text-black disabled:opacity-50">Calcular</button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted">Gasto mensual real</span>
        <span className="text-xl font-semibold tabular-nums">{gastoMensualArsInicial === null ? "Sin datos" : `$${fmtArs(gastoMensualArsInicial)}`}</span>
      </div>
      <p className="-mt-5 text-right text-xs text-muted">{gastoMensualFuenteInicial === "calculado" ? "promedio de 3 meses completos" : "valor manual"}{mepReferenciaInicial ? ` · MEP $${fmtArs(mepReferenciaInicial)}` : ""}</p>

      <section className="flex flex-col gap-3">
        {bolsillos.map((bolsillo) => {
          const meta = Number(bolsillo.meta ?? 0);
          const progreso = meta > 0 ? Math.min(100, Math.round(Number(bolsillo.saldo) / meta * 100)) : null;
          const simbolo = bolsillo.moneda === "USD" ? "US$" : "$";
          const formatear = bolsillo.moneda === "USD" ? fmtUsd : fmtArs;
          return (
            <article key={bolsillo.id} className="card flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div><p className="font-medium">{bolsillo.nombre}</p>{meta > 0 && <p className="text-xs text-muted">Meta {simbolo}{formatear(meta)}</p>}</div>
                <p className="text-2xl font-semibold tabular-nums">{simbolo}{formatear(Number(bolsillo.saldo))}</p>
              </div>
              {progreso !== null && <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${progreso}%` }} /></div>}
              {ajustando === bolsillo.clave ? (
                <div className="flex gap-2">
                  <input autoFocus type="number" min="0" value={valorAjuste[bolsillo.clave] ?? ""} onChange={(e) => setValorAjuste((actual) => ({ ...actual, [bolsillo.clave]: e.target.value }))} className="input-plan min-w-0 flex-1" />
                  <button onClick={() => guardarAjuste(bolsillo.clave)} className="pressable rounded-xl bg-accent px-3 text-black" aria-label="Guardar saldo"><IconCheck size={16} /></button>
                </div>
              ) : (
                <button onClick={() => { setAjustando(bolsillo.clave); setValorAjuste((actual) => ({ ...actual, [bolsillo.clave]: String(bolsillo.saldo) })); }} className="self-start text-xs text-muted hover:text-foreground">Ajustar</button>
              )}
            </article>
          );
        })}
      </section>

      {config && (
        <section className="card flex flex-col gap-5 p-4">
          <div><p className="font-medium">Porcentajes del próximo cobro</p><p className="text-sm text-muted">Los tres controles siempre suman 100%.</p></div>
          {CAMPOS_PCT.map((campo) => (
            <label key={campo} className="flex flex-col gap-2 text-sm">
              <span className="flex justify-between"><span>{ETIQUETAS_PCT[campo]}</span><strong className="tabular-nums">{porcentajes[campo]}%</strong></span>
              <input type="range" min="0" max="100" step="1" value={porcentajes[campo]} onChange={(e) => cambiarPorcentaje(campo, Number(e.target.value))} className="accent-accent" />
            </label>
          ))}
          <button onClick={() => guardarConfig(porcentajes)} disabled={procesando} className="pressable rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50">Guardar porcentajes</button>
          <div className="grid grid-cols-2 gap-3 border-t border-border-soft pt-4">
            <label className="flex flex-col gap-1 text-xs text-muted">Meses de emergencia<input type="number" min="1" defaultValue={config.meses_emergencia} onBlur={(e) => guardarConfig({ meses_emergencia: Number(e.target.value) })} className="input-plan" /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Mínimo de compra (US$)<input type="number" min="1" defaultValue={config.minimo_compra_usd} onBlur={(e) => guardarConfig({ minimo_compra_usd: Number(e.target.value) })} className="input-plan" /></label>
            <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">Gasto mensual manual (si no hay 3 meses de datos)<input type="number" min="0" defaultValue={config.gasto_mensual_manual ?? ""} onBlur={(e) => guardarConfig({ gasto_mensual_manual: e.target.value ? Number(e.target.value) : null })} className="input-plan" /></label>
          </div>
        </section>
      )}
    </div>
  );
}
