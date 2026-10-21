# Social SDK: que la IA lea tu bandeja de Discord

Esto es la parte "app oficial": el **Discord Social SDK** (la API oficial de
Discord, no un truco) lee los privados que te llegan a tu cuenta y la IA deja
preparada la respuesta.

Una diferencia importante con el resto del bot: **Discord no permite que una
app mande mensajes sola en tu nombre**. Su propia documentación del metodo
`sendUserMessage` lo dice: *"Only call in response to an explicit user action"*.
Por eso el diseño es:

- **leer y redactar**: automatico (cada 3 min mira la bandeja);
- **mandar**: lo mandas tu con un comando, `/enviar <id>`.

El bot te avisa por privado cuando hay un borrador nuevo, con el texto tal cual
para que lo leas y pulses enviar. Si prefieres que se mande solo, la via que
Discord si permite es que conteste **un bot** (R34pete), no tu cuenta.

## Como queda montado

```
Discord (tu bandeja)  ->  Social SDK  ->  R34pete (nube, GitHub Actions)
                                              |- lee la bandeja
                                              |- redacta con la IA (groq)
                                              |- te avisa por privado
                                              |- tu: /enviar <id>  -> sale el mensaje
```

## Lo que tienes que hacer (una vez)

### 1. Activar el Social SDK en una app

En el [portal de Discord para desarrolladores](https://discord.com/developers/applications):
crea una app (o usa la de R34pete, `1562157263483830462`) y activa el interruptor
**"Discord Social SDK"** en *App Settings -> Social SDK*.

### 2. Descargar la libreria nativa

En la misma pagina, en la barra lateral, **Downloads -> Social SDK**: descarga el
paquete de tu plataforma (Linux x64 si el bot corre en la nube). Descomprimelo y
guardalo en un sitio; dentro esta `libdiscord_partner_sdk.so`.

Discord **no permite redistribuirla**, asi que no puede ir en un repo publico.

### 3. Subirla a un repo privado y decirselo al bot

```bash
bash social/subir-sdk.sh /ruta/al/SDK/libdiscord_partner_sdk.so
```

El script crea (o usa) el repo privado `zumorra/r34pete-privado`, sube la
libreria ahi y deja los secretos `SOCIAL_SDK_URL` y `SOCIAL_SDK_TOKEN` puestos
en el repo de la nube. El fichero nunca pasa por el chat.

### 4. Autorizar tu cuenta (una vez, en tu equipo)

```bash
export DISCORD_SDK_PATH=/ruta/al/SDK
node social/autorizar.js --app 1562157263483830462
```

Se abre el navegador, apruebas los permisos (`sdk.social_layer`: leer tus
privados y poder mandar en tu nombre), y el script guarda los tokens como
secretos del repo: `DISCORD_SOCIAL_ACCESS`, `DISCORD_SOCIAL_REFRESH`,
`DISCORD_SOCIAL_EXPIRES`, `DISCORD_SOCIAL_SCOPES` y `DISCORD_SOCIAL_APP_ID`.
Ni los tokens ni la libreria se imprimen nunca.

## Comandos

| Comando | Que hace |
|---|---|
| `/borradores` | Lista las respuestas preparadas que aun no has mandado |
| `/enviar <id>` | Manda ese borrador a tu bandeja (esto es la accion tuya) |
| `/saber` | Las reglas que la IA conoce (`respuestas.json`) |
| `/instrucciones` | La personalidad actual (`instrucciones.md`) |

## Notas

- Los borradores **no** se suben al repo (son texto de tu vida privada): viven
  solo en memoria de la sesion y se pierden al reiniciar. Las reglas y la
  personalidad si estan en el repo, y se editan sin tocar codigo.
- Si el Social SDK no esta disponible (sin tokens o sin libreria), el bot
  sigue funcionando como de costumbre y lo dice en el log:
  `[social] sin tokens ... la parte de la bandeja queda apagada`.
- La IA es la misma que usa el bot: `groq` (gratis) con `pollinations` de
  reserva, y las reglas de `respuestas.json`.
