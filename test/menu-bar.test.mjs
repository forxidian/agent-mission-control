import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('provides a native macOS menu bar pending-count helper', async () => {
  const [script, packageJson] = await Promise.all([
    readFile(new URL('../scripts/macos-pending-island.swift', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ]);

  assert.match(script, /NSStatusBar\.system\.statusItem/);
  assert.match(script, /api\/pending-summary/);
  assert.match(script, /AGENT_MISSION_CONTROL_URL/);
  assert.match(script, /displayCount/);
  assert.match(script, /badgeCount/);
  assert.match(script, /NSPopover/);
  assert.match(script, /PendingPopoverViewController/);
  assert.match(script, /mouseEntered\(with event: NSEvent\)/);
  assert.match(script, /popover\.show\(relativeTo:/);
  assert.match(script, /item\.button\?\.action = #selector\(openDashboard\(_:\)\)/);
  assert.match(script, /focusExistingDashboardTab\(\)/);
  assert.match(script, /Google Chrome/);
  assert.match(script, /Safari/);
  assert.match(script, /active tab index/);
  assert.match(script, /NSWorkspace\.shared\.open\(baseURL\)/);
  assert.match(script, /drawBadgeImage\(count: Int, connected: Bool\)/);
  assert.match(script, /button\?\.image = image/);
  assert.match(script, /compactCountTitle\(_ count: Int\)/);
  assert.match(script, /"9\\u\{0307\}"/);
  assert.match(script, /calibratedWhite: connected && count == 0 \? 0\.90 : 0\.98/);
  assert.match(script, /NSColor\.systemOrange/);
  assert.doesNotMatch(script, /topSheen/);
  assert.doesNotMatch(script, /bottomLine/);
  assert.doesNotMatch(script, /drawIslandImage/);
  assert.match(script, /打开控制台/);
  assert.match(packageJson, /"menubar": "swift scripts\/macos-pending-island\.swift"/);
});
