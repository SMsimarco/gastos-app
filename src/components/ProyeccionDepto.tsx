"use client";

import { useEffect, useState } from "react";

type Escenarios<T> = { pesimista: T; base: T; optimista: T };
type Respuesta = {
  configurada: boolean;
  mensaje?: string;
  datos?: { saldoActualUsd: number; ahorroMensualPromedioUsd: number; precioObjetivoUsd: number; rendimientoAnualSupuesto: number };
  proyeccion?: { seLlega: boolean; meses: Escenarios<number | null>; fechaEstimada: Escenarios<string | null> };
  palancas?: Array<{ clave: string; nombre: string; meses: number | null; mesesGanados: number | null }>;
};

function plazo(meses: number | null) {
  if (meses === null) return "No se alcanza";
  const anios = Math.floor(meses / 12);
  const resto = meses % 12;
  if (anios === 0) return `${resto} ${resto === 1 ? "mes" : "meses"}`;
  return `${anios} ${anios === 1 ? "año" : "años"}${resto ? ` y ${resto} ${resto === 1 ? "mes" : "meses"}` : ""}`;
}
function fecha(valor: string | null) {
  return valor ? new Date(valor).toLocaleDateString("es-AR", { month: "short", year: "numeric", timeZone: "UTC" }) : "Sin fecha";
}

export function ProyeccionDepto() {
  const [resultado, setResultado] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activa = true;
    const cargar = () => {
      fetch("/api/plan/proyeccion")
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "No pude calcular la proyección");
          if (activa) { setResultado(data); setError(null); }
        })
        .catch((cause) => { if (activa) setError(cause instanceof Error ? cause.message : "No pude calcular la proyección"); });
    };
    cargar();
    window.addEventListener("plan-config-actualizada", cargar);
    return () => { activa = false; window.removeEventListener("plan-config-actualizada", cargar); };
  }, []);

  if (error) return <section className="card p-4 text-sm text-danger">⚠️ {error}</section>;
  if (!resultado) return <section className="card p-4 text-sm text-muted">Calculando proyección…</section>;
  if (!resultado.configurada) return (
    <section className="card p-4">
      <p className="font-medium">🏠 Proyección del depto</p>
      <p className="mt-1 text-sm text-muted">{resultado.mensaje}</p>
    </section>
  );

  const proyeccion = resultado.proyeccion!;
  if (!proyeccion.seLlega) return (
    <section className="card border-danger/40 p-4">
      <p className="font-medium">🏠 Proyección del depto</p>
      <p className="mt-2 text-sm">Con el ahorro actual no se llega. Necesitás aumentar ingresos o bajar gastos.</p>
      <p className="mt-2 text-xs text-muted">Ahorro promedio de los últimos 6 meses completos: US${resultado.datos!.ahorroMensualPromedioUsd.toFixed(2)} por mes.</p>
    </section>
  );

  const escenarios = [
    { clave: "optimista", nombre: "Optimista" },
    { clave: "base", nombre: "Base" },
    { clave: "pesimista", nombre: "Pesimista" },
  ] as const;
  return (
    <section className="card flex flex-col gap-4 p-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-accent">🏠 Proyección del depto</p>
        <h2 className="mt-1 text-xl font-semibold">A este ritmo llegás en {plazo(proyeccion.meses.base)}</h2>
        <p className="mt-1 text-xs text-muted">Estimación con datos reales, no una promesa. Objetivo US${resultado.datos!.precioObjetivoUsd.toLocaleString("es-AR")}.</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {escenarios.map(({ clave, nombre }) => (
          <div key={clave} className={`rounded-xl p-2.5 ${clave === "base" ? "bg-accent-soft" : "bg-surface-2"}`}>
            <p className="text-[11px] text-muted">{nombre}</p>
            <p className="mt-1 text-sm font-semibold">{plazo(proyeccion.meses[clave])}</p>
            <p className="text-[11px] text-muted">{fecha(proyeccion.fechaEstimada[clave])}</p>
          </div>
        ))}
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between text-xs text-muted"><span>Qué te acerca más</span><span>Meses que ganás</span></div>
        <div className="divide-y divide-border-soft rounded-xl border border-border-soft">
          {resultado.palancas!.map((palanca) => (
            <div key={palanca.clave} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <span>{palanca.nombre}</span>
              <strong className="shrink-0 text-positive">{palanca.mesesGanados === null ? "—" : `${palanca.mesesGanados} meses`}</strong>
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted">Usa 6 meses completos y un rendimiento real anual de {(resultado.datos!.rendimientoAnualSupuesto * 100).toFixed(1)}%.</p>
    </section>
  );
}

