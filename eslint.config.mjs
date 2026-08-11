import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/server",
              importNames: ["crearClienteServicio"],
              message:
                "service_role bypassea RLS. Usá crearClienteServidor() salvo que sea un cron sin sesión de usuario — ver SECURITY.md.",
            },
          ],
        },
      ],
    },
  },
  {
    // Crons sin sesión de usuario + rutas ya auditadas (2026-08-11, ver
    // SECURITY.md) que filtran usuario_id a mano de forma verificada.
    // Espejo de la allowlist en scripts/check-rls.sh.
    files: [
      "src/app/api/cron/**/*.ts",
      "src/app/api/capturar/route.ts",
      "src/app/api/movimientos/[id]/route.ts",
      "src/app/api/movimientos/[id]/foto/route.ts",
      "src/app/api/push/subscribe/route.ts",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
