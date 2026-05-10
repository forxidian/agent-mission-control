#!/usr/bin/env swift

import Cocoa
import Foundation

private struct PendingSummary: Decodable {
  let activeCount: Int?
  let displayCount: Int?
  let hardPendingCount: Int
  let progressCount: Int
  let label: String
  let generatedAtMs: Double?
}

private final class PendingPopoverViewController: NSViewController {
  private let titleLabel = NSTextField(labelWithString: "0 项待查看")
  private let detailLabel = NSTextField(labelWithString: "0 项需处理 · 0 项新进展")
  private let hintLabel = NSTextField(labelWithString: "点击徽章打开任务控制台")

  override func loadView() {
    let root = NSView(frame: NSRect(x: 0, y: 0, width: 218, height: 82))
    root.wantsLayer = true
    root.layer?.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.96).cgColor

    let stack = NSStackView()
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 5
    stack.translatesAutoresizingMaskIntoConstraints = false

    titleLabel.font = NSFont.systemFont(ofSize: 14, weight: .semibold)
    titleLabel.textColor = .labelColor
    detailLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .medium)
    detailLabel.textColor = .secondaryLabelColor
    hintLabel.font = NSFont.systemFont(ofSize: 11, weight: .regular)
    hintLabel.textColor = .tertiaryLabelColor

    stack.addArrangedSubview(titleLabel)
    stack.addArrangedSubview(detailLabel)
    stack.addArrangedSubview(hintLabel)
    root.addSubview(stack)

    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 14),
      stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -14),
      stack.centerYAnchor.constraint(equalTo: root.centerYAnchor),
    ])

    view = root
  }

  func update(displayCount: Int, hardPendingCount: Int, progressCount: Int, connected: Bool) {
    titleLabel.stringValue = connected
      ? (displayCount > 0 ? "\(displayCount) 项待查看" : "暂无待查看")
      : "未连接任务控制台"
    detailLabel.stringValue = connected
      ? "\(hardPendingCount) 项需处理 · \(progressCount) 项新进展"
      : "请确认本地服务已启动"
    hintLabel.stringValue = connected
      ? "点击徽章切回任务控制台"
      : "点击徽章尝试打开控制台"
  }
}

private final class PendingIslandApp: NSObject, NSApplicationDelegate {
  private let baseURL: URL
  private let baseURLText: String
  private let refreshInterval: TimeInterval
  private var statusItem: NSStatusItem?
  private var timer: Timer?
  private let popover = NSPopover()
  private let popoverController = PendingPopoverViewController()
  private var hidePopoverWorkItem: DispatchWorkItem?
  private var displayCount = 0
  private var hardPendingCount = 0
  private var progressCount = 0
  private var connected = true

  override init() {
    let environment = ProcessInfo.processInfo.environment
    let urlString = environment["AGENT_MISSION_CONTROL_URL"] ?? "http://127.0.0.1:4629"
    self.baseURL = URL(string: urlString) ?? URL(string: "http://127.0.0.1:4629")!
    self.baseURLText = self.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    self.refreshInterval = TimeInterval(environment["AGENT_MISSION_CONTROL_REFRESH_SECONDS"] ?? "") ?? 10
    super.init()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)

    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    self.statusItem = item
    item.button?.imagePosition = .imageOnly
    item.button?.imageScaling = .scaleProportionallyDown
    item.button?.toolTip = "Agent Mission Control 待处理"
    item.button?.target = self
    item.button?.action = #selector(openDashboard(_:))
    item.button?.sendAction(on: [.leftMouseUp])
    item.button?.addTrackingArea(NSTrackingArea(
      rect: .zero,
      options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
      owner: self,
      userInfo: nil
    ))

    configurePopover()
    updateBadge(count: 0, hardPendingCount: 0, progressCount: 0, connected: true)
    refreshNow(nil)

    timer = Timer.scheduledTimer(withTimeInterval: refreshInterval, repeats: true) { [weak self] _ in
      self?.refreshNow(nil)
    }
  }

  private func configurePopover() {
    popover.behavior = .transient
    popover.animates = true
    popover.contentSize = NSSize(width: 218, height: 82)
    popover.contentViewController = popoverController
  }

  @objc private func refreshNow(_ sender: Any?) {
    let endpoint = baseURL.appendingPathComponent("api/pending-summary")
    URLSession.shared.dataTask(with: endpoint) { [weak self] data, _, error in
      guard let self else { return }

      if let error {
        DispatchQueue.main.async {
          self.updateBadge(count: 0, hardPendingCount: 0, progressCount: 0, connected: false)
        }
        return
      }

      guard
        let data,
        let summary = try? JSONDecoder().decode(PendingSummary.self, from: data)
      else {
        DispatchQueue.main.async {
          self.updateBadge(count: 0, hardPendingCount: 0, progressCount: 0, connected: false)
        }
        return
      }

      DispatchQueue.main.async {
        let badgeCount = summary.displayCount ?? summary.activeCount ?? (summary.hardPendingCount + summary.progressCount)
        self.updateBadge(
          count: badgeCount,
          hardPendingCount: summary.hardPendingCount,
          progressCount: summary.progressCount,
          connected: true
        )
      }
    }.resume()
  }

  @objc private func openDashboard(_ sender: Any?) {
    popover.close()
    if focusExistingDashboardTab() {
      return
    }

    NSWorkspace.shared.open(baseURL)
  }

  private func focusExistingDashboardTab() -> Bool {
    let target = appleScriptString(baseURLText)
    let targetSlash = appleScriptString("\(baseURLText)/")
    let script = """
    set targetUrl to "\(target)"
    set targetUrlSlash to "\(targetSlash)"

    if application "Google Chrome" is running then
      tell application "Google Chrome"
        repeat with browserWindow in windows
          set tabIndex to 1
          repeat with browserTab in tabs of browserWindow
            set tabUrl to URL of browserTab
            if tabUrl is targetUrl or tabUrl starts with targetUrlSlash then
              set active tab index of browserWindow to tabIndex
              set index of browserWindow to 1
              activate
              return "found"
            end if
            set tabIndex to tabIndex + 1
          end repeat
        end repeat
      end tell
    end if

    if application "Safari" is running then
      tell application "Safari"
        repeat with browserWindow in windows
          repeat with browserTab in tabs of browserWindow
            set tabUrl to URL of browserTab
            if tabUrl is targetUrl or tabUrl starts with targetUrlSlash then
              set current tab of browserWindow to browserTab
              set index of browserWindow to 1
              activate
              return "found"
            end if
          end repeat
        end repeat
      end tell
    end if

    return "not-found"
    """

    let process = Process()
    let output = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    process.arguments = ["-e", script]
    process.standardOutput = output
    process.standardError = Pipe()

    do {
      try process.run()
      process.waitUntilExit()
      guard process.terminationStatus == 0 else { return false }
      let data = output.fileHandleForReading.readDataToEndOfFile()
      let result = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
      return result == "found"
    } catch {
      return false
    }
  }

  private func appleScriptString(_ value: String) -> String {
    value
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "\"", with: "\\\"")
  }

  func mouseEntered(with event: NSEvent) {
    showPopover()
  }

  func mouseExited(with event: NSEvent) {
    schedulePopoverHide()
  }

  private func showPopover() {
    hidePopoverWorkItem?.cancel()
    popoverController.update(
      displayCount: displayCount,
      hardPendingCount: hardPendingCount,
      progressCount: progressCount,
      connected: connected
    )

    guard let button = statusItem?.button, !popover.isShown else { return }
    popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
  }

  private func schedulePopoverHide() {
    hidePopoverWorkItem?.cancel()
    let workItem = DispatchWorkItem { [weak self] in
      self?.popover.close()
    }
    hidePopoverWorkItem = workItem
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: workItem)
  }

  private func updateBadge(count: Int, hardPendingCount: Int = 0, progressCount: Int, connected: Bool) {
    self.displayCount = count
    self.hardPendingCount = hardPendingCount
    self.progressCount = progressCount
    self.connected = connected

    let image = drawBadgeImage(count: count, connected: connected)

    statusItem?.length = image.size.width + 4
    statusItem?.button?.title = ""
    statusItem?.button?.image = image
    statusItem?.button?.toolTip = connected
      ? "\(count) 项待查看：\(hardPendingCount) 项需处理，\(progressCount) 项新进展"
      : "Agent Mission Control 未连接"
    popoverController.update(
      displayCount: count,
      hardPendingCount: hardPendingCount,
      progressCount: progressCount,
      connected: connected
    )
  }

  private func compactCountTitle(_ count: Int) -> String {
    if count > 9 {
      return "9\u{0307}"
    }

    return "\(max(0, count))"
  }

  private func drawBadgeImage(count: Int, connected: Bool) -> NSImage {
    let overflow = connected && count > 9
    let glyph = connected ? compactCountTitle(count).replacingOccurrences(of: "\u{0307}", with: "") : "!"
    let size = NSSize(width: 22, height: 22)
    let image = NSImage(size: size)

    image.lockFocus()
    defer { image.unlockFocus() }

    let rect = NSRect(x: 1.25, y: 1.25, width: size.width - 2.5, height: size.height - 2.5)
    let badge = NSBezierPath(roundedRect: rect, xRadius: 7.5, yRadius: 7.5)
    let badgeFill = connected
      ? NSColor(calibratedWhite: 0.08, alpha: 0.78)
      : NSColor(calibratedRed: 0.25, green: 0.07, blue: 0.07, alpha: 0.80)

    badgeFill.setFill()
    badge.fill()

    let innerRect = rect.insetBy(dx: 1.1, dy: 1.1)
    let innerStroke = NSBezierPath(roundedRect: innerRect, xRadius: 6.4, yRadius: 6.4)
    NSColor.white.withAlphaComponent(0.08).setStroke()
    innerStroke.lineWidth = 0.8
    innerStroke.stroke()

    NSColor.white.withAlphaComponent(connected ? 0.24 : 0.32).setStroke()
    badge.lineWidth = 1
    badge.stroke()

    let font = NSFont.monospacedDigitSystemFont(ofSize: 14, weight: .semibold)
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    let textAttributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: NSColor(calibratedWhite: connected && count == 0 ? 0.90 : 0.98, alpha: 1),
      .paragraphStyle: paragraph,
    ]
    let textSize = (glyph as NSString).size(withAttributes: textAttributes)
    let textRect = NSRect(
      x: 0,
      y: (size.height - textSize.height) / 2 - 0.8,
      width: size.width,
      height: textSize.height + 2
    )
    (glyph as NSString).draw(in: textRect, withAttributes: textAttributes)

    if overflow {
      NSColor(calibratedWhite: 0.08, alpha: 0.96).setFill()
      NSBezierPath(ovalIn: NSRect(x: 14.6, y: 14.8, width: 5.4, height: 5.4)).fill()
      NSColor.systemOrange.withAlphaComponent(0.95).setFill()
      NSBezierPath(ovalIn: NSRect(x: 15.6, y: 15.8, width: 3.4, height: 3.4)).fill()
    } else if connected && count > 0 {
      NSColor.systemOrange.withAlphaComponent(0.84).setFill()
      NSBezierPath(ovalIn: NSRect(x: 16.2, y: 4.2, width: 2.8, height: 2.8)).fill()
    } else if !connected {
      NSColor.systemRed.withAlphaComponent(0.90).setFill()
      NSBezierPath(ovalIn: NSRect(x: 16.0, y: 4.0, width: 3.2, height: 3.2)).fill()
    }

    return image
  }
}

let app = NSApplication.shared
private let delegate = PendingIslandApp()
app.delegate = delegate
app.run()
