// Rendimiento del bolsillo aprender contra "si esa plata la hubiera puesto en VOO el mismo día". Es la métrica que
// dice si conviene seguir con este 5%. Función PURA: los precios de VOO vienen de la tabla `precios`.
import { precioAlCierre, redondear2, type PuntoPrecio } from "./aprenderHistorial";

export type FlujoAprender = { fecha: string; tipo: "compra" | "venta" | "dividendo"; montoUsd: number };

export type ComparacionConVoo = {
  netoInvertidoUsd: number;
  valorActualUsd: number; // posiciones de aprender hoy + dividendos cobrados
  gananciaUsd: number;
  gananciaPct: number | null;
  siVooValorUsd: number;
  siVooGananciaUsd: number;
  siVooPct: number | null;
  diferenciaPuntos: number | null; // aprender menos VOO, en puntos porcentuales
  operacionesSinDatoVoo: number;
  veredicto: "gana" | "pierde" | "parejo" | "sin_datos";
};

export function compararConVoo(input: { flujos: FlujoAprender[]; valorActualUsd: number; vooSerie: PuntoPrecio[]; vooActualUsd: number | null }): ComparacionConVoo {
  let compras = 0;
  let ventas = 0;
  let dividendos = 0;
  let siVoo = 0;
  let sinDato = 0;
  for (const flujo of input.flujos) {
    if (flujo.tipo === "dividendo") {
      dividendos += flujo.montoUsd;
      continue;
    }
    const precioVoo = precioAlCierre(input.vooSerie, flujo.fecha, 7);
    if (!precioVoo || !input.vooActualUsd) {
      sinDato += 1;
      continue;
    }
    const signo = flujo.tipo === "compra" ? 1 : -1;
    if (flujo.tipo === "compra") compras += flujo.montoUsd;
    else ventas += flujo.montoUsd;
    siVoo += signo * flujo.montoUsd * (input.vooActualUsd / precioVoo.precio);
  }
  const neto = compras - ventas;
  const valorActual = input.valorActualUsd + dividendos;
  const vacio = compras <= 0 || sinDato === input.flujos.filter((flujo) => flujo.tipo !== "dividendo").length;
  const gananciaPct = vacio ? null : redondear2(((valorActual - neto) / compras) * 100);
  const siVooPct = vacio ? null : redondear2(((siVoo - neto) / compras) * 100);
  const diferencia = gananciaPct === null || siVooPct === null ? null : redondear2(gananciaPct - siVooPct);
  return {
    netoInvertidoUsd: redondear2(neto),
    valorActualUsd: redondear2(valorActual),
    gananciaUsd: redondear2(valorActual - neto),
    gananciaPct,
    siVooValorUsd: redondear2(siVoo),
    siVooGananciaUsd: redondear2(siVoo - neto),
    siVooPct,
    diferenciaPuntos: diferencia,
    operacionesSinDatoVoo: sinDato,
    veredicto: diferencia === null ? "sin_datos" : diferencia > 1 ? "gana" : diferencia < -1 ? "pierde" : "parejo",
  };
}
