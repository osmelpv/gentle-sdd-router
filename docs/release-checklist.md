# Release Checklist

This project is still in **beta**. Do not publish until the checklist below is complete.

## Pre-release

- [ ] Full test suite passes (`node --test`)
- [ ] Docker E2E environment prepared and validated manually in OpenCode
- [ ] README and docs audited for consistency
- [ ] Import/export flow tested on a clean machine or container
- [ ] Overlay generation tested with a real `~/.config/opencode/opencode.json`
- [ ] Safety preset validated interactively in OpenCode
- [ ] Token usage monitor scope for v1 is decided clearly

## Package metadata

- [ ] Confirm final npm package name
- [ ] Confirm `gsr` bin name does not conflict in npm ecosystem
- [ ] Decide whether to keep `assets/` in the published package
- [ ] Change `private: true` to `false`
- [ ] Decide final license text and add a real `LICENSE` file

## Publish steps

```bash
npm login
npm pack
npm publish --access public
```

## Post-publish

- [ ] Verify `npm install -g gentle-sdd-router` works on a clean environment
- [ ] Verify `gsr --version`
- [ ] Verify `gsr install` from global install
- [ ] Tag the release in GitHub
- [ ] Add release notes with the main features and known limitations
