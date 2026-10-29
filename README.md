# Rs-Agent-Ai

Agente de IA de escritorio para **Windows y Linux**, multi-proveedor (Claude, ChatGPT, Gemini, DeepSeek, NVIDIA, OpenRouter y URL compatible con OpenAI).

## Uso
    npm install
    npm start          # ejecutar
    npm test           # pruebas automáticas (en Linux: xvfb-run -a npm test)
    npm run dist       # instalador para tu sistema (electron-builder)

## Modos
- **Plan**: solo lectura. **Builder**: edita y ejecuta con aprobación. **Betatester**: prueba la app como un usuario.
- Permisos por proyecto en `.agente/permisos.json` (comandos y rutas: permitir / preguntar / bloquear).

## Betatester
- **Web y Electron**: lee el DOM (botones, iconos con nombre, campos, shadow DOM, iframes) y la consola. Necesita Chrome/Edge/Chromium o, si no hay, usa una ventana propia. Funciona en Windows y Linux.
- **Apps nativas**: captura + OCR + clics del sistema. Windows (PowerShell) y Linux X11.
  Linux: `sudo apt install xdotool imagemagick tesseract-ocr tesseract-ocr-spa`. En Wayland puro, las apps nativas solo funcionan si corren con XWayland.
- Los `[icono?]` de apps nativas se detectan por forma (heurística).
- Al pulsar "Permitir" en la primera acción se autoriza todo el Betatester hasta cerrar la app.
- `npm run selftest` comprueba el control de ventanas en tu sistema.

## Seguridad
- Las claves se cifran con el almacén del sistema (keyring). Sin él se guardan sin cifrar y la app avisa.
- Las rutas de archivos no pueden salir de la carpeta de trabajo (ni por enlaces simbólicos).
- `run_command` puede ejecutar cualquier comando con tu aprobación: revisa lo que apruebas.

## Licencia
Apache License 2.0. Ver `LICENSE` y `NOTICE`.
