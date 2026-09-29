# Publicar ECO DE ORIÓN en GitHub y GitHub Pages

Esta guía asume Windows con Git instalado y la cuenta de GitHub **FerTello29**. El proyecto trae su historial de commits en la carpeta oculta `.git`: la versión 2 (*Eco de Orión*) está **encima** de los 17 commits de la versión 1 (*Veta Airosa*) que ya están en `https://github.com/FerTello29/veta-airosa`.

> Importante: extrae el ZIP completo. Si copias solo los archivos visibles, se pierde la carpeta oculta `.git` y con ella el historial.

## A. Actualizar el repositorio existente (`veta-airosa`) con la versión 2

1. Cierra VS Code y cualquier terminal abierta en la carpeta anterior.
2. Renombra la carpeta anterior como respaldo, por ejemplo `veta-airosa-v1`.
3. Extrae el ZIP en el mismo lugar (por ejemplo el Escritorio). Debe quedar una carpeta `veta-airosa` con `index.html` y la carpeta oculta `.git`.
4. Abre una terminal en la nueva carpeta (en VS Code: *Terminal → New Terminal*) y revisa:

   ```bash
   git status            # "On branch main" y "nothing to commit"
   git log --oneline     # los commits nuevos arriba y los 17 de la v1 abajo
   ```

5. Conecta el repositorio remoto y sube:

   ```bash
   git remote add origin https://github.com/FerTello29/veta-airosa.git
   git push -u origin main
   ```

   Si responde que `origin` ya existe: `git remote set-url origin https://github.com/FerTello29/veta-airosa.git` y repite el `push`.

   Como la versión 2 continúa el mismo historial, el `push` es un avance directo (*fast-forward*): **no** hace falta `--force`. Si GitHub lo rechaza con `fetch first`, significa que en GitHub hay commits que no están aquí (por ejemplo, un README editado en la web); en ese caso avísame antes de forzar nada.

## B. Activar GitHub Pages (solo la primera vez)

1. En el repositorio: **Settings → Pages**.
2. En **Build and deployment → Source** elige **GitHub Actions**.
3. Pestaña **Actions**: el flujo *Publicar en GitHub Pages* se ejecuta en cada `push` a `main`. Si falló antes de activar Pages, ábrelo y pulsa **Re-run all jobs** (o **Run workflow**).
4. Con la palomita verde, el juego queda en:

   **https://fertello29.github.io/veta-airosa/**

   Si ves la versión anterior, recarga con <kbd>Ctrl</kbd> + <kbd>F5</kbd>.

### Alternativa sin Actions

**Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**. En ese caso borra `.github/workflows/pages.yml` (y haz commit) para que no aparezca un flujo fallido. El archivo `.nojekyll` ya está incluido.

## C. (Opcional) Cambiar el nombre del repositorio

Si prefieres que la URL diga `eco-de-orion`: **Settings → General → Repository name**. Después:

```bash
git remote set-url origin https://github.com/FerTello29/eco-de-orion.git
```

La nueva dirección será `https://fertello29.github.io/eco-de-orion/` (GitHub redirige la URL anterior del repositorio, pero no la de Pages).

## D. Cambios posteriores

```bash
git add .
git commit -m "feat: descripción del cambio"
git push
```

Cada `push` vuelve a publicar el sitio. Para forzar que el navegador descargue CSS/JS nuevos, incrementa el número `?v=2` en las etiquetas de `index.html`.

## E. Cuenta de Git

Si en tu equipo hay más de una cuenta (por ejemplo `Thorium29`), revisa cuál se usa:

```bash
git config --global user.name
git config --global user.email
```

Si Windows intenta subir con la cuenta equivocada: **Panel de control → Administrador de credenciales → Credenciales de Windows**, elimina `git:https://github.com` y vuelve a hacer `push`.

Los commits están firmados como *Fernando Rosales Tello <ftello629@gmail.com>*; GitHub los asocia a la cuenta que tenga ese correo verificado.

## F. Problemas comunes

| Síntoma | Solución |
|---|---|
| Pantalla «Se necesita un servidor local» | Abriste `index.html` con doble clic. Usa Live Server o la URL de GitHub Pages. |
| Error 404 en GitHub Pages | Espera 1–2 minutos tras el despliegue y revisa que la URL termine en `/veta-airosa/`. |
| Actions muestra error en *deploy* | En Settings → Pages la fuente debe ser **GitHub Actions**; luego *Re-run all jobs*. |
| `rejected ... fetch first` | Hay commits en GitHub que no tienes en local. No uses `--force` sin revisar qué contienen. |
| Pantalla de carga detenida | Revisa la consola (F12). Las librerías vienen de `cdn.jsdelivr.net`: verifica la conexión o que la red no bloquee ese dominio. |
| Va lento | En Ajustes desactiva *Sombras dinámicas* y *Resplandor*. |
