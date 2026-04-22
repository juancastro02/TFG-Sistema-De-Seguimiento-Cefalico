# Sistema de Seguimiento Cefalico

Sistema de apoyo a la accesibilidad orientado al control del ordenador mediante seguimiento cefalico y comandos de voz.

Este repositorio contiene el desarrollo de una aplicacion de escritorio cuyo objetivo es ofrecer una alternativa de interaccion para personas con limitaciones en el uso convencional de mouse y teclado. El sistema integra vision por computador para el movimiento del cursor, comandos de voz para acciones globales y un flujo de calibracion que permite adaptar el comportamiento del software a cada usuario.

## Resumen del proyecto

La propuesta parte de una necesidad concreta: facilitar el acceso a entornos informaticos mediante una interfaz natural, configurable y ejecutable sobre un equipo personal. Para ello, el sistema combina tres ejes principales:

- seguimiento cefalico para desplazar el cursor
- comandos de voz para ejecutar acciones del sistema y de interaccion
- calibracion y perfiles para adaptar el comportamiento del sistema a distintas personas y contextos de uso

La aplicacion se ejecuta como escritorio multiplataforma sobre `Electron`, con una interfaz construida en `React` y una capa nativa en `Python` para la automatizacion global de mouse y teclado.

## Objetivo general

Desarrollar un sistema de control de ordenador basado en seguimiento cefalico y voz que permita realizar tareas habituales de interaccion de manera accesible, configurable y suficientemente fluida para un uso real.

## Objetivos especificos

- Detectar la posicion de la cabeza y transformarla en movimiento continuo del cursor.
- Permitir acciones globales de mouse como clic izquierdo, clic derecho, doble clic, arrastre y scroll.
- Incorporar comandos de voz para control del sistema y entrada de texto por dictado.
- Ofrecer una calibracion guiada que permita ajustar sensibilidad, zona neutra y parametros de permanencia.
- Mantener perfiles de configuracion persistentes para distintos usuarios o escenarios de uso.
- Integrar una interfaz clara y ordenada, pensada para uso real y presentacion academica.

## Funcionalidades principales

- Movimiento del cursor mediante seguimiento cefalico.
- Calibracion guiada de postura, sensibilidad, ganancia y zona neutra.
- Activacion y desactivacion del seguimiento.
- Autoclick por permanencia.
- Comandos de voz para seleccion, arrastre, scroll y control de ventana.
- Dictado por voz con soporte para escritura, borrado de la ultima palabra y confirmacion.
- Gestion de perfiles persistentes.
- Ejecucion global fuera de la ventana de la aplicacion.

## Arquitectura general

El sistema se organiza en tres capas principales:

### 1. Renderer

Implementado con `React` y `TypeScript`. Se encarga de:

- la interfaz grafica
- la captura de video
- la visualizacion del estado del sistema
- la calibracion
- la captura de audio cuando se utiliza el proveedor remoto de voz

### 2. Proceso principal de Electron

Coordina la aplicacion y centraliza:

- IPC entre renderer y backend nativo
- logica de comandos de voz
- control de ventanas
- acceso a persistencia local

### 3. Backend nativo en Python

Permite ejecutar acciones globales sobre el sistema operativo:

- mover el cursor
- hacer clic
- mantener y soltar botones
- hacer scroll
- escribir texto
- enviar teclas

## Tecnologias utilizadas

- `Electron`
- `React`
- `TypeScript`
- `@mediapipe/tasks-vision`
- `openai`
- `electron-store`
- `Python 3`
- `pyautogui`
- `whisper.cpp` como alternativa local para voz

## Proveedor de voz

El proyecto soporta dos modos de funcionamiento para el reconocimiento de voz:

### Modo recomendado: OpenAI

Es el modo configurado por defecto. Utiliza:

- transcripcion remota
- interpretacion de comandos
- mejor experiencia general en el flujo actual del proyecto

Configuracion minima:

```env
OPENAI_API_KEY=tu_api_key
VOICE_PROVIDER=openai
```

### Modo alternativo: whisper.cpp

Se mantiene como opcion local/offline. En este caso la app utiliza `whisper-stream` y modelos descargados localmente.

Este modo requiere:

- tener `whisper.cpp` disponible dentro de `./whisper.cpp`
- compilar el binario con `npm run setup:voice`
- disponer de un modelo en `./models`

## Comandos de voz

### Comandos de interaccion

- `clic`
- `clic derecho`
- `doble clic`
- `mantener`
- `soltar`
- `scroll arriba`
- `scroll abajo`
- `activar autoclick`
- `desactivar autoclick`
- `cancelar`

### Comandos de control del sistema

- `pausar mouse`
- `reanudar mouse`
- `ocultar ventana`
- `mostrar ventana`

### Comandos de dictado

- `escribir`
- `borrar`
- `enter`
- `listo`
- `cancelar escritura`

## Requisitos del entorno

### Ubuntu / Debian

Paquetes recomendados:

```bash
sudo apt update
sudo apt install -y \
  git curl build-essential cmake pkg-config \
  python3 python3-pip python3-venv python3-dev python3-tk \
  scrot libxtst-dev libx11-dev libsdl2-dev libasound2-dev \
  libgtk-3-0 libnss3 libxss1
```

Paquete opcional:

```bash
sudo apt install -y xdotool
```

Observaciones:

- Para control global del cursor en Linux se recomienda utilizar `X11` o `XWayland`.
- En Wayland puro el comportamiento puede variar segun el entorno grafico.

### macOS

Si se desea usar voz local con `whisper.cpp`, conviene instalar:

```bash
brew install cmake sdl2 sox
```

## Instalacion

### 1. Instalar dependencias de Node

```bash
npm install
```

### 2. Crear archivo de entorno

```bash
cp .env.example .env
```

Las variables disponibles estan documentadas en [`.env.example`](.env.example).

### 3. Preparar entorno Python

```bash
npm run setup:py
```

Este paso:

- crea `py/.venv`
- instala las dependencias de `py/requirements.txt`

### 4. Configurar voz

#### Si se usa OpenAI

Solo es necesario definir la API key y dejar:

```env
VOICE_PROVIDER=openai
```

#### Si se usa whisper.cpp

1. Clonar `whisper.cpp` dentro de `./whisper.cpp`
2. Ejecutar:

```bash
npm run setup:voice
```

Este script:

- compila `whisper.cpp`
- prepara `whisper-stream`
- descarga los modelos de voz en `./models`

## Ejecucion del proyecto

### Desarrollo

```bash
npm run dev
```

Este comando lanza:

- `Vite` para el renderer
- `TypeScript` en modo watch
- `Electron`

### Verificacion de tipos

```bash
npm run typecheck
```

### Build

```bash
npm run build
```

## Variables de entorno relevantes

### Generales

- `OPENAI_API_KEY`
- `VOICE_PROVIDER`
- `VOICE_USE_AI`
- `VOICE_TRANSCRIBE_MODEL`
- `VOICE_INTENT_MODEL`
- `VOICE_CHUNK_MS`
- `PYTHON_BIN`
- `PYTHON_MOUSE_SERVER_PATH`

### Ajustes del modo local con whisper.cpp

- `WHISPER_BIN`
- `WHISPER_MODEL`
- `WHISPER_LANGUAGE`
- `WHISPER_USE_GPU`
- `VOICE_CAPTURE_ID`
- `VOICE_THREADS`
- `VOICE_STEP_MS`
- `VOICE_LENGTH_MS`
- `VOICE_KEEP_MS`
- `VOICE_MAX_TOKENS`
- `VOICE_FREQ_THRESHOLD`
- `VOICE_VAD_THRESHOLD`

### Ajustes de estabilidad de voz

- `VOICE_COMMAND_COOLDOWN_MS`
- `VOICE_COMMAND_REPEAT_WINDOW_MS`
- `VOICE_DUPLICATE_WINDOW_MS`
- `VOICE_REJECTED_WINDOW_MS`
- `VOICE_TRANSCRIPT_CONTEXT_MS`
- `VOICE_AMBIGUOUS_CLICK_DELAY_MS`

## Flujo de uso

### Control por cabeza

1. Iniciar la aplicacion.
2. Verificar la deteccion correcta del rostro en camara.
3. Ejecutar la calibracion inicial.
4. Ajustar sensibilidad, ganancia, amplificacion y permanencia.
5. Activar el seguimiento y utilizar el cursor mediante movimiento cefalico.

### Control por voz

1. Activar el sistema de voz desde la interfaz.
2. Utilizar frases cortas y claras.
3. Para dictado, situar el cursor en un campo de texto, decir `escribir` y comenzar la entrada por voz.
4. Decir `borrar` para eliminar la ultima palabra.
5. Decir `enter` o `listo` para confirmar.

## Persistencia local

La aplicacion guarda localmente:

- perfiles
- identificador del perfil activo
- parametros de calibracion
- configuraciones de voz y seguimiento

La persistencia se implementa con `electron-store`.

## Estructura del proyecto

```text
src/
  main/
    main.ts
    native-driver.ts
    storage/
    voice/
  renderer/
    components/
    styles.css
  tracking/
  types/
  preload.cjs

py/
  mouse_server.py
  requirements.txt

scripts/
  setup-python.sh
  setup-voice.sh
```

## Scripts disponibles

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`
- `npm run setup:py`
- `npm run setup:voice`
- `npm run setup`

## Limitaciones actuales

- En Linux, el control global del cursor depende del entorno grafico disponible.
- El modo local con modelos grandes de Whisper puede introducir latencia apreciable en CPU.
- El comportamiento del microfono puede requerir ajustar `VOICE_CAPTURE_ID` si hay varios dispositivos de entrada.
- La experiencia de uso puede variar segun iluminacion, posicion del usuario y calidad de la camara.

## Trabajo futuro

- ampliar la evaluacion con usuarios finales
- incorporar metricas formales de precision y tiempo de respuesta
- mejorar la adaptacion a distintos entornos de iluminacion
- estudiar nuevas estrategias de interpretacion multimodal
- empaquetar el sistema para distribucion mas sencilla

## Consideracion sobre whisper.cpp y Git

En el estado actual del proyecto, `whisper.cpp` actua como dependencia externa local y no como codigo propio del sistema principal.

Recomendacion practica:

- Mantener `whisper.cpp/` ignorado si se usa solo como dependencia local clonada aparte.
- Ignorar siempre `whisper.cpp/build/` y `models/*.bin`, ya que son artefactos generados o descargados.

