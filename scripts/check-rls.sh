#!/usr/bin/env bash
# Falla el build si crearClienteServicio (service_role, bypassea RLS) aparece
# en un archivo nuevo no revisado. Los crons y las rutas ya auditadas
# (2026-08-11, ver SECURITY.md) estan en la allowlist de abajo porque
# filtran usuario_id a mano de forma verificada.
set -euo pipefail

PERMITIDOS=(
  "src/lib/supabase/server.ts"
  "src/app/api/capturar/route.ts"
  "src/app/api/movimientos/[id]/route.ts"
  "src/app/api/movimientos/[id]/foto/route.ts"
  "src/app/api/push/subscribe/route.ts"
)

ENCONTRADOS=$(grep -rl "crearClienteServicio" src --include="*.ts" --include="*.tsx" | grep -v "/api/cron/" || true)

MALOS=""
for f in $ENCONTRADOS; do
  permitido=0
  for p in "${PERMITIDOS[@]}"; do
    if [ "$f" = "$p" ]; then
      permitido=1
      break
    fi
  done
  if [ "$permitido" -eq 0 ]; then
    MALOS="$MALOS$f\n"
  fi
done

if [ -n "$MALOS" ]; then
  echo "crearClienteServicio (service_role) en archivo no revisado:"
  echo -e "$MALOS"
  echo ""
  echo "service_role bypassea RLS. Si esta ruta corre con sesion de usuario logueado, usa crearClienteServidor()."
  echo "Si es un caso legitimo nuevo (ej. otro cron), agregalo a PERMITIDOS en scripts/check-rls.sh explicando por que."
  exit 1
fi

echo "OK: crearClienteServicio solo en cron/, su definicion, y rutas ya auditadas."
