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
  assert.match(script, /runningHostThreadCount/);
  assert.match(script, /let badgeCount = summary\.displayCount \?\? summary\.hardPendingCount/);
  assert.match(script, /NSPopover/);
  assert.match(script, /PendingPopoverViewController/);
  assert.match(script, /mouseEntered\(with event: NSEvent\)/);
  assert.match(script, /popover\.show\(relativeTo:/);
  assert.match(script, /item\.button\?\.action = #selector\(openDashboard\(_:\)\)/);
  assert.match(script, /item\.button\?\.sendAction\(on: \[\.leftMouseDown\]\)/);
  assert.match(script, /openInstalledDashboardApp\(\)/);
  assert.match(script, /api\/app\/open-installed/);
  assert.match(script, /request\.httpMethod = "POST"/);
  assert.match(script, /focusExistingDashboardTab\(\)/);
  assert.match(script, /Google Chrome/);
  assert.match(script, /Safari/);
  assert.match(script, /active tab index/);
  assert.match(script, /NSWorkspace\.shared\.open\(baseURL\)/);
  assert.match(script, /drawBadgeImage\(pendingCount: Int, hostCount: Int, connected: Bool\)/);
  assert.match(script, /drawSegmentCount\(_ count: Int/);
  assert.match(script, /drawDisconnectedBadgeImage\(\)/);
  assert.doesNotMatch(script, /项新进展/);
  assert.doesNotMatch(script, /项需处理/);
  assert.match(script, /button\?\.image = image/);
  assert.match(script, /compactCountTitle\(_ count: Int\)/);
  assert.match(script, /"9\\u\{0307\}"/);
  assert.match(script, /islandSurfaceColor/);
  assert.match(script, /islandBlueColor/);
  assert.match(script, /islandMutedRedColor/);
  assert.match(script, /accentColor/);
  assert.match(script, /font\.ascender - font\.descender \+ font\.leading/);
  assert.match(script, /opticalYOffset/);
  assert.doesNotMatch(script, /calibratedWhite: count == 0 \? 0\.86 : 0\.98/);
  assert.doesNotMatch(script, /NSColor\.systemOrange/);
  assert.doesNotMatch(script, /NSColor\.systemBlue/);
  assert.doesNotMatch(script, /rect\.maxX - 4\.7/);
  assert.match(script, /Host 工作中/);
  assert.doesNotMatch(script, /topSheen/);
  assert.doesNotMatch(script, /bottomLine/);
  assert.doesNotMatch(script, /drawIslandImage/);
  assert.match(script, /打开控制台/);
  assert.match(packageJson, /"menubar": "swift scripts\/macos-pending-island\.swift"/);
});
