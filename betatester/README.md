# betatester

Lógica del modo Betatester de Rs-Agent-Ai. Se usa desde `tools.js` y `main.js`.

- `index.js`: herramientas `test_*` que ve el modelo, descripciones y qué pide aprobación.
- `detect.js`: detecta si el proyecto es web, de escritorio o de consola y cómo ejecutarlo.
- `session.js`: abre la app, mira la pantalla, hace clic, escribe, pulsa teclas y cierra.
- `grid.js`: cuadrícula, zoom y conversión de texto de pantalla a celdas.
- `win.js`: capa de Windows (PowerShell): ventanas, captura, OCR de Windows, mouse y teclado.
- `report.js`: reporte en `.agente/reports/`.
- `selftest.js`: prueba real en Windows con el Bloc de notas. Ejecuta `node betatester/selftest.js`.
