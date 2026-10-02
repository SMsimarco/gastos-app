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

export type OperacionExtraida = {
  tipo: "compra" | "venta" | "dividendo";
  ticker: string;
  monto_usd: number;
  precio_usd: number;
  cantidad: number;
  comision_usd: number;
  fecha: string;
  confianza: "alta" | "media" | "baja";
  transcripcion_raw: string;
};

const CATEGORIAS_GASTO_DEFAULT = [
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
const CATEGORIAS_INGRESO_DEFAULT = ["Clientes", "Sueldo", "Ventas", "Otros"];

export type ListasCategorias = {
  gasto: string[];
  ingreso: string[];
};

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

function construirPrompt(fechaHoyAR: string, categorias: ListasCategorias) {
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

Compras de comida que NO son supermercado ni delivery/restaurante (panadería, verdulería, carnicería, kiosco, almacén) van en categoria "Alimentos" si esa categoría está en la lista de abajo; si no existe, usá la más parecida de la lista. Poné en descripcion el detalle específico (ej. "facturas de panadería", "verdura", "fiambre") para poder diferenciar cada compra aunque compartan categoría.

Cuotas: si mencionan pago en cuotas ("en 3 cuotas", "en 6 pagos", "lo pagué en 12"), poné ese número en cuotas. Si no dicen nada de cuotas, poné cuotas: 1. El monto que des es el TOTAL de la compra (no dividas vos por cuota, eso lo hace el sistema después).

Categorías válidas para tipo=gasto (usá EXACTAMENTE uno de estos nombres): ${categorias.gasto.join(", ")}
Categorías válidas para tipo=ingreso (usá EXACTAMENTE uno de estos nombres): ${categorias.ingreso.join(", ")}
Si dice "cobré", "me pagaron" o menciona el pago de un proyecto o cliente, usá tipo "ingreso" y categoría "Clientes" siempre que esa categoría esté en la lista.

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

const OPERACION_SCHEMA = {
  type: "OBJECT",
  properties: {
    tipo: { type: "STRING", enum: ["compra", "venta", "dividendo"] },
    ticker: { type: "STRING" },
    monto_usd: { type: "NUMBER" },
    precio_usd: { type: "NUMBER" },
    cantidad: { type: "NUMBER" },
    comision_usd: { type: "NUMBER" },
    fecha: { type: "STRING" },
    confianza: { type: "STRING", enum: ["alta", "media", "baja"] },
    transcripcion_raw: { type: "STRING" },
  },
  required: ["tipo", "ticker", "monto_usd", "precio_usd", "cantidad", "comision_usd", "fecha", "confianza", "transcripcion_raw"],
};

export async function extraerMovimientos(input: {
  base64Data?: string;
  mimeType?: string;
  textoMensaje?: string;
  categorias?: ListasCategorias;
}): Promise<Movimiento[]> {
  const fechaHoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const categorias = input.categorias ?? { gasto: CATEGORIAS_GASTO_DEFAULT, ingreso: CATEGORIAS_INGRESO_DEFAULT };

  const parts: Array<Record<string, unknown>> = [{ text: construirPrompt(fechaHoyAR, categorias) }];
  if (input.base64Data && input.mimeType) {
    parts.push({ inlineData: { mimeType: input.mimeType, data: input.base64Data } });
  } else if (input.textoMensaje) {
    parts.push({ text: `Mensaje del usuario: "${input.textoMensaje}"` });
  }

  return generarJSON(parts, { type: "ARRAY", items: MOVIMIENTO_SCHEMA });
}

export type ResultadoTexto =
  | { intencion: "registro"; movimientos: Movimiento[] }
  | { intencion: "consulta"; pregunta: string }
  | { intencion: "operacion"; operacion: OperacionExtraida };

async function clasificarEntrada(
  parts: Array<Record<string, unknown>>,
  textoFallback: string,
  categorias?: ListasCategorias
): Promise<ResultadoTexto> {
  const fechaHoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const listas = categorias ?? { gasto: CATEGORIAS_GASTO_DEFAULT, ingreso: CATEGORIAS_INGRESO_DEFAULT };

  const prompt = `${construirPrompt(fechaHoyAR, listas)}

Antes que nada, decidí la intención del mensaje:
- "registro": el usuario está contando un gasto o ingreso nuevo para guardar.
- "consulta": el usuario está preguntando sobre sus gastos pasados.
- "operacion": compró, vendió o cobró un dividendo de una inversión (por ejemplo, "compré 125 dólares de VOO a 703").

Para una operación extraé únicamente datos que el usuario haya dicho: ticker, monto total en USD, precio unitario en USD, cantidad, comisión y fecha. No calcules cantidad, montos ni rendimientos. Si falta ticker, monto o precio en una compra/venta, usá 0 para el dato faltante y confianza "baja". La comisión es 0 si no se menciona.
Si es consulta, dejá movimientos vacío y poné la pregunta textual. Si es operación, dejá movimientos vacío y completá operacion.`;

  const schema = {
    type: "OBJECT",
    properties: {
      intencion: { type: "STRING", enum: ["registro", "consulta", "operacion"] },
      movimientos: { type: "ARRAY", items: MOVIMIENTO_SCHEMA },
      pregunta: { type: "STRING" },
      operacion: { ...OPERACION_SCHEMA, nullable: true },
    },
    required: ["intencion", "movimientos", "pregunta", "operacion"],
  };

  const data = await generarJSON([{ text: prompt }, ...parts], schema);
  if (data.intencion === "consulta") return { intencion: "consulta", pregunta: data.pregunta || textoFallback };
  if (data.intencion === "operacion" && data.operacion) {
    return { intencion: "operacion", operacion: data.operacion };
  }
  return { intencion: "registro", movimientos: data.movimientos ?? [] };
}

export async function clasificarYExtraerTexto(
  textoMensaje: string,
  categorias?: ListasCategorias
): Promise<ResultadoTexto> {
  return clasificarEntrada([{ text: `Mensaje del usuario: "${textoMensaje}"` }], textoMensaje, categorias);
}

export async function clasificarYExtraerAudio(
  base64Data: string,
  mimeType: string,
  categorias?: ListasCategorias
): Promise<ResultadoTexto> {
  return clasificarEntrada([{ inlineData: { mimeType, data: base64Data } }], "Audio del usuario", categorias);
}

export type FiltrosConsulta = {
  desde: string;
  hasta: string;
  categoriaNombre: string | null;
  tipo: "gasto" | "ingreso";
};

export async function interpretarPregunta(
  pregunta: string,
  categorias?: ListasCategorias
): Promise<FiltrosConsulta> {
  const fechaHoyAR = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const listas = categorias ?? { gasto: CATEGORIAS_GASTO_DEFAULT, ingreso: CATEGORIAS_INGRESO_DEFAULT };

  const prompt = `Traducí esta pregunta sobre finanzas personales a filtros de fecha/categoría.
Fecha de hoy: ${fechaHoyAR} (timezone America/Argentina/Buenos_Aires).
"este mes" = desde el día 1 del mes actual hasta hoy.
"la semana pasada" = los 7 días anteriores a hoy.
"ayer" = el día calendario anterior a hoy (desde y hasta iguales).
Si no menciona ninguna categoría específica, categoriaNombre debe ser null.
Categorías válidas (usar el nombre EXACTO si aplica alguna): ${listas.gasto.join(", ")}, ${listas.ingreso.join(", ")}.
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
