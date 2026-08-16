const fmt = (n: number) => Math.round(n).toLocaleString("es-AR");
const fmtFecha = (iso: string) => {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
};

type CuotaPendiente = {
  id: string;
  descripcion: string | null;
  fecha: string;
  monto_ars: number;
  cuota_nro: number;
  cuotas_total: number;
  categoriaEmoji?: string;
};

type SuscripcionAVencer = {
  id: string;
  descripcion: string;
  monto: number;
  proximaFecha: string;
};

export function PagosPendientes({
  cuotas,
  suscripciones,
}: {
  cuotas: CuotaPendiente[];
  suscripciones: SuscripcionAVencer[];
}) {
  const totalCuotas = cuotas.reduce((acc, c) => acc + c.monto_ars, 0);
  const totalSuscripciones = suscripciones.reduce((acc, s) => acc + s.monto, 0);
  const totalGeneral = totalCuotas + totalSuscripciones;

  if (cuotas.length === 0 && suscripciones.length === 0) return null;

  return (
    <div className="flex flex-col gap-5 w-full max-w-md mx-auto px-5 pb-8">
      <div className="card flex items-center justify-between px-4 py-3.5">
        <span className="text-muted text-sm">Pagos pendientes</span>
        <span className="text-lg font-semibold tabular-nums">${fmt(totalGeneral)}</span>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-muted text-xs font-medium uppercase tracking-widest">Cuotas pendientes</h2>
        {cuotas.length === 0 ? (
          <p className="text-muted text-sm py-2">No tenés cuotas futuras.</p>
        ) : (
          <>
            {cuotas.map((c) => (
              <div key={c.id} className="card flex items-center justify-between px-4 py-3.5">
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {c.categoriaEmoji ? `${c.categoriaEmoji} ` : ""}
                    {c.descripcion}
                  </p>
                  <p className="text-muted text-sm">
                    Cuota {c.cuota_nro}/{c.cuotas_total} · {fmtFecha(c.fecha)}
                  </p>
                </div>
                <span className="text-lg font-semibold tabular-nums shrink-0">${fmt(c.monto_ars)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-muted text-sm">Total cuotas pendientes</span>
              <span className="font-semibold tabular-nums">${fmt(totalCuotas)}</span>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-muted text-xs font-medium uppercase tracking-widest">Suscripciones a vencer (7 días)</h2>
        {suscripciones.length === 0 ? (
          <p className="text-muted text-sm py-2">No hay suscripciones o recurrentes por vencer esta semana.</p>
        ) : (
          <>
            {suscripciones.map((s) => (
              <div key={s.id} className="card flex items-center justify-between px-4 py-3.5">
                <div className="min-w-0">
                  <p className="font-medium truncate">{s.descripcion}</p>
                  <p className="text-muted text-sm">{fmtFecha(s.proximaFecha)}</p>
                </div>
                <span className="text-lg font-semibold tabular-nums shrink-0">${fmt(s.monto)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-muted text-sm">Total suscripciones</span>
              <span className="font-semibold tabular-nums">${fmt(totalSuscripciones)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
