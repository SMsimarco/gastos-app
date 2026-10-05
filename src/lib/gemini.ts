export type Movimiento = {
  tipo: "gasto" | "ingreso";
  monto: number;
  moneda: "ARS" | "USD";
  // Pesos que realmente entraron cuando el cobro se pactó en USD. 0/ausente si no lo dicen.
  monto_ars_recibido?: number;
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

export type ConsultaFinancieraExtraida = {
  pregunta: string;
  ticker: string | null;
  confianza: "alta" | "media" | "baja";
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
  const modelos = ["gemini-3.6-flash", "gemini-3.5-flash"];
  let ultimoError = "";
  for (const modelo of modelos) {
    for (let intento = 0; intento < 2; intento++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
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

      if (res.ok) {
        const data = await res.json();
        const textoRespuesta = data.candidates[0].content.parts[0].text;
        return JSON.parse(textoRespuesta);
      }

      const detalle = await res.text();
      ultimoError = `${res.status} ${detalle}`;
      if (![429, 503].includes(res.status)) {
        throw new Error(`Gemini falló: ${ultimoError}`);
      }
      if (intento === 0) await new Promise((resolver) => setTimeout(resolver, 500));
    }
  }
  throw new Error(`Gemini no respondió después de los reintentos: ${ultimoError}`);
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

Cobros en dólares transferidos en pesos: si dicen el valor en dólares pero aclaran cuántos pesos les transfirieron o acreditaron ("cobré 500 dólares, me transfirieron 725 mil pesos"), poné monto=500, moneda "USD" y monto_ars_recibido=725000. Transcribí solo lo que dijeron, no conviertas ni calcules. Si no mencionan pesos recibidos, poné monto_ars_recibido en 0.

Si NO podés determinar el monto con confianza razonable, poné confianza "baja" y NO inventes un número (poné monto en 0).
Guardá siempre en transcripcion_raw una transcripción fiel de lo que se dijo o del texto/ticket recibido.`;
}

const MOVIMIENTO_SCHEMA = {
  type: "OBJECT",
  properties: {
    tipo: { type: "STRING", enum: ["gasto", "ingreso"] },
    monto: { type: "NUMBER" },
    moneda: { type: "STRING", enum: ["ARS", "USD"] },
    monto_ars_recibido: { type: "NUMBER" },
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
  | { intencion: "operacion"; operacion: OperacionExtraida }
  | { intencion: "consulta_inversiones"; consulta: ConsultaFinancieraExtraida }
  | { intencion: "consulta_plan"; consulta: ConsultaFinancieraExtraida }
  | { intencion: "pedir_sugerencia"; consulta: ConsultaFinancieraExtraida };

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
- "consulta_inversiones": pregunta por valor, rendimiento o composición de su cartera o un activo (por ejemplo, "¿cuánto me rinde VOO?" o "¿cuánto tengo en total?").
- "consulta_plan": pregunta por bolsillos, fondo de emergencia, metas o avance hacia el departamento.
- "pedir_sugerencia": pide consejo o una acción (por ejemplo, "¿qué hago con esta plata?" o "¿me conviene comprar YPF?", o pregunta por el bolsillo "aprender" y sus sugerencias: "¿qué hago con lo de aprender?", "¿por qué me sugerís MSFT?", "¿por qué no NVDA?").

Para una operación extraé únicamente datos que el usuario haya dicho: ticker, monto total en USD, precio unitario en USD, cantidad, comisión y fecha. No calcules cantidad, montos ni rendimientos. Si falta ticker, monto o precio en una compra/venta, usá 0 para el dato faltante y confianza "baja". La comisión es 0 si no se menciona.
Para las tres consultas financieras, copiá la pregunta, extraé el ticker solo si se menciona explícitamente y evaluá confianza sobre la intención. No respondas la pregunta ni calcules nada.
Si es consulta, dejá movimientos vacío y poné la pregunta textual. Si es operación, dejá movimientos vacío y completá operacion.`;

  const consultaFinancieraSchema = {
    type: "OBJECT",
    properties: {
      pregunta: { type: "STRING" },
      ticker: { type: "STRING", nullable: true },
      confianza: { type: "STRING", enum: ["alta", "media", "baja"] },
    },
    required: ["pregunta", "ticker", "confianza"],
  };

  const schema = {
    type: "OBJECT",
    properties: {
      intencion: {
        type: "STRING",
        enum: ["registro", "consulta", "operacion", "consulta_inversiones", "consulta_plan", "pedir_sugerencia"],
      },
      movimientos: { type: "ARRAY", items: MOVIMIENTO_SCHEMA },
      pregunta: { type: "STRING" },
      operacion: { ...OPERACION_SCHEMA, nullable: true },
      consulta_financiera: { ...consultaFinancieraSchema, nullable: true },
    },
    required: ["intencion", "movimientos", "pregunta", "operacion", "consulta_financiera"],
  };

  const data = await generarJSON([{ text: prompt }, ...parts], schema);
  if (data.intencion === "consulta") return { intencion: "consulta", pregunta: data.pregunta || textoFallback };
  if (data.intencion === "operacion" && data.operacion) {
    return { intencion: "operacion", operacion: data.operacion };
  }
  if (["consulta_inversiones", "consulta_plan", "pedir_sugerencia"].includes(data.intencion)) {
    const consulta = data.consulta_financiera;
    return {
      intencion: data.intencion,
      consulta: {
        pregunta: consulta?.pregunta || textoFallback,
        ticker: consulta?.ticker?.trim().toUpperCase() || null,
        confianza: consulta?.confianza ?? "baja",
      },
    };
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

export async function redactarRespuestaDesdeHechos(input: {
  pregunta: string;
  hechos: Record<string, unknown>;
  esSugerencia: boolean;
  respuestaBase: string;
}): Promise<string> {
  const cierre = "Sugerencia según tu plan, no asesoramiento financiero.";
  const prompt = `Redactá una respuesta breve en español rioplatense a la pregunta del usuario usando EXCLUSIVAMENTE los hechos JSON provistos.
No calcules, no infieras y no agregues ningún número que no aparezca literalmente en los hechos. No recomiendes activos fuera de politica ni opines si son buenos o malos. Nunca sugieras vender el largo plazo porque subió o bajó.
Si fuera_de_politica es true, explicá solamente que el ticker no está en el plan del usuario y que por eso no podés sugerirlo.
${input.esSugerencia ? "Si la lista de sugerencias está vacía, decí que no hay una acción pendiente según el plan." : "Respondé solamente la consulta informativa; no hables de acciones pendientes."}
${input.esSugerencia ? `Terminá exactamente con esta línea, una sola vez: ${cierre}` : "No agregues un descargo financiero."}

Pregunta: ${input.pregunta}
Hechos JSON: ${JSON.stringify(input.hechos)}
Respuesta base calculada por el código: ${input.respuestaBase}`;
  const schema = {
    type: "OBJECT",
    properties: { respuesta: { type: "STRING" } },
    required: ["respuesta"],
  };
  let respuesta = input.respuestaBase;
  try {
    const data = await generarJSON([{ text: prompt }], schema);
    respuesta = String(data.respuesta ?? input.respuestaBase).trim();
  } catch {
    respuesta = input.respuestaBase;
  }
  if (!input.esSugerencia) return respuesta;
  const sinCierre = respuesta.replaceAll(cierre, "").trim();
  return `${sinCierre}\n${cierre}`;
}

// Asesor de aprender: Gemini solo redacta a partir de los hechos que armó el código (aprender.ts). Si falla, devuelve
// el texto base. Quien llama valida el resultado (validarTextoAprender) y usa el texto base si no pasa.
export async function redactarTextoAprenderIA(input: { instruccion: string; hechos: Record<string, unknown>; textoBase: string }): Promise<string> {
  const prompt = `${input.instruccion}

Redactá el mensaje usando EXCLUSIVAMENTE los hechos JSON. No agregues ningún número que no esté literalmente en los hechos.
Hechos JSON: ${JSON.stringify(input.hechos)}
Texto base calculado por el código (mismo contenido, tono más seco): ${input.textoBase}`;
  const schema = { type: "OBJECT", properties: { texto: { type: "STRING" } }, required: ["texto"] };
  try {
    const data = await generarJSON([{ text: prompt }], schema);
    return String(data.texto ?? input.textoBase).trim() || input.textoBase;
  } catch {
    return input.textoBase;
  }
}
