# Mubis HD — plugin de Kino

Películas, series y TV en vivo en HD: catálogo, búsqueda, fichas, episodios y guía de canales, sobre un servidor **Xtream Codes** (`player_api.php`).

## Instalar

En Kino: **Ajustes ▸ Plugins ▸ Agregar**, y escribe `xuper-plugin/mubis`. Kino muestra la hoja de consentimiento (a qué hosts llega y qué permisos pide) antes de instalar nada.

## Qué trae

- Inicio con secciones, exploración, búsqueda (también dentro de una página «Ver más»), categorías, fichas con temporadas y episodios, y **descargas** de lo que `resolve` entrega.
- **En vivo**: categorías y canales, con guía de programación cuando el servidor la publica.
- La cuenta del servicio se guarda **cifrada** en el aparato (AES-256-CBC); su clave es un secreto sellado que solo Kino puede abrir, así que ni este repositorio ni el aparato la exponen. Por eso el plugin solo funciona instalado desde la rama principal, sin `@rama`.

## Ajustes

- **Cuenta:** estado de la cuenta, **Probar conexión** y **Vaciar caché**.
- El video puede salir de otros hosts (`streamHosts: any`, `liveStreamHosts: any`; aviso en rojo al instalar).

## Hosts declarados

`vseemax.com`.

## Licencia

Apache-2.0 (ver `LICENSE`). El plugin no aloja ni almacena contenido: muestra lo que devuelve el servicio indicado arriba, y lo que se ve a través de él
es responsabilidad de quien lo usa. No está afiliado con los servicios ni con los sitios que menciona.
