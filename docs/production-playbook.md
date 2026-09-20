# AutomationOpsAI — Playbook gratuito de producción y monetización

Actualizado: 2026-09-20

## Principio editorial

La automatización ayuda a producir; no sustituye la aportación original. Cada video debe resolver un problema distinto, incluir una demostración reproducible y mostrar decisiones, pruebas o resultados que no sean intercambiables con otro episodio.

YouTube considera no monetizable el contenido genérico, repetitivo, producido en masa o basado en plantillas sin valor original. También evalúa el canal completo, incluidos videos nuevos, más vistos, títulos, miniaturas y descripciones.

Fuente oficial: https://support.google.com/youtube/answer/1311392

## Mezcla de temas sin destruir la identidad del canal

- 70%: automatización práctica con n8n, agentes y APIs.
- 20%: fiabilidad, seguridad, pruebas, costos y observabilidad.
- 10%: experimentos de IA aplicados a negocios, siempre con implementación verificable.
- No mezclar temas ajenos sólo por tendencia. La variedad debe ocurrir dentro de una promesa clara: sistemas de IA que funcionan en producción.

## Flujo obligatorio

1. **Demanda:** validar una pregunta concreta con fuentes actuales y señales de búsqueda.
2. **Originalidad:** definir la tesis propia, el artefacto reproducible y qué aprenderá el espectador.
3. **Evidencia:** usar documentación primaria; registrar URL, fecha, afirmación y licencia.
4. **Guion:** gancho, problema, construcción visible, prueba adversarial, resultado y siguiente paso.
5. **Storyboard:** cada escena debe cambiar visualmente y construir el sistema mostrado.
6. **Producción:** diagramas, terminales y datos propios; evitar B-roll decorativo.
7. **Audio:** voz neural consistente, -16 LUFS aproximadamente y pico verdadero menor de -0.5 dBTP.
8. **QA automática:** resolución, audio, silencios, cuadros negros, límites de texto y duración.
9. **QA humana:** claridad, ritmo, promesa cumplida, miniatura y ausencia de información sensible.
10. **Derechos:** completar el ledger de procedencia. Sin licencia verificable, el recurso no entra.
11. **Publicación:** primero no listado; sólo hacerlo público tras revisión.
12. **Aprendizaje:** medir retención por segmento, CTR, comentarios útiles y conversiones al repositorio.

## Stack gratuito priorizado

| Trabajo | Primera opción | Respaldo |
| --- | --- | --- |
| Investigación y guion | Gemini API, nivel gratuito y con límites | Modelos locales con Ollama cuando haya hardware |
| Revisión factual | Fuentes oficiales + segundo modelo | Revisión humana obligatoria para afirmaciones materiales |
| Voz | Kokoro-82M local, licencia Apache 2.0 | Proveedor neural gratuito ya configurado |
| Subtítulos | faster-whisper local | SRT corregido manualmente |
| Diagramas | SVG, Mermaid, Graphviz, Matplotlib | HTML/CSS determinista |
| Edición | FFmpeg y Python | Remotion/Node para motion graphics |
| QA | FFprobe/FFmpeg + scripts de este repositorio | Inspección visual de hoja de contacto |
| Publicación | YouTube Data API con OAuth | Panel privado de Creator OS |

Referencias:
- Gemini API: https://ai.google.dev/gemini-api/docs/pricing
- Ollama: https://ollama.com/
- Kokoro: https://github.com/hexgrad/kokoro
- faster-whisper: https://github.com/SYSTRAN/faster-whisper
- FFmpeg: https://ffmpeg.org/

Los niveles gratuitos y sus cuotas pueden cambiar. El enrutador debe registrar errores, respetar límites y detenerse antes de degradar la calidad.

## Política para IA generativa

La IA puede ayudar con investigación, estructura, edición, diagramas y narración. Se debe declarar contenido realista generado o alterado cuando corresponda. La divulgación de IA, por sí sola, no reduce la elegibilidad de monetización.

Fuente oficial: https://support.google.com/youtube/answer/14328491

Reglas internas:

- No clonar voces o rostros de terceros sin consentimiento verificable.
- No presentar una persona sintética como experta en salud, finanzas, derecho o política.
- No inventar eventos, resultados, métricas o demostraciones.
- Usar datos sintéticos sin credenciales ni información de clientes.
- Marcar el upload con `containsSyntheticMedia=true` cuando proceda.

## Derechos de autor

- Preferir código, diagramas, animaciones y grabaciones propios.
- Mantener por episodio un archivo `sources.json` con autor, URL, licencia, fecha y uso.
- Música: sólo composiciones propias o Biblioteca de Audio de YouTube.
- No descargar clips de redes sociales ni reutilizar compilaciones.
- Una licencia o permiso no garantiza monetización si el resultado sigue pareciendo contenido reutilizado.
- Ejecutar una revisión de claims después de subir el video no listado.

Biblioteca de Audio de YouTube: https://support.google.com/youtube/answer/3376882

## Shorts

YouTube clasifica como Short un video cuadrado o vertical de hasta tres minutos. Para esta estrategia se usarán piezas de 25–55 segundos, una sola idea y formato 1080×1920.

Fuente oficial: https://support.google.com/youtube/answer/15424877

Cada Short debe tener:

- gancho comprensible en el primer segundo;
- una demostración o cambio visual real;
- subtítulos dentro del área segura;
- una conclusión útil antes del llamado a la acción;
- relación directa con un video largo;
- título, guion y edición propios, no un recorte indistinguible producido en masa.

Cadencia inicial: un video largo y dos Shorts derivados editorialmente por semana. No publicar varios Shorts casi idénticos.

## Ruta de monetización

La ruta principal exige 1,000 suscriptores y 4,000 horas públicas válidas en 12 meses, o 1,000 suscriptores y 10 millones de vistas públicas válidas de Shorts en 90 días. Las vistas u horas de videos no listados no cuentan para esos umbrales.

Fuente oficial: https://support.google.com/youtube/answer/72851

## Cuándo pagar por mejores modelos

No contratar por moda. Activar una herramienta pagada sólo cuando:

1. exista una limitación medida que el modelo gratuito no resuelva;
2. la prueba A/B muestre mejora consistente en retención, comprensión o tiempo de producción;
3. el costo mensual sea menor al 20% del ingreso atribuible al canal durante tres meses;
4. se pueda cancelar sin romper el flujo.

Orden de inversión recomendado: voz principal, revisión final de guion, generación visual puntual y, al final, video generativo. Los diagramas técnicos y las pruebas deben seguir siendo deterministas.
