# R34pete

Bot de Discord de contenido de adultos: **busca** imágenes por etiquetas en
tableros de booru y publica un **feed automático** en canales con restricción
de edad. Node.js + discord.js, pensado para correr en una instancia gratuita
de Oracle Cloud.

- `/buscar tags:… fuente:… medio:…` → postea un resultado al azar.
- `/feed anadir canal:… tags:… medio:…` → feed automático cada X minutos.
- `/feed listar` · `/feed borrar id:…` · `/estado` · `/ayuda`.

## Chat automático con IA

El bot **responde solo por privado** a quien le escriba. En los canales del
servidor no responde: si lo mencionan, le recuerda que le escriban por
mensaje directo (`chat.en_canales` = `nunca`).

### Las instrucciones se editan tú

El "prompt de sistema" vive en un fichero de texto:

```
sudo nano /etc/r34pete/instrucciones.md
```

El bot lo relee **solo cuando lo guardas** (sin reiniciar nada). Escribe ahí
cómo quieres que hable: tono, longitud, si es coqueto, si se llama de una
forma, etc.

### Backends de IA (todos gratis)

Se prueban en orden y, si uno falla, se pasa al siguiente:

| Backend | Clave | Notas |
|---|---|---|
| `ollama` | no | **Local** en la master: gratis, ilimitado, sin censura y rapidísimo (0,5 s). |
| `pollinations` | no | **Online y sin clave**: 1 respuesta cada 30 s por IP. |
| `gemini` | sí | Google AI Studio, tier gratis. |
| `groq` | sí | console.groq.com, tier gratis y muy rápido. |
| `openrouter` | sí | modelos marcados como `free`. |

Las claves se guardan en `/etc/r34pete/config.json` (`ia.claves`), con
permisos `640`. Para añadir una:

```bash
sudo nano /etc/r34pete/config.json     # "ia": { "claves": { "groq": "gsk_..." } }
sudo systemctl restart r34pete
```

### Comandos del chat

| Comando | Qué hace |
|---|---|
| `/instrucciones` | Muestra las instrucciones que sigue el bot. |
| `/ia` | Estado de la IA (backend activo, modo en DM y en canales). |
| `/olvidar` | Borra la memoria de conversación de ese usuario. |

En memoria recuerda los últimos 12 mensajes por usuario (`chat.maximo_historial`),
así que el chat mantiene el contexto.

## Palabras clave (mini-idioma)

Escribes palabras sueltas y el bot las traduce a etiquetas y al tipo de
archivo que quieres:

| Escribes | Busca | Detalle |
|---|---|---|
| `furry` | `anthro` | e621 no tiene etiqueta «furry»: lo anthro es `anthro` + especies |
| `canine` `feline` `fox` `wolf` `dragon` `quadruped` | la especie | etiquetas de especie de e621 |
| `futa` | `futa` | etiqueta directa |
| `gif` | `animated` | y solo archivos `.gif` |
| `videos` / `video` | `animated` | y solo `.webm`/`.mp4` (Discord los reproduce) |
| `imagen` | — | solo imágenes fijas |

Se pueden combinar: `/buscar furry videos` busca anthro en `.webm`.
Si una palabra no está en la tabla, se usa tal cual como etiqueta
(estilo danbooru).

Los `.webm` de e621 pesan entre 3 y 90 MB: el bot se queda con los que caben
en el límite de subida de Discord (`guards.maxUploadMb`, 25 MB por defecto) y,
si no cabe ninguno, usa la versión pequeña que da el tablero.

## Tableros

| Tablero | Credenciales | Notas |
|---|---|---|
| rule34 | **user_id + api_key** | El que más material de adultos tiene. La API ahora **exige clave**: se saca en `rule34.xxx` → *Ajustes de la cuenta*. |
| e621 | ninguna | Funciona con un User-Agent identificable; trae contenido `rating:explicit`, `.gif` y `.webm`. |
| danbooru | ninguna | Funciona; su contenido explícito está filtrado para cuentas anónimas; sus animaciones son `.gif`. |
| gelbooru | user_id + api_key | Apagado por defecto. |

## Guardas (siempre activas)

1. **Sólo canales con "Restricción de edad" activada.** Discord lo exige
   para contenido maduro; el bot se niega y lo dice si el canal no la tiene.
2. **Rol de edad opcional** (`guards.ageRole`, p. ej. `"18+"`).
3. **Lista negra incondicional**: menores y material no consentido se
   rechazan siempre, en cualquier servidor.
4. **Enfriado por usuario** para no abusar del tablero.
5. Los tableros se piden con un User-Agent propio y con espera entre
   peticiones, como piden sus reglas de uso.

## Hosting: todo online

El bot **no debe correr en tu PC**: en la nube, con la IA también online.

| Opción | Coste | Sirve 24/7 | Notas |
|---|---|---|---|
| **Oracle Cloud Always Free** | gratis | sí | 2 micro x86 (1 GB) o 1 A1 ARM (2 OCPU/12 GB). Pide tarjeta **una vez** para verificar la cuenta; luego no cobra nada. El A1 suele salir *Out of capacity*: prueba otra región o la micro. |
| Railway | 5 $/mes | sí | Trial de 5 $ al registrarte (un mes gratis) y luego plan Hobby. |
| Koyeb | gratis | **no** | El plan gratis da 5 h/mes: no sirve para un bot. |

### Oracle en 4 pasos

1. `cloud.oracle.com/free` → *Start for free* (tarjeta para verificar).
2. **Create instance** → shape `VM.Standard.A1.Flex` (2 OCPU, 12 GB) o
   `VM.Standard.E2.1.Micro` (1 GB) → imagen Ubuntu 22.04/24.04.
3. Red: VCN por defecto, subred pública, **ingress 22/tcp** (SSH) y sube tu
   clave pública (`~/.ssh/r34pete_oci.pub`).
4. *Advanced options → Cloud-init script*: pega `cloud-init.sh` (prepara Node,
   el usuario y el servicio).

Y luego, desde la master:

```bash
bash ~/superyuki-arreglos/r34pete/desplegar-remoto.sh <IP_PUBLICA> ubuntu ~/.ssh/r34pete_oci
```

## Instalación

### En cualquier Linux (Ubuntu / Oracle Linux)

```bash
sudo bash install.sh /ruta/al/codigo
sudo nano /etc/r34pete/config.json    # campo "token"
sudo systemctl restart r34pete
sudo journalctl -u r34pete -f
```

### En Oracle Cloud (Always Free)

1. **Crear la instancia**: Compute → Instances → Create.
   - Shape: `VM.Standard.A1.Flex` (Always Free, 2 OCPU / 12 GB; si sale
     *Out of capacity*, prueba otra región o `VM.Standard.E2.1.Micro`).
   - Imagen: Ubuntu 22.04/24.04 (aarch64) u Oracle Linux 9.
   - Red: VCN por defecto, subred pública con **ingress 22/tcp** (SSH).
   - Subir tu clave pública de SSH.
2. **Cloud-init**: *Advanced options → Cloud-init script* y pega
   `cloud-init.sh` (instala Node 22, el usuario `r34pete` y el servicio).
3. **Copiar código y configuración** desde tu máquina:

   ```bash
   scp -i <tu_llave> -r . ubuntu@<IP>:/tmp/r34pete
   scp -i <tu_llave> config.json ubuntu@<IP>:/tmp/config.json
   ssh -i <tu_llave> ubuntu@<IP> 'sudo bash /tmp/r34pete/install.sh /tmp/r34pete && \
     sudo install -m 640 -o root -g r34pete /tmp/config.json /etc/r34pete/config.json && \
     sudo systemctl restart r34pete'
   ```

   `config.json` debe llevar el token ya pegado (no se copia el token por la
   red en claro: hazlo por ssh desde tu máquina, o edita el fichero en el
   servidor con `nano`).
4. Comprobar: `ssh … 'sudo journalctl -u r34pete -f'` → debe decir
   *R34pete conectado como …*.

## Configuración (`/etc/r34pete/config.json`)

```jsonc
{
  "token": "…",                     // token del bot
  "guildId": "1540174644311756832", // comandos al instante en ese servidor
  "providers": {
    "rule34": { "enabled": true, "userId": "…", "apiKey": "…" },
    "e621":    { "enabled": true },
    "danbooru":{ "enabled": true }
  },
  "guards": {
    "requireNsfwChannel": true,
    "ageRole": "",                  // nombre o id del rol "18+"
    "cooldownSeconds": 20,
    "maxResults": 40
  },
  "feeds": []                       // los crea /feed anadir
}
```

También vale por entorno: `DISCORD_TOKEN`, `R34PETE_GUILD_ID`,
`RULE34_USER_ID`, `RULE34_API_KEY`.

## Discord: crear la aplicación

1. `discord.com/developers/applications` → *New Application* → nombre
   **R34pete** → *Bot* → *Reset Token* (cópialo, sale una sola vez).
2. En *Installation* → *Install* en el servidor de pruebas
   (`CHAMBACION SERVIRISTICA`, id `1540174644311756832`) con permisos:
   *Send Messages*, *Attach Files*, *Embed Links*, *Use Slash Commands*.
3. En *Bot → Privileged Gateway Intents* no hace falta nada.
4. Marca la descripción del bot como NSFW: Discord exige que el bot declare
   que sirve contenido de adultos.
5. Crea un canal con *Restricción de edad* activada (Ajustes del canal →
   Restricción de edad) y ahí crea el feed.

Los comandos se registran solos al arrancar; si tardan, fuerza el registro:

```bash
DISCORD_TOKEN=… node src/register.js 1540174644311756832
```

## Notas de Discord

- Los servidores dedicados a porno quedan bloqueados en iOS (sólo desktop y
  web).
- A partir de **100 servidores**, Discord pide verificación de la
  aplicación: descripción del bot y canal de soporte.
- El contenido de adultos va siempre en canal con restricción de edad.

## Licencia

Uso personal. Quien lo usa es responsable del contenido que se publique en
su servidor y de cumplir las reglas de Discord y la ley de su país.
