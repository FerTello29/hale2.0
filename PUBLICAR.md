# Publicar VETA AIROSA en GitHub y GitHub Pages

Esta guía asume Windows con Git instalado y la cuenta de GitHub **FerTello29** (cambia el usuario si usas otra). El proyecto ya trae su historial de commits (carpeta oculta `.git`), así que **no** hace falta `git init`.

> Importante: extrae el ZIP completo. Si copias solo los archivos visibles, se pierde la carpeta oculta `.git` y con ella el historial de versiones.

## 1. Verificar la cuenta de Git

Si en tu equipo hay más de una cuenta de GitHub guardada (por ejemplo `Thorium29`), revisa cuál se va a usar antes de subir:

```bash
git config --global user.name
git config --global user.email
```

Si al hacer `push` Windows intenta usar la cuenta equivocada: **Panel de control → Administrador de credenciales → Credenciales de Windows**, elimina la entrada `git:https://github.com` y vuelve a intentarlo; se te pedirá iniciar sesión con la cuenta correcta.

Los commits incluidos están firmados como *Fernando Rosales Tello <ftello629@gmail.com>*. Si tu correo de GitHub es otro, GitHub simplemente no los enlazará a tu avatar (no afecta la publicación).

## 2. Crear el repositorio en GitHub

1. Entra a <https://github.com/new>.
2. **Repository name:** `veta-airosa`.
3. **Public** (necesario para GitHub Pages gratis).
4. **No** marques *Add a README*, *.gitignore* ni *license* (el proyecto ya los tiene; si los marcas habrá conflicto al subir).
5. *Create repository*.

## 3. Subir el proyecto

Abre una terminal en la carpeta del proyecto (en VS Code: *Terminal → New Terminal*):

```bash
git status                      # debe decir "On branch main" y "nothing to commit"
git log --oneline               # historial de commits incluido
git remote add origin https://github.com/FerTello29/veta-airosa.git
git push -u origin main
```

Si `git remote add` responde que `origin` ya existe:

```bash
git remote set-url origin https://github.com/FerTello29/veta-airosa.git
git push -u origin main
```

## 4. Activar GitHub Pages

1. En el repositorio: **Settings → Pages**.
2. En **Build and deployment → Source** elige **GitHub Actions**.
3. Ve a la pestaña **Actions**: el flujo *Publicar en GitHub Pages* se ejecuta en cada `push` a `main`. Si no se ejecutó, entra al flujo y pulsa **Run workflow**.
4. Cuando termine (palomita verde), el juego estará en:

   **https://fertello29.github.io/veta-airosa/**

### Alternativa sin Actions (desde una rama)

Si prefieres no usar Actions: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**. En ese caso borra el archivo `.github/workflows/pages.yml` (y haz commit) para que no aparezca un flujo fallido en la pestaña Actions. El archivo `.nojekyll` ya está incluido para que GitHub sirva todos los archivos tal cual.

## 5. Flujo de trabajo para cambios posteriores

```bash
git add .
git commit -m "feat: descripción del cambio"
git push
```

Cada `push` vuelve a publicar el sitio automáticamente. Para forzar que el navegador descargue CSS/JS nuevos, incrementa el número de versión `?v=1` en las etiquetas de `index.html`.

## 6. Problemas comunes

| Síntoma | Solución |
|---|---|
| Pantalla "Se necesita un servidor local" | Abriste `index.html` con doble clic. Usa Live Server o la URL de GitHub Pages. |
| Error 404 en GitHub Pages | Espera 1–2 minutos tras el primer despliegue y revisa que la URL termine en `/veta-airosa/`. |
| La pestaña Actions muestra error en *deploy* | En Settings → Pages la fuente debe ser **GitHub Actions**. |
| `rejected ... fetch first` al hacer push | Creaste el repositorio con README. Ejecuta `git pull origin main --allow-unrelated-histories`, resuelve y vuelve a subir, o crea el repositorio vacío. |
| Pantalla de carga detenida | Revisa la consola (F12). Las librerías se descargan de `cdn.jsdelivr.net`: verifica tu conexión o que la red no bloquee ese dominio. |
| Va lento | En Ajustes desactiva *Sombras dinámicas* y *Resplandor*. |
