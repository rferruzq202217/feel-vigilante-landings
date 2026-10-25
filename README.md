# Vigilante de landings

Cada 5 minutos, GitHub Actions abre con un navegador cada landing con campaña de `landings.json` y comprueba:

1. Que carga sin error (y si tarda más de 10 s, la marca como lenta).
2. Que aparece el calendario con días disponibles.
3. Que la consulta de disponibilidad (`POST /check`) devuelve horarios.
4. Que calcula el precio y está el formulario de reserva.

No pulsa «Reservar», así que no crea prerreservas en Gestión. Reintenta una vez antes de dar una landing por caída.

## Avisos

Escribe en Slack solo cuando una landing cae o se recupera (con los minutos de caída), usando el secreto `SLACK_WEBHOOK_URL` del repositorio. Una caída nueva también pone la ejecución en rojo y GitHub manda un email al dueño.

## Dashboard y datos para Kasper

Cada pasada publica en GitHub Pages (https://rferruzq202217.github.io/feel-vigilante-landings/):

- `index.html`: dashboard con el estado de cada landing, disponibilidad 24 h y 7 días, franja de las últimas 24 h e incidencias.
- `status.json`: estado actual de cada landing (ok, paso que falla, detalle, segundos de carga, días, horarios, precio, caída desde).
- `incidents.json`: todas las caídas con inicio, fin, minutos y motivo.
- `history.json`: últimos 7 días de pasadas (por pasada, hora y por landing `[ok, segundos]`, en el orden de `urls`).

## Cambiar la lista

Añadir o quitar landings en `landings.json` (nombre y URL). Las 22 iniciales son las del Excel «Subdominios y dominios FeeltheCity» con Campañas = SÍ (25/10/2026).
