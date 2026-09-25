import { NextRequest, NextResponse } from "next/server";
import { crearClienteServidor } from "@/lib/supabase/server";
import { generarRepartoParaIngreso } from "@/lib/planData";

// Simulador manual: "tengo esta plata disponible ahora, decime cómo repartirla".
// Mismo motor que el reparto automático de un ingreso (calcularReparto), sin
// ingreso asociado (ingreso_id null) — reusa la misma card de "reparto
// pendiente" y los mismos endpoints de aplicar/descartar.
export async function POST(request: NextRequest) {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { monto } = await request.json();
  const montoArs = Number(monto);
  if (!montoArs || montoArs <= 0) {
    return NextResponse.json({ error: "Monto inválido" }, { status: 400 });
  }

  const reparto = await generarRepartoParaIngreso(supabase, user.id, null, montoArs);

  if (!reparto) {
    return NextResponse.json(
      {
        error:
          "Todavía no tengo cotización del dólar (MEP) o gasto mensual suficiente para calcular el reparto. Probá de nuevo más tarde o cargá el gasto mensual manual en Configuración.",
      },
      { status: 422 }
    );
  }

  return NextResponse.json({ reparto });
}
