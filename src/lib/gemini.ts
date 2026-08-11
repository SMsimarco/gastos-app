export type Movimiento = {
  tipo: "gasto" | "ingreso";
  monto: number;
  moneda: "ARS" | "USD";
  descripcion: string;
  comercio: string | null;
  categoria: string;
  metodo_pago: "efectivo" | "debito" | "credito" | "transferencia" | "mercadopago" | null;
  cuotas: number;
  fecha: string;
  confianza: "alta" | "media" | "baja";
  transcripcion_raw: string;
};

const CATEGORIAS_GASTO = [
  "Supermercado",
  "Delivery/Restaurantes",
  "Alimentos",
  "Transporte/Nafta",
  "Servicios",
  "Alquiler",
  "Salud",
  "Ocio",
  "Ropa",
  "Educación",
  "Suscripciones",
  "Impuestos",
  "Otros",
];
const CATEGORIAS_INGRESO = ["Clientes", "Sueldo", "Ventas", "Otros"];

function construirPrompt(fechaHoyAR: string) {
  return `Sos un extractor de movimientos financieros a partir de un mensaje (audio, foto de ticket, o texto) en español rioplatense (Argentina).
Fecha de hoy: ${fechaHoyAR} (timezone America/Argentina/Buenos_Aires). Resolvé fechas relativas ("ayer", "el viernes pasado") contra esta fecha, nunca uses UTC.

Si te llega una imagen, es una foto de un ticket/factura de compra: leé el total, el comercio y la fecha del ticket si están visibles.

Un mensaje puede contener uno o varios movimientos (gasto o ingreso). Devolvé SIEMPRE un array, uno por movimiento. Si el mensaje no contiene ningún movimiento financiero, devolvé un array vacío [].

Reglas de argot monetario argentino:
- "20 lucas" = 20000
- "2 palos" = 2000000
- "500 mangos" = 500
- "un verde" = 1 USD (y en general "verdes" = dólares)
- "facturas" (en contexto de compra de comida) son medialunas/pastelitos de panadería, NO boletas de servicios

Compras de comida que NO son supermercado ni delivery/restaurante (panadería, verdulería, carnicería, kiosco, almacén) van en categoria "Alimentos". Poné en descripcion el detalle específico (ej. "facturas de panadería", "verdura", "fiambre") para poder diferenciar cada compra aunque compartan categoría.

Cuotas: si mencionan pago en cuotas ("en 3 cuotas", "en 6 pagos", "lo pagué en 12"), poné ese número en cuotas. Si no dicen nada de cuotas, poné cuotas: 1. El monto que des es el TOTAL de la compra (no dividas vos por cuota, eso lo hace el sistema después).

Categorías válidas para tipo=gasto: ${CATEGORIAS_GASTO.join(", ")}
Categorías válidas para tipo=ingreso: ${CATEGORIAS_INGRESO.join(", ")}

Si NO podés determinar el monto con confianza razonable, poné confianza "baja" y NO inventes un número (poné monto en 0).
Guardá siempre en transcripcion_raw una transcripción fiel de lo que se dijo o del texto/ticket recibido.`;
}

const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      tipo: { type: "STRING", enum: ["gasto", "ingreso"] },
      monto: { type: "NUMBER" },
      moneda: { type: "STRING", enum: ["ARS", "USD"] },
      descripcion: { type: "STRING" },
      comercio: { type: "STRING", nullable: true },
      categoria: { type: "STRING" },
      metodo_pago: {
        type: "STRING",
        enum: ["efectivo", "debito", "credito", "transferencia", "mercadopago"],
        nullable: true,
      },
      cuotas: { type: "INTEGER" },
      fecha: { type: "STRING" },
      confianza: { type: "STRING", enum: ["alta", "media", "baja"] },
      transcripcion_raw: { type: "STRING" },
    },
    required: [
      "tipo",
      "monto",
      "moneda",
      "descripcion",
      "categoria",
      "cuotas",
      "fecha",
      "confianza",
      "transcripcion_raw",
    ],
  },
};

export async function extraerMovimientos(input: {
  base64Data?: string;
  mimeType?: string;
  textoMensaje?: string;
}): Promise<Movimiento[]> {
  const fechaHoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });

  const parts: Array<Record<string, unknown>> = [{ text: construirPrompt(fechaHoyAR) }];
  if (input.base64Data && input.mimeType) {
    parts.push({ inlineData: { mimeType: input.mimeType, data: input.base64Data } });
  } else if (input.textoMensaje) {
    parts.push({ text: `Mensaje del usuario: "${input.textoMensaje}"` });
  }

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`Gemini falló: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const textoRespuesta = data.candidates[0].content.parts[0].text;
  return JSON.parse(textoRespuesta);
}
