/**
 * Minimal stand-in for the Azure DevOps Server git REST API.
 *
 * It implements just the four endpoints the YAML browser calls, backed by an
 * in-memory repository tree, so the UI can be developed and demoed without a
 * real on-prem collection. Start it with `npm run mock`, then run the app with
 * `npm run start:mock` (which proxies /ado here instead of at a real server).
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 5111);

/** path -> file contents. Folders are implied by the path segments. */
const FILES = {
  '/README.md': '# Demo repository\n\nNothing to see here.\n',
  '/azure-pipelines.yml': [
    'trigger:',
    '  branches:',
    '    include:',
    '      - main',
    '',
    'pool:',
    "  name: 'Default'",
    '',
    'steps:',
    '  - script: echo "building"',
    '    displayName: Build',
    '',
  ].join('\n'),
  '/src/app.ts': 'export const answer = 42;\n',
  '/src/config/settings.yaml': [
    'server:',
    '  host: tfs.contoso.com',
    '  port: 8080',
    'features:',
    '  - browse',
    '  - preview',
    '',
  ].join('\n'),
  '/src/config/notes.txt': 'not a yaml file\n',
  '/pipelines/build.yml': [
    'parameters:',
    '  - name: configuration',
    '    default: Release',
    '',
    'steps:',
    '  - task: DotNetCoreCLI@2',
    '    inputs:',
    '      command: build',
    '',
  ].join('\n'),
  '/pipelines/deploy/release.yaml': [
    'stages:',
    '  - stage: Deploy',
    '    jobs:',
    '      - deployment: Web',
    '        environment: production',
    '',
  ].join('\n'),
  '/pipelines/deploy/rollback.yml': 'stages: []\n',
};

const REPOSITORIES = [
  { id: 'repo-1', name: 'demo-service', defaultBranch: 'refs/heads/main' },
  { id: 'repo-2', name: 'infrastructure', defaultBranch: 'refs/heads/master' },
];

const BRANCHES = {
  'repo-1': ['refs/heads/main', 'refs/heads/develop'],
  'repo-2': ['refs/heads/master'],
};

/** Immediate children of a folder, mirroring recursionLevel=OneLevel. */
function listOneLevel(scopePath) {
  const scope = scopePath === '/' ? '' : scopePath.replace(/\/+$/, '');
  const children = new Map();

  for (const filePath of Object.keys(FILES)) {
    if (!filePath.startsWith(`${scope}/`)) continue;
    const rest = filePath.slice(scope.length + 1);
    const slash = rest.indexOf('/');

    if (slash === -1) {
      children.set(filePath, {
        objectId: hash(filePath),
        gitObjectType: 'blob',
        path: filePath,
        isFolder: false,
        size: Buffer.byteLength(FILES[filePath], 'utf8'),
      });
    } else {
      const folderPath = `${scope}/${rest.slice(0, slash)}`;
      children.set(folderPath, {
        objectId: hash(folderPath),
        gitObjectType: 'tree',
        path: folderPath,
        isFolder: true,
      });
    }
  }

  // The real API returns the scoped folder alongside its children.
  const self = {
    objectId: hash(scopePath),
    gitObjectType: 'tree',
    path: scopePath,
    isFolder: true,
  };
  return [self, ...children.values()];
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, '0').repeat(5).slice(0, 40);
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname, searchParams } = url;
  console.log(`${req.method} ${pathname}${url.search}`);

  // .../_apis/git/repositories
  if (pathname.endsWith('/_apis/git/repositories')) {
    return send(res, 200, { count: REPOSITORIES.length, value: REPOSITORIES });
  }

  // .../_apis/git/repositories/{id}/refs
  const refs = pathname.match(/\/_apis\/git\/repositories\/([^/]+)\/refs$/);
  if (refs) {
    const names = BRANCHES[refs[1]] ?? ['refs/heads/main'];
    return send(res, 200, {
      count: names.length,
      value: names.map((name) => ({ name, objectId: hash(name) })),
    });
  }

  // .../_apis/git/repositories/{id}/items
  if (/\/_apis\/git\/repositories\/[^/]+\/items$/.test(pathname)) {
    const filePath = searchParams.get('path');
    if (filePath) {
      const content = FILES[filePath];
      if (content === undefined) {
        return send(res, 404, { message: `Path '${filePath}' not found.` });
      }
      return send(res, 200, {
        objectId: hash(filePath),
        gitObjectType: 'blob',
        path: filePath,
        isFolder: false,
        size: Buffer.byteLength(content, 'utf8'),
        content: searchParams.get('includeContent') === 'true' ? content : undefined,
      });
    }

    const scopePath = searchParams.get('scopePath') ?? '/';
    const items = listOneLevel(scopePath);
    return send(res, 200, { count: items.length, value: items });
  }

  send(res, 404, { message: `No mock route for ${pathname}` });
});

server.listen(PORT, () => {
  console.log(`ADO mock server listening on http://localhost:${PORT}`);
  console.log('Collection/project names are not validated - any values work.');
});
