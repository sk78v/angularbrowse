import { basename, dirname, isYamlPath, shortBranchName } from './ado.models';

describe('path helpers', () => {
  it('recognises YAML extensions case-insensitively', () => {
    expect(isYamlPath('/azure-pipelines.yml')).toBe(true);
    expect(isYamlPath('/deploy/Values.YAML')).toBe(true);
    expect(isYamlPath('/README.md')).toBe(false);
    expect(isYamlPath('/yamlfolder/notes.txt')).toBe(false);
  });

  it('takes the trailing segment as the name', () => {
    expect(basename('/src/pipelines/build.yml')).toBe('build.yml');
    expect(basename('/src')).toBe('src');
    expect(basename('/')).toBe('/');
  });

  it('walks up to the parent folder, stopping at the root', () => {
    expect(dirname('/src/pipelines/build.yml')).toBe('/src/pipelines');
    expect(dirname('/src/pipelines')).toBe('/src');
    expect(dirname('/src')).toBe('/');
    expect(dirname('/')).toBe('/');
  });

  it('shortens branch refs', () => {
    expect(shortBranchName('refs/heads/main')).toBe('main');
    expect(shortBranchName('refs/heads/feature/a/b')).toBe('feature/a/b');
    expect(shortBranchName('main')).toBe('main');
  });
});
