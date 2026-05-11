#!/usr/bin/env swift

import Cocoa
import Foundation

private struct PendingSummary: Decodable {
  let activeCount: Int?
  let displayCount: Int?
  let hardPendingCount: Int
  let progressCount: Int
  let runningHostThreadCount: Int?
  let label: String
  let generatedAtMs: Double?
}

private final class PendingPopoverViewController: NSViewController {
  private let titleLabel = NSTextField(labelWithString: "0 项待查看")
  private let detailLabel = NSTextField(labelWithString: "0 项需处理 · 0 项新进展")
  private let hintLabel = NSTextField(labelWithString: "点击徽章打开任务控制台")

  override func loadView() {
    let root = NSView(frame: NSRect(x: 0, y: 0, width: 252, height: 86))
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

  func update(displayCount: Int, hardPendingCount: Int, progressCount: Int, runningHostThreadCount: Int, connected: Bool) {
    titleLabel.stringValue = connected
      ? "\(runningHostThreadCount) Host 工作中 · \(displayCount) 待查看"
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
  private var animationTimer: Timer?
  private let popover = NSPopover()
  private let popoverController = PendingPopoverViewController()
  private var hidePopoverWorkItem: DispatchWorkItem?
  private var displayCount = 0
  private var hardPendingCount = 0
  private var progressCount = 0
  private var runningHostThreadCount = 0
  private var workActivityPhase = 0
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
    updateBadge(count: 0, hardPendingCount: 0, progressCount: 0, runningHostThreadCount: 0, connected: true)
    refreshNow(nil)

    timer = Timer.scheduledTimer(withTimeInterval: refreshInterval, repeats: true) { [weak self] _ in
      self?.refreshNow(nil)
    }
    animationTimer = Timer.scheduledTimer(withTimeInterval: 0.42, repeats: true) { [weak self] _ in
      self?.advanceWorkActivity()
    }
  }

  private func configurePopover() {
    popover.behavior = .transient
    popover.animates = true
    popover.contentSize = NSSize(width: 252, height: 86)
    popover.contentViewController = popoverController
  }

  @objc private func refreshNow(_ sender: Any?) {
    let endpoint = baseURL.appendingPathComponent("api/pending-summary")
    URLSession.shared.dataTask(with: endpoint) { [weak self] data, _, error in
      guard let self else { return }

      if let error {
        DispatchQueue.main.async {
          self.updateBadge(count: 0, hardPendingCount: 0, progressCount: 0, runningHostThreadCount: 0, connected: false)
        }
        return
      }

      guard
        let data,
        let summary = try? JSONDecoder().decode(PendingSummary.self, from: data)
      else {
        DispatchQueue.main.async {
          self.updateBadge(count: 0, hardPendingCount: 0, progressCount: 0, runningHostThreadCount: 0, connected: false)
        }
        return
      }

      DispatchQueue.main.async {
        let badgeCount = summary.displayCount ?? summary.activeCount ?? (summary.hardPendingCount + summary.progressCount)
        let hostCount = summary.runningHostThreadCount ?? 0
        self.updateBadge(
          count: badgeCount,
          hardPendingCount: summary.hardPendingCount,
          progressCount: summary.progressCount,
          runningHostThreadCount: hostCount,
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
      runningHostThreadCount: runningHostThreadCount,
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

  private func updateBadge(count: Int, hardPendingCount: Int = 0, progressCount: Int, runningHostThreadCount: Int, connected: Bool) {
    self.displayCount = count
    self.hardPendingCount = hardPendingCount
    self.progressCount = progressCount
    self.runningHostThreadCount = runningHostThreadCount
    self.connected = connected

    let image = drawBadgeImage(pendingCount: count, hostCount: runningHostThreadCount, connected: connected)

    statusItem?.length = image.size.width + 2
    statusItem?.button?.title = ""
    statusItem?.button?.image = image
    statusItem?.button?.toolTip = connected
      ? "\(count) 项待查看，\(runningHostThreadCount) 个 Host 工作中：\(hardPendingCount) 项需处理，\(progressCount) 项新进展"
      : "Agent Mission Control 未连接"
    popoverController.update(
      displayCount: count,
      hardPendingCount: hardPendingCount,
      progressCount: progressCount,
      runningHostThreadCount: runningHostThreadCount,
      connected: connected
    )
  }

  private func advanceWorkActivity() {
    guard connected, runningHostThreadCount > 0 else { return }
    workActivityPhase = (workActivityPhase + 1) % 3
    statusItem?.button?.image = drawBadgeImage(
      pendingCount: displayCount,
      hostCount: runningHostThreadCount,
      connected: connected
    )
  }

  private func compactCountTitle(_ count: Int) -> String {
    if count > 9 {
      return "9\u{0307}"
    }

    return "\(max(0, count))"
  }

  private func drawBadgeImage(pendingCount: Int, hostCount: Int, connected: Bool) -> NSImage {
    if !connected {
      return drawDisconnectedBadgeImage()
    }

    let size = NSSize(width: 32, height: 22)
    let image = NSImage(size: size)

    image.lockFocus()
    defer { image.unlockFocus() }

    let rect = NSRect(x: 1.25, y: 1.25, width: size.width - 2.5, height: size.height - 2.5)
    let badge = NSBezierPath(roundedRect: rect, xRadius: 7.5, yRadius: 7.5)
    NSColor(calibratedWhite: 0.08, alpha: 0.78).setFill()
    badge.fill()

    let innerRect = rect.insetBy(dx: 1.1, dy: 1.1)
    let innerStroke = NSBezierPath(roundedRect: innerRect, xRadius: 6.4, yRadius: 6.4)
    NSColor.white.withAlphaComponent(0.08).setStroke()
    innerStroke.lineWidth = 0.8
    innerStroke.stroke()

    NSColor.white.withAlphaComponent(0.24).setStroke()
    badge.lineWidth = 1
    badge.stroke()

    NSColor.white.withAlphaComponent(0.16).setStroke()
    let divider = NSBezierPath()
    divider.move(to: NSPoint(x: size.width / 2, y: 4.4))
    divider.line(to: NSPoint(x: size.width / 2, y: size.height - 4.4))
    divider.lineWidth = 0.8
    divider.stroke()

    drawSegmentCount(hostCount, in: NSRect(x: 0, y: 0, width: size.width / 2, height: size.height), activeColor: NSColor.systemBlue, showsWorkActivity: true)
    drawSegmentCount(pendingCount, in: NSRect(x: size.width / 2, y: 0, width: size.width / 2, height: size.height), activeColor: NSColor.systemOrange)

    return image
  }

  private func drawSegmentCount(_ count: Int, in rect: NSRect, activeColor: NSColor, showsWorkActivity: Bool = false) {
    let overflow = count > 9
    let glyph = compactCountTitle(count).replacingOccurrences(of: "\u{0307}", with: "")
    let font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .semibold)
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    let textAttributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: NSColor(calibratedWhite: count == 0 ? 0.86 : 0.98, alpha: 1),
      .paragraphStyle: paragraph,
    ]
    let textSize = (glyph as NSString).size(withAttributes: textAttributes)
    let textRect = NSRect(
      x: rect.minX,
      y: rect.minY + (rect.height - textSize.height) / 2 - 0.7,
      width: rect.width,
      height: textSize.height + 2
    )
    (glyph as NSString).draw(in: textRect, withAttributes: textAttributes)

    if showsWorkActivity && count > 0 {
      drawWorkActivity(in: rect, color: activeColor)
      return
    }

    if overflow {
      NSColor(calibratedWhite: 0.08, alpha: 0.96).setFill()
      NSBezierPath(ovalIn: NSRect(x: rect.maxX - 6.2, y: rect.maxY - 6.9, width: 4.8, height: 4.8)).fill()
      activeColor.withAlphaComponent(0.95).setFill()
      NSBezierPath(ovalIn: NSRect(x: rect.maxX - 5.3, y: rect.maxY - 6.0, width: 3.0, height: 3.0)).fill()
    } else if count > 0 {
      activeColor.withAlphaComponent(0.86).setFill()
      NSBezierPath(ovalIn: NSRect(x: rect.maxX - 4.7, y: rect.minY + 4.1, width: 2.5, height: 2.5)).fill()
    }
  }

  private func drawWorkActivity(in rect: NSRect, color: NSColor) {
    for index in 0..<3 {
      let alpha = index == workActivityPhase ? 0.92 : 0.30
      color.withAlphaComponent(alpha).setFill()
      let dot = NSRect(
        x: rect.midX - 4.1 + CGFloat(index) * 2.8,
        y: rect.minY + 2.7,
        width: 1.9,
        height: 1.9
      )
      NSBezierPath(ovalIn: dot).fill()
    }
  }

  private func drawDisconnectedBadgeImage() -> NSImage {
    let size = NSSize(width: 22, height: 22)
    let image = NSImage(size: size)

    image.lockFocus()
    defer { image.unlockFocus() }

    let rect = NSRect(x: 1.25, y: 1.25, width: size.width - 2.5, height: size.height - 2.5)
    let badge = NSBezierPath(roundedRect: rect, xRadius: 7.5, yRadius: 7.5)
    NSColor(calibratedRed: 0.25, green: 0.07, blue: 0.07, alpha: 0.80).setFill()
    badge.fill()

    NSColor.white.withAlphaComponent(0.32).setStroke()
    badge.lineWidth = 1
    badge.stroke()

    let font = NSFont.monospacedDigitSystemFont(ofSize: 14, weight: .semibold)
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    let textAttributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: NSColor(calibratedWhite: 0.98, alpha: 1),
      .paragraphStyle: paragraph,
    ]
    let textSize = ("!" as NSString).size(withAttributes: textAttributes)
    let textRect = NSRect(
      x: 0,
      y: (size.height - textSize.height) / 2 - 0.8,
      width: size.width,
      height: textSize.height + 2
    )
    ("!" as NSString).draw(in: textRect, withAttributes: textAttributes)

    NSColor.systemRed.withAlphaComponent(0.90).setFill()
    NSBezierPath(ovalIn: NSRect(x: 16.0, y: 4.0, width: 3.2, height: 3.2)).fill()

    return image
  }
}

let app = NSApplication.shared
private let delegate = PendingIslandApp()
app.delegate = delegate
app.run()
