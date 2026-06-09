# Monitor de Posturas Web

Aplicacion web de monitoreo postural en tiempo real con IA.

## Estructura del proyecto

```
postura-web/
├── index.html              Punto de entrada principal
├── style.css               Estilos globales (variables CSS, sin emojis)
│
├── js/                     Modulos JavaScript (cargar en orden)
│   ├── credentials.js      Token y claves cifradas con XOR+Base64 (no exponer)
│   ├── config.js           Constantes: umbrales, etiquetas, indices MediaPipe
│   ├── ui.js               Funciones de interfaz: estado, barra, log, toast
│   ├── telegram.js         API Telegram: deteccion de Chat ID, alertas, resumen
│   ├── db.js               API Supabase: insertar sesiones y frames muestreados
│   ├── pose.js             Inferencia ONNX, auto-switch, dibujo en canvas
│   └── main.js             Control de camara, modos, inicializacion de la app
│
├── models/                 Modelos ONNX y metadata
│   ├── modelo_frontal.onnx
│   ├── scaler_frontal.onnx
│   ├── metadata_frontal.json
│   ├── modelo_lateral.onnx
│   ├── scaler_lateral.onnx
│   └── metadata_lateral.json
│
├── img/                    Imagenes de la interfaz
│   ├── logo.png
│   ├── IA.jpg
│   ├── monitoreo-postura.jpg
│   ├── supabase.jpg
│   └── telegram.png
│
└── db/
    └── schema.sql          Schema Supabase: tablas sessions y posture_frames

```

## Orden de carga de scripts

Los scripts no usan ES modules para mantener compatibilidad maxima con
servidores estaticos y sin bundler. El orden en index.html es:

1. `credentials.js` — constantes cifradas (BOT_TOKEN, SUPABASE_URL, etc.)
2. `config.js`      — constantes de configuracion (MALA_SEG, POSE_LM_INDEX, etc.)
3. `ui.js`          — funciones de UI (depende de config.js)
4. `telegram.js`    — funciones TG (depende de credentials, config, ui)
5. `db.js`          — funciones Supabase (depende de credentials, config, ui)
6. `pose.js`        — inferencia y loop (depende de todos los anteriores)
7. `main.js`        — init y control de camara (depende de todos)

## Base de datos

Ejecutar `db/schema.sql` en Supabase SQL Editor (una sola vez).

Tablas:
- `sessions`       — una fila por sesion de monitoreo (con duracion calculada)
- `posture_frames` — frames muestreados cada ~2s (SAMPLE_EVERY_N = 60)

Vistas para exportar dataset:
```sql
-- Dataset frontal
COPY (SELECT * FROM v_dataset_frontal) TO '/tmp/dataset_frontal.csv' CSV HEADER;

-- Dataset lateral
COPY (SELECT * FROM v_dataset_lateral) TO '/tmp/dataset_lateral.csv' CSV HEADER;
```

## Configuracion de credenciales

El token del bot de Telegram esta cifrado en `js/credentials.js`.
El usuario solo ingresa su `TELEGRAM_CHAT_ID` — no se pide ningun token.

Para actualizar las claves de Supabase, ejecutar en Python:
```python
import base64
def enc(s, k=73):
    return base64.b64encode(bytes([ord(c) ^ k for c in s])).decode()
print(enc("tu_nueva_clave"))
```
Y reemplazar el valor en `credentials.js`.
