// Reuniones del FOMC. El calendario de la Fed se publica con un año de anticipación y Finnhub
// lo tiene en un plan pago, así que se mantiene a mano. Fuente:
// https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (verificado 2026-10-03).
// Se guarda el día de la decisión (el segundo de cada reunión).
// Hay que sumar 2028 cuando la Fed lo publique.
export const REUNIONES_FOMC: ReadonlyArray<string> = [
  "2026-10-28",
  "2026-12-09",
  "2027-01-27",
  "2027-03-17",
  "2027-04-28",
  "2027-06-09",
  "2027-07-28",
  "2027-09-15",
  "2027-10-27",
  "2027-12-08",
];

export function reunionesFedEntre(desde: string, hasta: string): string[] {
  return REUNIONES_FOMC.filter((fecha) => fecha >= desde && fecha <= hasta);
}
