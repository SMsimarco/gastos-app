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

async function generarJSON(parts: Array<Record<string, unknown>>, schema: Record<string, unknown>) {
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
          responseSchema: schema,
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

const MOVIMIENTO_SCHEMA = {
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

  return generarJSON(parts, { type: "ARRAY", items: MOVIMIENTO_SCHEMA });
}

export type ResultadoTexto =
  | { intencion: "registro"; movimientos: Movimiento[] }
  | { intencion: "consulta"; pregunta: string };

export async function clasificarYExtraerTexto(textoMensaje: string): Promise<ResultadoTexto> {
  const fechaHoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });

  const prompt = `${construirPrompt(fechaHoyAR)}

Antes que nada, decidí la intención del mensaje:
- "registro": el usuario está contando un gasto o ingreso nuevo para guardar.
- "consulta": el usuario está PREGUNTANDO sobre sus gastos pasados (ej. "¿cuánto gasté en comida?", "¿en qué se me fue la plata este mes?", "cuánto gasté ayer").

Si es "consulta", dejá "movimientos" como array vacío y poné la pregunta tal cual en "pregunta".
Si es "registro", llená "movimientos" normalmente y "pregunta" puede quedar vacía.`;

  const schema = {
    type: "OBJECT",
    properties: {
      intencion: { type: "STRING", enum: ["registro", "consulta"] },
      movimientos: { type: "ARRAY", items: MOVIMIENTO_SCHEMA },
      pregunta: { type: "STRING" },
    },
    required: ["intencion", "movimientos", "pregunta"],
  };

  const data = await generarJSON(
    [{ text: prompt }, { text: `Mensaje del usuario: "${textoMensaje}"` }],
    schema
  );

  if (data.intencion === "consulta") {
    return { intencion: "consulta", pregunta: data.pregunta || textoMensaje };
  }
  return { intencion: "registro", movimientos: data.movimientos ?? [] };
}

export type FiltrosConsulta = {
  desde: string;
  hasta: string;
  categoriaNombre: string | null;
  tipo: "gasto" | "ingreso";
};

export async function interpretarPregunta(pregunta: string): Promise<FiltrosConsulta> {
  const fechaHoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });

  const prompt = `Traducí esta pregunta sobre finanzas personales a filtros de fecha/categoría.
Fecha de hoy: ${fechaHoyAR} (timezone America/Argentina/Buenos_Aires).
"este mes" = desde el día 1 del mes actual hasta hoy.
"la semana pasada" = los 7 días anteriores a hoy.
"ayer" = el día calendario anterior a hoy (desde y hasta iguales).
Si no menciona ninguna categoría específica, categoriaNombre debe ser null.
Categorías válidas (usar el nombre EXACTO si aplica alguna): ${CATEGORIAS_GASTO.join(", ")}, ${CATEGORIAS_INGRESO.join(", ")}.
Si no dice explícitamente "ingreso"/"cobré"/"me pagaron", asumí tipo "gasto".

Pregunta: "${pregunta}"`;

  const schema = {
    type: "OBJECT",
    properties: {
      desde: { type: "STRING" },
      hasta: { type: "STRING" },
      categoriaNombre: { type: "STRING", nullable: true },
      tipo: { type: "STRING", enum: ["gasto", "ingreso"] },
    },
    required: ["desde", "hasta", "tipo"],
  };

  return generarJSON([{ text: prompt }], schema);
}
