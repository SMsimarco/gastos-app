"use client";

import { useMemo, useState } from "react";
import { compraBloqueadaPorTesis } from "@/lib/inversiones/aprenderActivos";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type ActivoDisponible = {
  id: string;
  ticker: string;
  nombre: string;
  tipo: "etf" | "accion" | "cuenta_remunerada";
  bolsillo_clave?: string | null;
  tesis?: string | null;
};

type Cartera = {
  activos: Array<{
    id: string;
    ticker: string;
    nombre: string;
    cantidad: number;
    costoPromedioUsd: number;
    invertidoUsd: number;
    valorActualUsd: number;
    gananciaUsd: number;
    gananciaPct: number;
    precioActualUsd: number | null;
    fechaPrecio: string | null;
    precioDesactualizado: boolean;
  }>;
  cuentas: Array<{
    id: string;
    ticker: string;
    nombre: string;
    moneda: "ARS" | "USD";
    saldo: number;
    tasaAnualPct: number;
    rendimientoMes: number;
    rendimientoAnio: number;
    tasaRealAnualPct: number | null;
    rendimientoRealMes: number | null;
  }>;
  total: { valorUsd: number; invertidoUsd: number; gananciaUsd: number; gananciaPct: number };
  benchmark: { diferenciaUsd: number; diferenciaPct: number; hubieraSidoMejorVoo: boolean };
  historial: Array<{ fecha: string; valorUsd: number }>;
  activosDisponibles: ActivoDisponible[];
  tcReferencia: number | null;
};

const usd = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const ars = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const numero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 6 });

function colorGanancia(valor: number) {
  return valor > 0 ? "text-positive" : valor < 0 ? "text-danger" : "text-muted";
}

export function GestionCartera({ carteraInicial }: { carteraInicial: Cartera }) {
  const [cartera, setCartera] = useState(carteraInicial);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; error: boolean } | null>(null);
  const activosCompra = useMemo(
    () => cartera.activosDisponibles.filter((activo) => activo.tipo !== "cuenta_remunerada"),
    [cartera.activosDisponibles]
  );
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

  async function registrarCompra(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setGuardando(true);
    setMensaje(null);
    const formulario = new FormData(evento.currentTarget);
    try {
      const respuesta = await fetch("/api/cartera/operaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activo_id: formulario.get("activo_id"),
          tipo: "compra",
          monto_usd: Number(formulario.get("monto_usd")),
          precio_usd: Number(formulario.get("precio_usd")),
          comision_usd: Number(formulario.get("comision_usd") || 0),
          fecha: formulario.get("fecha"),
        }),
      });
      const data = await respuesta.json();
      if (!respuesta.ok) throw new Error(data.error ?? "No pude registrar la compra");
      const carteraActualizada = await fetch("/api/cartera", { cache: "no-store" });
      const dataCartera = await carteraActualizada.json();
      if (!carteraActualizada.ok) throw new Error(dataCartera.error ?? "No pude actualizar la cartera");
      setCartera(dataCartera);
      setMostrarFormulario(false);
      setMensaje({
        texto: data.operacion.avisoSaldoNegativo ?? `Compra de ${data.operacion.activo.ticker} registrada.`,
        error: Boolean(data.operacion.avisoSaldoNegativo),
      });
    } catch (error) {
      setMensaje({ texto: error instanceof Error ? error.message : "No pude registrar la compra", error: true });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 p-5 pb-12">
      <header className="pt-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Tus inversiones</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Cartera</h1>
      </header>

      <section className="card p-5">
        <p className="text-sm text-muted">Valor total</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums">{usd.format(cartera.total.valorUsd)}</p>
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border-soft pt-4">
          <div><p className="text-xs text-muted">Invertido</p><p className="mt-1 font-medium tabular-nums">{usd.format(cartera.total.invertidoUsd)}</p></div>
          <div><p className="text-xs text-muted">Ganancia</p><p className={`mt-1 font-semibold tabular-nums ${colorGanancia(cartera.total.gananciaUsd)}`}>{usd.format(cartera.total.gananciaUsd)} · {cartera.total.gananciaPct.toFixed(2)}%</p></div>
        </div>
        <p className={`mt-4 text-sm tabular-nums ${cartera.benchmark.hubieraSidoMejorVoo ? "text-danger" : "text-positive"}`}>
          Vs. todo en VOO: {cartera.benchmark.hubieraSidoMejorVoo ? "+" : ""}{cartera.benchmark.diferenciaPct.toFixed(2)}% para VOO
        </p>
      </section>

      {mensaje && <p role="status" className={`rounded-xl border p-3 text-sm ${mensaje.error ? "border-danger/40 bg-danger/10 text-danger" : "border-positive/40 bg-positive/10 text-positive"}`}>{mensaje.texto}</p>}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Activos</h2>
          <button onClick={() => setMostrarFormulario((actual) => !actual)} className="pressable rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-black">{mostrarFormulario ? "Cerrar" : "Registrar compra"}</button>
        </div>

        {mostrarFormulario && (
          <form onSubmit={registrarCompra} className="card grid grid-cols-2 gap-3 p-4">
            <label className="col-span-2 flex flex-col gap-1 text-xs text-muted">Activo<select name="activo_id" required className="input-plan">{activosCompra.map((activo) => { const sinTesis = compraBloqueadaPorTesis(activo, "compra") !== null; return <option key={activo.id} value={activo.id} disabled={sinTesis}>{activo.ticker} · {activo.nombre}{sinTesis ? " (falta tu tesis en Plan → Aprender)" : ""}</option>; })}</select></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Monto total (US$)<input name="monto_usd" type="number" min="0.01" step="0.01" required className="input-plan" /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Precio unitario (US$)<input name="precio_usd" type="number" min="0.000001" step="0.000001" required className="input-plan" /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Comisión (US$)<input name="comision_usd" type="number" min="0" step="0.01" defaultValue="0" className="input-plan" /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Fecha<input name="fecha" type="date" required defaultValue={hoy} className="input-plan" /></label>
            <button disabled={guardando || activosCompra.length === 0} className="pressable col-span-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50">{guardando ? "Guardando…" : "Guardar compra"}</button>
          </form>
        )}

        {cartera.activos.map((activo) => (
          <article key={activo.id} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="text-lg font-semibold">{activo.ticker}</p><p className="text-xs text-muted">{activo.nombre}</p></div>
              <div className="text-right"><p className="text-xl font-semibold tabular-nums">{usd.format(activo.valorActualUsd)}</p><p className={`text-sm font-medium tabular-nums ${colorGanancia(activo.gananciaUsd)}`}>{usd.format(activo.gananciaUsd)} · {activo.gananciaPct.toFixed(2)}%</p></div>
            </div>
            <div className="mt-3 flex justify-between border-t border-border-soft pt-3 text-xs text-muted">
              <span>{numero.format(activo.cantidad)} unidades</span>
              <span className="tabular-nums">Costo prom. {usd.format(activo.costoPromedioUsd)}</span>
            </div>
            {activo.precioDesactualizado && <p className="mt-2 text-xs text-danger">Precio desactualizado{activo.fechaPrecio ? ` · último cierre ${activo.fechaPrecio}` : ""}</p>}
          </article>
        ))}
        {cartera.activos.length === 0 && <p className="text-sm text-muted">Todavía no hay activos de mercado en tu política.</p>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Cuentas remuneradas</h2>
        {cartera.cuentas.map((cuenta) => {
          const formatear = cuenta.moneda === "ARS" ? ars : usd;
          return (
            <article key={cuenta.id} className="card p-4">
              <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{cuenta.nombre}</p><p className="text-xs text-muted">TNA {cuenta.tasaAnualPct.toFixed(2)}%</p></div><p className="text-xl font-semibold tabular-nums">{formatear.format(cuenta.saldo)}</p></div>
              <p className="mt-3 text-sm text-positive tabular-nums">Estimado del mes: {formatear.format(cuenta.rendimientoMes)}</p>
              {cuenta.tasaRealAnualPct !== null && <p className={`mt-1 text-xs tabular-nums ${colorGanancia(cuenta.tasaRealAnualPct)}`}>Tasa real anual aproximada: {cuenta.tasaRealAnualPct.toFixed(2)}%</p>}
            </article>
          );
        })}
        {cartera.tcReferencia && <p className="text-xs text-muted">Conversión de saldos en pesos con MEP de referencia: {ars.format(cartera.tcReferencia)}.</p>}
      </section>

      <section className="card p-4">
        <div><h2 className="font-semibold">Valor en el tiempo</h2><p className="text-xs text-muted">Activos de mercado, en dólares</p></div>
        {cartera.historial.length > 1 ? (
          <div className="mt-4 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cartera.historial} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border-soft)" vertical={false} />
                <XAxis dataKey="fecha" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={false} width={48} tickFormatter={(valor) => `$${valor}`} />
                <Tooltip contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12 }} formatter={(valor) => [usd.format(Number(valor)), "Valor"]} />
                <Area type="monotone" dataKey="valorUsd" stroke="var(--accent)" fill="var(--accent-soft)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : <p className="mt-4 text-sm text-muted">El gráfico aparece cuando haya precios históricos para tus operaciones.</p>}
      </section>
    </div>
  );
}
