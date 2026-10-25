# Vigilante de landings

Cada 5 minutos, GitHub Actions abre con un navegador cada landing con campaña de `landings.json` y comprueba:

1. Que carga sin error (y si tarda más de 10 s, la marca como lenta).
2. Que aparece el calendario con días disponibles.
3. Que la consulta de disponibilidad (`POST /check`) devuelve horarios.
4. Que calcula el precio y está el formulario de reserva.

No pulsa «Reservar», así que no crea prerreservas en Gestión. Reintenta una vez antes de dar una landing por caída.

## Avisos

Escribe en Slack solo cuando una landing cae o se recupera (con los minutos de caída), usando el secreto `SLACK_WEBHOOK_URL` del repositorio. Una caída nueva también pone la ejecución en rojo y GitHub manda un email al dueño.

## Cambiar la lista

Añadir o quitar landings en `landings.json` (nombre y URL). Las 22 iniciales son las del Excel «Subdominios y dominios FeeltheCity» con Campañas = SÍ (25/10/2026).
