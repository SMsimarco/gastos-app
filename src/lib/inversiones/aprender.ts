// Asesor del bolsillo "aprender" (Fase 7). Funciones PURAS: el código elige los candidatos y calcula cada número;
// la IA solo redacta a partir de esto (ver aprenderTextos.ts). Nada de acá sugiere tocar VOO, emergencia ni gastos:
// las únicas acciones posibles son "comprar uno de tu lista de aprender" o "esperar / sumar a VOO lo que está en aprender".
import { evaluarObjetivoGanancia, evaluarRevisionTesis, type Sugerencia } from "./sugerencias";

export type CriterioClave = "valuacion" | "momento" | "calidad" | "noticias" | "riesgo";
export type PesosAprender = { valuacion: number; momento: number; calidad: number; noticias: number };

// Pesos por defecto (suman 100). Se editan en config_plan; ver NOTES.md para el porqué de cada uno.
export const PESOS_DEFAULT: PesosAprender = { valuacion: 30, momento: 25, calidad: 25, noticias: 20 };

export const CONCENTRACION_MAX_PCT = 50;
export const MAX_CANDIDATOS = 3;
export const DIAS_BALANCE_EXCLUYE = 3;
export const DIAS_BALANCE_RIESGO = 7;
export const DIAS_PRECIO_VIGENTE = 5;
export const MIN_NOTICIAS = 3;
export const MIN_CASOS_HISTORIAL = 30;
const VOLATILIDAD_ALTA_PCT = 40;
const PUNTAJE_MINIMO_DESTACA = 10;
const APORTE_RELEVANTE = 2; // puntos: menos que esto no cuenta como "a favor" ni "en contra"

export type NoticiaUsada = { titular: string; url: string; fuente: string; publicadoAt: string };

export type DatosMercado = {
  ticker: string;
  precio: { valor: number; fecha: string; fuente: string } | null;
  indicadores: { fecha: string; cierre: number | null; sma200: number | null; distanciaMax52s: number | null; volatilidad20: number | null } | null;
  fundamentales: { fecha: string; pe: number | null; crecimientoIngresos: number | null; margenNeto: number | null } | null;
  peProm5a: { valor: number; fecha: string } | null;
  noticias: { sentimiento: number | null; cantidad: number; usadas: NoticiaUsada[]; fechaUltima: string | null };
  proximoBalance: string | null;
};

export type ActivoAprender = {
  ticker: string;
  tesis: string;
  tomaGananciaPct: number | null;
  stopRevisionPct: number | null;
  gananciaPct: number;
  valorPosicionUsd: number;
};

export type HistorialCriterio = { casos: number; aciertos: number };

export type EstadoAprender = {
  hoy: string; // YYYY-MM-DD
  saldoAprenderUsd: number;
  minimoCompraUsd: number;
  pesos: PesosAprender;
  activos: ActivoAprender[];
  datos: Record<string, DatosMercado>;
  voo: DatosMercado | null;
  historial?: Partial<Record<CriterioClave, HistorialCriterio>>;
};

export type FilaFicha = {
  criterio: CriterioClave;
  dato: string;
  referencia: string;
  aporte: number | null; // null = marcado (riesgo) o sin dato
  pesoEfectivo: number;
  marcado: boolean;
  sinDato: boolean;
  fuente: string;
  fecha: string | null;
  enCriollo: string;
  historial: { casos: number; aciertos: number; pocosCasos: boolean } | null;
};

export type Candidato = {
  ticker: string;
  tesis: string;
  puntaje: number;
  componentes: FilaFicha[];
  montoSugeridoUsd: number;
  porQueSi: string[];
  porQueNo: string[];
  queCambiaria: string[];
  noticias: NoticiaUsada[];
  balanceEnDias: number | null;
};

export type MotivoExclusion = "balance" | "concentracion" | "sin_precio" | "sin_datos" | "puntaje_bajo";

export type Excluido = { ticker: string; motivo: MotivoExclusion; detalle: string; queCambiaria: string };

export type ResultadoAprender = {
  puedeComprar: boolean;
  saldoUsd: number;
  faltaUsd: number;
  candidatos: Candidato[];
  excluidos: Excluido[];
  voo: { puntaje: number; componentes: FilaFicha[] } | null;
  opcionEsperar: { accion: "esperar_o_sumar_a_voo"; motivo: string };
  alertas: Sugerencia[];
  advertencias: string[];
};

const redondear1 = (valor: number) => Math.round(valor * 10) / 10;
const limitar = (valor: number, minimo: number, maximo: number) => Math.min(maximo, Math.max(minimo, valor));
const numeroCorto = (valor: number) => String(redondear1(valor)).replace(".", ",");

export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

const fechaCorta = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;

// Cada función devuelve un puntaje entre -1 y 1 (o null si no hay dato) para su componente.
export function puntajeValuacion(pe: number | null, promedio: number | null): number | null {
  if (pe === null || promedio === null || pe <= 0 || promedio <= 0) return null;
  const masBarataPct = ((promedio - pe) / promedio) * 100;
  return limitar(masBarataPct / 40, -1, 1); // 40% más barata que su promedio = tope
}

// Distancia al máximo de 52 semanas (<= 0): en el máximo -0,5; 20% abajo o más +1.
export function puntajeCaida(distanciaMax52s: number): number {
  return limitar((-distanciaMax52s * 1.5) / 20 - 0.5, -0.5, 1);
}

// Precio contra su media de 200 días: debajo cae hasta -1 (tendencia rota), 0 a +15% sube hasta 1 (tendencia sana),
// y más allá de +15% se enfría hasta 0 en +40% (ya corrió demasiado).
export function puntajeTendencia(brechaPct: number): number {
  if (brechaPct <= -20) return -1;
  if (brechaPct < 0) return brechaPct / 20;
  if (brechaPct <= 15) return brechaPct / 15;
  if (brechaPct < 40) return 1 - (brechaPct - 15) / 25;
  return 0;
}

export function puntajeMomento(distanciaMax52s: number | null, brechaSma200Pct: number | null): number | null {
  const partes: number[] = [];
  if (distanciaMax52s !== null) partes.push(puntajeCaida(distanciaMax52s));
  if (brechaSma200Pct !== null) partes.push(puntajeTendencia(brechaSma200Pct));
  return partes.length ? partes.reduce((total, parte) => total + parte, 0) / partes.length : null;
}

// Crecimiento de ingresos: 0% = 0, 20% o más = 1. Margen neto: 5% = 0, 25% o más = 1.
export function puntajeCalidad(crecimientoIngresos: number | null, margenNeto: number | null): number | null {
  const partes: number[] = [];
  if (crecimientoIngresos !== null) partes.push(limitar(crecimientoIngresos / 20, -1, 1));
  if (margenNeto !== null) partes.push(limitar((margenNeto - 5) / 20, -1, 1));
  return partes.length ? partes.reduce((total, parte) => total + parte, 0) / partes.length : null;
}

export function puntajeNoticias(sentimiento: number | null, cantidad: number): number | null {
  if (sentimiento === null || cantidad < MIN_NOTICIAS) return null;
  return limitar(sentimiento / 0.5, -1, 1);
}

function historialDe(estado: EstadoAprender, criterio: CriterioClave): FilaFicha["historial"] {
  const dato = estado.historial?.[criterio];
  if (!dato) return null;
  return { casos: dato.casos, aciertos: dato.aciertos, pocosCasos: dato.casos < MIN_CASOS_HISTORIAL };
}

type FilaBase = Omit<FilaFicha, "aporte" | "pesoEfectivo" | "historial"> & { puntaje: number | null };

function filasBase(datos: DatosMercado, hoy: string): FilaBase[] {
  const indicadores = datos.indicadores;
  const fundamentales = datos.fundamentales;
  const precio = datos.precio?.valor ?? indicadores?.cierre ?? null;
  const balanceEnDias = datos.proximoBalance ? diasEntre(hoy, datos.proximoBalance) : null;

  // Valuación
  const pe = fundamentales?.pe ?? null;
  const promedio = datos.peProm5a?.valor ?? null;
  const puntajeVal = puntajeValuacion(pe, promedio);
  const filaValuacion: FilaBase = {
    criterio: "valuacion",
    puntaje: puntajeVal,
    sinDato: puntajeVal === null,
    marcado: false,
    dato: pe !== null ? `P/E ${numeroCorto(pe)}` : "Sin P/E",
    referencia: promedio !== null ? `Su promedio de 5 años: ${numeroCorto(promedio)}` : "Sin promedio de 5 años",
    fuente: "Finnhub",
    fecha: datos.peProm5a?.fecha ?? fundamentales?.fecha ?? null,
    enCriollo:
      puntajeVal === null
        ? "No hay dato para saber si está cara o barata"
        : pe! < promedio! * 0.9
          ? "Está más barata que de costumbre"
          : pe! > promedio! * 1.1
            ? "Está más cara que de costumbre"
            : "Está en su precio de siempre",
  };

  // Momento
  const distancia = indicadores?.distanciaMax52s ?? null;
  const brecha = precio !== null && indicadores?.sma200 ? (precio / indicadores.sma200 - 1) * 100 : null;
  const puntajeMom = puntajeMomento(distancia, brecha);
  const filaMomento: FilaBase = {
    criterio: "momento",
    puntaje: puntajeMom,
    sinDato: puntajeMom === null,
    marcado: false,
    dato: distancia !== null ? `${numeroCorto(Math.abs(distancia))}% abajo del máximo de 52 semanas` : "Sin distancia al máximo",
    referencia: brecha !== null && indicadores?.sma200 ? `Media de 200 días: US$${numeroCorto(indicadores.sma200)} (el precio está ${brecha >= 0 ? "+" : "−"}${numeroCorto(Math.abs(brecha))}%)` : "Sin media de 200 días",
    fuente: "Alpaca (precios) y cálculo propio",
    fecha: indicadores?.fecha ?? null,
    enCriollo:
      puntajeMom === null
        ? "No hay dato de precios para ver el momento"
        : distancia !== null && distancia <= -10
          ? "Viene de una baja, no de una suba"
          : distancia !== null && distancia >= -3
            ? "Está cerca de su máximo: ya subió"
            : "Bajó algo desde su máximo",
  };

  // Calidad
  const crecimiento = fundamentales?.crecimientoIngresos ?? null;
  const margen = fundamentales?.margenNeto ?? null;
  const puntajeCal = puntajeCalidad(crecimiento, margen);
  const filaCalidad: FilaBase = {
    criterio: "calidad",
    puntaje: puntajeCal,
    sinDato: puntajeCal === null,
    marcado: false,
    dato:
      puntajeCal === null
        ? "Sin datos de crecimiento ni margen"
        : [crecimiento !== null ? `Ingresos ${crecimiento >= 0 ? "+" : "−"}${numeroCorto(Math.abs(crecimiento))}% al año` : null, margen !== null ? `margen neto ${numeroCorto(margen)}%` : null].filter(Boolean).join(", "),
    referencia: "Escala: crecer 20% y margen de 25% es el máximo",
    fuente: "Finnhub",
    fecha: fundamentales?.fecha ?? null,
    enCriollo: puntajeCal === null ? "No hay dato de cómo le va a la empresa" : puntajeCal > 0.3 ? "Crece y gana plata" : puntajeCal < -0.3 ? "Crece poco o gana poco" : "Una empresa normal en lo que gana",
  };

  // Noticias
  const puntajeNot = puntajeNoticias(datos.noticias.sentimiento, datos.noticias.cantidad);
  const sentimiento = datos.noticias.sentimiento;
  const filaNoticias: FilaBase = {
    criterio: "noticias",
    puntaje: puntajeNot,
    sinDato: puntajeNot === null,
    marcado: false,
    dato: puntajeNot === null ? `Solo ${datos.noticias.cantidad} ${datos.noticias.cantidad === 1 ? "noticia" : "noticias"} en 7 días` : `Sentimiento ${numeroCorto(sentimiento!)} (${datos.noticias.cantidad} noticias, 7 días)`,
    referencia: "Escala de −1 (muy malas) a +1 (muy buenas)",
    fuente: "Noticias del laboratorio",
    fecha: datos.noticias.fechaUltima,
    enCriollo: puntajeNot === null ? "Hay pocas noticias para opinar" : sentimiento! > 0.15 ? "Las noticias vienen buenas" : sentimiento! < -0.15 ? "Las noticias vienen malas" : "Las noticias vienen tranquilas",
  };

  // Riesgo: se marca, no suma ni resta.
  const volatilidad = indicadores?.volatilidad20 ?? null;
  const balanceCerca = balanceEnDias !== null && balanceEnDias >= 0 && balanceEnDias <= DIAS_BALANCE_RIESGO;
  const volatil = volatilidad !== null && volatilidad > VOLATILIDAD_ALTA_PCT;
  const filaRiesgo: FilaBase = {
    criterio: "riesgo",
    puntaje: null,
    sinDato: volatilidad === null && datos.proximoBalance === null,
    marcado: balanceCerca || volatil,
    dato: [volatilidad !== null ? `Volatilidad ${numeroCorto(volatilidad)}% anual` : null, balanceEnDias !== null && balanceEnDias >= 0 ? `balance en ${balanceEnDias} ${balanceEnDias === 1 ? "día" : "días"}` : null].filter(Boolean).join(", ") || "Sin datos de riesgo",
    referencia: datos.proximoBalance ? `Balance el ${fechaCorta(datos.proximoBalance)}` : "—",
    fuente: "Alpaca y Finnhub",
    fecha: indicadores?.fecha ?? null,
    enCriollo: balanceCerca ? "Puede moverse fuerte ese día" : volatil ? "Se mueve bastante de un día para otro" : "Riesgo normal para una acción",
  };

  return [filaValuacion, filaMomento, filaCalidad, filaNoticias, filaRiesgo];
}

// Arma la ficha con los aportes ya ponderados. Si un componente no tiene dato, su peso se reparte entre los que sí
// tienen (así el puntaje sigue yendo de −100 a +100 y la suma de los aportes es el puntaje total).
export function armarFicha(estado: EstadoAprender, datos: DatosMercado): { puntaje: number; componentes: FilaFicha[] } {
  const base = filasBase(datos, estado.hoy);
  const pesos = estado.pesos;
  const conDato = base.filter((fila) => fila.puntaje !== null && fila.criterio !== "riesgo");
  const sumaPesos = conDato.reduce((total, fila) => total + pesos[fila.criterio as keyof PesosAprender], 0);
  let puntaje = 0;
  const componentes = base.map((fila): FilaFicha => {
    const { puntaje: puntajeFila, ...resto } = fila;
    let aporte: number | null = null;
    let pesoEfectivo = 0;
    if (puntajeFila !== null && fila.criterio !== "riesgo" && sumaPesos > 0) {
      pesoEfectivo = redondear1((pesos[fila.criterio as keyof PesosAprender] / sumaPesos) * 100);
      aporte = redondear1(pesoEfectivo * puntajeFila);
      puntaje += aporte;
    }
    return { ...resto, aporte, pesoEfectivo, historial: historialDe(estado, fila.criterio) };
  });
  return { puntaje: redondear1(puntaje), componentes };
}

function queCambiaria(datos: DatosMercado, componentes: FilaFicha[], hoy: string): string[] {
  const cambios: string[] = [];
  const pe = datos.fundamentales?.pe ?? null;
  const promedio = datos.peProm5a?.valor ?? null;
  if (pe !== null && promedio !== null && pe > 0 && pe < promedio) {
    cambios.push(`Si sube ${numeroCorto((promedio / pe - 1) * 100)}% más, deja de estar barata contra su promedio.`);
  } else if (pe !== null && promedio !== null && pe >= promedio) {
    cambios.push(`Si baja ${numeroCorto((1 - promedio / pe) * 100)}%, vuelve a su promedio de 5 años.`);
  }
  const distancia = datos.indicadores?.distanciaMax52s ?? null;
  if (distancia !== null && distancia > -10) cambios.push("Si cae a más de 10% debajo de su máximo, mejora en momento.");
  if (datos.proximoBalance) {
    const dias = diasEntre(hoy, datos.proximoBalance);
    if (dias >= 0) cambios.push(`Después del balance (${fechaCorta(datos.proximoBalance)}) se vuelve a evaluar.`);
  }
  if (componentes.find((fila) => fila.criterio === "noticias")?.sinDato) cambios.push("Con más noticias en la semana se puede evaluar ese criterio.");
  return cambios;
}

// Recibe el estado y devuelve candidatos, excluidos con motivo, y la opción de esperar. No tiene efectos.
export function evaluarCandidatos(estado: EstadoAprender): ResultadoAprender {
  const saldo = Math.max(0, estado.saldoAprenderUsd);
  const puedeComprar = saldo >= estado.minimoCompraUsd;
  const faltaUsd = puedeComprar ? 0 : Math.round((estado.minimoCompraUsd - saldo) * 100) / 100;
  const advertencias: string[] = [];

  // Toma de ganancia y revisión de tesis: mismas reglas 4 y 5 de sugerencias.ts.
  const alertas: Sugerencia[] = estado.activos.flatMap((activo) => {
    const base = { ticker: activo.ticker, bolsilloClave: "aprender", gananciaPct: activo.gananciaPct, precioActualUsd: null, max52sUsd: null, tomaGananciaPct: activo.tomaGananciaPct, stopRevisionPct: activo.stopRevisionPct };
    return [evaluarObjetivoGanancia(base), evaluarRevisionTesis(base)].filter((item): item is Sugerencia => item !== null);
  });

  const voo = estado.voo ? armarFicha(estado, estado.voo) : null;

  const vacio = (motivo: string): ResultadoAprender => ({
    puedeComprar, saldoUsd: saldo, faltaUsd, candidatos: [], excluidos: [], voo, opcionEsperar: { accion: "esperar_o_sumar_a_voo", motivo }, alertas, advertencias,
  });

  // Bajo el mínimo solo se informa cuánto falta.
  if (!puedeComprar) return vacio(`Todavía te faltan US$${Math.round(faltaUsd)} para llegar al mínimo de US$${Math.round(estado.minimoCompraUsd)}.`);
  if (estado.activos.length === 0) {
    advertencias.push("Tu lista de aprender está vacía: sumá activos con su tesis para que haya qué evaluar.");
    return vacio("No hay activos en tu lista de aprender: podés esperar o sumar el saldo a VOO.");
  }

  const posicionesUsd = estado.activos.reduce((total, activo) => total + Math.max(0, activo.valorPosicionUsd), 0);
  const totalBolsilloUsd = saldo + posicionesUsd;
  const elegibles: Array<{ activo: ActivoAprender; puntaje: number; componentes: FilaFicha[]; datos: DatosMercado }> = [];
  const excluidos: Excluido[] = [];

  for (const activo of estado.activos) {
    const datos = estado.datos[activo.ticker];
    const precioFecha = datos?.precio?.fecha ?? datos?.indicadores?.fecha ?? null;
    if (!datos || !datos.precio || !precioFecha || diasEntre(precioFecha, estado.hoy) > DIAS_PRECIO_VIGENTE) {
      excluidos.push({ ticker: activo.ticker, motivo: "sin_precio", detalle: "No tiene un precio actualizado en el laboratorio.", queCambiaria: "Cuando el laboratorio traiga un precio nuevo se vuelve a evaluar." });
      continue;
    }
    const diasBalance = datos.proximoBalance ? diasEntre(estado.hoy, datos.proximoBalance) : null;
    if (diasBalance !== null && diasBalance >= 0 && diasBalance < DIAS_BALANCE_EXCLUYE) {
      excluidos.push({ ticker: activo.ticker, motivo: "balance", detalle: `Presenta balance en ${diasBalance} ${diasBalance === 1 ? "día" : "días"} (${fechaCorta(datos.proximoBalance!)}).`, queCambiaria: `Después del balance (${fechaCorta(datos.proximoBalance!)}) se vuelve a evaluar.` });
      continue;
    }
    // La concentración solo se mide si el bolsillo ya tiene posiciones: en la primera compra no hay con qué diversificar.
    if (posicionesUsd > 0 && totalBolsilloUsd > 0) {
      const actualPct = (Math.max(0, activo.valorPosicionUsd) / totalBolsilloUsd) * 100;
      const despuesPct = ((Math.max(0, activo.valorPosicionUsd) + saldo) / totalBolsilloUsd) * 100;
      if (actualPct > CONCENTRACION_MAX_PCT || despuesPct > CONCENTRACION_MAX_PCT) {
        excluidos.push({
          ticker: activo.ticker,
          motivo: "concentracion",
          detalle: actualPct > CONCENTRACION_MAX_PCT ? `Ya es el ${Math.round(actualPct)}% de tu bolsillo aprender (el máximo es ${CONCENTRACION_MAX_PCT}%).` : `Sumarle US$${Math.round(saldo)} lo dejaría en ${Math.round(despuesPct)}% del bolsillo aprender (el máximo es ${CONCENTRACION_MAX_PCT}%).`,
          queCambiaria: "Que el bolsillo crezca o que sumes plata a otros activos de tu lista.",
        });
        continue;
      }
    }
    const ficha = armarFicha(estado, datos);
    if (ficha.componentes.every((fila) => fila.sinDato || fila.criterio === "riesgo")) {
      excluidos.push({ ticker: activo.ticker, motivo: "sin_datos", detalle: "No hay datos suficientes para puntuarlo (precio, valuación, calidad o noticias).", queCambiaria: "Cuando el laboratorio junte datos de este activo se vuelve a evaluar." });
      continue;
    }
    elegibles.push({ activo, ...ficha, datos });
  }

  // Orden: mayor puntaje primero; en empate, por ticker (así el resultado es siempre el mismo).
  elegibles.sort((a, b) => b.puntaje - a.puntaje || a.activo.ticker.localeCompare(b.activo.ticker));
  const elegidos = elegibles.slice(0, MAX_CANDIDATOS);
  const umbral = elegidos.at(-1)?.puntaje ?? 0;
  for (const resto of elegibles.slice(MAX_CANDIDATOS)) {
    excluidos.push({
      ticker: resto.activo.ticker,
      motivo: "puntaje_bajo",
      detalle: `Quedó afuera por puntaje: ${resto.puntaje} contra ${umbral} del último candidato.`,
      queCambiaria: `Tendría que subir de ${resto.puntaje} a más de ${umbral} puntos para entrar.`,
    });
  }

  const candidatos: Candidato[] = elegidos.map(({ activo, puntaje, componentes, datos }) => ({
    ticker: activo.ticker,
    tesis: activo.tesis,
    puntaje,
    componentes,
    montoSugeridoUsd: Math.round(saldo * 100) / 100,
    porQueSi: [...componentes].filter((fila) => fila.aporte !== null && fila.aporte >= APORTE_RELEVANTE).sort((a, b) => b.aporte! - a.aporte!).map((fila) => fila.enCriollo),
    // Solo cuenta como "en contra" lo que resta con claridad (2 puntos o más) o el riesgo marcado; lo más fuerte primero.
    porQueNo: [
      ...[...componentes]
        .filter((fila) => (fila.aporte !== null && fila.aporte <= -APORTE_RELEVANTE) || (fila.criterio === "riesgo" && fila.marcado))
        .sort((a, b) => (a.criterio === "riesgo" ? -Infinity : a.aporte!) - (b.criterio === "riesgo" ? -Infinity : b.aporte!))
        .map((fila) => fila.enCriollo),
      ...componentes.filter((fila) => fila.sinDato && fila.criterio !== "riesgo").map((fila) => `Sin dato de ${fila.criterio === "valuacion" ? "valuación" : fila.criterio}`),
    ],
    queCambiaria: queCambiaria(datos, componentes, estado.hoy),
    noticias: datos.noticias.usadas,
    balanceEnDias: datos.proximoBalance ? diasEntre(estado.hoy, datos.proximoBalance) : null,
  }));

  if (candidatos.length < 2) advertencias.push("Hay menos de 2 candidatos que pasen los filtros: conviene esperar o sumar a VOO.");
  const mejor = candidatos[0]?.puntaje ?? null;
  const motivo =
    mejor === null || mejor < PUNTAJE_MINIMO_DESTACA
      ? `Ningún candidato destaca: el mejor tiene ${mejor ?? 0} puntos de 100.`
      : "Esperar no cuesta nada: no hay apuro, y sumar el saldo a VOO es una opción válida.";
  return { puedeComprar, saldoUsd: saldo, faltaUsd, candidatos, excluidos, voo, opcionEsperar: { accion: "esperar_o_sumar_a_voo", motivo }, alertas, advertencias };
}

// Para las consultas: la ficha de un ticker haya sido sugerido o no.
export function explicarTicker(resultado: Pick<ResultadoAprender, "candidatos" | "excluidos">, ticker: string): { estado: "sugerido"; candidato: Candidato } | { estado: "excluido"; excluido: Excluido } | { estado: "no_esta" } {
  const simbolo = ticker.toUpperCase();
  const candidato = resultado.candidatos.find((item) => item.ticker === simbolo);
  if (candidato) return { estado: "sugerido", candidato };
  const excluido = resultado.excluidos.find((item) => item.ticker === simbolo);
  if (excluido) return { estado: "excluido", excluido };
  return { estado: "no_esta" };
}
