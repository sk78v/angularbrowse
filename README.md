# AngularBrowse — YAML file picker for on-prem Azure DevOps

An Angular 22 app with a reusable "browse and pick a file" control that walks a git
repository on an **on-prem Azure DevOps Server / TFS** collection and lets the user select a
`.yml` / `.yaml` file. The chosen file's contents are fetched and previewed.

## Quick start (no ADO server needed)

A mock ADO server is included so you can see the whole flow working immediately:

```bash
npm run mock
```

Then, in a second terminal:

```bash
npm run start:mock
```

Open http://localhost:4200, set **Project** to anything (e.g. `Demo`), pick an auth mode, and
click **Browse…**. The mock ignores collection/project names and serves a small fake repo tree.

## Pointing at a real server

1. Edit `proxy.conf.json` and set `target` to your server, with `pathRewrite` mapping `/ado`
   onto the server's virtual directory:

   ```json
   {
     "/ado": {
       "target": "https://tfs.contoso.com",
       "secure": false,
       "changeOrigin": true,
       "pathRewrite": { "^/ado": "/tfs" }
     }
   }
   ```

   Set `"secure": false` only if the server uses a self-signed certificate.

2. `npm start`, then fill in the Connection panel:

   | Field | Meaning |
   | --- | --- |
   | Base URL | `/ado` to go through the proxy, or the full server address |
   | Collection | e.g. `DefaultCollection` |
   | Project | team project name |
   | API version | `5.0` (Server 2019), `6.0` (2020), `7.0` (2022) |
   | Authentication | PAT, or Windows/integrated |

   A PAT needs the **Code (Read)** scope.

### Why the proxy

The browser will not let a page on `localhost:4200` call `https://tfs.contoso.com` unless that
server returns CORS headers, which on-prem ADO does not do by default. The dev-server proxy
makes the calls same-origin. In production, serve the app behind the same host as ADO or put a
reverse proxy (IIS ARR, nginx) in front of both. Setting **Base URL** to the full server
address works only if you have arranged CORS yourself.

## What the control does

- Repository and branch selectors, populated from the collection.
- Lazy, one-level-at-a-time folder listing (`recursionLevel=OneLevel`), cached per
  repo/branch/path so walking back up the tree does not re-hit the server.
- Folders sort ahead of files; only YAML files are selectable.
- **Show all files** reveals non-YAML entries, dimmed and unselectable.
- Breadcrumb trail, up-one-level, refresh, and a name filter.
- Double-click a YAML file to pick it; `Esc` cancels.
- On confirm, fetches the file body and emits it to the host.

## Reusing it elsewhere

The dialog is a standalone component that reads connection settings from `AdoConnectionStore`:

```html
@if (browserOpen()) {
  <ado-yaml-browser (picked)="onPicked($event)" (cancelled)="browserOpen.set(false)" />
}
```

`picked` emits a `SelectedYamlFile`: `path`, `name`, `repository`, `branch`, `objectId`,
`size` and `content`.

## Layout

| Path | Purpose |
| --- | --- |
| `src/app/models/ado.models.ts` | API types and path helpers |
| `src/app/services/ado.service.ts` | REST client + error messages |
| `src/app/services/ado-connection.store.ts` | Connection settings (signals) |
| `src/app/yaml-browser/` | The browse dialog |
| `src/app/app.*` | Host page: settings, picker, preview |
| `mock/ado-mock-server.mjs` | Fake ADO API for development |

## A note on the PAT

The PAT is held in memory for the tab only — everything else in the Connection panel is
persisted to `localStorage`, but the token deliberately is not. Anything in `localStorage` is
readable by any script on the origin and outlives the user's session.

## Commands

```bash
npm start          # dev server (proxy.conf.json)
npm run start:mock # dev server against the bundled mock
npm run mock       # the mock ADO server
npm run build      # production build
npm test           # unit tests
```
