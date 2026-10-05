# Estrategia de testing y cierre

Consultar según el cambio. Tests existentes: casos ejecutables;
[qa-audits.md](history/qa-audits.md): resultados históricos, no evidencia actual.

## Selección de verificación

| Cambio | Verificación mínima aplicable |
|---|---|
| Documentación/instrucciones | Enlaces, comandos, coherencia con código y diff; no arrancar servicios |
| Utilidad o servicio | Unitarios afectados y regresión del comportamiento cambiado |
| DTO o contrato HTTP | Validación y e2e afectados; Swagger, status y envelope |
| Auth, roles o bootstrap | Seguridad y endpoints afectados; ampliar e2e por impacto transversal |
| Pedidos, cupones o premios | Flujo, transacciones, idempotencia y efectos después del commit |
| Esquema | Migración aplicada en BD de prueba, datos preservados y e2e pertinentes |
| Fechas/reportes | Bordes y suites afectadas en TZ=UTC y TZ=America/Lima |

Para cambios TypeScript funcionales incluir build y lint sin correcciones.
Ampliar a suites completas para cambios de varios dominios, configuración global
o esquema. No repetir corridas sin cambios o una incertidumbre concreta.

## Comandos vigentes

Desde la raíz con dependencias instaladas:

```powershell
pnpm run build
pnpm exec eslint "{src,apps,libs,test}/**/*.ts"
pnpm run test -- --runInBand --runTestsByPath src/modules/orders/orders.service.spec.ts
pnpm run test:e2e -- --runTestsByPath test/orders.e2e-spec.ts
# Suites completas cuando corresponda:
pnpm run test -- --runInBand
pnpm run test:e2e
```

Build escribe dist y archivos de compilación. Jest puede escribir caché;
cobertura escribe coverage. `pnpm run lint` lleva --fix y `format` reformatea:
no utilizarlos para revisiones sin modificaciones.
En PowerShell, guardar/restaurar `$env:TZ` al probar UTC y America/Lima;
no cambiar archivos .env para ello.

## E2E: datos y entorno

- AppModule, Supertest y PostgreSQL real. Identificar DB_HOST/DB_DATABASE de una
  BD local/de prueba, sin exponer secretos; nunca ejecutar contra producción.
- Evitar escrituras concurrentes de backend/app en esa BD. maxWorkers=1
  serializa suites, no procesos externos.
- Conservar afterAll y snapshots/restauraciones de settings y horarios.
- globalSetup/globalTeardown comparan conteos: no detectan cambios de valores
  con igual cantidad de filas. Restaurar valores explícitamente.
- AppModule puede sembrar settings y registrar cron/integraciones; revisar
  overrides y limpieza antes de correr la suite.
- Overrides de guards no prueban su comportamiento real. No desactivarlos para
  hacer pasar pruebas de seguridad.

## Regresión y cierre

- Observar comportamiento público y distinguir el fallo anterior del esperado;
  evitar tests que solo repliquen la implementación.
- Cubrir omitidos/null/vacíos, límites y combinaciones pertinentes.
- Verificar envelope, códigos HTTP, español, ausencia de password y propiedad.
- Preservar snapshots, totales, transiciones y no duplicación de beneficios.
- Revisar Swagger si cambia el contrato; consultar el dominio pertinente de
  [business-rules.md](business-rules.md) para criterios específicos.
- Mutaciones temporales no son requisito habitual: solo con alcance autorizado
  y evidencia adicional que lo justifique.
- Cierre: diff acotado, comprobaciones aplicables aprobadas, documentación vigente
  y límites explícitos. Sin comprobaciones críticas, indicar “validación pendiente”.
- No marcar funcionalidades verificadas usando resultados históricos.
  No se exige auditoría de subagentes.
