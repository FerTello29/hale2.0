# Publicar ECO DE ORIÓN (Vercel + GitHub Pages)

Repositorio: **https://github.com/FerTello29/hale2.0**

El juego se puede publicar de dos formas:

| Opción | URL | IA (OpenAI) | Voz | VR |
|---|---|---|---|---|
| **Vercel (recomendada)** | `https://<tu-proyecto>.vercel.app` | ✅ la API key queda oculta en el servidor | ✅ todas las variantes, también en Meta Quest | ✅ |
| GitHub Pages | `https://fertello29.github.io/hale2.0/` | Solo si apuntas a tu despliegue de Vercel (sección C) | Reconocimiento del navegador (Chrome, Edge, Android) | ✅ |

> **Nunca escribas tu API key de OpenAI en el código ni la subas a GitHub.** Solo va en las variables de entorno de Vercel (o en `.env.local`, que Git ignora).

---

## A. Subir los cambios a GitHub

```bash
cd C:\Users\ftell\hale2.0
git status
git push origin main
```

## B. Desplegar en Vercel con la API key oculta

1. Entra a <https://vercel.com> con tu cuenta de GitHub.
2. **Add New… → Project → Import** el repositorio `FerTello29/hale2.0`.
3. Configuración del proyecto:
   - **Framework Preset:** `Other`
   - **Build Command:** vacío (no hay compilación)
   - **Output Directory:** vacío o `.` (la raíz)
4. En **Environment Variables** agrega:

   | Nombre | Valor |
   |---|---|
   | `OPENAI_API_KEY` | tu clave `sk-…` de <https://platform.openai.com/api-keys> |
   | `OPENAI_MODEL` | `gpt-4o-mini` (opcional, es el valor por defecto) |
   | `OPENAI_TRANSCRIBE_MODEL` | `whisper-1` (opcional) |
   | `ALLOWED_ORIGINS` | `https://fertello29.github.io` (solo si también juegas desde GitHub Pages) |

5. **Deploy.** Cada `push` a `main` vuelve a desplegar automáticamente.
6. Comprueba que funciona: abre `https://<tu-proyecto>.vercel.app/api/health`. Debe responder `{"ok":true,"ai":true,...}`. La clave nunca aparece en esa respuesta.
7. En el juego, **Ajustes → Voz, IA y realidad virtual** debe decir «IA conectada».

### Proteger tu saldo de OpenAI

- Las funciones aceptan solo peticiones desde tu propio dominio, `localhost` y lo que pongas en `ALLOWED_ORIGINS`, y limitan las solicitudes por IP (comandos 30/min, táctica 8/min, transcripción 20/min).
- Esa protección es básica: alguien con `curl` podría hacer peticiones dentro del límite. **Configura un límite de gasto mensual** en <https://platform.openai.com/settings/organization/limits> (por ejemplo, 5 USD).
- Si sospechas que se filtró la clave, revócala en OpenAI, crea otra y actualízala en Vercel (**Settings → Environment Variables → Redeploy**).

## C. Usar la IA desde GitHub Pages (opcional)

GitHub Pages solo sirve archivos estáticos, así que no tiene `/api`. Para usar la IA desde ahí:

1. En Vercel, agrega `ALLOWED_ORIGINS=https://fertello29.github.io`.
2. En `js/config.js`, pon la URL de tu despliegue:

   ```js
   export const AI = {
     baseUrl: 'https://<tu-proyecto>.vercel.app',
     ...
   };
   ```

3. Haz commit y push.

Si `baseUrl` está vacío, el juego busca `/api` en su propio dominio. Si no lo encuentra, usa la lógica local sin mostrar errores.

GitHub Pages está configurado como **Deploy from a branch** (`main`, raíz). El flujo de Actions que fallaba se eliminó: ya no hace falta.

## D. Probar en tu computadora

Sin IA (solo archivos estáticos):

```bash
npm start            # http://localhost:8080
```

Con IA (funciones de Vercel en local):

```bash
copy .env.example .env.local     # y pon tu clave en .env.local
npm run ia-local                 # npx vercel dev → http://localhost:3000
```

La primera vez, `vercel dev` pide iniciar sesión y vincular el proyecto.

## E. Jugar en realidad virtual

- **Meta Quest 3 (o 2/Pro):** abre la URL de Vercel en el **navegador del Quest** → elige una operación → **Jugar en visor VR**. Para la voz, mantén **X** en el control izquierdo mientras hablas: se transcribe con OpenAI porque el navegador del Quest no tiene reconocimiento de voz propio.
- **Lentes VR Box (celular):** abre la URL en **Chrome para Android** (o Safari en iPhone) → **Lentes VR Box** → acepta los permisos de giroscopio y micrófono → coloca el teléfono en horizontal en el visor. Controla a NOVA-7 con la voz («avanza», «dispara», «ve al objetivo», «alto»), con un control Bluetooth o tocando la pantalla para disparar. Di «pausa» para salir del modo estéreo.
- La voz y la VR necesitan **HTTPS**. Vercel y GitHub Pages ya lo tienen; `localhost` también funciona.

## F. Problemas comunes

| Síntoma | Solución |
|---|---|
| «Sin servidor de IA» en Ajustes | Estás en GitHub Pages o en `npm start`. Usa Vercel o configura `AI.baseUrl` (sección C). |
| «Servidor de IA sin API key» | Falta `OPENAI_API_KEY` en Vercel o no hiciste *Redeploy* después de agregarla. |
| `/api/health` da 404 en Vercel | Revisa que el preset sea `Other` y que la carpeta `api/` esté en el repositorio. |
| La voz no responde | Acepta el permiso del micrófono. En Firefox y Quest se necesita la IA (Vercel) para transcribir. |
| No aparece «Jugar en visor VR» | El navegador no tiene WebXR. Usa el navegador del Quest (o Chrome/Edge con un visor de PC conectado). |
| VR Box: la imagen no se mueve con la cabeza | En iPhone acepta el permiso de «movimiento y orientación». La página debe estar en HTTPS. |
| Pantalla «Se necesita un servidor local» | Abriste `index.html` con doble clic. Usa `npm start`, Live Server o la URL publicada. |
| Va lento (sobre todo en VR) | En Ajustes desactiva *Sombras dinámicas*. En VR el resplandor se desactiva solo. |
| `rejected ... fetch first` al hacer push | Hay commits en GitHub que no tienes en local: `git pull --rebase` y vuelve a hacer push. No uses `--force` sin revisar. |
