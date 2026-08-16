// Calcula la próxima fecha (YYYY-MM-DD) en que corresponde una recurrente,
// dado su día del mes configurado y cuándo fue su última ejecución.
// Si el día del mes no existe en el mes destino (ej. 31 en febrero), recorta al último día válido.
export function proximaFechaRecurrente(
  diaDelMes: number,
  ultimaEjecucion: string | null,
  hoyISO: string
): string {
  const [anio, mes] = hoyISO.split("-").map(Number);
  const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");

  const diaEsteMes = Math.min(diaDelMes, ultimoDia(anio, mes));
  const fechaEsteMes = `${anio}-${pad(mes)}-${pad(diaEsteMes)}`;

  if (fechaEsteMes >= hoyISO && ultimaEjecucion !== fechaEsteMes) return fechaEsteMes;

  const anioSig = mes === 12 ? anio + 1 : anio;
  const mesSig = mes === 12 ? 1 : mes + 1;
  const diaSig = Math.min(diaDelMes, ultimoDia(anioSig, mesSig));
  return `${anioSig}-${pad(mesSig)}-${pad(diaSig)}`;
}
